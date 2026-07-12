#!/usr/bin/env node

const assert = require("assert");
process.env.ASK_SNOOZER_PREFER_LOCAL_KNOWLEDGE = "1";
for (const key of [
  "ZCRM_CLIENT_ID",
  "ZCRM_CLIENT_SECRET",
  "ZCRM_REFRESH_TOKEN",
  "ZCRM_OAUTH_DOMAIN",
  "ZCRM_API_DOMAIN",
  "ZOHO_CRM_BASE",
]) {
  process.env[key] = "";
}

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
      reply:
        "I do not want to guess without the right showroom context. I can help compare mattresses, explain your recommendation, answer policy questions from the loaded guides, or point you to a human.",
      text:
        "I do not want to guess without the right showroom context. I can help compare mattresses, explain your recommendation, answer policy questions from the loaded guides, or point you to a human.",
      model: "mock-premium-final-answer",
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
  {
    id: "why-pod-recommended",
    message: "Why is this pod recommended for me?",
    body: { context: { assessment: buildCanonicalAssessment() } },
    expectAny: ["SnoozePod 4", "12-inch All Foam", "pressure", "support"],
    mustNotInclude: ["No Base", "No Motion", "exact mattress match", "matched setup"],
  },
  {
    id: "mattress-recommendation",
    message: "What mattress do you recommend for me?",
    body: { context: { assessment: buildCanonicalAssessment() } },
    expectAny: ["12-inch All Foam", "SnoozePod 4"],
    mustNotInclude: ["No Base", "No Motion", "matched setup"],
  },
  {
    id: "compare-top-mattresses",
    message: "Compare my top mattresses.",
    expectAny: ["foam", "hybrid", "compare"],
  },
  {
    id: "return-policy",
    message: "What is your return policy?",
    expectAny: ["100-night", "trial", "final sale", "mattress"],
    mustNotInclude: ["Yes, that falls under the return policy"],
  },
  {
    id: "delivery",
    message: "How does delivery work?",
    expectAny: ["delivery", "checkout", "business days", "setup"],
  },
  {
    id: "financing",
    message: "Can I finance this?",
    expectAny: ["financing", "checkout", "terms", "monthly"],
    mustNotInclude: ["0% APR"],
  },
  {
    id: "sleep-hot",
    message: "I sleep hot. What should I do?",
    expectAny: ["cooling", "heat", "breathable", "sleep setup"],
    mustNotInclude: ["Tell me if you sleep side", "Tell me your usual sleep position"],
  },
  {
    id: "side-sleeper",
    message: "I sleep on my side. What should I look for?",
    expectAny: ["pressure relief", "shoulders", "hips"],
    mustNotInclude: ["firm bed"],
  },
  {
    id: "back-pain",
    message: "I have back pain. What should I look for?",
    expectAny: ["support", "stable", "diagnose", "lower back"],
    mustNotInclude: ["cure", "guarantee"],
  },
  {
    id: "partner-moves",
    message: "My partner moves a lot. What matters?",
    expectAny: ["motion separation", "12-inch Dual Comfort", "different firmness"],
    mustNotInclude: ["14-inch Hybrid gives each partner", "14-inch Hybrid lets each", "14-inch Hybrid so each sleeper", "No Base", "No Motion"],
  },
  {
    id: "talk-human",
    message: "Can I talk to a human?",
    expectAny: ["human", "support", "store contact", "guidance"],
  },
  {
    id: "help-decide",
    message: "I do not know what to choose. Help me decide.",
    body: { context: { assessment: buildCanonicalAssessment() } },
    expectAny: ["SnoozePod", "lower-back support", "shoulder", "hip", "best or worst"],
    mustNotInclude: ["No Base", "No Motion", "matched setup"],
  },
];

function buildCanonicalAssessment() {
  return {
    size: "Queen",
    motionMode: "No Motion",
    firmness: "Soft",
    sleepPosition: "Side",
    sleepPartner: "No",
    baseType: "No Base",
    temperature: "Hot",
  };
}

function extractAnswerText(body) {
  return String(
    body?.answer ||
      body?.reply ||
      body?.message?.text ||
      body?.speech ||
      body?.captions ||
      ""
  ).trim();
}

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

function assertAnswerQuality(path, testCase, body) {
  const answer = extractAnswerText(body);
  assert(answer, `${path} ${testCase.id} should include answer text`);
  assert(answer.length <= 700, `${path} ${testCase.id} should stay concise`);

  const banned = [
    /as an ai/i,
    /based on your preferences/i,
    /lorem ipsum/i,
    /\bundefined\b/i,
    /\bnull\b/i,
    /variant_id/i,
    /product_id/i,
    /traceId/i,
    /ReferenceError/i,
    /OPENAI_TIMEOUT/i,
    /I understand\b/i,
    /exact mattress match/i,
    /matched setup/i,
    /back or stomach sleeper support/i,
    /\bNo Base\b/i,
    /\bNo Motion\b/i,
    /\bno[-\s]?base\b/i,
    /\bno[-\s]?motion\b/i,
  ];
  for (const pattern of banned) {
    assert(!pattern.test(answer), `${path} ${testCase.id} used banned phrasing: ${pattern}`);
  }

  const medicalClaims = [
    /\bcure\b/i,
    /\bheal\b/i,
    /\btreat\b/i,
    /\bdiagnose\b.*\bwith certainty\b/i,
    /\bguarantee\b.*\bpain\b/i,
    /\beliminate\b.*\bpain\b/i,
  ];
  for (const pattern of medicalClaims) {
    assert(!pattern.test(answer), `${path} ${testCase.id} made unsupported medical claim`);
  }

  if (Array.isArray(testCase.expectAny) && testCase.expectAny.length) {
    const lowerAnswer = answer.toLowerCase();
    assert(
      testCase.expectAny.some((term) => lowerAnswer.includes(String(term).toLowerCase())),
      `${path} ${testCase.id} should mention one of: ${testCase.expectAny.join(", ")}. Actual: ${answer}`
    );
  }

  if (Array.isArray(testCase.mustNotInclude) && testCase.mustNotInclude.length) {
    const lowerAnswer = answer.toLowerCase();
    for (const term of testCase.mustNotInclude) {
      assert(
        !lowerAnswer.includes(String(term).toLowerCase()),
        `${path} ${testCase.id} should not mention "${term}". Actual: ${answer}`
      );
    }
  }

  if (/return-policy/i.test(testCase.id)) {
    const returnExchangeCount = (answer.match(/return(?:ed)? or exchang(?:e|ed)/gi) || []).length;
    assert(returnExchangeCount <= 1, `${path} ${testCase.id} duplicated return/exchange phrasing. Actual: ${answer}`);
    assert(!/falls under the return policy/i.test(answer), `${path} ${testCase.id} used awkward return-policy opener`);
  }

  if (/side-sleeper/i.test(testCase.id)) {
    assert(!/\.\.\.$/.test(answer), `${path} ${testCase.id} should not be backend-truncated. Actual: ${answer}`);
  }
}

async function invoke(path, testCase) {
  const { lambdaHandler } = require("../index");
  const response = await lambdaHandler(
    buildEvent(path, {
      message: testCase.message,
      sessionId: `smoke-${path.replace("/", "")}-${testCase.id}`,
      accessCode: "1234",
      shopperId: "1234",
      ...(testCase.body || {}),
    })
  );

  assert.strictEqual(response.statusCode, 200, `${path} ${testCase.id} should return HTTP 200`);
  const body = JSON.parse(response.body);
  assert.strictEqual(body.ok, true, `${path} ${testCase.id} should return ok=true`);
  assert(hasRenderableText(body), `${path} ${testCase.id} should include a renderable text field`);
  assertNoRuntimeLeak(path, testCase, body);
  assertNoInventedCommerceTruth(path, testCase, body);
  assertAnswerQuality(path, testCase, body);
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
          answerPreview: extractAnswerText(body).slice(0, 100),
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
