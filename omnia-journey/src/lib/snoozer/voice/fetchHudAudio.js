const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
const AUDIO_CACHE = new Map();
const AUDIO_CACHE_MAX = 48;

function toApiUrl(path) {
  const cleanPath = String(path || "").startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${cleanPath}` : cleanPath;
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
  const timeoutId = window.setTimeout(() => controller.abort(), 6000);

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

    if (!response.ok) {
      console.error("[fetchHudAudio] non-200 response:", response.status, payload);
      return null;
    }

    const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;

    const audioBase64 =
      typeof data?.audioBase64 === "string" ? data.audioBase64.trim() : "";

    if (!audioBase64) {
      console.error("[fetchHudAudio] missing audioBase64 in response:", payload);
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
    if (error?.name !== "AbortError") {
      console.error("[fetchHudAudio] request failed:", error);
    }
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
    const pending = fetchAndDecodeHudAudio(job);
    setCachedAudio(cacheKey, pending);
    cached = pending;
  }

  const resolved = await Promise.resolve(cached).catch(() => null);

  if (!resolved?.blob) {
    AUDIO_CACHE.delete(cacheKey);
    return null;
  }

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
