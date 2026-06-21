const fs = require("fs");
const path = require("path");
const { S3Client, HeadObjectCommand } = require("@aws-sdk/client-s3");

const { getLocalMirrorCandidates } = require("./knowledgeKeyAliases");
const { loadShowroomManifest } = require("./showroomManifest");

const KNOWLEDGE_MANIFEST_PATH = path.join(__dirname, "..", "data", "knowledgeManifest.json");
const LOCAL_ROOTS = Object.freeze({
  knowledge: path.join(__dirname, "..", "s3 files", "snoozerknowledgeprod"),
  prompt: path.join(__dirname, "..", "s3 files", "snoozerpromptsprod"),
});
const BUCKETS = Object.freeze({
  knowledge: process.env.S3_KNOWLEDGE_BUCKET || "snoozer-knowledge-prod",
  prompt: process.env.S3_PROMPT_BUCKET || process.env.S3_PROMPTS_BUCKET || "snoozer-prompts-prod",
});

let cache = {
  mtimeMs: 0,
  manifest: null,
};

function createKnowledgeManifestError(message, cause) {
  const error = new Error(`Invalid knowledge manifest: ${message}`);
  error.code = "E_KNOWLEDGE_MANIFEST";
  error.statusCode = 500;
  if (cause) error.cause = cause;
  return error;
}

function assert(condition, message) {
  if (!condition) throw createKnowledgeManifestError(message);
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function validateEntry(sectionName, entryKey, entry) {
  assert(
    isObject(entry),
    `${sectionName}.${entryKey} must be an object`
  );
  assert(
    typeof entry.required === "boolean",
    `${sectionName}.${entryKey}.required must be a boolean`
  );
  assert(
    typeof entry.bucket === "string" && ["knowledge", "prompt"].includes(entry.bucket),
    `${sectionName}.${entryKey}.bucket must be "knowledge" or "prompt"`
  );
  assert(
    typeof entry.sourceKind === "string" && entry.sourceKind.trim(),
    `${sectionName}.${entryKey}.sourceKind is required`
  );
  assert(
    Array.isArray(entry.sourceKeys),
    `${sectionName}.${entryKey}.sourceKeys must be an array`
  );

  for (const sourceKey of entry.sourceKeys) {
    assert(
      typeof sourceKey === "string" && sourceKey.trim(),
      `${sectionName}.${entryKey}.sourceKeys entries must be non-empty strings`
    );
  }
}

function validateKnowledgeManifest(manifest) {
  assert(isObject(manifest), "manifest must be an object");
  assert(typeof manifest.version === "string" && manifest.version.trim(), "version is required");
  assert(typeof manifest.updatedAt === "string" && manifest.updatedAt.trim(), "updatedAt is required");

  const sections = ["policies", "sessionGuidance", "products", "bases"];
  for (const sectionName of sections) {
    const section = manifest[sectionName];
    assert(isObject(section), `${sectionName} must be an object`);
    for (const [entryKey, entry] of Object.entries(section)) {
      validateEntry(sectionName, entryKey, entry);
    }
  }

  return manifest;
}

function loadKnowledgeManifest(options = {}) {
  const refresh = options.refresh === true;
  let stat;
  try {
    stat = fs.statSync(KNOWLEDGE_MANIFEST_PATH);
  } catch (error) {
    throw createKnowledgeManifestError(`file not found at ${KNOWLEDGE_MANIFEST_PATH}`, error);
  }

  if (!refresh && cache.manifest && cache.mtimeMs === stat.mtimeMs) {
    return cache.manifest;
  }

  let raw;
  try {
    raw = fs.readFileSync(KNOWLEDGE_MANIFEST_PATH, "utf8");
  } catch (error) {
    throw createKnowledgeManifestError(`unable to read ${KNOWLEDGE_MANIFEST_PATH}`, error);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw createKnowledgeManifestError("manifest is not valid JSON", error);
  }

  const manifest = validateKnowledgeManifest(parsed);
  cache = { mtimeMs: stat.mtimeMs, manifest };
  return manifest;
}

function getKnowledgeManifestEntry(sectionName = "", entryKey = "") {
  const manifest = loadKnowledgeManifest();
  const section = manifest[String(sectionName || "").trim()] || {};
  return isObject(section) ? section[String(entryKey || "").trim()] || null : null;
}

function getLocalAbsolutePath(bucketType = "knowledge", sourceKey = "") {
  const root = LOCAL_ROOTS[bucketType];
  if (!root || !sourceKey) return "";
  return path.join(root, String(sourceKey || "").replace(/^\/+/, ""));
}

function findLocalMirrorMatch(bucketType = "knowledge", sourceKey = "") {
  const root = LOCAL_ROOTS[bucketType];
  if (!root || !sourceKey) return null;

  for (const candidate of getLocalMirrorCandidates(bucketType, sourceKey)) {
    const absolute = path.join(root, candidate);
    if (fs.existsSync(absolute)) {
      return {
        key: candidate,
        absolute,
      };
    }
  }

  return null;
}

function flattenManifestEntries(manifest) {
  const items = [];
  for (const [sectionName, section] of Object.entries(manifest)) {
    if (!isObject(section) || ["version", "updatedAt"].includes(sectionName)) continue;
    for (const [entryKey, entry] of Object.entries(section)) {
      items.push({
        sectionName,
        entryKey,
        entry,
      });
    }
  }
  return items;
}

async function validateKnowledgeManifestSources(options = {}) {
  const manifest = loadKnowledgeManifest({ refresh: options.refresh === true });
  const showroomManifest = loadShowroomManifest({ refresh: options.refresh === true });
  const showroomProducts = new Map(
    (Array.isArray(showroomManifest.products) ? showroomManifest.products : []).map((product) => [
      String(product?.handle || "").trim(),
      product,
    ])
  );
  const results = [];
  let requiredFailures = 0;
  let localFoundCount = 0;
  let localMissingCount = 0;
  let s3SkippedReason = null;
  const shouldCheckS3 = options.checkS3 === true;
  const region = process.env.AWS_REGION || "us-east-1";
  const s3 = shouldCheckS3 ? new S3Client({ region }) : null;

  for (const item of flattenManifestEntries(manifest)) {
    const { sectionName, entryKey, entry } = item;
    const sourceKeys = Array.isArray(entry.sourceKeys) ? entry.sourceKeys : [];
    const localFound = [];
    const localMissing = [];
    for (const sourceKey of sourceKeys) {
      const match = findLocalMirrorMatch(entry.bucket, sourceKey);
      if (match) {
        localFound.push(match.key || sourceKey);
      } else {
        localMissing.push(sourceKey);
      }
    }
    const showroomProduct = sectionName === "products" || sectionName === "bases"
      ? showroomProducts.get(entryKey) || null
      : null;
    const expectedCatalogType =
      sectionName === "products" ? "mattress" : sectionName === "bases" ? "base" : null;

    let showroomMatch = true;
    if (expectedCatalogType) {
      showroomMatch =
        Boolean(showroomProduct) &&
        String(showroomProduct.catalogType || "").trim().toLowerCase() === expectedCatalogType;
    }

    let s3Status = "skipped";
    let s3Missing = [];
    if (shouldCheckS3 && !s3SkippedReason && s3 && sourceKeys.length) {
      try {
        const bucket = BUCKETS[entry.bucket];
        s3Status = "ok";
        for (const sourceKey of sourceKeys) {
          await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: sourceKey }));
        }
      } catch (error) {
        const errorCode = String(error?.name || error?.code || error?.message || "");
        if (
          /AccessDenied|Credentials|ExpiredToken|Timeout|UnknownEndpoint|ECONN|ENOTFOUND/i.test(errorCode)
        ) {
          s3SkippedReason = errorCode || "S3_VALIDATION_SKIPPED";
          s3Status = "skipped";
        } else {
          s3Status = "missing";
          s3Missing = sourceKeys.slice();
        }
      }
    }

    const requiredSourceMissing =
      entry.required && (sourceKeys.length === 0 || localFound.length === 0);
    const status =
      !showroomMatch
        ? "invalid_showroom_reference"
        : requiredSourceMissing
          ? "missing_required_source"
          : localMissing.length > 0 && localFound.length > 0
            ? "partial_local_match"
            : localFound.length > 0
              ? "ok"
              : "skipped_optional";

    if (localFound.length > 0) {
      localFoundCount += localFound.length;
    }
    if (localMissing.length > 0) {
      localMissingCount += localMissing.length;
    }
    if (status === "missing_required_source" || status === "invalid_showroom_reference") {
      requiredFailures += 1;
    }

    results.push({
      sectionName,
      entryKey,
      required: entry.required,
      bucket: entry.bucket,
      sourceKind: entry.sourceKind,
      sourceKeys,
      localFound,
      localMissing,
      showroomMatch,
      showroomCatalogType: showroomProduct ? showroomProduct.catalogType : null,
      status,
      s3Status,
      s3Missing,
    });
  }

  return {
    ok: requiredFailures === 0,
    manifestVersion: manifest.version,
    checkedAt: new Date().toISOString(),
    s3Checked: shouldCheckS3 && !s3SkippedReason,
    s3SkippedReason,
    summary: {
      totalEntries: results.length,
      requiredFailures,
      localFoundCount,
      localMissingCount,
    },
    results,
  };
}

module.exports = {
  BUCKETS,
  KNOWLEDGE_MANIFEST_PATH,
  LOCAL_ROOTS,
  getKnowledgeManifestEntry,
  getLocalAbsolutePath,
  loadKnowledgeManifest,
  validateKnowledgeManifest,
  validateKnowledgeManifestSources,
};
