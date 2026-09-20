const { S3Client, GetObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");

const REGION = process.env.AWS_REGION || "us-east-1";
const PROMPT_BUCKET = process.env.S3_PROMPT_BUCKET || "snoozer-prompts-prod";
const KNOWLEDGE_BUCKET = process.env.S3_KNOWLEDGE_BUCKET || "snoozer-knowledge-prod";
const ROUTING_BUCKET = process.env.S3_ROUTING_BUCKET || KNOWLEDGE_BUCKET;
const S3_RETRIEVAL_TIMEOUT_MS = Math.max(
  50,
  Number(process.env.S3_RETRIEVAL_TIMEOUT_MS || 300)
);
const FILE_TTL_MS = Number(process.env.CONTEXT_FILE_TTL_MS || 300000);
const LIST_TTL_MS = Number(process.env.S3_LIST_CACHE_TTL_MS || 300000);

const s3 = new S3Client({ region: REGION });
const cache = {
  fileText: new Map(),
  listKeys: new Map(),
  inflight: new Map(),
};

const isFresh = (timestamp, ttl) => Boolean(timestamp) && Date.now() - timestamp < ttl;

function logEvent(event, data = {}) {
  try {
    console.log(JSON.stringify({ source: "snoozer", event, ts: new Date().toISOString(), ...data }));
  } catch {
    console.log(`[snoozer:${event}]`, data);
  }
}

function buildTimeoutError(code, message, timeoutMs, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.timeoutMs = timeoutMs;
  Object.assign(error, extra);
  return error;
}

function withTimeout(promise, timeoutMs, code, message, extra = {}) {
  let timer = null;
  return Promise.race([
    Promise.resolve().then(() => promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(buildTimeoutError(code, message, timeoutMs, extra)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isTimeoutError(error) {
  const code = String(error?.code || "").toUpperCase();
  return code.includes("TIMEOUT") || /timeout/i.test(String(error?.message || ""));
}

async function getObjectText(bucket, key, options = {}) {
  const { timeoutMs = S3_RETRIEVAL_TIMEOUT_MS, forceFresh = false } = options;
  const id = `${bucket}/${key}`;
  const cached = cache.fileText.get(id);
  if (!forceFresh && cached && isFresh(cached.ts, FILE_TTL_MS)) {
    return { value: cached.value, cacheHit: true };
  }

  const inflightKey = `text:${id}`;
  if (cache.inflight.has(inflightKey)) return cache.inflight.get(inflightKey);

  const promise = (async () => {
    try {
      const data = await withTimeout(
        s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
        timeoutMs,
        "S3_GET_TIMEOUT",
        `S3 GET exceeded ${timeoutMs}ms`,
        { bucket, key }
      );
      const chunks = [];
      for await (const chunk of data.Body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString("utf-8");
      cache.fileText.set(id, { value: text, ts: Date.now() });
      return { value: text, cacheHit: false };
    } catch (error) {
      logEvent("s3.get.error", {
        bucket,
        key,
        error: error.message,
        timeoutMs: isTimeoutError(error) ? timeoutMs : null,
      });
      return { value: null, cacheHit: false, error };
    } finally {
      cache.inflight.delete(inflightKey);
    }
  })();

  cache.inflight.set(inflightKey, promise);
  return promise;
}

async function getObjectJson(bucket, key, options = {}) {
  const textResult = await getObjectText(bucket, key, options);
  if (!textResult?.value) {
    return {
      value: null,
      cacheHit: Boolean(textResult?.cacheHit),
      error: textResult?.error || null,
    };
  }
  try {
    return {
      value: JSON.parse(textResult.value),
      cacheHit: Boolean(textResult.cacheHit),
      error: null,
    };
  } catch (error) {
    logEvent("s3.json.parse_error", { bucket, key, error: error.message });
    return { value: null, cacheHit: Boolean(textResult.cacheHit), error };
  }
}

async function listMarkdownKeys(bucket, prefix, options = {}) {
  const { timeoutMs = S3_RETRIEVAL_TIMEOUT_MS, forceFresh = false } = options;
  const id = `${bucket}/${prefix}`;
  const cached = cache.listKeys.get(id);
  if (!forceFresh && cached && isFresh(cached.ts, LIST_TTL_MS)) {
    return { value: cached.value, cacheHit: true };
  }

  const inflightKey = `list:${id}`;
  if (cache.inflight.has(inflightKey)) return cache.inflight.get(inflightKey);

  const promise = (async () => {
    let keys = [];
    let ContinuationToken;
    try {
      do {
        const response = await withTimeout(
          s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken })),
          timeoutMs,
          "S3_LIST_TIMEOUT",
          `S3 LIST exceeded ${timeoutMs}ms`,
          { bucket, prefix }
        );
        keys = keys.concat(
          (response.Contents || [])
            .map((object) => object && object.Key)
            .filter((objectKey) => objectKey && objectKey.endsWith(".md"))
        );
        ContinuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (ContinuationToken);
    } catch (error) {
      logEvent("s3.list.error", {
        bucket,
        prefix,
        error: error.message,
        timeoutMs: isTimeoutError(error) ? timeoutMs : null,
      });
      return { value: [], cacheHit: false, error };
    } finally {
      cache.inflight.delete(inflightKey);
    }
    cache.listKeys.set(id, { value: keys, ts: Date.now() });
    return { value: keys, cacheHit: false, error: null };
  })();

  cache.inflight.set(inflightKey, promise);
  return promise;
}

module.exports = {
  KNOWLEDGE_BUCKET,
  PROMPT_BUCKET,
  ROUTING_BUCKET,
  S3_RETRIEVAL_TIMEOUT_MS,
  getObjectJson,
  getObjectText,
  listMarkdownKeys,
};
