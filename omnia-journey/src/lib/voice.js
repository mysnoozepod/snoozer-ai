// src/lib/voice.js
import { buildApiUrl } from "@/lib/apiBase";

const DEFAULTS = {
  voiceId: "Ruth",
  engine: "generative",
  format: "mp3",
};

let audio = null;
let audioUrl = "";
let requestSeq = 0;
let unlocked = false;

let state = {
  ready: false,
  loading: false,
  playing: false,
  blocked: false,
  error: "",
  lastText: "",
};

const subscribers = new Set();

function emit() {
  const snapshot = { ...state, unlocked };
  subscribers.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      // ignore subscriber errors
    }
  });
}

function setState(patch = {}) {
  state = { ...state, ...patch };
  emit();
}

function toAbsoluteApiUrl(path) {
  return buildApiUrl(path);
}

function stripBase64Prefix(value) {
  return String(value || "").replace(/^data:[^;]+;base64,/, "");
}

function base64ToBlobUrl(base64, contentType = "audio/mpeg") {
  const clean = stripBase64Prefix(base64);
  const byteChars = atob(clean);
  const byteNums = new Array(byteChars.length);

  for (let i = 0; i < byteChars.length; i += 1) {
    byteNums[i] = byteChars.charCodeAt(i);
  }

  const byteArray = new Uint8Array(byteNums);
  const blob = new Blob([byteArray], { type: contentType });
  return URL.createObjectURL(blob);
}

function revokeAudioUrl() {
  if (!audioUrl) return;

  try {
    URL.revokeObjectURL(audioUrl);
  } catch {
    // ignore
  }

  audioUrl = "";
}

function detachAudioEvents(target) {
  if (!target) return;
  target.onplay = null;
  target.onended = null;
  target.onpause = null;
  target.onerror = null;
}

function attachAudio(nextAudio) {
  if (audio && audio !== nextAudio) {
    detachAudioEvents(audio);
  }

  audio = nextAudio;

  if (!audio) return;

  audio.onplay = () => {
    setState({
      playing: true,
      blocked: false,
      error: "",
    });
  };

  audio.onended = () => {
    setState({
      playing: false,
      error: "",
    });
  };

  audio.onpause = () => {
    setState({
      playing: false,
    });
  };

  audio.onerror = () => {
    setState({
      playing: false,
      error: "Audio playback failed.",
    });
  };
}

function normalizeVoicePayload(json) {
  const root = json?.data || json || {};

  return {
    audioBase64:
      root?.audioBase64 ||
      root?.base64 ||
      root?.audioContent ||
      root?.audio ||
      null,
    audioUrl:
      root?.audioUrl ||
      root?.url ||
      root?.signedUrl ||
      root?.fileUrl ||
      null,
    contentType:
      root?.contentType ||
      root?.mimeType ||
      root?.content_type ||
      "audio/mpeg",
    raw: root,
  };
}

function markUnlocked() {
  unlocked = true;
  setState({ blocked: false });
}

function installUnlockListeners() {
  if (typeof window === "undefined") return;

  const unlock = () => {
    markUnlocked();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
    window.removeEventListener("touchstart", unlock);
  };

  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
  window.addEventListener("touchstart", unlock, { passive: true });
}

installUnlockListeners();

function isAutoplayBlockedMessage(msg = "") {
  return /user didn't interact|notallowederror|play\(\) failed/i.test(String(msg || ""));
}

function isInterruptedReplaceMessage(msg = "") {
  return /interrupted by a call to pause\(\)|the play\(\) request was interrupted/i.test(
    String(msg || "")
  );
}

async function fetchVoicePayload({
  text,
  shopperId = "guest",
  voiceId = DEFAULTS.voiceId,
  engine = DEFAULTS.engine,
  format = DEFAULTS.format,
}) {
  const res = await fetch(toAbsoluteApiUrl("/voice/welcome"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, audio/mpeg, audio/*",
    },
    body: JSON.stringify({
      shopperId: shopperId || "guest",
      text,
      voiceId,
      engine,
      format,
    }),
  });

  const contentType = (res.headers.get("content-type") || "").toLowerCase();

  if (!res.ok) {
    let json = null;
    let textBody = "";

    if (contentType.includes("application/json")) {
      json = await res.json().catch(() => null);
    } else {
      textBody = await res.text().catch(() => "");
    }

    throw new Error(
      json?.error?.message ||
        json?.message ||
        textBody ||
        "Voice request failed"
    );
  }

  if (contentType.startsWith("audio/") || contentType.includes("application/octet-stream")) {
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);

    return {
      mode: "blob",
      audioUrl: objectUrl,
      contentType: blob.type || "audio/mpeg",
      cleanup: () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          // ignore
        }
      },
      raw: null,
    };
  }

  const json = await res.json().catch(() => null);
  const payload = normalizeVoicePayload(json);

  if (payload.audioUrl) {
    return {
      mode: "url",
      audioUrl: payload.audioUrl,
      contentType: payload.contentType,
      cleanup: () => {},
      raw: payload.raw,
    };
  }

  if (payload.audioBase64) {
    const objectUrl = base64ToBlobUrl(payload.audioBase64, payload.contentType || "audio/mpeg");

    return {
      mode: "base64",
      audioUrl: objectUrl,
      contentType: payload.contentType || "audio/mpeg",
      cleanup: () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          // ignore
        }
      },
      raw: payload.raw,
    };
  }

  throw new Error("Voice response missing playable audio.");
}

function stopVoice() {
  if (audio) {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // ignore
    }
  }

  setState({ playing: false });
}

function cleanupVoice() {
  stopVoice();
  detachAudioEvents(audio);
  attachAudio(null);
  revokeAudioUrl();
  requestSeq += 1;
  setState({
    ready: false,
    loading: false,
    playing: false,
    blocked: false,
    error: "",
  });
}

async function tryPlay(targetAudio) {
  targetAudio.preload = "auto";
  targetAudio.playsInline = true;
  targetAudio.crossOrigin = "anonymous";
  return await targetAudio.play();
}

async function speakText(text, opts = {}) {
  const phrase = String(text || "").trim();
  if (!phrase) return { ok: false, skipped: true, reason: "empty_text" };
  if (opts.muted && !opts.force) return { ok: false, skipped: true, reason: "muted" };

  const seq = ++requestSeq;

  setState({
    loading: true,
    blocked: false,
    error: "",
    lastText: phrase,
  });

  let fetched = null;

  try {
    fetched = await fetchVoicePayload({
      text: phrase,
      shopperId: opts.shopperId,
      voiceId: opts.voiceId,
      engine: opts.engine,
      format: opts.format,
    });

    if (seq !== requestSeq) {
      try {
        fetched?.cleanup?.();
      } catch {
        // ignore
      }
      return { ok: false, skipped: true, reason: "stale_request" };
    }

    stopVoice();
    revokeAudioUrl();

    audioUrl = fetched.audioUrl || "";
    const nextAudio = new Audio(audioUrl);
    attachAudio(nextAudio);

    setState({ ready: true });

    try {
      await tryPlay(nextAudio);
    } catch (err) {
      const msg = String(err?.message || err || "");

      if (seq !== requestSeq || isInterruptedReplaceMessage(msg)) {
        return {
          ok: false,
          skipped: true,
          reason: "interrupted_replace",
        };
      }

      const blocked = isAutoplayBlockedMessage(msg);

      if (blocked) {
        setState({
          blocked: true,
          playing: false,
          error: "",
        });

        return { ok: false, blocked: true, error: err };
      }

      throw err;
    }

    return {
      ok: true,
      payload: fetched?.raw || null,
      mode: fetched?.mode || "unknown",
      audioUrl,
    };
  } catch (err) {
    const msg = String(err?.message || err || "");

    if (seq !== requestSeq || isInterruptedReplaceMessage(msg)) {
      return {
        ok: false,
        skipped: true,
        reason: "interrupted_replace",
      };
    }

    const blocked = isAutoplayBlockedMessage(msg);

    setState({
      blocked,
      error: blocked ? "" : msg || "Unable to play voice.",
    });

    return { ok: false, error: err, blocked };
  } finally {
    if (seq === requestSeq) {
      setState({ loading: false });
    }
  }
}

function getVoiceState() {
  return { ...state, unlocked };
}

function subscribeVoice(listener) {
  if (typeof listener !== "function") return () => {};
  subscribers.add(listener);
  listener({ ...state, unlocked });

  return () => {
    subscribers.delete(listener);
  };
}

export {
  DEFAULTS as SNOOZER_VOICE_DEFAULTS,
  cleanupVoice,
  getVoiceState,
  speakText,
  stopVoice,
  subscribeVoice,
  toAbsoluteApiUrl,
};
