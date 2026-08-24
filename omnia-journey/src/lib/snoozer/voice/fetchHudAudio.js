import { buildApiUrl } from "@/lib/apiBase";

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
  return buildApiUrl(path);
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
  const clean = String(base64 || "").replace(/^data:[^;]+;base64,/, "");
  const binary = window.atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);

  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: contentType });
}

function normalizeTtsPayload(payload) {
  const root =
    payload?.data && typeof payload.data === "object" ? payload.data : payload || {};

  const audioUrl = [
    root?.audioUrl,
    root?.url,
    root?.signedUrl,
    root?.s3Url,
    root?.fileUrl,
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);

  const audioBase64 = [
    root?.audioBase64,
    root?.base64,
    root?.audioContent,
    root?.audio,
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);

  const contentType = [
    root?.contentType,
    root?.mimeType,
    root?.content_type,
    "audio/mpeg",
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);

  const error = [
    root?.error,
    root?.message,
    root?.error?.message,
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);

  return {
    ok: Boolean(root?.ok !== false && (audioUrl || audioBase64 || !error)),
    audioUrl: audioUrl || null,
    audioBase64: audioBase64 || null,
    contentType: contentType || "audio/mpeg",
    cacheHit: Boolean(root?.cacheHit),
    error: error || null,
    durationMs: Number.isFinite(Number(root?.durationMs))
      ? Number(root.durationMs)
      : null,
  };
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

    const retrievalMs =
      (typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now()) - startedAt;
    const responseContentType = String(response.headers.get("content-type") || "").trim();

    if (!response.ok) {
      const payload = responseContentType.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text().catch(() => null);
      markAudioFailure(`http_${response.status}`, {
        openBreaker: response.status >= 500 || response.status === 429,
        retrievalMs,
      });
      if (payload) {
        console.warn("[hud.audio] backend error payload", payload);
      }
      return null;
    }

    if (
      responseContentType.startsWith("audio/") ||
      responseContentType.includes("application/octet-stream")
    ) {
      const blob = await response.blob();
      if (!blob?.size) {
        markAudioFailure("empty_audio_blob", {
          openBreaker: false,
          retrievalMs,
        });
        return null;
      }

      return {
        audioUrl: null,
        blob,
        contentType: blob.type || responseContentType || "audio/mpeg",
        durationMs: null,
        cleanup: null,
      };
    }

    const payload = await response.json().catch(() => null);
    const normalized = normalizeTtsPayload(payload);

    if (!normalized.ok) {
      markAudioFailure(normalized.error || "tts_error", {
        openBreaker: false,
        retrievalMs,
      });
      return null;
    }

    if (!normalized.audioUrl && !normalized.audioBase64) {
      markAudioFailure("missing_audio_payload", {
        openBreaker: false,
        retrievalMs,
      });
      return null;
    }

    if (normalized.audioUrl) {
      return {
        audioUrl: normalized.audioUrl,
        blob: null,
        contentType: normalized.contentType,
        durationMs: normalized.durationMs,
        cleanup: () => {},
      };
    }

    return {
      audioUrl: null,
      blob: base64ToBlob(normalized.audioBase64, normalized.contentType),
      contentType: normalized.contentType,
      durationMs: normalized.durationMs,
      cleanup: null,
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

  if (resolved?.audioUrl) {
    markAudioSuccess();
    setCachedAudio(cacheKey, Promise.resolve(resolved));
    return {
      audioUrl: resolved.audioUrl,
      durationMs: resolved.durationMs,
      cacheKey,
      cleanup: typeof resolved.cleanup === "function" ? resolved.cleanup : () => {},
    };
  }

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
