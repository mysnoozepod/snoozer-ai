// services/hudScripts.js
const { S3Client, GetObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

const REGION = process.env.AWS_REGION || "us-east-1";
const HUD_SCRIPT_BUCKET = process.env.HUD_SCRIPT_BUCKET || "snoozer-assets-prod";
const HUD_SCRIPT_KEY = process.env.HUD_SCRIPT_KEY || "scripts/hud/voice-script-pack.json";
const HUD_SCRIPT_CACHE_TTL_MS = Number(process.env.HUD_SCRIPT_CACHE_TTL_MS || 300000);
const S3_RETRIEVAL_TIMEOUT_MS = Math.max(50, Number(process.env.S3_RETRIEVAL_TIMEOUT_MS || 300));

const s3 = new S3Client({ region: REGION });

let cache = {
  data: null,
  etag: null,
  lastModified: null,
  ts: 0,
};

let inFlightLoad = null;

function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function lower(v) {
  return String(v || "").toLowerCase().trim();
}

function normalizeEtag(etag) {
  if (!etag) return "";
  return String(etag).trim();
}

function normalizeState(v, fallback = "speaking") {
  const s = lower(v);
  if (s === "idle") return "idle";
  if (s === "listening") return "listening";
  if (s === "thinking") return "thinking";
  if (s === "speaking") return "speaking";
  if (s === "celebrate") return "celebrate";
  if (s === "warning") return "warning";
  return fallback;
}

function normalizePriority(v, fallback = "normal") {
  const s = lower(v);
  if (s === "low") return "low";
  if (s === "high") return "high";
  return fallback;
}

function normalizeVoiceStyle(v, fallback = "default") {
  const s = lower(v);
  return s === "calm" ? "calm" : fallback;
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((a) => {
      if (typeof a === "string") return a;
      if (isObject(a)) return a;
      return null;
    })
    .filter(Boolean)
    .slice(0, 12);
}

function clampTtlMs(v, fallback = 5000) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1000, Math.min(Math.round(n), 15000));
}

function withTimeout(promise, timeoutMs, code, message, extra = {}) {
  let timer = null;

  return Promise.race([
    Promise.resolve().then(() => promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(message);
        err.code = code;
        err.timeoutMs = timeoutMs;
        Object.assign(err, extra);
        reject(err);
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function fallbackInlineEntry(key = "fallback.inline") {
  return {
    key,
    speech: "I’m here. Tell me what you want to do next.",
    captions: "I’m here. Tell me what you want to do next.",
    state: "speaking",
    priority: "normal",
    ttlMs: 5000,
    voiceStyle: "default",
    actions: [],
  };
}

function normalizeScriptEntry(entry = {}, key = "") {
  const speech =
    typeof entry?.speech === "string"
      ? entry.speech.trim()
      : typeof entry?.text === "string"
      ? entry.text.trim()
      : "";

  const captions =
    typeof entry?.captions === "string"
      ? entry.captions.trim()
      : speech;

  return {
    key,
    speech: speech || fallbackInlineEntry(key).speech,
    captions: captions || speech || fallbackInlineEntry(key).captions,
    state: normalizeState(entry?.state, "speaking"),
    priority: normalizePriority(entry?.priority, "normal"),
    ttlMs: clampTtlMs(entry?.ttlMs, 5000),
    voiceStyle: normalizeVoiceStyle(entry?.voiceStyle, "default"),
    actions: normalizeActions(entry?.actions),
  };
}

async function streamToString(stream) {
  if (!stream) return "";
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function headScriptPack() {
  const head = await withTimeout(
    s3.send(
      new HeadObjectCommand({
        Bucket: HUD_SCRIPT_BUCKET,
        Key: HUD_SCRIPT_KEY,
      })
    ),
    S3_RETRIEVAL_TIMEOUT_MS,
    "HUD_SCRIPT_HEAD_TIMEOUT",
    `HUD script HEAD exceeded ${S3_RETRIEVAL_TIMEOUT_MS}ms`,
    { bucket: HUD_SCRIPT_BUCKET, key: HUD_SCRIPT_KEY }
  );

  return {
    etag: normalizeEtag(head?.ETag),
    lastModified: head?.LastModified || null,
  };
}

async function fetchScriptPack() {
  const out = await withTimeout(
    s3.send(
      new GetObjectCommand({
        Bucket: HUD_SCRIPT_BUCKET,
        Key: HUD_SCRIPT_KEY,
      })
    ),
    S3_RETRIEVAL_TIMEOUT_MS,
    "HUD_SCRIPT_GET_TIMEOUT",
    `HUD script GET exceeded ${S3_RETRIEVAL_TIMEOUT_MS}ms`,
    { bucket: HUD_SCRIPT_BUCKET, key: HUD_SCRIPT_KEY }
  );

  const raw = await streamToString(out?.Body);
  const parsed = JSON.parse(raw || "{}");

  return isObject(parsed) ? parsed : {};
}

function canonicalKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_/-]+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function buildKeyCandidates(requestedKey) {
  const raw = String(requestedKey || "").trim();
  const canon = canonicalKey(raw);

  const set = new Set();
  if (raw) set.add(raw);
  if (canon) set.add(canon);

  if (canon) {
    set.add(canon.replace(/\.default$/, ""));
    set.add(`${canon}.default`);
  }

  const parts = canon ? canon.split(".").filter(Boolean) : [];
  while (parts.length > 1) {
    parts.pop();
    set.add(`${parts.join(".")}.default`);
  }

  return Array.from(set).filter(Boolean);
}

function extractRawScripts(raw = {}) {
  if (isObject(raw?.scripts)) {
    return raw.scripts;
  }

  const reserved = new Set(["defaults", "version", "updatedAt", "meta"]);
  const out = {};

  for (const [key, value] of Object.entries(raw || {})) {
    if (reserved.has(key)) continue;
    if (!isObject(value)) continue;
    out[key] = value;
  }

  return out;
}

function normalizeFallbackKey(rawFallbackKey, normalizedScripts) {
  const scripts = normalizedScripts || {};
  const preferred = ["fallback.default", "default", "global.default"];

  for (const key of preferred) {
    if (scripts[key]) return key;
  }

  const requested = String(rawFallbackKey || "").trim();
  if (
    requested &&
    /^fallback(\.|$)|^default$|^global\.default$/i.test(requested) &&
    scripts[requested]
  ) {
    return requested;
  }

  return "";
}

function normalizeScriptPack(raw = {}) {
  const scripts = extractRawScripts(raw);
  const normalizedScripts = {};
  const canonicalMap = {};

  for (const [key, value] of Object.entries(scripts)) {
    if (!isObject(value)) continue;

    const normalized = normalizeScriptEntry(value, key);
    normalizedScripts[key] = normalized;

    const canon = canonicalKey(key);
    if (canon && !canonicalMap[canon]) {
      canonicalMap[canon] = key;
    }
  }

  const fallbackKey = normalizeFallbackKey(raw?.defaults?.fallbackKey, normalizedScripts);

  return {
    version: Number(raw?.version || 1),
    updatedAt: raw?.updatedAt || null,
    defaults: {
      fallbackKey,
    },
    scripts: normalizedScripts,
    canonicalMap,
  };
}

async function loadHudScriptPack({ force = false } = {}) {
  const now = Date.now();

  if (!force && cache.data && now - cache.ts < HUD_SCRIPT_CACHE_TTL_MS) {
    return {
      data: cache.data,
      meta: {
        etag: cache.etag,
        lastModified: cache.lastModified,
        bucket: HUD_SCRIPT_BUCKET,
        key: HUD_SCRIPT_KEY,
        cacheHit: true,
        timeoutMs: S3_RETRIEVAL_TIMEOUT_MS,
      },
    };
  }

  if (!force && inFlightLoad) {
    return await inFlightLoad;
  }

  inFlightLoad = (async () => {
    try {
      const head = await headScriptPack();

      if (!force && cache.data && cache.etag && head.etag && cache.etag === head.etag) {
        cache = {
          ...cache,
          lastModified: head.lastModified,
          ts: now,
        };

        return {
          data: cache.data,
          meta: {
            etag: cache.etag,
            lastModified: cache.lastModified,
            bucket: HUD_SCRIPT_BUCKET,
            key: HUD_SCRIPT_KEY,
            cacheHit: true,
            timeoutMs: S3_RETRIEVAL_TIMEOUT_MS,
          },
        };
      }

      const raw = await fetchScriptPack();
      const normalized = normalizeScriptPack(raw);

      cache = {
        data: normalized,
        etag: head.etag || "",
        lastModified: head.lastModified || null,
        ts: Date.now(),
      };

      return {
        data: normalized,
        meta: {
          etag: cache.etag,
          lastModified: cache.lastModified,
          bucket: HUD_SCRIPT_BUCKET,
          key: HUD_SCRIPT_KEY,
          cacheHit: false,
          timeoutMs: S3_RETRIEVAL_TIMEOUT_MS,
        },
      };
    } catch (error) {
      if (cache.data) {
        return {
          data: cache.data,
          meta: {
            etag: cache.etag,
            lastModified: cache.lastModified,
            bucket: HUD_SCRIPT_BUCKET,
            key: HUD_SCRIPT_KEY,
            cacheHit: true,
            stale: true,
            timeoutMs: S3_RETRIEVAL_TIMEOUT_MS,
            error: {
              code: error?.code || "HUD_SCRIPT_LOAD_FAILED",
              message: error?.message || "HUD script load failed",
            },
          },
        };
      }

      throw error;
    } finally {
      inFlightLoad = null;
    }
  })();

  return await inFlightLoad;
}

function resolveByCandidate(scripts, canonicalMap, candidate) {
  if (!candidate) return null;

  if (scripts[candidate]) {
    return {
      entry: scripts[candidate],
      key: candidate,
    };
  }

  const canon = canonicalKey(candidate);
  const mappedKey = canonicalMap[canon];
  if (mappedKey && scripts[mappedKey]) {
    return {
      entry: scripts[mappedKey],
      key: mappedKey,
    };
  }

  return null;
}

async function getHudScript(scriptKey, opts = {}) {
  const requestedKey = String(scriptKey || "").trim();

  let out;
  try {
    out = await loadHudScriptPack(opts);
  } catch (error) {
    return {
      script: fallbackInlineEntry("fallback.inline"),
      key: "fallback.inline",
      meta: {
        bucket: HUD_SCRIPT_BUCKET,
        key: HUD_SCRIPT_KEY,
        cacheHit: false,
        timeoutMs: S3_RETRIEVAL_TIMEOUT_MS,
        fallbackUsed: true,
        error: {
          code: error?.code || "HUD_SCRIPT_LOAD_FAILED",
          message: error?.message || "HUD script load failed",
        },
      },
    };
  }

  const data = out?.data || {};
  const meta = out?.meta || {};
  const scripts = data?.scripts || {};
  const canonicalMap = data?.canonicalMap || {};
  const fallbackKey = data?.defaults?.fallbackKey || "";

  let entry = null;
  let resolvedKey = requestedKey;
  let fallbackUsed = false;

  const candidates = buildKeyCandidates(requestedKey);

  for (const candidate of candidates) {
    const found = resolveByCandidate(scripts, canonicalMap, candidate);
    if (found) {
      entry = found.entry;
      resolvedKey = found.key;
      break;
    }
  }

  if (!entry && fallbackKey) {
    const foundFallback = resolveByCandidate(scripts, canonicalMap, fallbackKey);
    if (foundFallback) {
      entry = foundFallback.entry;
      resolvedKey = foundFallback.key;
      fallbackUsed = true;
    }
  }

  if (!entry) {
    entry = fallbackInlineEntry("fallback.inline");
    resolvedKey = "fallback.inline";
    fallbackUsed = true;
  }

  return {
    script: normalizeScriptEntry(entry, resolvedKey),
    key: resolvedKey,
    meta: {
      ...meta,
      requestedKey,
      fallbackUsed,
    },
  };
}

async function getHudScriptPayload(scriptKey, opts = {}) {
  const out = await getHudScript(scriptKey, opts);
  return {
    ...out.script,
    scriptKey: out.key,
    scriptMeta: out.meta,
  };
}

module.exports = {
  loadHudScriptPack,
  getHudScript,
  getHudScriptPayload,
};