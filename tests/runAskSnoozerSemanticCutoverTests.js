#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.ASK_SNOOZER_PREFER_LOCAL_KNOWLEDGE = "1";
for (const key of [
  "ZCRM_CLIENT_ID",
  "ZCRM_CLIENT_SECRET",
  "ZCRM_REFRESH_TOKEN",
  "ZCRM_OAUTH_DOMAIN",
  "ZCRM_API_DOMAIN",
  "ZOHO_CRM_BASE",
]) process.env[key] = "";

const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const modelCore = require("../services/askSnoozerModelCore");
const { buildPlannerFixture } = require("./askSnoozerPlannerFixture");

const originalDdbSend = DynamoDBDocumentClient.prototype.send;
const originalPlanner = modelCore.planTrustedAdvisorTurnWithModel;
const originalComposer = modelCore.composeTrustedAdvisorResponse;
const originalConsoleLog = console.log;
const originalModelOnly = process.env.ASK_SNOOZER_MODEL_ONLY;

const sessionStore = new Map();
const logs = [];
let plannerCalls = 0;
let checks = 0;

function check(condition, message) {
  assert(condition, message);
  checks += 1;
}

function patchDependencies() {
  DynamoDBDocumentClient.prototype.send = async function send(command) {
    if (command instanceof GetCommand) {
      const sessionId = command.input?.Key?.sessionId;
      return { Item: sessionId ? sessionStore.get(sessionId) || null : null };
    }
    if (command instanceof PutCommand) {
      const item = command.input?.Item;
      if (item?.sessionId) sessionStore.set(item.sessionId, item);
      return {};
    }
    if (command instanceof UpdateCommand) {
      const sessionId = command.input?.Key?.sessionId;
      if (sessionId) {
        const existing = sessionStore.get(sessionId) || { sessionId, context: {} };
        const journey = command.input?.ExpressionAttributeValues?.[":journey"];
        sessionStore.set(sessionId, {
          ...existing,
          context: journey
            ? { ...(existing.context || {}), activeJourney: journey }
            : command.input?.ExpressionAttributeValues?.[":c"] || existing.context,
          ...(journey ? { journeyRevision: Number(journey.revision || 0) } : {}),
        });
      }
      return {};
    }
    return {};
  };

  modelCore.planTrustedAdvisorTurnWithModel = async (args = {}) => {
    plannerCalls += 1;
    if (/force pass five planner failure/i.test(args.query || "")) {
      const error = new Error("forced Pass 5 planner failure");
      error.code = "E_ADVISOR_PLANNER_TIMEOUT";
      throw error;
    }
    return buildPlannerFixture(args);
  };
  modelCore.composeTrustedAdvisorResponse = async (input = {}) => ({
    displayText: input.deterministicDraft.displayText,
    speechText: input.deterministicDraft.speechText,
    confidence: 0.99,
    model: "semantic-cutover-test-composer",
    inputChars: 0,
    factPackChars: 0,
  });
  console.log = (...args) => {
    logs.push(args.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" "));
  };
}

function restore() {
  DynamoDBDocumentClient.prototype.send = originalDdbSend;
  modelCore.planTrustedAdvisorTurnWithModel = originalPlanner;
  modelCore.composeTrustedAdvisorResponse = originalComposer;
  console.log = originalConsoleLog;
  if (originalModelOnly === undefined) delete process.env.ASK_SNOOZER_MODEL_ONLY;
  else process.env.ASK_SNOOZER_MODEL_ONLY = originalModelOnly;
}

function eventFor(body) {
  return {
    version: "2.0",
    routeKey: "POST /ask-snoozer",
    rawPath: "/ask-snoozer",
    headers: {
      "content-type": "application/json",
      host: "semantic-cutover.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
      "x-session-id": body.sessionId,
    },
    requestContext: {
      http: {
        method: "POST",
        path: "/ask-snoozer",
        sourceIp: "127.0.0.1",
        userAgent: "semantic-cutover-test",
      },
      requestId: `cutover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      routeKey: "POST /ask-snoozer",
      stage: "local",
      timeEpoch: Date.now(),
    },
    body: JSON.stringify({ accessCode: "1234", shopperId: "1234", ...body }),
    isBase64Encoded: false,
  };
}

async function request(body) {
  const { lambdaHandler } = require("../index");
  const beforePlanner = plannerCalls;
  const response = await lambdaHandler(eventFor(body));
  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.body),
    plannerCalls: plannerCalls - beforePlanner,
  };
}

function planning(result) {
  return result.body?.metadata?.planning || {};
}

async function main() {
  patchDependencies();
  try {
    const freeText = "I liked the first mattress, but it was too firm. What should I try next?";
    for (const [label, value] of [["true", "true"], ["false", "false"], ["unset", undefined]]) {
      if (value === undefined) delete process.env.ASK_SNOOZER_MODEL_ONLY;
      else process.env.ASK_SNOOZER_MODEL_ONLY = value;
      const result = await request({ message: freeText, sessionId: `cutover-flag-${label}` });
      check(result.statusCode === 200, `flag ${label} returns HTTP 200`);
      check(
        planning(result).semanticAuthority === "model_semantics",
        `flag ${label} cannot change model semantic authority (received ${planning(result).semanticAuthority || "missing"}; response ${JSON.stringify(result.body)})`
      );
      check(result.plannerCalls === 1 && planning(result).modelCallCount === 1, `flag ${label} performs exactly one planner call`);
    }

    const failed = await request({
      message: "Force Pass Five planner failure for this arbitrary shopper request.",
      sessionId: "cutover-planner-failure",
    });
    check(failed.statusCode === 200, "planner failure uses the safe response contract");
    check(planning(failed).semanticAuthority === "model_failed", "planner failure remains model_failed");
    check(planning(failed).fallbackUsed === true, "planner failure reports grounded fallback use");
    check(failed.plannerCalls === 1, "planner failure makes no second planner call");

    const policy = await request({ message: "What is your return policy?", sessionId: "cutover-policy" });
    check(planning(policy).semanticAuthority === "deterministic_atomic", "protected policy remains deterministic atomic");
    check(policy.plannerCalls === 0 && /100-night|sleep trial/i.test(policy.body.answer || policy.body.reply || ""), "policy uses canonical truth without a planner call");

    const greeting = await request({ message: "Hello", sessionId: "cutover-greeting" });
    check(planning(greeting).semanticAuthority === "deterministic_atomic" && greeting.plannerCalls === 0, "greeting remains narrow deterministic atomic");

    const support = await request({ message: "I need to talk to a human.", sessionId: "cutover-support" });
    check(support.plannerCalls === 0, "support handoff remains narrow deterministic atomic without a planner call");

    const station = await request({ message: "Browse Products", sessionId: "cutover-station" });
    check(planning(station).semanticAuthority === "deterministic_atomic" && station.plannerCalls === 0, "English station compatibility remains narrow deterministic atomic");

    const invalid = await request({
      message: "Find Rewards",
      sessionId: "cutover-invalid-command",
      command: { version: "showroom-command.v1", type: "do_whatever", payload: {} },
    });
    check(invalid.body.error?.code === "E_INVALID_SHOWROOM_COMMAND", "invalid typed commands still fail closed");
    check(invalid.plannerCalls === 0, "invalid typed command cannot fall back to model or English semantics");

    const routeSource = fs.readFileSync(path.join(__dirname, "..", "routes", "askSnoozerRoutes.js"), "utf8");
    check(!routeSource.includes("evaluateAskSnoozerSemanticShadow"), "canonical route has no semantic shadow evaluator");
    check(!routeSource.includes("ask-snoozer.semantic-shadow"), "canonical route emits no semantic shadow event");
    check(!routeSource.includes("routeAskSnoozerQuestion"), "canonical route has no broad legacy semantic router");
    check(!routeSource.includes("getSnoozerResponse"), "canonical route has no legacy OpenAI answer call");
    check(!routeSource.includes('path: "legacy_path"'), "canonical route cannot identify a legacy response path");
    check(!fs.existsSync(path.join(__dirname, "..", "services", "openai.js")), "legacy OpenAI service is deleted");
    check(!fs.existsSync(path.join(__dirname, "..", "services", "askSnoozerSemanticShadow.js")), "semantic shadow module is deleted");

    const parsedLogs = logs.flatMap((line) => {
      try { return [JSON.parse(line)]; } catch (_) { return []; }
    });
    check(parsedLogs.some((entry) => entry.src === "ask-snoozer.semantic-authority" && entry.semanticAuthority === "deterministic_atomic" && entry.atomicReason === "support_handoff"), "support handoff telemetry confirms deterministic atomic authority");
    check(!parsedLogs.some((entry) => entry.src === "ask-snoozer.semantic-shadow"), "runtime emits no semantic-shadow records");
    check(!parsedLogs.some((entry) => entry.responsePath === "legacy_path" || entry.path === "legacy_path"), "canonical runtime emits no legacy_path responses");

    originalConsoleLog(`Ask Snoozer semantic cutover tests passed (${checks} checks).`);
  } finally {
    restore();
  }
}

main().catch((error) => {
  restore();
  console.error(error);
  process.exit(1);
});
