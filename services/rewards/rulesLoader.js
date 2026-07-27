"use strict";

const fs = require("fs");
const path = require("path");
const { GetObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const { resolveActiveRules, validateRewardsRules } = require("../rewardsDomain/rules");

let cache = null;
let lastValid = null;

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function streamToString(body) {
  if (!body) return "";
  if (typeof body.transformToString === "function") return body.transformToString();
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function validateActiveRules(document, now = new Date().toISOString()) {
  const validation = validateRewardsRules(document);
  if (!validation.ok) {
    const error = new Error("Rewards rules failed validation.");
    error.code = "REWARD_RULES_INVALID";
    error.details = validation.errors;
    throw error;
  }
  const resolved = resolveActiveRules([document], now);
  if (!resolved.ok) {
    const error = new Error(resolved.error?.message || "Rewards rules are not active.");
    error.code = resolved.error?.code || "REWARD_RULES_NOT_EFFECTIVE";
    throw error;
  }
  return resolved.rules;
}

function explicitLocalPath(options = {}) {
  const configured = String(
    options.localPath || process.env.REWARDS_RULES_LOCAL_PATH || ""
  ).trim();
  if (!configured) return "";
  return path.resolve(configured);
}

async function loadRewardsRules(options = {}) {
  const nowMs = Date.now();
  const ttlMs = parsePositiveInteger(
    options.cacheTtlMs || process.env.REWARDS_RULES_CACHE_TTL_MS,
    60000
  );
  if (!options.force && cache && cache.expiresAt > nowMs) return cache.value;

  try {
    let document;
    let etag = null;
    let source = "s3";
    const localPath = explicitLocalPath(options);
    if (localPath) {
      document = JSON.parse(fs.readFileSync(localPath, "utf8"));
      source = `file:${localPath}`;
    } else {
      const bucket = String(options.bucket || process.env.REWARDS_RULES_BUCKET || "").trim();
      const key = String(options.key || process.env.REWARDS_RULES_KEY || "").trim();
      if (!bucket || !key) {
        const error = new Error("Rewards rules S3 location is not configured.");
        error.code = "REWARD_RULES_NOT_CONFIGURED";
        throw error;
      }
      const client = options.s3Client || new S3Client({});
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      document = JSON.parse(await streamToString(result.Body));
      etag = result.ETag || null;
      source = `s3://${bucket}/${key}`;
    }

    const rules = validateActiveRules(document, options.now);
    const value = { rules, etag, source, stale: false, loadedAt: new Date().toISOString() };
    cache = { value, expiresAt: nowMs + ttlMs };
    lastValid = value;
    return value;
  } catch (error) {
    if (lastValid) {
      console.warn(JSON.stringify({
        event: "rewards.rules.last_valid_cache",
        code: error.code || "REWARD_RULES_LOAD_FAILED",
        message: error.message,
      }));
      const value = { ...lastValid, stale: true, loadError: error.code || error.message };
      cache = { value, expiresAt: nowMs + Math.min(ttlMs, 10000) };
      return value;
    }
    throw error;
  }
}

function resetRewardsRulesCache() {
  cache = null;
  lastValid = null;
}

module.exports = {
  loadRewardsRules,
  resetRewardsRulesCache,
  validateActiveRules,
};
