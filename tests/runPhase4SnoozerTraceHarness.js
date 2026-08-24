#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const manifest = require("../data/showroom-manifest.v1.json");
const shopifySvc = require("../services/shopify");
const policySvc = require("../services/askSnoozerPolicy");
const openaiSvc = require("../services/openai");

let customerProfileSvc = null;
try {
  customerProfileSvc = require("../services/customerProfile");
} catch {
  customerProfileSvc = null;
}

const originalDdbSend = DynamoDBDocumentClient.prototype.send;
const originalFetchProductsByHandles = shopifySvc.fetchProductsByHandles;
const originalResolvePolicySources = policySvc.resolveAskSnoozerPolicySources;
const originalResolveSupplementalSources = policySvc.resolveAskSnoozerSupplementalSources;
const originalResolvePolicyAnswer = policySvc.resolveAskSnoozerPolicyAnswer;
const originalOpenAiGetSnoozerResponse = openaiSvc.getSnoozerResponse;
const originalCustomerProfileGet = customerProfileSvc?.getCustomerProfile;

const sessionStore = new Map();
const resultsStore = new Map();

const TRACE_OUTPUT_PATH = path.join(
  __dirname,
  "..",
  "phase4-audit",
  "phase4-trace-output.json"
);

const CANONICAL_ASSESSMENT = Object.freeze({
  size: "Queen",
  motionMode: "No Motion",
  firmness: "Soft",
  sleepPosition: "Side",
  sleepPartner: "No",
  baseType: "No Base",
  temperature: "Hot",
});

const CANONICAL_SESSION_PREP = Object.freeze({
  status: "generated",
  topPodId: "4",
  topPodIds: ["4", "2", "1"],
  talkingPoints: [
    "Start with SnoozePod 4.",
    "Notice pressure relief first, then motion.",
    "Compare a second pod before deciding.",
  ],
});

const GENERIC_REPLY_PATTERNS = [
  /i can help with mattress fit, pricing, delivery, returns, or booking a snooze session/i,
  /i can still guide you\. try one of these starting points\./i,
  /i can recommend a setup once i have your assessment/i,
  /\[phase4-trace-model-stub]/i,
];

const TRACE_CASES = [
  {
    id: "price-product-queen",
    category: "price",
    surface: "website_snoozer",
    route: "/hud/ask",
    payload: {
      query: "How much is this in Queen?",
      path: "/products/14-hybrid",
      page_type: "product",
      currentProductHandle: "14-hybrid",
      surface: "shopify_header",
    },
  },
  {
    id: "price-bundle-base",
    category: "price",
    surface: "website_snoozer",
    route: "/hud/ask",
    payload: {
      query: "How much with an adjustable base?",
      path: "/products/12-all-foam-mattress",
      page_type: "product",
      currentProductHandle: "12-all-foam-mattress",
      surface: "shopify_header",
    },
  },
  {
    id: "price-cheapest-ask",
    category: "price",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "What's the cheapest mattress-only option?",
      sessionId: "phase4-price-cheapest",
      context: {
        path: "/ask-snoozer",
        page_type: "page",
        surface: "ask_snoozer_page",
      },
    },
  },
  {
    id: "fit-couple-conflict-product",
    category: "product_fit",
    surface: "website_snoozer",
    route: "/hud/ask",
    payload: {
      query: "I like firmer, my wife likes softer",
      path: "/products/14-hybrid",
      page_type: "product",
      currentProductHandle: "14-hybrid",
      surface: "shopify_header",
    },
  },
  {
    id: "fit-hot-side-home",
    category: "product_fit",
    surface: "website_snoozer",
    route: "/hud/ask",
    payload: {
      query: "I'm a hot side sleeper. What fits me?",
      path: "/",
      page_type: "home",
      surface: "shopify_header",
    },
  },
  {
    id: "fit-toss-turn-ask",
    category: "product_fit",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "I toss and turn and wake up sweaty",
      sessionId: "phase4-fit-toss-turn",
      context: {
        path: "/ask-snoozer",
        page_type: "page",
        surface: "ask_snoozer_page",
      },
    },
  },
  {
    id: "policy-sleep-trial",
    category: "policy",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "What is your 90 day sleep trial?",
      sessionId: "phase4-policy-trial",
      context: {
        path: "/ask-snoozer",
        page_type: "page",
        surface: "ask_snoozer_page",
      },
    },
  },
  {
    id: "policy-delivery",
    category: "policy",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "How does delivery work?",
      sessionId: "phase4-policy-delivery",
      context: {
        path: "/ask-snoozer",
        page_type: "page",
        surface: "ask_snoozer_page",
      },
    },
  },
  {
    id: "policy-financing-hud",
    category: "policy",
    surface: "website_snoozer",
    route: "/hud/ask",
    payload: {
      query: "Do you offer financing?",
      path: "/",
      page_type: "home",
      surface: "shopify_header",
    },
  },
  {
    id: "session-try-first",
    category: "session_guidance",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "What should I try first?",
      sessionId: "phase4-session-try-first",
      context: {
        path: "/results",
        page_type: "results",
        surface: "ask_snoozer_page",
        sessionPrep: CANONICAL_SESSION_PREP,
        assessment: CANONICAL_ASSESSMENT,
      },
    },
  },
  {
    id: "session-what-happens",
    category: "session_guidance",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "What happens during a Snooze Session?",
      sessionId: "phase4-session-what-happens",
      context: {
        path: "/what-to-expect",
        page_type: "page",
        surface: "ask_snoozer_page",
        bookingStatus: "scheduled",
      },
    },
  },
  {
    id: "session-prep-tomorrow",
    category: "session_guidance",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "I'm booked tomorrow. How should I prep?",
      sessionId: "phase4-session-prep",
      context: {
        path: "/what-to-expect",
        page_type: "page",
        surface: "ask_snoozer_page",
        sessionPrep: CANONICAL_SESSION_PREP,
        bookingStatus: "scheduled",
      },
    },
  },
  {
    id: "code-where-use",
    category: "snooze_code",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "Where do I use my Snooze Code?",
      sessionId: "phase4-code-where",
      context: {
        path: "/ask-snoozer",
        page_type: "page",
        surface: "ask_snoozer_page",
      },
    },
  },
  {
    id: "code-what-next-hud",
    category: "snooze_code",
    surface: "website_snoozer",
    route: "/hud/ask",
    payload: {
      query: "I already have a Snooze Code. What do I do next?",
      path: "/",
      page_type: "home",
      surface: "shopify_header",
    },
  },
  {
    id: "code-589424-ask",
    category: "snooze_code",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "I have code 589424. What should I do first?",
      sessionId: "phase4-code-589424",
      shopperId: "589424",
      context: {
        path: "/ask-snoozer",
        page_type: "page",
        surface: "ask_snoozer_page",
      },
    },
  },
  {
    id: "pod-why-this-pod",
    category: "pod_guidance",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "Why this pod?",
      sessionId: "phase4-pod-why",
      context: {
        path: "/results",
        page_type: "results",
        surface: "ask_snoozer_page",
        assessment: CANONICAL_ASSESSMENT,
      },
    },
  },
  {
    id: "pod-explain-results",
    category: "pod_guidance",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "Explain my results.",
      sessionId: "phase4-pod-explain",
      context: {
        path: "/results",
        page_type: "results",
        surface: "ask_snoozer_page",
        assessment: CANONICAL_ASSESSMENT,
      },
    },
  },
  {
    id: "pod-recommendation",
    category: "pod_guidance",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "What do you recommend?",
      sessionId: "phase4-pod-recommend",
      context: {
        path: "/results",
        page_type: "results",
        surface: "ask_snoozer_page",
        assessment: CANONICAL_ASSESSMENT,
      },
    },
  },
  {
    id: "rest-test-start",
    category: "rest_test",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "How do I start the rest test?",
      sessionId: "phase4-rest-start",
      context: {
        path: "/pod/4",
        page_type: "pod",
        surface: "ask_snoozer_page",
      },
    },
  },
  {
    id: "rest-test-notice",
    category: "rest_test",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "What should I notice during the rest test?",
      sessionId: "phase4-rest-notice",
      context: {
        path: "/pod/4",
        page_type: "pod",
        surface: "ask_snoozer_page",
      },
    },
  },
  {
    id: "rest-test-in-person-hud",
    category: "rest_test",
    surface: "website_snoozer",
    route: "/hud/ask",
    payload: {
      query: "How do I test this in person?",
      path: "/products/14-hybrid",
      page_type: "product",
      currentProductHandle: "14-hybrid",
      surface: "shopify_header",
    },
  },
  {
    id: "build-pod-help",
    category: "build_your_pod",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "Help me build my pod",
      sessionId: "phase4-build-help",
      context: {
        path: "/snoozepod",
        page_type: "page",
        surface: "ask_snoozer_page",
      },
    },
  },
  {
    id: "build-pod-add-first",
    category: "build_your_pod",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "What should I add first?",
      sessionId: "phase4-build-first",
      context: {
        path: "/snoozepod",
        page_type: "page",
        surface: "ask_snoozer_page",
      },
    },
  },
  {
    id: "checkout-help",
    category: "checkout",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "Can you help me checkout?",
      sessionId: "phase4-checkout-help",
      context: {
        path: "/checkout/guest",
        page_type: "checkout",
        surface: "ask_snoozer_page",
      },
    },
  },
  {
    id: "checkout-add-cart",
    category: "checkout",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "Add this to cart",
      sessionId: "phase4-add-cart",
      context: {
        path: "/products/14-hybrid",
        page_type: "product",
        surface: "ask_snoozer_page",
      },
    },
  },
  {
    id: "medical-cure-back-pain",
    category: "unsafe_medical",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "Will this cure my back pain?",
      sessionId: "phase4-medical-cure",
      context: {
        path: "/products/14-hybrid",
        page_type: "product",
        surface: "ask_snoozer_page",
      },
    },
  },
  {
    id: "medical-proven-snoring-hud",
    category: "unsafe_medical",
    surface: "website_snoozer",
    route: "/hud/ask",
    payload: {
      query: "Is this medically proven to stop snoring?",
      path: "/products/premium-motion-adjustable-base",
      page_type: "product",
      currentProductHandle: "premium-motion-adjustable-base",
      surface: "shopify_header",
    },
  },
  {
    id: "unknown-purple-ask",
    category: "unknown_products",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "Tell me about Purple mattress",
      sessionId: "phase4-unknown-purple",
      context: {
        path: "/ask-snoozer",
        page_type: "page",
        surface: "ask_snoozer_page",
      },
    },
  },
  {
    id: "unknown-tempur-hud",
    category: "unknown_products",
    surface: "website_snoozer",
    route: "/hud/ask",
    payload: {
      query: "Compare Tempur-Pedic to yours",
      path: "/",
      page_type: "home",
      surface: "shopify_header",
    },
  },
  {
    id: "canonical-which-mattress",
    category: "product_fit",
    surface: "ask_snoozer_page",
    route: "/ask-snoozer",
    payload: {
      message: "Which mattress fits me?",
      sessionId: "phase4-canonical-which-mattress",
      context: {
        path: "/results",
        page_type: "results",
        surface: "ask_snoozer_page",
        assessment: CANONICAL_ASSESSMENT,
      },
    },
  },
];

const observer = {
  activeCaseId: null,
  selectedS3Keys: new Set(),
  shopifyLookups: [],
  profileLookups: [],
  modelCalls: [],
};

function resetObserver(caseId) {
  observer.activeCaseId = caseId;
  observer.selectedS3Keys = new Set();
  observer.shopifyLookups = [];
  observer.profileLookups = [];
  observer.modelCalls = [];
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function buildProductItem(product) {
  const basePrice = Number(product?.diagnostics?.tracePrice || 1000);
  const currencyCode = "USD";
  const sizeOptions = ["Twin", "Full", "Queen", "King", "Split King", "Twin XL"];
  const variants = sizeOptions.map((size, index) => ({
    id: `gid://shopify/ProductVariant/${product.handle}-${size.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    available: true,
    title: size,
    price: basePrice + index * 100,
    currencyCode,
    selectedOptions: [{ name: "Size", value: size }],
  }));

  return {
    id: `gid://shopify/Product/${product.handle}`,
    handle: product.handle,
    title: product.title,
    available: true,
    variants,
    firstAvailableVariantId: variants[0].id,
    variantId: variants[0].id,
    priceRange: {
      min: basePrice,
      currencyCode,
    },
    image: {
      url: `/mock-images/${product.handle}.png`,
      altText: product.title,
    },
    images: [
      {
        url: `/mock-images/${product.handle}.png`,
        altText: product.title,
      },
    ],
  };
}

function patchDynamo() {
  resultsStore.set("589424", {
    shopperId: "589424",
    answers: { ...CANONICAL_ASSESSMENT },
    updatedAt: new Date().toISOString(),
  });

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

function patchShopify() {
  const productMap = new Map(
    (Array.isArray(manifest.products) ? manifest.products : []).map((product) => [
      String(product.handle || "").trim(),
      product,
    ])
  );

  shopifySvc.fetchProductsByHandles = async function mockedFetchProductsByHandles({
    handles = [],
  } = {}) {
    const normalizedHandles = uniqueStrings(handles);
    const items = normalizedHandles
      .map((handle) => productMap.get(handle))
      .filter(Boolean)
      .map(buildProductItem);

    observer.shopifyLookups.push({
      requestedHandles: normalizedHandles,
      returnedHandles: items.map((item) => item.handle),
      ok: true,
    });

    return { items };
  };
}

function collectSourceKeys(result) {
  const keys = [];
  if (result?.key) keys.push(result.key);
  if (Array.isArray(result?.sources)) {
    for (const source of result.sources) {
      if (source?.source_key) keys.push(source.source_key);
      if (source?.sourceKey) keys.push(source.sourceKey);
      if (source?.key) keys.push(source.key);
    }
  }
  return uniqueStrings(keys);
}

function patchPolicy() {
  policySvc.resolveAskSnoozerPolicySources = async function wrappedResolvePolicySources(...args) {
    const result = await originalResolvePolicySources.apply(this, args);
    for (const key of collectSourceKeys(result)) {
      observer.selectedS3Keys.add(key);
    }
    return result;
  };

  policySvc.resolveAskSnoozerSupplementalSources =
    async function wrappedResolveSupplementalSources(...args) {
      const result = await originalResolveSupplementalSources.apply(this, args);
      for (const key of collectSourceKeys(result)) {
        observer.selectedS3Keys.add(key);
      }
      return result;
    };

  policySvc.resolveAskSnoozerPolicyAnswer = async function wrappedResolvePolicyAnswer(...args) {
    const result = await originalResolvePolicyAnswer.apply(this, args);
    for (const key of collectSourceKeys(result)) {
      observer.selectedS3Keys.add(key);
    }
    return result;
  };
}

function patchOpenAi() {
  const useRealOpenAi = String(process.env.PHASE4_USE_REAL_OPENAI || "").trim() === "1";

  openaiSvc.getSnoozerResponse = async function wrappedGetSnoozerResponse(message, options = {}) {
    if (!useRealOpenAi) {
      const stubReply = `[phase4-trace-model-stub] Model path hit for: ${String(message || "").trim()}`;
      const stubResult = {
        reply: stubReply,
        text: stubReply,
        model: "phase4-trace-stub",
        meta: {
          path: "phase4_trace_stub",
          retrievalMs: 0,
          fallbackUsed: false,
        },
        actions: [],
        products: [],
        context: options.context || {},
        raw: {
          stubbed: true,
          message: String(message || ""),
          mode: options.mode || null,
        },
      };

      observer.modelCalls.push({
        ok: true,
        mode: options.mode || null,
        usedStub: true,
        rawAnswer: stubReply,
      });

      return stubResult;
    }

    const result = await originalOpenAiGetSnoozerResponse.call(this, message, options);
    observer.modelCalls.push({
      ok: true,
      mode: options.mode || null,
      usedStub: false,
      rawAnswer: String(result?.reply || result?.text || "").trim() || null,
      model: result?.model || null,
    });
    return result;
  };
}

function patchCustomerProfile() {
  if (!customerProfileSvc || typeof originalCustomerProfileGet !== "function") return;

  customerProfileSvc.getCustomerProfile = async function wrappedGetCustomerProfile(...args) {
    const result = await originalCustomerProfileGet.apply(this, args);
    observer.profileLookups.push({
      ok: Boolean(result?.ok),
      skipped: Boolean(result?.skipped),
      reason: result?.reason || null,
      profileId: result?.profileId || null,
      found: Boolean(result?.profile),
    });
    return result;
  };
}

function restorePatches() {
  DynamoDBDocumentClient.prototype.send = originalDdbSend;
  shopifySvc.fetchProductsByHandles = originalFetchProductsByHandles;
  policySvc.resolveAskSnoozerPolicySources = originalResolvePolicySources;
  policySvc.resolveAskSnoozerSupplementalSources = originalResolveSupplementalSources;
  policySvc.resolveAskSnoozerPolicyAnswer = originalResolvePolicyAnswer;
  openaiSvc.getSnoozerResponse = originalOpenAiGetSnoozerResponse;
  if (customerProfileSvc && typeof originalCustomerProfileGet === "function") {
    customerProfileSvc.getCustomerProfile = originalCustomerProfileGet;
  }
}

function buildBaseEvent(routePath, body, requestIdPrefix) {
  return {
    version: "2.0",
    routeKey: `POST ${routePath}`,
    rawPath: routePath,
    rawQueryString: "debug=1",
    queryStringParameters: {
      debug: "1",
    },
    headers: {
      "content-type": "application/json",
      host: "local.phase4.trace.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
      "x-debug": "1",
    },
    requestContext: {
      http: {
        method: "POST",
        path: routePath,
        sourceIp: "127.0.0.1",
        userAgent: "phase4-snoozer-trace-harness",
      },
      requestId: `${requestIdPrefix}-${Date.now()}`,
      routeKey: `POST ${routePath}`,
      stage: "local",
      timeEpoch: Date.now(),
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function buildEventForCase(testCase) {
  if (testCase.route === "/ask-snoozer") {
    return buildBaseEvent("/ask-snoozer", testCase.payload, testCase.id);
  }
  return buildBaseEvent("/hud/ask", testCase.payload, testCase.id);
}

function safeParseJson(raw) {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function captureConsole(run) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const entries = [];

  const recorder = (level) => (...args) => {
    entries.push({ level, args });
  };

  console.log = recorder("log");
  console.warn = recorder("warn");
  console.error = recorder("error");

  return Promise.resolve()
    .then(run)
    .then((result) => ({ result, entries }))
    .finally(() => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    });
}

function parseLogEntries(entries = []) {
  return entries.map((entry) => {
    const first = entry.args[0];
    const structured =
      typeof first === "string" ? safeParseJson(first) : null;

    if (structured && typeof structured === "object") {
      return {
        level: entry.level,
        structured,
        raw: first,
      };
    }

    return {
      level: entry.level,
      structured: null,
      raw: entry.args
        .map((value) => {
          if (typeof value === "string") return value;
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })
        .join(" "),
    };
  });
}

function findStructuredLog(parsedLogs = [], src) {
  return parsedLogs
    .filter((entry) => entry.structured && entry.structured.src === src)
    .map((entry) => entry.structured);
}

function validateAskSnoozerContract(payload) {
  const issues = [];
  if (typeof payload?.ok !== "boolean") issues.push("ok must be boolean");
  if (typeof payload?.status !== "string" || !payload.status.trim()) {
    issues.push("status must be a non-empty string");
  }
  if (typeof payload?.reply !== "string" || !payload.reply.trim()) {
    issues.push("reply must be a non-empty string");
  }
  if (!payload?.metadata || typeof payload.metadata !== "object" || Array.isArray(payload.metadata)) {
    issues.push("metadata must be an object");
  }
  if (!payload?.context || typeof payload.context !== "object" || Array.isArray(payload.context)) {
    issues.push("context must be an object");
  }
  if (!Array.isArray(payload?.actions)) issues.push("actions must be an array");
  if (!Array.isArray(payload?.products)) issues.push("products must be an array");
  return {
    valid: issues.length === 0,
    issues,
  };
}

function validateHudAskContract(payload) {
  const issues = [];
  const requiredStringFields = [
    "status",
    "reply",
    "intent",
    "intent_group",
    "confidence_label",
  ];
  for (const field of requiredStringFields) {
    if (typeof payload?.[field] !== "string" || !payload[field].trim()) {
      issues.push(`${field} must be a non-empty string`);
    }
  }

  if (typeof payload?.confidence !== "number" || Number.isNaN(payload.confidence)) {
    issues.push("confidence must be a number");
  }

  for (const field of ["chips", "actions", "products", "collections", "pages"]) {
    if (!Array.isArray(payload?.[field])) issues.push(`${field} must be an array`);
  }

  if (!payload?.meta || typeof payload.meta !== "object" || Array.isArray(payload.meta)) {
    issues.push("meta must be an object");
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

function detectGenericReply(reply = "") {
  return GENERIC_REPLY_PATTERNS.some((pattern) => pattern.test(String(reply || "")));
}

function buildFailureTags({
  route,
  modelCalled,
  sourceOfTruth,
  answerSourceType,
  fallbackUsed,
  genericReply,
  contractValid,
  category,
}) {
  const tags = [];
  if (route === "/ask-snoozer" && modelCalled) tags.push("model_escape");
  if (sourceOfTruth === "fallback" || answerSourceType === "fallback") tags.push("fallback_source");
  if (fallbackUsed) tags.push("fallback_used");
  if (genericReply) tags.push("generic_reply");
  if (!contractValid) tags.push("contract_gap");
  if (
    modelCalled &&
    [
      "policy",
      "product_fit",
      "session_guidance",
      "snooze_code",
      "pod_guidance",
      "rest_test",
      "build_your_pod",
      "unknown_products",
    ].includes(category)
  ) {
    tags.push("deterministic_gap");
  }
  return uniqueStrings(tags);
}

function safeReply(payload) {
  return String(
    payload?.reply ||
      payload?.speech ||
      payload?.captions ||
      payload?.message?.text ||
      ""
  ).trim();
}

async function invokeCase(lambdaHandler, testCase) {
  resetObserver(testCase.id);
  const event = buildEventForCase(testCase);
  const { result, entries } = await captureConsole(() => lambdaHandler(event));
  const body = safeParseJson(result?.body || "{}") || {};
  const parsedLogs = parseLogEntries(entries);

  const askDecisionLog = findStructuredLog(parsedLogs, "ask-snoozer.router.decision").pop() || null;
  const askResultLog = findStructuredLog(parsedLogs, "ask-snoozer.fulfillment.result").pop() || null;
  const hudResultLog = findStructuredLog(parsedLogs, "hud.ask").pop() || null;

  const contractValidation =
    testCase.route === "/ask-snoozer"
      ? validateAskSnoozerContract(body)
      : validateHudAskContract(body);

  const reply = safeReply(body);
  const sourceOfTruth =
    body?.metadata?.qualityGate?.sourceOfTruth ||
    body?.meta?.answer_source_type ||
    askDecisionLog?.sourceOfTruth ||
    hudResultLog?.policySource ||
    "unknown";
  const answerSourceType =
    body?.metadata?.qualityGate?.sourceOfTruth === "canonical_profile" &&
    body?.metadata?.qualityGate?.factsResolved
      ? "canonical_profile"
      : body?.meta?.answer_source_type ||
        body?.metadata?.qualityGate?.sourceOfTruth ||
        null;
  const fallbackUsed = Boolean(
    body?.metadata?.metrics?.fallbackUsed ||
      body?.meta?.error ||
      askResultLog?.fallbackUsed ||
      false
  );
  const modelCalled = observer.modelCalls.length > 0;
  const genericReply = detectGenericReply(reply);

  return {
    id: testCase.id,
    category: testCase.category,
    surface: testCase.surface,
    route: testCase.route,
    message: String(testCase.payload.message || testCase.payload.query || "").trim(),
    pageContext:
      testCase.route === "/ask-snoozer"
        ? {
            path: testCase.payload.context?.path || null,
            pageType: testCase.payload.context?.page_type || null,
            mode: testCase.payload.mode || null,
          }
        : {
            path: testCase.payload.path || null,
            pageType: testCase.payload.page_type || null,
            currentProductHandle: testCase.payload.currentProductHandle || null,
          },
    shopperSessionContext: {
      shopperId:
        testCase.payload.shopperId ||
        testCase.payload.context?.shopperId ||
        null,
      sessionId:
        testCase.payload.sessionId ||
        testCase.payload.session_id ||
        testCase.payload.thread_id ||
        null,
      hasAssessment:
        Boolean(testCase.payload.context?.assessment) ||
        Boolean(testCase.payload.assessment),
      hasSessionPrep: Boolean(testCase.payload.context?.sessionPrep),
    },
    classifiedIntent: {
      intent:
        askDecisionLog?.intent ||
        body?.intent ||
        hudResultLog?.intent ||
        null,
      intentGroup:
        askDecisionLog?.intentGroup ||
        body?.intent_group ||
        hudResultLog?.intentGroup ||
        null,
      confidence:
        askDecisionLog?.confidence ??
        body?.confidence ??
        hudResultLog?.confidence ??
        null,
      shouldUseOpenAI: askDecisionLog?.shouldUseOpenAI ?? modelCalled,
      shouldAskClarifyingQuestion:
        askDecisionLog?.shouldAskClarifyingQuestion ?? null,
    },
    selectedSourceType: {
      sourceOfTruth,
      answerSourceType,
      answerSourceKey:
        body?.meta?.answer_source_key ||
        body?.metadata?.qualityGate?.knowledgeKeys?.[0] ||
        null,
    },
    selectedS3Keys: uniqueStrings([
      ...observer.selectedS3Keys,
      ...(Array.isArray(body?.metadata?.source?.s3Prompts) ? body.metadata.source.s3Prompts : []),
    ]),
    shopifyLookupStatus: observer.shopifyLookups.length
      ? observer.shopifyLookups
      : [{ ok: false, requestedHandles: [], returnedHandles: [] }],
    profileLookupStatus: observer.profileLookups.length
      ? observer.profileLookups
      : [{ ok: false, skipped: true, reason: "NOT_ATTEMPTED", found: false }],
    modelCallStatus: modelCalled
      ? observer.modelCalls
      : [{ ok: false, usedStub: false, rawAnswer: null, model: null }],
    fallbackStatus: {
      fallbackUsed,
      genericReply,
      status: body?.status || body?.meta?.error || null,
      reason:
        body?.metadata?.qualityGate?.reason ||
        body?.meta?.error ||
        askResultLog?.reason ||
        null,
    },
    rawModelAnswer:
      observer.modelCalls[0]?.rawAnswer ||
      body?.message?.raw ||
      null,
    finalAnswer: reply,
    contractValidation,
    failureTags: buildFailureTags({
      route: testCase.route,
      modelCalled,
      sourceOfTruth,
      answerSourceType,
      fallbackUsed,
      genericReply,
      contractValid: contractValidation.valid,
      category: testCase.category,
    }),
    traceId: body?.traceId || body?.thread_id || result?.headers?.["X-Trace-Id"] || null,
    logsExamined: {
      askDecisionSeen: Boolean(askDecisionLog),
      askResultSeen: Boolean(askResultLog),
      hudResultSeen: Boolean(hudResultLog),
      logCount: parsedLogs.length,
    },
  };
}

function summarizeResults(results = []) {
  const summary = {
    totalCases: results.length,
    byRoute: {},
    byCategory: {},
    failureTags: {},
    modelEscapeCount: 0,
    deterministicCount: 0,
    genericReplyCount: 0,
    invalidContractCount: 0,
  };

  for (const result of results) {
    summary.byRoute[result.route] = (summary.byRoute[result.route] || 0) + 1;
    summary.byCategory[result.category] = (summary.byCategory[result.category] || 0) + 1;

    if (!result.modelCallStatus[0]?.ok) {
      summary.deterministicCount += 1;
    } else {
      summary.modelEscapeCount += 1;
    }

    if (result.fallbackStatus.genericReply) summary.genericReplyCount += 1;
    if (!result.contractValidation.valid) summary.invalidContractCount += 1;

    for (const tag of result.failureTags) {
      summary.failureTags[tag] = (summary.failureTags[tag] || 0) + 1;
    }
  }

  return summary;
}

function printSummary(results, summary) {
  console.log("Phase 4 Snoozer Trace Harness");
  console.log("============================");
  console.log(`Cases: ${summary.totalCases}`);
  console.log(`Deterministic responses: ${summary.deterministicCount}`);
  console.log(`Model path escapes: ${summary.modelEscapeCount}`);
  console.log(`Generic replies: ${summary.genericReplyCount}`);
  console.log(`Invalid contracts: ${summary.invalidContractCount}`);
  console.log("");

  console.log("Failure tags:");
  const sortedFailureTags = Object.entries(summary.failureTags).sort((a, b) => b[1] - a[1]);
  for (const [tag, count] of sortedFailureTags) {
    console.log(`- ${tag}: ${count}`);
  }

  console.log("");
  console.log("Case rollup:");
  for (const result of results) {
    const intentGroup = result.classifiedIntent.intentGroup || "unknown";
    const source = result.selectedSourceType.sourceOfTruth || "unknown";
    const model = result.modelCallStatus[0]?.ok ? "model" : "deterministic";
    const tags = result.failureTags.join(", ") || "none";
    console.log(
      `- ${result.id} | ${result.route} | ${result.category} | ${intentGroup} | ${source} | ${model} | ${tags}`
    );
  }
}

function ensureOutputDir() {
  fs.mkdirSync(path.dirname(TRACE_OUTPUT_PATH), { recursive: true });
}

async function main() {
  patchDynamo();
  patchShopify();
  patchPolicy();
  patchOpenAi();
  patchCustomerProfile();

  try {
    const { lambdaHandler } = require("../index");
    const results = [];

    for (const testCase of TRACE_CASES) {
      results.push(await invokeCase(lambdaHandler, testCase));
    }

    const summary = summarizeResults(results);
    ensureOutputDir();
    fs.writeFileSync(
      TRACE_OUTPUT_PATH,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          mode:
            String(process.env.PHASE4_USE_REAL_OPENAI || "").trim() === "1"
              ? "real_openai"
              : "stubbed_openai",
          summary,
          results,
        },
        null,
        2
      )
    );

    printSummary(results, summary);
    console.log("");
    console.log(`Trace output: ${TRACE_OUTPUT_PATH}`);
  } finally {
    restorePatches();
  }
}

main().catch((error) => {
  restorePatches();
  console.error(error);
  process.exitCode = 1;
});
