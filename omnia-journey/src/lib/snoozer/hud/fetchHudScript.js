const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
const SCRIPT_CACHE = new Map();
const SCRIPT_CACHE_MAX = 48;

function toApiUrl(path) {
  const cleanPath = String(path || "").startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${cleanPath}` : cleanPath;
}

function clampTtlMs(value, fallback = 5000) {
  const ttl = Number(value);
  if (!Number.isFinite(ttl) || ttl <= 0) return fallback;
  return Math.max(1000, Math.min(15000, Math.round(ttl)));
}

function normalizeHudState(value, fallback = "speaking") {
  const state = String(value || "").trim().toLowerCase();
  if (
    state === "idle" ||
    state === "listening" ||
    state === "thinking" ||
    state === "speaking" ||
    state === "celebrate" ||
    state === "warning"
  ) {
    return state;
  }
  return fallback;
}

function normalizeHudPriority(value, fallback = "normal") {
  const priority = String(value || "").trim().toLowerCase();
  if (priority === "low" || priority === "normal" || priority === "high") {
    return priority;
  }
  return fallback;
}

function normalizeHudPayload(payload) {
  const speech = String(payload?.speech || "").trim();
  const captions = String(payload?.captions || payload?.speech || "").trim();

  if (!speech && !captions) return null;

  return {
    speech: speech || captions,
    captions: captions || speech,
    state: normalizeHudState(payload?.state, "speaking"),
    priority: normalizeHudPriority(payload?.priority, "normal"),
    ttlMs: clampTtlMs(payload?.ttlMs, 5000),
    actions: Array.isArray(payload?.actions) ? payload.actions.slice(0, 12) : [],
    voiceStyle:
      String(payload?.voiceStyle || "").trim().toLowerCase() === "calm"
        ? "calm"
        : "default",
  };
}

function cloneHudPayload(payload) {
  if (!payload) return null;

  return {
    ...payload,
    actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 12) : [],
  };
}

function isBackendFallback(payload) {
  const speech = String(payload?.speech || payload?.captions || "")
    .trim()
    .toLowerCase();

  return (
    speech === "i'm here if you need me." ||
    speech === "i’m here if you need me." ||
    speech === "hud scripts are unavailable right now." ||
    speech === "a script key is required."
  );
}

function setCachedScript(key, value) {
  if (!key) return;

  if (SCRIPT_CACHE.has(key)) {
    SCRIPT_CACHE.delete(key);
  }

  SCRIPT_CACHE.set(key, value);

  while (SCRIPT_CACHE.size > SCRIPT_CACHE_MAX) {
    const oldestKey = SCRIPT_CACHE.keys().next().value;
    SCRIPT_CACHE.delete(oldestKey);
  }
}

export async function fetchHudScript({
  scriptKey,
  shopperId = "guest",
  context = {},
} = {}) {
  const key = String(scriptKey || "").trim();
  if (!key) return null;

  const cached = SCRIPT_CACHE.get(key);
  if (cached) {
    const resolved = await cached.catch(() => null);
    return cloneHudPayload(resolved);
  }

  const pending = (async () => {
    try {
      const response = await fetch(toApiUrl("/hud/script"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hud": "true",
        },
        body: JSON.stringify({
          scriptKey: key,
          shopperId: shopperId || "guest",
          context: context && typeof context === "object" ? context : {},
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) return null;

      const normalized = normalizeHudPayload(payload);
      if (!normalized || isBackendFallback(normalized)) {
        return null;
      }

      return normalized;
    } catch (error) {
      console.warn("[fetchHudScript] request failed:", error);
      return null;
    }
  })();

  setCachedScript(key, pending);

  const resolved = await pending;

  if (!resolved) {
    SCRIPT_CACHE.delete(key);
    return null;
  }

  setCachedScript(key, Promise.resolve(resolved));
  return cloneHudPayload(resolved);
}

export default fetchHudScript;
