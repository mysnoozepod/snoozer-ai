#!/usr/bin/env node

const assert = require("assert");
process.env.ASK_SNOOZER_PREFER_LOCAL_KNOWLEDGE = "1";
process.env.ASK_SNOOZER_CONVERSATION_CORE_MODE = "active";
process.env.ASK_SNOOZER_CONVERSATION_CORE_MODEL = "gpt-6.1-sol";
process.env.ASK_SNOOZER_CONVERSATION_CORE_REASONING_EFFORT = "low";

for (const key of ["ZCRM_CLIENT_ID", "ZCRM_CLIENT_SECRET", "ZCRM_REFRESH_TOKEN", "ZCRM_OAUTH_DOMAIN", "ZCRM_API_DOMAIN", "ZOHO_CRM_BASE"]) {
  process.env[key] = "";
}

const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const modelCore = require("../services/askSnoozerModelCore");

const originalDdbSend = DynamoDBDocumentClient.prototype.send;
const originalRunCore = modelCore.runSnoozerConversationCore;
const sessionStore = new Map();
let coreCalls = 0;

function event(body) {
  return {
    version: "2.0",
    routeKey: "POST /ask-snoozer",
    rawPath: "/ask-snoozer",
    headers: {
      "content-type": "application/json",
      host: "local.conversation-core.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: { method: "POST", path: "/ask-snoozer", sourceIp: "127.0.0.1", userAgent: "conversation-core-route-test" },
      requestId: `conversation-core-${Date.now()}`,
      routeKey: "POST /ask-snoozer",
      stage: "local",
      timeEpoch: Date.now(),
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function patchDependencies() {
  DynamoDBDocumentClient.prototype.send = async function send(command) {
    if (command instanceof GetCommand) {
      return { Item: sessionStore.get(command.input?.Key?.sessionId) || null };
    }
    if (command instanceof PutCommand) {
      if (command.input?.Item?.sessionId) sessionStore.set(command.input.Item.sessionId, command.input.Item);
      return {};
    }
    if (command instanceof UpdateCommand) {
      const sessionId = command.input?.Key?.sessionId;
      if (sessionId) {
        const existing = sessionStore.get(sessionId) || { sessionId, context: {} };
        const values = command.input?.ExpressionAttributeValues || {};
        sessionStore.set(sessionId, {
          ...existing,
          context: values[":c"] || existing.context,
          ...(values[":journey"] ? { context: { ...(existing.context || {}), activeJourney: values[":journey"] } } : {}),
        });
      }
      return {};
    }
    return {};
  };
  modelCore.runSnoozerConversationCore = async ({ message, context, history }) => {
    coreCalls += 1;
    assert(message.includes("side sleeper"));
    assert(Array.isArray(history));
    assert(context.sessionId);
    return {
      ok: true,
      status: "answered",
      reply: "Your side-sleeping position, shoulder pressure, and heat sensitivity all matter. I would compare the 12-inch All Foam and 12-inch Dual Comfort Hybrid, with the Dual Comfort first because its verified cooling better balances all three needs.",
      speech: "I would compare the 12-inch All Foam and 12-inch Dual Comfort Hybrid, starting with the Dual Comfort for pressure relief plus cooling.",
      captions: "I would compare the 12-inch All Foam and 12-inch Dual Comfort Hybrid, starting with the Dual Comfort for pressure relief plus cooling.",
      state: "speaking",
      priority: "normal",
      ttlMs: 7000,
      responseMode: "answer",
      productHandles: ["12-all-foam-mattress", "12-dual-comfort-hybrid"],
      products: [],
      chips: [{ label: "Compare these two", value: "Compare these two", type: "prompt", target: null }],
      actionProposals: [],
      actions: [],
      preferences: [
        { key: "sleep_position", value: "side", subject: "shopper", operation: "set", evidence: "side sleeper" },
        { key: "pressure_area", value: "shoulders", subject: "shopper", operation: "set", evidence: "shoulders get sore" },
        { key: "temperature", value: "sleeps_hot", subject: "shopper", operation: "set", evidence: "sleep hot" },
      ],
      references: {
        presentedProductHandles: ["12-all-foam-mattress", "12-dual-comfort-hybrid"],
        comparisonProductHandles: ["12-all-foam-mattress", "12-dual-comfort-hybrid"],
        lastDiscussedProductHandle: "12-dual-comfort-hybrid",
        lastDiscussedBaseHandle: null,
      },
      decisions: [{ status: "recommended", productHandle: "12-dual-comfort-hybrid", configurationKey: null, evidence: "side sleeper" }],
      claims: [{ kind: "product", value: "Verified product comparison.", sourceTool: "discover_products", sourceKey: "12-dual-comfort-hybrid" }],
      fallback: { used: false, reason: null },
      quote: null,
      telemetry: {
        coreVersion: "conversation-core.v1", mode: "active", model: "gpt-6.1-sol", reasoningEffort: "low",
        modelCallCount: 2, modelMs: 1200, toolRounds: 1, toolCallCount: 1,
        tools: [{ name: "discover_products", ok: true, latencyMs: 40, error: null }],
        retrievalMs: 40, totalMs: 1240,
        usage: { prompt: 900, cached: 100, completion: 180, reasoning: 20, total: 1080, estimatedCostUsd: 0.00341 },
        validationErrors: [], acceptedStateProposals: 4, rejectedStateProposals: 0, fallbackReason: null,
      },
    };
  };
}

function restore() {
  DynamoDBDocumentClient.prototype.send = originalDdbSend;
  modelCore.runSnoozerConversationCore = originalRunCore;
}

async function main() {
  patchDependencies();
  try {
    const sessionId = "conversation-core-route-fresh";
    const { lambdaHandler } = require("../index");
    const response = await lambdaHandler(event({
      sessionId,
      accessCode: "9876",
      shopperId: "9876",
      history: [],
      message: "I'm a side sleeper, my shoulders get sore, and I sleep hot. Where should I start?",
    }));
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(coreCalls, 1);
    assert.equal(body.ok, true);
    assert.equal(body.status, "answered");
    assert.equal(body.metadata.answerPath, "conversation_core");
    assert.equal(body.metadata.model, "gpt-6.1-sol");
    assert.equal(body.metadata.metrics.modelCallCount, 2);
    assert.equal(body.metadata.conversationCore.toolCallCount, 1);
    assert(body.metadata.conversationCore.estimatedCostUsd > 0);
    assert.equal(body.chips[0].label, "Compare these two");
    const stored = [...sessionStore.values()].map((item) => item?.context).find((item) => item?.snoozerConversationState);
    assert(stored?.snoozerConversationState, "validated conversation state should be persisted");
    assert.equal(Object.keys(stored.snoozerConversationState.preferences).length, 3);
    assert.deepEqual(stored.snoozerConversationState.references.comparisonProductHandles, ["12-all-foam-mattress", "12-dual-comfort-hybrid"]);
    assert.equal(stored.recentConversation.at(-1).role, "assistant");
    console.log("Ask Snoozer Conversation Core route test passed (active cutover, Sol metadata, post-validation persistence, and frontend contract).");
  } finally {
    restore();
  }
}

main().catch((error) => {
  restore();
  console.error(error);
  process.exitCode = 1;
});
