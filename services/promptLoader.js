// services/promptLoader.js
// S3-backed prompt loader with:
// • In-memory ETag cache + HEAD validation
// • Token/size guard and newline/BOM normalization
// • Dual metadata parsing (YAML front-matter or header lines)
// • Structured logs, retry w/ backoff, and small LRU eviction
//
// Exports:
//   - getPromptScriptFromS3(key, opts?)
//   - loadPromptFromS3(key, opts?)
//   - invalidatePromptCache(key?, opts?)  // optional cache bust

const {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const REGION = process.env.AWS_REGION || "us-east-1";
const PROMPT_BUCKET = process.env.S3_PROMPT_BUCKET || "snoozer-prompts-prod";
const FILE_EXT = ".md";

// TTL defaults (align with Phase-1)
const DEFAULT_TTL_MS = Number(process.env.BASE_PROMPT_TTL_MS || 5 * 60 * 1000); // 5m
// ~500 tokens ≈ ~2,000 chars (rough heuristic)
const DEFAULT_MAX_CHARS = Number(process.env.PROMPT_MAX_CHARS || 2000);

// Retry/backoff
const MAX_RETRIES = Number(process.env.PROMPT_S3_MAX_RETRIES || 3);
const BASE_DELAY_MS = Number(process.env.PROMPT_S3_BASE_DELAY_MS || 150);

// Cache size guard
const MAX_CACHE_ENTRIES = Number(process.env.PROMPT_CACHE_MAX_ENTRIES || 200);

const s3 = new S3Client({ region: REGION });

// ─────────────────────────────────────────────────────────────────────────────
// Internal LRU cache: id -> { body, etag, lastModified, ts, hits }
// id = `${bucket}/${key}`
// ─────────────────────────────────────────────────────────────────────────────
const cache = new Map();

function lruTouch(id) {
  const item = cache.get(id);
  if (!item) return;
  item.hits = (item.hits || 0) + 1;
  // Re-insert to move to end (newest)
  cache.delete(id);
  cache.set(id, item);
}

function lruMaybeEvict() {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  // Evict oldest (Map iteration order = insertion order)
  const evictCount = Math.max(1, Math.ceil(MAX_CACHE_ENTRIES * 0.1));
  const victims = Array.from(cache.keys()).slice(0, evictCount);
  victims.forEach((k) => cache.delete(k));
  log("cache.evict", { evicted: victims.length, size: cache.size });
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────
function log(event, data = {}) {
  try {
    console.log(
      JSON.stringify({
        source: "promptLoader",
        event,
        ts: new Date().toISOString(),
        ...data,
      })
    );
  } catch {
    // Fallback if JSON.stringify hits circular refs
    console.log(`[promptLoader:${event}]`, data);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function normalizeKey(key) {
  if (!key || typeof key !== "string")
    throw new Error("Prompt key is required.");
  return key.endsWith(FILE_EXT) ? key : `${key}${FILE_EXT}`;
}

function stripBOM(str = "") {
  return str.replace(/^\uFEFF/, "");
}

function normalizeNewlines(str = "") {
  return str.replace(/\r\n?/g, "\n");
}

function approxTokensForText(text = "") {
  // Simple heuristic: ~4 chars per token
  return Math.ceil((text || "").length / 4);
}

function ensureMaxChars(text, maxChars = DEFAULT_MAX_CHARS) {
  if (!text)
    return { text: "", trimmed: false, originalChars: 0, approxTokens: 0 };
  if (text.length <= maxChars) {
    return {
      text,
      trimmed: false,
      originalChars: text.length,
      approxTokens: approxTokensForText(text),
    };
  }
  const sliced = text.slice(0, maxChars);
  return {
    text: `${sliced}\n…`,
    trimmed: true,
    originalChars: text.length,
    approxTokens: approxTokensForText(sliced),
  };
}

function parseYamlFrontMatter(raw = "") {
  // Supports minimal YAML "key: value" lines between leading --- and closing ---
  // Returns { meta, body } or null if not front-matter.
  if (!raw.startsWith("---")) return null;
  const lines = raw.split("\n");
  let i = 0;
  if (lines[i].trim() !== "---") return null;
  i++;

  const meta = {};
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") {
      i++;
      break;
    }
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)\s*$/);
    if (m) {
      const k = m[1].toLowerCase();
      meta[k] = m[2].trim();
    }
  }
  const body = lines.slice(i).join("\n");
  return { meta, body };
}

function parseHeaderLines(raw = "") {
  // Reads prefix lines like:
  // Title: ...
  // Intent: ...
  // Zone: ...
  // Tone: ...
  // (blank line)
  const lines = raw.split("\n");
  const meta = {};
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      bodyStart = i + 1;
      break;
    }
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)\s*$/);
    if (m) {
      const k = m[1].toLowerCase();
      meta[k] = m[2].trim();
    } else {
      // not a header line → stop
      bodyStart = i;
      break;
    }
  }
  const body = lines.slice(bodyStart).join("\n");
  return { meta, body };
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(err) {
  const status = err?.$metadata?.httpStatusCode;
  const name = (err?.name || "").toString();
  // Throttling/5xx/timeout-ish
  return (
    status === 429 ||
    (status >= 500 && status < 600) ||
    name.includes("Timeout") ||
    name.includes("Throttl") ||
    name.includes("SlowDown")
  );
}

async function withRetry(fn, { what, reqId }) {
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        log("s3.retry", { reqId, what, attempt, delay_ms: delay });
        await sleep(delay);
      }
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES) break;
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────────────────────
// Low-level S3 fetch with ETag-aware cache
// ─────────────────────────────────────────────────────────────────────────────
async function fetchPromptBody(
  key,
  { ttlMs = DEFAULT_TTL_MS, bucket = PROMPT_BUCKET, reqId } = {}
) {
  const normalizedKey = normalizeKey(key);
  const cacheId = `${bucket}/${normalizedKey}`;
  const now = Date.now();
  const entry = cache.get(cacheId);

  // Fresh cache hit
  if (entry && now - entry.ts < ttlMs) {
    lruTouch(cacheId);
    log("cache.hit", {
      reqId,
      key: normalizedKey,
      etag: entry.etag,
      age_ms: now - entry.ts,
    });
    return { body: entry.body, meta: { etag: entry.etag, lastModified: entry.lastModified, source: "cache", cacheAgeMs: now - entry.ts } };
  }

  try {
    // If we have a cache entry, validate via HEAD to avoid full GET when unchanged
    if (entry) {
      const head = await withRetry(
        () =>
          s3.send(
            new HeadObjectCommand({ Bucket: bucket, Key: normalizedKey })
          ),
        { what: "head", reqId }
      );

      const etag = head.ETag;
      const lastModified = head.LastModified
        ? new Date(head.LastModified).toISOString()
        : undefined;

      if (etag && etag === entry.etag) {
        // Unchanged → refresh timestamp, reuse body
        entry.ts = now;
        lruTouch(cacheId);
        log("cache.validated", {
          reqId,
          key: normalizedKey,
          etag,
          lastModified,
          reused: true,
        });
        return { body: entry.body, meta: { etag, lastModified, source: "s3-head-validated", cacheAgeMs: 0 } };
      }
      // Changed → fall through to GET
      log("cache.stale", {
        reqId,
        key: normalizedKey,
        prevEtag: entry.etag,
        newEtag: etag,
        lastModified,
      });
    }

    // Fetch with GET
    log("s3.get.start", { reqId, key: normalizedKey, bucket });
    const res = await withRetry(
      () => s3.send(new GetObjectCommand({ Bucket: bucket, Key: normalizedKey })),
      { what: "get", reqId }
    );
    const body = await streamToString(res.Body);
    const etag = res.ETag;
    const lastModified = res.LastModified
      ? new Date(res.LastModified).toISOString()
      : undefined;

    cache.set(cacheId, { body, etag, lastModified, ts: now, hits: 1 });
    lruMaybeEvict();

    log("s3.get.ok", { reqId, key: normalizedKey, etag, lastModified });
    return { body, meta: { etag, lastModified, source: "s3-get", cacheAgeMs: 0 } };
  } catch (err) {
    const code =
      err?.name || err?.Code || err?.$metadata?.httpStatusCode || "Error";
    if (code === "NoSuchKey" || code === 404) {
      log("s3.get.missing", { reqId, key: normalizedKey });
    } else {
      log("s3.get.error", {
        reqId,
        key: normalizedKey,
        error: err?.message || String(err),
        code,
      });
    }
    return { body: null, meta: { error: err?.message || String(err) } };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Bust cache for a single key (or entire cache if key not provided).
 * Useful after admin reindex actions.
 */
function invalidatePromptCache(key, { bucket = PROMPT_BUCKET } = {}) {
  if (!key) {
    const n = cache.size;
    cache.clear();
    log("cache.cleared", { count: n });
    return n;
  }
  const normalizedKey = normalizeKey(key);
  const id = `${bucket}/${normalizedKey}`;
  const existed = cache.delete(id);
  log("cache.invalidate", { key: normalizedKey, existed });
  return existed ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load raw markdown from S3 (with cache).
 * @param {string} key - e.g. 'system/default.md' or 'system/default'
 * @param {object} opts
 * @param {number} [opts.ttlMs] - cache TTL (ms)
 * @param {string} [opts.bucket] - override bucket
 * @param {string} [opts.reqId] - request id for logs
 * @returns {Promise<string|null>}
 */
async function loadPromptFromS3(key, opts = {}) {
  if (!PROMPT_BUCKET && !opts.bucket) {
    log("config.warn", {
      msg: "PROMPT_BUCKET not configured; skipping prompt load.",
    });
    return null;
  }
  const out = await fetchPromptBody(key, opts);
  if (!out?.body) return null;
  // Normalize
  return normalizeNewlines(stripBOM(out.body));
}

/**
 * Load and parse a prompt with metadata and size enforcement.
 * Supports YAML front-matter or header lines; trims body to max chars.
 * @param {string} key
 * @param {object} opts
 * @param {number} [opts.ttlMs] - cache TTL (ms)
 * @param {number} [opts.maxChars] - hard char cap (default ~500 tokens)
 * @param {boolean} [opts.preferYaml] - try YAML front-matter first (default true)
 * @param {string} [opts.bucket] - override bucket
 * @param {string} [opts.reqId] - request id for logs
 * @returns {Promise<{
 *   title?: string,
 *   intent?: string,
 *   zone?: string,
 *   tone?: string,
 *   body: string,
 *   approxTokens: number,
 *   trimmed: boolean,
 *   etag?: string,
 *   lastModified?: string,
 *   source?: "cache" | "s3-head-validated" | "s3-get",
 *   cacheAgeMs?: number
 * }|null>}
 */
async function getPromptScriptFromS3(key, opts = {}) {
  const {
    ttlMs = DEFAULT_TTL_MS,
    maxChars = DEFAULT_MAX_CHARS,
    preferYaml = true,
    bucket,
    reqId,
  } = opts;

  if (!PROMPT_BUCKET && !bucket) {
    log("config.warn", {
      msg: "PROMPT_BUCKET not configured; skipping prompt load.",
    });
    return null;
  }

  const normalizedKey = normalizeKey(key);
  const fetched = await fetchPromptBody(normalizedKey, { ttlMs, bucket, reqId });
  if (!fetched?.body) return null;

  const content = normalizeNewlines(stripBOM(fetched.body));
  let title, intent, zone, tone, body;

  // Parse metadata
  const parsedYaml = preferYaml ? parseYamlFrontMatter(content) : null;
  if (parsedYaml) {
    const meta = parsedYaml.meta || {};
    title = meta.title || meta.name || undefined;
    intent = meta.intent || undefined;
    zone = meta.zone || undefined;
    tone = meta.tone || undefined;
    body = parsedYaml.body.trim();
  } else {
    const hl = parseHeaderLines(content);
    const meta = hl.meta || {};
    title = meta.title || meta.name || undefined;
    intent = meta.intent || undefined;
    zone = meta.zone || undefined;
    tone = meta.tone || undefined;
    body = (hl.body || "").trim();
  }

  const { text, trimmed, originalChars, approxTokens } = ensureMaxChars(
    body,
    maxChars
  );

  log("prompt.parsed", {
    reqId,
    key: normalizedKey,
    title,
    intent,
    zone,
    tone,
    approxTokens,
    trimmed,
    originalChars,
  });

  return {
    title,
    intent,
    zone,
    tone,
    body: text,
    approxTokens,
    trimmed,
    etag: fetched.meta?.etag,
    lastModified: fetched.meta?.lastModified,
    source: fetched.meta?.source,
    cacheAgeMs: fetched.meta?.cacheAgeMs,
  };
}

module.exports = {
  getPromptScriptFromS3,
  loadPromptFromS3,
  invalidatePromptCache,
};
