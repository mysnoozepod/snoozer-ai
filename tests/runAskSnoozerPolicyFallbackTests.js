#!/usr/bin/env node

const assert = require("assert");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { resolveRecommendation } = require("../services/recommendationResolver");
const openai = require("../services/openai");

const originalDdbSend = DynamoDBDocumentClient.prototype.send;
const originalOpenAiGetSnoozerResponse = openai.getSnoozerResponse;

const sessionStore = new Map();
const resultsStore = new Map();
const openAiCalls = [];

function buildEvent(body) {
  return {
    version: "2.0",
    routeKey: "POST /ask-snoozer",
    rawPath: "/ask-snoozer",
    headers: {
      "content-type": "application/json",
      host: "local.ask-snoozer.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: {
        method: "POST",
        path: "/ask-snoozer",
        sourceIp: "127.0.0.1",
        userAgent: "ask-snoozer-policy-test",
      },
      requestId: `ask-${Date.now()}`,
      routeKey: "POST /ask-snoozer",
      stage: "local",
      timeEpoch: Date.now(),
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function parseBody(response) {
  assert.strictEqual(response.statusCode, 200, "expected HTTP 200");
  return JSON.parse(response.body);
}

function patchDynamo() {
  DynamoDBDocumentClient.prototype.send = async function send(command) {
    if (command instanceof GetCommand) {
      if (command.input?.Key?.sessionId) {
        return { Item: sessionStore.get(command.input.Key.sessionId) || null };
      }
      if (command.input?.Key?.shopperId) {
        return { Item: resultsStore.get(command.input.Key.shopperId) || null };
      }
      return { Item: null };
    }

    if (command instanceof PutCommand) {
      if (command.input?.Item?.sessionId) {
        sessionStore.set(command.input.Item.sessionId, command.input.Item);
      }
      if (command.input?.Item?.shopperId) {
        resultsStore.set(command.input.Item.shopperId, command.input.Item);
      }
      return {};
    }

    if (command instanceof UpdateCommand) {
      const sessionId = command.input?.Key?.sessionId;
      if (sessionId) {
        const existing = sessionStore.get(sessionId) || { sessionId, context: {} };
        sessionStore.set(sessionId, {
          ...existing,
          context: command.input?.ExpressionAttributeValues?.[":c"] || existing.context,
        });
      }
      return {};
    }

    return {};
  };
}

function restoreDynamo() {
  DynamoDBDocumentClient.prototype.send = originalDdbSend;
}

function patchOpenAi() {
  openai.getSnoozerResponse = async function mockedGetSnoozerResponse(message, options = {}) {
    openAiCalls.push({ message, options });
    return {
      reply: `mocked fallback: ${message}`,
      text: `mocked fallback: ${message}`,
      model: "mock-openai",
      meta: { path: "mock_openai", retrievalMs: 0 },
      context: options.context || {},
      actions: [],
    };
  };
}

function restoreOpenAi() {
  openai.getSnoozerResponse = originalOpenAiGetSnoozerResponse;
}

function resetStores() {
  sessionStore.clear();
  resultsStore.clear();
  openAiCalls.length = 0;
}

async function invokeAskSnoozer(body) {
  const { lambdaHandler } = require("../index");
  return parseBody(await lambdaHandler(buildEvent(body)));
}

async function testSleepTrialPolicyFallback() {
  resetStores();
  const body = await invokeAskSnoozer({
    message: "What is your 90 day sleep trial?",
    sessionId: "policy-trial-1",
  });

  assert.strictEqual(openAiCalls.length, 0, "policy fallback should not call OpenAI");
  assert.strictEqual(body.ok, true, "policy fallback should succeed");
  assert(!/OPENAI_TIMEOUT/i.test(body.reply), "reply should not expose OPENAI_TIMEOUT");
  assert(!/mocked fallback/i.test(body.reply), "reply should be deterministic, not model fallback");
  assert(
    /trial|return|mattress/i.test(body.reply),
    "reply should mention trial or return guidance"
  );
}

async function testFinancingPolicyFallback() {
  resetStores();
  const body = await invokeAskSnoozer({
    message: "Do you offer financing?",
    sessionId: "policy-financing-1",
  });

  assert.strictEqual(openAiCalls.length, 0, "financing fallback should not call OpenAI");
  assert.strictEqual(body.ok, true, "financing fallback should succeed");
  assert(!/mocked fallback/i.test(body.reply), "reply should be deterministic");
  assert(
    /financ|monthly|pay/i.test(body.reply),
    "reply should mention financing guidance"
  );
}

async function testCanonicalRecommendationStillWins() {
  resetStores();
  const assessment = {
    size: "Queen",
    motionMode: "No Motion",
    firmness: "Soft",
    sleepPosition: "Side",
    sleepPartner: "No",
    baseType: "No Base",
    temperature: "Hot",
  };
  const resolved = await resolveRecommendation({
    assessment,
    includeProducts: true,
    includePods: true,
  });

  const body = await invokeAskSnoozer({
    message: "What do you recommend?",
    sessionId: "policy-canonical-1",
    context: { assessment },
  });

  assert.strictEqual(openAiCalls.length, 0, "canonical recommendation should remain deterministic");
  assert.strictEqual(
    body.context?.canonicalRecommendation?.topPodId,
    resolved.recommendation.topPodId,
    "canonical top pod should remain attached"
  );
  assert(
    String(body.reply || "").includes("SnoozePod 4"),
    "reply should still recommend SnoozePod 4 for the known fixture"
  );
}

async function testMissingAssessmentRecommendationFallback() {
  resetStores();
  const body = await invokeAskSnoozer({
    message: "What do you recommend?",
    sessionId: "policy-no-assessment-1",
  });

  assert.strictEqual(body.ok, true, "missing assessment path should still succeed");
  assert(
    !/SnoozePod\s+\d/i.test(String(body.reply || "")),
    "missing assessment reply should not invent a pod recommendation"
  );
}

async function main() {
  patchDynamo();
  patchOpenAi();

  try {
    await testSleepTrialPolicyFallback();
    await testFinancingPolicyFallback();
    await testCanonicalRecommendationStillWins();
    await testMissingAssessmentRecommendationFallback();
    console.log("All /ask-snoozer policy fallback tests passed.");
  } finally {
    restoreOpenAi();
    restoreDynamo();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
