// services/assetLoader.js
// Sign short-lived S3 URLs for product previews.
// Expects S3 layout:  s3://<S3_ASSET_BUCKET>/<slug>/preview.jpg
//
// Hardened:
// - Warm-lambda cache for signed URLs (cuts repeat presign calls).
// - Clamp expiry to sane bounds.
// - Support custom preview object key name via env.

const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const REGION = process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.S3_ASSET_BUCKET || ""; // <-- set this env

// Default 5m, minimum 30s, maximum 1h (don’t hand out day-long URLs for “preview.jpg”)
const DEFAULT_EXPIRY_SECONDS = (() => {
  const raw = Number(process.env.ASSET_URL_TTL_SEC || 300);
  const n = Number.isFinite(raw) ? raw : 300;
  return Math.max(30, Math.min(n, 3600));
})();

// Allows overriding the filename, still under <slug>/...
// e.g. "preview.webp" or "preview.png"
const PREVIEW_OBJECT_NAME = (process.env.ASSET_PREVIEW_OBJECT_NAME || "preview.jpg").trim() || "preview.jpg";

const s3 = new S3Client({ region: REGION });

// Simple warm-container cache: key -> { url, expMs }
const _cache = new Map();

function nowMs() {
  return Date.now();
}

function clampInt(n, { min, max, def } = {}) {
  const x = Number(n);
  if (!Number.isFinite(x)) return def;
  const i = Math.floor(x);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80); // keep keys tidy
}

/**
 * Get a signed URL for <slug>/<PREVIEW_OBJECT_NAME>.
 * Returns { key, url } or null if bucket not configured or signing fails.
 */
async function getAssetPreview(productNameOrSlug, opts = {}) {
  try {
    if (!BUCKET) {
      // Intentionally quiet; frontend can fall back to Shopify image.
      return null;
    }

    const slug = slugify(productNameOrSlug);
    if (!slug) return null;

    const expiresIn = clampInt(
      opts.expiresIn ?? DEFAULT_EXPIRY_SECONDS,
      { min: 30, max: 3600, def: DEFAULT_EXPIRY_SECONDS }
    );

    const key = `${slug}/${PREVIEW_OBJECT_NAME}`;

    // Cache hit? (leave a 3s buffer to avoid edge expiry)
    const cacheKey = `${BUCKET}:${REGION}:${key}:${expiresIn}`;
    const hit = _cache.get(cacheKey);
    if (hit && hit.url && hit.expMs && nowMs() < hit.expMs - 3000) {
      return { key, url: hit.url };
    }

    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const url = await getSignedUrl(s3, cmd, { expiresIn });

    // Cache until expiry (ms)
    _cache.set(cacheKey, { url, expMs: nowMs() + expiresIn * 1000 });

    return { key, url };
  } catch (err) {
    // Don’t spam CloudWatch for missing previews; this is optional sugar.
    if (process.env.DEBUG_ASSET_SIGNER === "1") {
      console.warn("assetPreview error:", err?.message || err);
    }
    return null;
  }
}

module.exports = { getAssetPreview, slugify };