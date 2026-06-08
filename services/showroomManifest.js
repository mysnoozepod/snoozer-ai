const fs = require("fs");
const path = require("path");

const SHOWROOM_MANIFEST_PATH = path.join(__dirname, "..", "data", "showroom-manifest.v1.json");

let cache = {
  mtimeMs: 0,
  manifest: null,
};

function createManifestError(message, cause) {
  const error = new Error(`Invalid showroom manifest: ${message}`);
  error.code = "E_SHOWROOM_MANIFEST";
  error.statusCode = 500;
  if (cause) error.cause = cause;
  return error;
}

function assert(condition, message) {
  if (!condition) throw createManifestError(message);
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function validateShowroomManifest(manifest) {
  assert(manifest && typeof manifest === "object" && !Array.isArray(manifest), "manifest must be an object");
  assert(typeof manifest.version === "string" && manifest.version.trim(), "version is required");
  assert(typeof manifest.updatedAt === "string" && manifest.updatedAt.trim(), "updatedAt is required");

  const schema = manifest.assessmentSchema;
  assert(schema && typeof schema === "object", "assessmentSchema is required");
  assert(Array.isArray(schema.sizes) && schema.sizes.length > 0, "assessmentSchema.sizes is required");
  assert(Array.isArray(schema.positions) && schema.positions.length > 0, "assessmentSchema.positions is required");
  assert(Array.isArray(schema.firmnesses) && schema.firmnesses.length > 0, "assessmentSchema.firmnesses is required");
  assert(Array.isArray(schema.baseTypes) && schema.baseTypes.length > 0, "assessmentSchema.baseTypes is required");
  assert(Array.isArray(schema.motionModes) && schema.motionModes.length > 0, "assessmentSchema.motionModes is required");
  assert(uniqueBy(schema.baseTypes, (item) => item.key), "baseTypes keys must be unique");
  assert(uniqueBy(schema.motionModes, (item) => item.key), "motionModes keys must be unique");

  for (const baseType of schema.baseTypes) {
    assert(typeof baseType.key === "string" && baseType.key.trim(), "each baseType.key is required");
    assert(typeof baseType.label === "string" && baseType.label.trim(), "each baseType.label is required");
  }

  for (const motionMode of schema.motionModes) {
    assert(typeof motionMode.key === "string" && motionMode.key.trim(), "each motionMode.key is required");
    assert(typeof motionMode.label === "string" && motionMode.label.trim(), "each motionMode.label is required");
    assert(Array.isArray(motionMode.allowedSizes), `motionMode ${motionMode.key} requires allowedSizes`);
  }

  assert(Array.isArray(manifest.products) && manifest.products.length > 0, "products are required");
  assert(uniqueBy(manifest.products, (item) => item.handle), "product handles must be unique");
  const productHandles = new Set();
  for (const product of manifest.products) {
    assert(typeof product.handle === "string" && product.handle.trim(), "each product.handle is required");
    assert(typeof product.catalogType === "string" && product.catalogType.trim(), `product ${product.handle} needs catalogType`);
    assert(typeof product.family === "string" && product.family.trim(), `product ${product.handle} needs family`);
    assert(typeof product.title === "string" && product.title.trim(), `product ${product.handle} needs title`);
    productHandles.add(product.handle);
  }

  assert(Array.isArray(manifest.pods) && manifest.pods.length > 0, "pods are required");
  assert(uniqueBy(manifest.pods, (item) => item.podId), "podIds must be unique");
  for (const pod of manifest.pods) {
    assert(typeof pod.podId === "string" && pod.podId.trim(), "each pod.podId is required");
    assert(typeof pod.name === "string" && pod.name.trim(), `pod ${pod.podId} needs name`);
    assert(typeof pod.mattressHandle === "string" && productHandles.has(pod.mattressHandle), `pod ${pod.podId} has unknown mattressHandle`);
    assert(typeof pod.baseHandle === "string" && productHandles.has(pod.baseHandle), `pod ${pod.podId} has unknown baseHandle`);
    assert(typeof pod.baseTypeKey === "string" && pod.baseTypeKey.trim(), `pod ${pod.podId} needs baseTypeKey`);
    assert(typeof pod.defaultSize === "string" && pod.defaultSize.trim(), `pod ${pod.podId} needs defaultSize`);
    assert(typeof pod.defaultMotionKey === "string" && pod.defaultMotionKey.trim(), `pod ${pod.podId} needs defaultMotionKey`);
    assert(pod.displayedIn && typeof pod.displayedIn === "object", `pod ${pod.podId} needs displayedIn`);
    assert(Array.isArray(pod.tags), `pod ${pod.podId} needs tags`);
  }

  const rules = manifest.recommendationRules;
  assert(rules && typeof rules === "object", "recommendationRules are required");
  assert(Number.isInteger(rules.recommendedCount) && rules.recommendedCount > 0, "recommendedCount must be a positive integer");
  assert(Array.isArray(rules.primaryMattressRules) && rules.primaryMattressRules.length > 0, "primaryMattressRules are required");
  assert(Array.isArray(rules.baseRules) && rules.baseRules.length > 0, "baseRules are required");
  assert(Array.isArray(rules.podScoreBoosts) && rules.podScoreBoosts.length > 0, "podScoreBoosts are required");

  return manifest;
}

function loadShowroomManifest(options = {}) {
  const refresh = options.refresh === true;
  let stat;
  try {
    stat = fs.statSync(SHOWROOM_MANIFEST_PATH);
  } catch (error) {
    throw createManifestError(`file not found at ${SHOWROOM_MANIFEST_PATH}`, error);
  }

  if (!refresh && cache.manifest && cache.mtimeMs === stat.mtimeMs) {
    return cache.manifest;
  }

  let raw;
  try {
    raw = fs.readFileSync(SHOWROOM_MANIFEST_PATH, "utf8");
  } catch (error) {
    throw createManifestError(`unable to read ${SHOWROOM_MANIFEST_PATH}`, error);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw createManifestError("manifest is not valid JSON", error);
  }

  const manifest = validateShowroomManifest(parsed);
  cache = { mtimeMs: stat.mtimeMs, manifest };
  return manifest;
}

module.exports = {
  SHOWROOM_MANIFEST_PATH,
  loadShowroomManifest,
  validateShowroomManifest,
};
