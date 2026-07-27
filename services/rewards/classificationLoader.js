"use strict";

const fs = require("fs");
const path = require("path");
const { GetObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const { validateProductClassification } = require("../rewardsDomain/offers");

let cache = null;

async function bodyToString(body) {
  if (!body) return "";
  if (typeof body.transformToString === "function") return body.transformToString();
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function validateDocument(document) {
  if (
    !document ||
    document.schemaVersion !== 1 ||
    !document.classificationVersion ||
    !Array.isArray(document.products)
  ) {
    const error = new Error("Reward product classifications are invalid.");
    error.code = "REWARD_PRODUCT_CLASSIFICATIONS_INVALID";
    throw error;
  }
  const products = document.products.map((product) => {
    const normalized = {
      ...product,
      handle: String(product.handle || "").trim().toLowerCase(),
      classificationVersion: document.classificationVersion,
      source: document.source,
    };
    const validation = validateProductClassification(normalized);
    if (!validation.ok || !normalized.handle) {
      const error = new Error("A reward product classification is invalid.");
      error.code = "REWARD_PRODUCT_CLASSIFICATIONS_INVALID";
      error.details = validation.errors;
      throw error;
    }
    return normalized;
  });
  return { ...document, products };
}

async function loadProductClassifications(options = {}) {
  const ttlMs = Number(options.cacheTtlMs || process.env.REWARDS_CLASSIFICATIONS_CACHE_TTL_MS || 60000);
  if (!options.force && cache && cache.expiresAt > Date.now()) return cache.value;

  let document;
  let source;
  const localPath = String(
    options.localPath || process.env.REWARDS_CLASSIFICATIONS_LOCAL_PATH || ""
  ).trim();
  if (options.document) {
    document = options.document;
    source = "injected";
  } else if (localPath) {
    const absolute = path.resolve(localPath);
    document = JSON.parse(fs.readFileSync(absolute, "utf8"));
    source = `file:${absolute}`;
  } else {
    const bucket = String(
      options.bucket || process.env.REWARDS_CLASSIFICATIONS_BUCKET || ""
    ).trim();
    const key = String(
      options.key || process.env.REWARDS_CLASSIFICATIONS_KEY || ""
    ).trim();
    if (!bucket || !key) {
      const error = new Error("Reward product classifications are not configured.");
      error.code = "REWARD_PRODUCT_CLASSIFICATIONS_NOT_CONFIGURED";
      throw error;
    }
    const s3 = options.s3Client || new S3Client({});
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    document = JSON.parse(await bodyToString(result.Body));
    source = `s3://${bucket}/${key}`;
  }
  const value = { document: validateDocument(document), source };
  cache = { value, expiresAt: Date.now() + (Number.isFinite(ttlMs) ? ttlMs : 60000) };
  return value;
}

function flattenCartLines(cart) {
  const edges = cart?.lines?.edges || [];
  return edges.map((edge) => edge?.node || edge).filter(Boolean);
}

function classifyCart(cart, document) {
  const byHandle = new Map(
    document.products.map((product) => [product.handle, product])
  );
  return flattenCartLines(cart).map((line) => {
    const merchandise = line.merchandise || {};
    const handle = String(merchandise.product?.handle || "").trim().toLowerCase();
    const classification = byHandle.get(handle) || null;
    return {
      lineId: line.id,
      quantity: Number(line.quantity || 0),
      variantId: merchandise.id || null,
      productId: merchandise.product?.id || null,
      handle,
      title: merchandise.product?.title || merchandise.title || "",
      price: merchandise.price || null,
      classification,
    };
  });
}

function resetClassificationCache() {
  cache = null;
}

module.exports = {
  classifyCart,
  flattenCartLines,
  loadProductClassifications,
  resetClassificationCache,
  validateDocument,
};
