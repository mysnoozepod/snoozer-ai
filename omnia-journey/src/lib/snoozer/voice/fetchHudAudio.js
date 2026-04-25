const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
const AUDIO_CACHE = new Map();
const AUDIO_CACHE_MAX = 48;
const HUD_AUDIO_TIMEOUT_MS = Number(import.meta.env.VITE_HUD_AUDIO_TIMEOUT_MS || 2000);
const HUD_AUDIO_LONG_TIMEOUT_MS = Number(
  import.meta.env.VITE_HUD_AUDIO_LONG_TIMEOUT_MS || 4500
);
const HUD_AUDIO_LONG_TEXT_THRESHOLD = Number(
  import.meta.env.VITE_HUD_AUDIO_LONG_TEXT_THRESHOLD || 220
);
const HUD_AUDIO_FAILURE_THRESHOLD = 2;
const HUD_AUDIO_COOLDOWN_MS = 10000;
const hudAudioBreaker = {
  consecutiveFailures: 0,
  openUntil: 0,
};

function toApiUrl(path) {
  const cleanPath = String(path || "").startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${cleanPath}` : cleanPath;
}

function nowMs() {
  return Date.now();
}

function browserOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

function isAudioBreakerOpen() {
  return hudAudioBreaker.openUntil > nowMs();
}

function markAudioSuccess() {
  hudAudioBreaker.consecutiveFailures = 0;
  hudAudioBreaker.openUntil = 0;
}

function markAudioFailure(reason, { openBreaker = true, retrievalMs = 0 } = {}) {
  hudAudioBreaker.consecutiveFailures += 1;

  if (
    openBreaker &&
    hudAudioBreaker.consecutiveFailures >= HUD_AUDIO_FAILURE_THRESHOLD
  ) {
    hudAudioBreaker.openUntil = nowMs() + HUD_AUDIO_COOLDOWN_MS;
  }

  console.warn("[hud.audio] degraded", {
    reason,
    retrievalMs: Math.round(Number(retrievalMs) || 0),
    breakerOpen: isAudioBreakerOpen(),
    cooldownMs: Math.max(hudAudioBreaker.openUntil - nowMs(), 0),
  });
}

function normalizeActionType(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeScriptKey(value) {
  return String(value || "").trim().toLowerCase();
}

function getHudAudioTimeoutMs(job) {
  const speechLength = String(job?.speech || job?.captions || "").trim().length;
  const actionType = normalizeActionType(job?.metadata?.actionType);
  const scriptKey = normalizeScriptKey(job?.metadata?.scriptKey);
  const isPodNarration =
    actionType === "view_details" ||
    actionType === "build_pod" ||
    scriptKey.startsWith("pod.details.") ||
    scriptKey === "pod.build.default";

  if (isPodNarration || speechLength >= HUD_AUDIO_LONG_TEXT_THRESHOLD) {
    return Math.max(HUD_AUDIO_TIMEOUT_MS, HUD_AUDIO_LONG_TIMEOUT_MS);
  }

  return HUD_AUDIO_TIMEOUT_MS;
}

function base64ToBlob(base64, contentType = "audio/mpeg") {
  const binary = window.atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);

  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: contentType });
}

function setCachedAudio(key, value) {
  if (!key) return;

  if (AUDIO_CACHE.has(key)) {
    AUDIO_CACHE.delete(key);
  }

  AUDIO_CACHE.set(key, value);

  while (AUDIO_CACHE.size > AUDIO_CACHE_MAX) {
    const oldestKey = AUDIO_CACHE.keys().next().value;
    AUDIO_CACHE.delete(oldestKey);
  }
}

async function hashValue(input) {
  const text = String(input || "");

  if (window?.crypto?.subtle && typeof TextEncoder !== "undefined") {
    try {
      const bytes = new TextEncoder().encode(text);
      const digest = await window.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      // ignore and fall back to a plain key
    }
  }

  return text;
}

async function buildCacheKey(job) {
  return await hashValue(
    JSON.stringify({
      text: String(job?.speech || "").trim(),
      voiceStyle: String(job?.voiceStyle || "default").trim().toLowerCase(),
      voiceId: String(job?.voiceId || "Ruth").trim(),
      engine: String(job?.engine || "generative").trim().toLowerCase(),
      format: String(job?.format || "mp3").trim().toLowerCase(),
    })
  );
}

async function fetchAndDecodeHudAudio(job) {
  const controller = new AbortController();
  const startedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const timeoutMs = getHudAudioTimeoutMs(job);
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(toApiUrl("/hud/tts"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hud": "true",
      },
      body: JSON.stringify({
        text: job.speech,
        captions: job.captions,
        style: job.voiceStyle || "default",
        voiceId: job.voiceId || "Ruth",
        engine: job.engine || "generative",
        format: job.format || "mp3",
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    const retrievalMs =
      (typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now()) - startedAt;

    if (!response.ok) {
      markAudioFailure(`http_${response.status}`, {
        openBreaker: response.status >= 500 || response.status === 429,
        retrievalMs,
      });
      return null;
    }

    const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;

    const audioBase64 =
      typeof data?.audioBase64 === "string" ? data.audioBase64.trim() : "";

    if (!audioBase64) {
      markAudioFailure("missing_audio_payload", {
        openBreaker: false,
        retrievalMs,
      });
      return null;
    }

    const contentType =
      typeof data?.contentType === "string" && data.contentType.trim()
        ? data.contentType.trim()
        : "audio/mpeg";

    return {
      blob: base64ToBlob(audioBase64, contentType),
      contentType,
      durationMs: Number.isFinite(Number(data?.durationMs))
        ? Number(data.durationMs)
        : null,
    };
  } catch (error) {
    const retrievalMs =
      (typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now()) - startedAt;
    markAudioFailure(error?.name === "AbortError" ? "timeout" : "network", {
      openBreaker: true,
      retrievalMs,
    });
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchHudAudio(job) {
  if (!job?.speech?.trim()) {
    return null;
  }

  const cacheKey = await buildCacheKey(job);
  let cached = AUDIO_CACHE.get(cacheKey);

  if (!cached) {
    if (!browserOnline()) {
      return null;
    }

    if (isAudioBreakerOpen()) {
      return null;
    }

    const pending = fetchAndDecodeHudAudio(job);
    setCachedAudio(cacheKey, pending);
    cached = pending;
  }

  const resolved = await Promise.resolve(cached).catch(() => null);

  if (!resolved?.blob) {
    AUDIO_CACHE.delete(cacheKey);
    return null;
  }

  markAudioSuccess();
  setCachedAudio(cacheKey, Promise.resolve(resolved));

  const audioUrl = URL.createObjectURL(resolved.blob);

  return {
    audioUrl,
    durationMs: resolved.durationMs,
    cacheKey,
    cleanup: () => {
      try {
        URL.revokeObjectURL(audioUrl);
      } catch {
        // ignore
      }
    },
  };
}

export default fetchHudAudio;
