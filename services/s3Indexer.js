// services/s3Indexer.js
// ─────────────────────────────────────────────────────────────────────────────
// Snoozer Knowledge Indexer — builds products_index.json, faq_index.json,
// and skills_index.json inside snoozer-knowledge-prod/meta/
//
// Usage:
//   - Automatically called from POST /admin/reindex
//   - Or run manually in Node:  node services/s3Indexer.js
//
// Requires env vars:
//   AWS_REGION=us-east-1
//   S3_KNOWLEDGE_BUCKET=snoozer-knowledge-prod
// ─────────────────────────────────────────────────────────────────────────────

const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const yaml = require("js-yaml");

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const REGION = process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.S3_KNOWLEDGE_BUCKET || "snoozer-knowledge-prod";
const OUTPUT_PREFIX = "meta/";
const PREFIXES = ["skills/", "faq/", "products/"];
const CACHE_CONTROL = "max-age=300, public";

const s3 = new S3Client({ region: REGION });

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
async function listKeys(prefix) {
  const keys = [];
  let token;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    for (const o of res.Contents || []) if (o.Key) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

// safer body-to-string converter (handles SDK v3 streaming quirks)
async function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}

async function readFile(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = res.Body;
  if (!body) throw new Error(`Empty S3 body for ${key}`);
  if (typeof body.transformToString === "function") return await body.transformToString();
  return await streamToString(body);
}

function parseFrontMatter(text) {
  if (!text.startsWith("---")) return { front: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { front: {}, body: text };
  const frontRaw = text.substring(3, end + 1).trim();
  const body = text.substring(end + 4).trim();
  let front = {};
  try {
    front = yaml.load(frontRaw) || {};
  } catch (err) {
    console.log("⚠️ YAML parse error:", err.message);
  }
  return { front, body };
}

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function extractAnchors(raw) {
  const lines = raw.split(/\r?\n/);
  const anchors = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.+?)\s*$/.exec(lines[i]);
    if (m) anchors.push({ id: slugify(m[1]), line: i + 1 });
  }
  return anchors;
}

async function putJson(key, obj) {
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(obj, null, 2),
        ContentType: "application/json",
        CacheControl: CACHE_CONTROL,
      })
    );
    console.log(`✅ Wrote ${key}`);
  } catch (err) {
    console.error(`❌ Failed to write ${key}: ${err.message}`);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Builders
// ─────────────────────────────────────────────────────────────────────────────
async function buildProductsIndex() {
  const keys = await listKeys("products/");
  const mdKeys = keys.filter((k) => k.endsWith(".md"));
  const items = [];

  for (const key of mdKeys) {
    try {
      const raw = await readFile(key);
      const { front } = parseFrontMatter(raw);
      const handle = front.handle || key.split("/").pop().replace(".md", "");
      const title = front.title || handle;
      const category = front.category || key.split("/")[1] || "products";
      const vendor = front.vendor || "";
      const type = front.type || "";
      const tags = Array.isArray(front.tags)
        ? front.tags
        : String(front.tags || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
      const variants = Array.isArray(front.variants) ? front.variants : [];
      const priceMin = Math.min(
        ...variants.map((v) => Number(v.price)).filter((x) => !isNaN(x))
      );
      const priceMax = Math.max(
        ...variants.map((v) => Number(v.price)).filter((x) => !isNaN(x))
      );
      const image = front.image || (variants.find((v) => v.image)?.image || null);

      items.push({
        handle,
        title,
        category,
        vendor,
        type,
        tags,
        price_min: isFinite(priceMin) ? priceMin : null,
        price_max: isFinite(priceMax) ? priceMax : null,
        image,
        path: key,
      });
    } catch (err) {
      console.log("⚠️ Error parsing product", key, err.message);
    }
  }

  return { version: "1.0", updated: new Date().toISOString(), items };
}

async function buildFaqIndex() {
  const keys = await listKeys("faq/");
  const mdKeys = keys.filter((k) => k.endsWith(".md"));
  const items = [];

  for (const key of mdKeys) {
    try {
      const raw = await readFile(key);
      const { front } = parseFrontMatter(raw);
      const title = front.title || key.split("/").pop().replace(".md", "");
      const anchors = extractAnchors(raw);
      items.push({
        slug: slugify(title),
        title,
        path: key,
        anchors,
      });
    } catch (err) {
      console.log("⚠️ FAQ parse error", key, err.message);
    }
  }

  return { version: "1.0", updated: new Date().toISOString(), items };
}

async function buildSkillsIndex() {
  const keys = await listKeys("skills/");
  const mdKeys = keys.filter((k) => k.endsWith(".md"));
  const items = [];

  for (const key of mdKeys) {
    try {
      const raw = await readFile(key);
      const { front } = parseFrontMatter(raw);
      const topic = key.split("/").pop().replace(".md", "");
      const title = front.title || topic;
      const hints = Array.isArray(front.hints)
        ? front.hints
        : String(front.hints || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
      items.push({ topic, title, path: key, hints });
    } catch (err) {
      console.log("⚠️ Skill parse error", key, err.message);
    }
  }

  return { version: "1.0", updated: new Date().toISOString(), items };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────────────────────────────────────────
async function buildIndexes() {
  console.log("🏗️  Building knowledge indexes in", BUCKET);

  try {
    const [products, faqs, skills] = await Promise.all([
      buildProductsIndex(),
      buildFaqIndex(),
      buildSkillsIndex(),
    ]);

    await Promise.all([
      putJson(`${OUTPUT_PREFIX}products_index.json`, products),
      putJson(`${OUTPUT_PREFIX}faq_index.json`, faqs),
      putJson(`${OUTPUT_PREFIX}skills_index.json`, skills),
    ]);

    const summary = {
      ok: true,
      bucket: BUCKET,
      counts: {
        products: products.items.length,
        faq: faqs.items.length,
        skills: skills.items.length,
      },
      updated: new Date().toISOString(),
    };

    console.log("✅ Index build complete:", summary);
    return summary;
  } catch (err) {
    console.error("❌ Index build failed:", err.message);
    return { ok: false, error: err.message, bucket: BUCKET };
  }
}

// Export for Lambda + manual usage
module.exports = { buildIndexes };

// Run locally if executed directly
if (require.main === module) {
  buildIndexes()
    .then(() => console.log("Done."))
    .catch((err) => console.error(err));
}
