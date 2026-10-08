#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const region = "us-east-1";
const functionName = "snoozer-backend";
const mode = String(process.argv[2] || "").trim().toLowerCase();
if (!["shadow", "active", "legacy"].includes(mode)) {
  throw new Error("Usage: node scripts/updateSnoozerConversationCoreConfig.js <shadow|active|legacy>");
}

function aws(args) {
  return execFileSync("aws", [...args, "--region", region, "--output", "json"], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", AWS_CLI_FILE_ENCODING: "utf-8" },
  });
}

function getConfiguration() {
  return JSON.parse(aws(["lambda", "get-function-configuration", "--function-name", functionName]));
}

function main() {
  const current = getConfiguration();
  const variables = { ...(current.Environment?.Variables || {}) };
  if (variables.REWARDS_ENVIRONMENT !== "staging" || !/staging\./i.test(variables.CORS_ALLOW_ORIGIN || "")) {
    throw new Error("Refusing configuration update because the Lambda is not unambiguously configured for staging.");
  }
  delete variables.ASK_SNOOZER_CONVERSATION_CORE_MODE;
  variables.ASK_SNOOZER_MODEL_ONLY = mode === "legacy" ? "true" : `cc_${mode}`;
  variables.OPENAI_RUN_MAX_RETRIES = "1";
  variables.OPENAI_RUN_MAX_WAIT_MS = "400";
  const envPath = path.join(os.tmpdir(), `snoozer-conversation-core-env-${process.pid}.json`);
  try {
    fs.writeFileSync(envPath, JSON.stringify({ Variables: variables }), { encoding: "utf8", mode: 0o600 });
    aws([
      "lambda", "update-function-configuration",
      "--function-name", functionName,
      "--revision-id", current.RevisionId,
      "--environment", `file://${envPath.replace(/\\/g, "/")}`,
      "--query", "{FunctionName:FunctionName,LastModified:LastModified,RevisionId:RevisionId,State:State,LastUpdateStatus:LastUpdateStatus}",
    ]);
    aws(["lambda", "wait", "function-updated", "--function-name", functionName]);
  } finally {
    if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
  }
  const verified = getConfiguration();
  const env = verified.Environment?.Variables || {};
  console.log(JSON.stringify({
    functionName: verified.FunctionName,
    functionArn: verified.FunctionArn,
    runtime: verified.Runtime,
    state: verified.State,
    lastUpdateStatus: verified.LastUpdateStatus,
    lastModified: verified.LastModified,
    revisionId: verified.RevisionId,
    environment: {
      rewardsEnvironment: env.REWARDS_ENVIRONMENT,
      corsOrigin: env.CORS_ALLOW_ORIGIN,
      conversationCoreMode: env.ASK_SNOOZER_CONVERSATION_CORE_MODE || ({ cc_shadow: "shadow", cc_active: "active" }[env.ASK_SNOOZER_MODEL_ONLY] || "legacy"),
      featureFlagStorage: "ASK_SNOOZER_MODEL_ONLY",
      model: env.ASK_SNOOZER_CONVERSATION_CORE_MODEL || env.OPENAI_FINAL_MODEL,
      reasoningEffort: env.ASK_SNOOZER_CONVERSATION_CORE_REASONING_EFFORT || env.OPENAI_FINAL_REASONING_EFFORT,
      maxToolRounds: env.ASK_SNOOZER_CONVERSATION_CORE_MAX_TOOL_ROUNDS || "2 (default)",
      maxToolCalls: env.ASK_SNOOZER_CONVERSATION_CORE_MAX_TOOL_CALLS || "6 (default)",
      totalTimeoutMs: env.ASK_SNOOZER_CONVERSATION_CORE_TOTAL_TIMEOUT_MS || "30000 (default)",
      modelTimeoutMs: env.ASK_SNOOZER_CONVERSATION_CORE_MODEL_TIMEOUT_MS || "16000 (default)",
      retryCount: env.OPENAI_RUN_MAX_RETRIES,
    },
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exitCode = 1;
}
