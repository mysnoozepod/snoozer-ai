#!/usr/bin/env node

const assert = require("assert");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
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
        userAgent: "phase4-consistency-test",
      },
      requestId: `phase4-${Date.now()}`,
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
  openai.getSnoozerResponse = async function mockedGetSnoozerResponse(message) {
    openAiCalls.push(message);
    return {
      reply: `mocked fallback: ${message}`,
      text: `mocked fallback: ${message}`,
      model: "mock-openai",
      meta: {
        path: "mock_openai",
      },
      context: {},
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

function assertNoModelCall(label) {
  assert.strictEqual(openAiCalls.length, 0, `${label} should not call OpenAI`);
}

async function testSnoozeCodeGuidance() {
  resetStores();
  const body = await invokeAskSnoozer({
    message: "Where do I use my Snooze Code?",
    sessionId: "phase4-code-guidance",
    context: {
      path: "/ask-snoozer",
      page_type: "page",
      surface: "ask_snoozer_page",
    },
  });

  assertNoModelCall("Snooze Code guidance");
  assert.match(String(body.reply || ""), /Snooze Code/i, "reply should mention Snooze Code");
  assert.match(
    String(body.reply || ""),
    /(unlock|saved profile|check-in)/i,
    "reply should explain what the code is used for"
  );
  assert.strictEqual(
    body.metadata?.qualityGate?.sourceOfTruth,
    "identity_guidance",
    "quality gate should trace identity guidance"
  );
}

async function testRestTestGuidance() {
  resetStores();
  const body = await invokeAskSnoozer({
    message: "How do I start the rest test?",
    sessionId: "phase4-rest-guidance",
    context: {
      path: "/pod/4",
      page_type: "pod",
      surface: "ask_snoozer_page",
    },
  });

  assertNoModelCall("Rest Test guidance");
  assert.strictEqual(
    body.metadata?.qualityGate?.sourceOfTruth,
    "hud_script",
    "rest test guidance should trace to hud_script"
  );
  assert.match(
    String(body.metadata?.qualityGate?.reason || ""),
    /script_guidance_resolved/i,
    "rest test guidance should resolve through script guidance"
  );
  assert.match(
    String(body.reply || ""),
    /(rest test|notice|start|support|pressure)/i,
    "reply should sound like rest test guidance"
  );
}

async function testBuildGuidance() {
  resetStores();
  const body = await invokeAskSnoozer({
    message: "What should I add first?",
    sessionId: "phase4-build-guidance",
    context: {
      path: "/snoozepod",
      page_type: "page",
      surface: "ask_snoozer_page",
    },
  });

  assertNoModelCall("Build guidance");
  assert.strictEqual(
    body.metadata?.qualityGate?.sourceOfTruth,
    "hud_script",
    "build guidance should trace to hud_script"
  );
  assert.match(
    String(body.reply || ""),
    /(build|pod|mattress|setup)/i,
    "reply should sound like build guidance"
  );
}

async function testBookingTraceAlignment() {
  resetStores();
  const body = await invokeAskSnoozer({
    message: "What happens in a Snooze Session?",
    sessionId: "phase4-booking-guidance",
    context: {
      path: "/what-to-expect",
      page_type: "page",
      surface: "ask_snoozer_page",
    },
  });

  assertNoModelCall("Booking guidance");
  assert.strictEqual(
    body.metadata?.qualityGate?.sourceOfTruth,
    "action_allowlist",
    "booking guidance should no longer trace to OpenAI"
  );
  assert.match(
    String(body.reply || ""),
    /Snooze Session|try the bed|in person/i,
    "reply should describe the in-person session"
  );
}

async function testUnknownProductContainment() {
  resetStores();
  const body = await invokeAskSnoozer({
    message: "Tell me about Purple mattress",
    sessionId: "phase4-unknown-product",
    context: {
      path: "/ask-snoozer",
      page_type: "page",
      surface: "ask_snoozer_page",
    },
  });

  assertNoModelCall("Unknown product containment");
  assert.strictEqual(
    body.metadata?.qualityGate?.sourceOfTruth,
    "catalog_boundary",
    "unknown product should trace to catalog boundary"
  );
  assert.match(String(body.reply || ""), /Purple/i, "reply should acknowledge the outside brand");
  assert.match(
    String(body.reply || ""),
    /MySnoozePod catalog|our line|our lineup/i,
    "reply should keep the comparison inside the allowed catalog"
  );
}

async function main() {
  patchDynamo();
  patchOpenAi();

  try {
    await testSnoozeCodeGuidance();
    await testRestTestGuidance();
    await testBuildGuidance();
    await testBookingTraceAlignment();
    await testUnknownProductContainment();
    console.log("runPhase4ConsistencyFixTests: PASS");
  } finally {
    restoreOpenAi();
    restoreDynamo();
  }
}

main().catch((error) => {
  console.error("runPhase4ConsistencyFixTests: FAIL");
  console.error(error);
  process.exit(1);
});
