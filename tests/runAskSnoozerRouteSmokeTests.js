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

function buildEvent(path, body) {
  return {
    version: "2.0",
    routeKey: `POST ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      host: "local.ask-snoozer-smoke.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: {
        method: "POST",
        path,
        sourceIp: "127.0.0.1",
        userAgent: "ask-snoozer-route-smoke",
      },
      requestId: `ask-smoke-${Date.now()}`,
      routeKey: `POST ${path}`,
      stage: "local",
      timeEpoch: Date.now(),
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
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

function patchOpenAi() {
  openai.getSnoozerResponse = async function mockedGetSnoozerResponse(message, options = {}) {
    return {
      reply: `Hi there. I can help with that: ${message}`,
      text: `Hi there. I can help with that: ${message}`,
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

function restore() {
  DynamoDBDocumentClient.prototype.send = originalDdbSend;
  openai.getSnoozerResponse = originalOpenAiGetSnoozerResponse;
}

function hasRenderableText(body) {
  return ["answer", "reply", "speech", "captions", "message"].some((key) => {
    const value = body?.[key];
    if (typeof value === "string") return value.trim().length > 0;
    if (value && typeof value === "object") {
      return Object.values(value).some((nested) => typeof nested === "string" && nested.trim());
    }
    return false;
  });
}

const ASK_SNOOZER_CASES = [
  { id: "hello", message: "hello" },
  { id: "firmer-mattress", message: "Do I need a firmer mattress?" },
  { id: "compare-top-pods", message: "Compare my top pods" },
  { id: "best-value", message: "What is the best value option?" },
  { id: "wake-up-tired", message: "Why do I wake up tired?" },
];

function assertNoRuntimeLeak(path, testCase, body) {
  const serialized = JSON.stringify(body);
  assert(!/ReferenceError/i.test(serialized), `${path} ${testCase.id} leaked a ReferenceError`);
  assert(!/safeNumber is not defined/i.test(serialized), `${path} ${testCase.id} regressed safeNumber`);
}

function assertNoInventedCommerceTruth(path, testCase, body) {
  const checkoutUrl = body?.checkoutUrl || body?.metadata?.checkoutUrl || body?.context?.checkoutUrl;
  const cartId = body?.cartId || body?.metadata?.cartId || body?.context?.cartId;
  assert(!checkoutUrl, `${path} ${testCase.id} invented checkoutUrl`);
  assert(!cartId, `${path} ${testCase.id} invented cartId`);

  const serialized = JSON.stringify(body);
  assert(!/gid:\/\/shopify\/(Cart|ProductVariant)\//i.test(serialized), `${path} ${testCase.id} invented Shopify GID`);
}

async function invoke(path, testCase) {
  const { lambdaHandler } = require("../index");
  const response = await lambdaHandler(
    buildEvent(path, {
      message: testCase.message,
      sessionId: `smoke-${path.replace("/", "")}-${testCase.id}`,
      accessCode: "1234",
      shopperId: "1234",
    })
  );

  assert.strictEqual(response.statusCode, 200, `${path} ${testCase.id} should return HTTP 200`);
  const body = JSON.parse(response.body);
  assert.strictEqual(body.ok, true, `${path} ${testCase.id} should return ok=true`);
  assert(hasRenderableText(body), `${path} ${testCase.id} should include a renderable text field`);
  assertNoRuntimeLeak(path, testCase, body);
  assertNoInventedCommerceTruth(path, testCase, body);
  return body;
}

async function main() {
  patchDynamo();
  patchOpenAi();

  try {
    const results = [];
    for (const path of ["/ask-snoozer", "/ask"]) {
      for (const testCase of ASK_SNOOZER_CASES) {
        const body = await invoke(path, testCase);
        results.push({
          path,
          id: testCase.id,
          answerPreview: String(body.answer || body.reply || body.message || "").slice(0, 80),
          contract: body.contract,
        });
      }
    }
    console.log("Ask Snoozer route smoke matrix passed.", {
      cases: results.length,
      results,
    });
  } finally {
    restore();
  }
}

main().catch((error) => {
  restore();
  console.error(error);
  process.exit(1);
});
