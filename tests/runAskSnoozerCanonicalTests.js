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
    rawQueryString: "",
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
        userAgent: "ask-snoozer-canonical-test",
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
      const tableName = command.input?.TableName || "";
      if (command.input?.Key?.sessionId) {
        return { Item: sessionStore.get(command.input.Key.sessionId) || null };
      }
      if (command.input?.Key?.shopperId) {
        return { Item: resultsStore.get(command.input.Key.shopperId) || null };
      }
      return { Item: null, TableName: tableName };
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
  if (typeof originalDdbSend === "function") {
    DynamoDBDocumentClient.prototype.send = originalDdbSend;
  }
}

function patchOpenAi() {
  openai.getSnoozerResponse = async function mockedGetSnoozerResponse(message, options = {}) {
    openAiCalls.push({
      message,
      options,
    });
    return {
      reply: `mocked fallback: ${message}`,
      text: `mocked fallback: ${message}`,
      model: "mock-openai",
      meta: {
        path: "mock_openai",
        retrievalMs: 0,
      },
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

function getProductTitle(resolved, handle) {
  return resolved.products.find((product) => product.handle === handle)?.title || handle || "";
}

async function invokeAskSnoozer(body) {
  const { lambdaHandler } = require("../index");
  return parseBody(await lambdaHandler(buildEvent(body)));
}

async function testCanonicalRecommendationAnswer() {
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
  const topPod = resolved.pods.find((pod) => pod.podId === resolved.recommendation.topPodId);

  const body = await invokeAskSnoozer({
    message: "What do you recommend?",
    sessionId: "canon-recommend-1",
    context: {
      assessment,
    },
  });

  assert.strictEqual(openAiCalls.length, 0, "canonical recommendation path should not call OpenAI");
  assert.strictEqual(body.ok, true, "canonical recommendation response should succeed");
  assert.strictEqual(
    body.context?.canonicalRecommendation?.manifestVersion,
    resolved.manifestVersion,
    "manifestVersion mismatch"
  );
  assert.strictEqual(
    body.context?.canonicalRecommendation?.topPodId,
    resolved.recommendation.topPodId,
    "topPodId mismatch"
  );
  assert.deepStrictEqual(
    body.context?.canonicalRecommendation?.topPodIds,
    resolved.recommendation.topPodIds,
    "topPodIds mismatch"
  );
  assert.strictEqual(
    body.context?.canonicalRecommendation?.primaryMattressHandle,
    resolved.recommendation.primaryMattressHandle,
    "primaryMattressHandle mismatch"
  );
  assert.strictEqual(
    body.context?.canonicalRecommendation?.baseHandle,
    resolved.recommendation.baseHandle,
    "baseHandle mismatch"
  );
  assert.strictEqual(
    body.context?.canonicalRecommendation?.motionKey,
    resolved.normalizedAssessment.motionKey,
    "motionKey mismatch"
  );
  assert.strictEqual(
    body.context?.canonicalRecommendation?.motionLabel,
    resolved.normalizedAssessment.motionLabel,
    "motionLabel mismatch"
  );
  assert.deepStrictEqual(
    [...body.context?.canonicalRecommendation?.reasonKeys].sort(),
    [...resolved.recommendation.reasonKeys].sort(),
    "reasonKeys mismatch"
  );
  assert.deepStrictEqual(
    [...body.context?.canonicalRecommendation?.warnings].sort(),
    [...resolved.recommendation.warnings].sort(),
    "warnings mismatch"
  );
  assert.strictEqual(
    body.metadata?.model,
    "canonical_recommendation",
    "canonical recommendation should return the canonical deterministic model marker"
  );

  const mattressTitle = getProductTitle(resolved, resolved.recommendation.primaryMattressHandle);
  assert(
    body.reply.includes(topPod?.name || ""),
    "reply should mention the canonical top pod name"
  );
  assert(
    body.reply.includes(mattressTitle),
    "reply should mention the canonical mattress title"
  );
  assert(
    body.reply.includes("No Base"),
    "reply should preserve explicit no-base intent"
  );
  assert(
    body.reply.includes(resolved.normalizedAssessment.motionLabel),
    "reply should mention the canonical motion label"
  );
}

async function testCanonicalExplanationAnswer() {
  resetStores();
  const assessment = {
    size: "King",
    motionMode: "Standard Motion",
    firmness: "Firm",
    sleepPosition: "Back",
    sleepPartner: "No",
    baseType: "Adjustable Base",
    painPoints: ["Lower Back"],
  };
  const resolved = await resolveRecommendation({
    assessment,
    includeProducts: true,
    includePods: true,
  });
  const topPod = resolved.pods.find((pod) => pod.podId === resolved.recommendation.topPodId);
  const baseTitle = getProductTitle(resolved, resolved.recommendation.baseHandle);

  const body = await invokeAskSnoozer({
    message: "Why this pod?",
    sessionId: "canon-explain-1",
    context: {
      assessment,
    },
  });

  assert.strictEqual(openAiCalls.length, 0, "why this pod should stay on canonical path");
  assert.strictEqual(
    body.context?.canonicalRecommendation?.topPodId,
    resolved.recommendation.topPodId,
    "topPodId mismatch on explanation"
  );
  assert(
    body.reply.includes(topPod?.name || ""),
    "explanation reply should mention the canonical top pod name"
  );
  assert(
    body.reply.includes(baseTitle),
    "explanation reply should mention the canonical base title"
  );
  assert(
    body.reply.includes(resolved.normalizedAssessment.motionLabel),
    "explanation reply should mention the canonical motion label"
  );
}

async function testCanonicalContextPassedToOpenAi() {
  resetStores();
  const assessment = {
    size: "Queen",
    motionMode: "Half Split Motion",
    firmness: "Medium",
    sleepPosition: "Side",
    sleepPartner: "Yes",
    baseType: "Adjustable Base",
  };
  const resolved = await resolveRecommendation({
    assessment,
    includeProducts: true,
    includePods: true,
  });

  const body = await invokeAskSnoozer({
    message: "show my cart",
    sessionId: "canon-cart-1",
    context: {
      assessment,
    },
  });

  assert.strictEqual(openAiCalls.length, 1, "non-recommendation query should still call OpenAI path");
  assert.strictEqual(body.reply, "mocked fallback: show my cart", "mock OpenAI reply should pass through");
  assert.strictEqual(
    openAiCalls[0]?.options?.context?.canonicalRecommendation?.topPodId,
    resolved.recommendation.topPodId,
    "OpenAI context should receive canonical topPodId"
  );
  assert.strictEqual(
    openAiCalls[0]?.options?.context?.canonicalRecommendation?.primaryMattressHandle,
    resolved.recommendation.primaryMattressHandle,
    "OpenAI context should receive canonical primaryMattressHandle"
  );
  assert.strictEqual(
    openAiCalls[0]?.options?.context?.canonicalRecommendation?.baseHandle,
    resolved.recommendation.baseHandle,
    "OpenAI context should receive canonical baseHandle"
  );
  assert.strictEqual(
    openAiCalls[0]?.options?.context?.canonicalRecommendation?.motionKey,
    resolved.normalizedAssessment.motionKey,
    "OpenAI context should receive canonical motionKey"
  );
}

async function testNoAssessmentFallback() {
  resetStores();
  const body = await invokeAskSnoozer({
    message: "Hello there",
    sessionId: "canon-fallback-1",
    context: {},
  });

  assert.strictEqual(openAiCalls.length, 1, "fallback path should call OpenAI");
  assert.strictEqual(body.reply, "mocked fallback: Hello there", "fallback reply should come from mocked OpenAI");
  assert.strictEqual(
    body.context?.canonicalRecommendation || null,
    null,
    "fallback request should not invent canonical recommendation context"
  );
}

async function main() {
  patchDynamo();
  patchOpenAi();

  const tests = [
    ["canonical_recommendation_answer", testCanonicalRecommendationAnswer],
    ["canonical_explanation_answer", testCanonicalExplanationAnswer],
    ["canonical_context_passed_to_openai", testCanonicalContextPassedToOpenAi],
    ["no_assessment_fallback", testNoAssessmentFallback],
  ];

  const failures = [];

  try {
    for (const [name, testFn] of tests) {
      try {
        await testFn();
        console.log(`PASS ${name}`);
      } catch (error) {
        failures.push({ name, message: error.message });
        console.error(`FAIL ${name}: ${error.message}`);
      }
    }
  } finally {
    restoreOpenAi();
    restoreDynamo();
  }

  if (failures.length) {
    console.error(`\n${failures.length} failure(s) detected.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${tests.length} /ask-snoozer canonical tests passed.`);
}

main().catch((error) => {
  restoreOpenAi();
  restoreDynamo();
  console.error(error);
  process.exit(1);
});
