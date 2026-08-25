import { ensureSession, getSessionId } from "@/lib/api";
import { buildApiUrl as buildSharedApiUrl } from "@/lib/apiBase";
import { getAccessCode, getSessionState, getShopperId } from "@/state/sessionStore";
import { getStoredShopifyCartIdentity } from "@/lib/session/shopifyCartState";
import { useStore } from "@/lib/useStore";

const ASK_SNOOZER_ROUTE = "/ask-snoozer";
const ASK_SNOOZER_REQUEST_TIMEOUT_MS = Math.max(
  5000,
  Number(import.meta.env.VITE_ASK_SNOOZER_TIMEOUT_MS || 15000)
);
const ASK_SNOOZER_CONVERSATION_KEY = "snooze.askSnoozer.conversationId";
const ASK_SNOOZER_HISTORY_LIMIT = 10;
const FALLBACK_MESSAGE =
  "I hit a snag, but I can still help. Try asking that another way, or choose one of these next steps.";
const RECOMMENDATION_TERMS = [
  "recommend",
  "what should i try first",
  "which pod",
  "which mattress",
  "why this pod",
  "explain my results",
  "explain my recommendation",
];
const POLICY_TERMS = [
  "return",
  "sleep trial",
  "delivery",
  "shipping",
  "warranty",
  "financing",
  "payment",
];
const COMMERCE_TERMS = [
  "price",
  "pricing",
  "cost",
  "how much",
  "mattress only",
  "base",
  "available",
  "in stock",
];
const SNOOZE_CODE_TERMS = ["snooze code", "access code", "unlock code", "shopper id"];
const SESSION_TERMS = [
  "snooze session",
  "what should i do first",
  "rest test",
  "build my pod",
  "learn about this pod",
];

function safeGetItem(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeParseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return String(Date.now());
  }
}

function createId(prefix) {
  if (globalThis?.crypto?.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function firstNonEmptyString(values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function buildApiUrl(path) {
  return buildSharedApiUrl(path);
}

function toConversationId(value) {
  const text = String(value || "").trim();
  return text || null;
}

function readStoredObject(keys) {
  for (const key of keys) {
    const parsed = safeParseJson(safeGetItem(key));
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  }
  return null;
}

function ensureConversationId(preferred) {
  const nextPreferred = toConversationId(preferred);
  if (nextPreferred) {
    safeSetItem(ASK_SNOOZER_CONVERSATION_KEY, nextPreferred);
    return nextPreferred;
  }

  const existing = toConversationId(safeGetItem(ASK_SNOOZER_CONVERSATION_KEY));
  if (existing) return existing;

  const generated = createId("ask_snoozer");
  safeSetItem(ASK_SNOOZER_CONVERSATION_KEY, generated);
  return generated;
}

function normalizeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter(
      (entry) =>
        entry &&
        (entry.role === "user" || entry.role === "assistant") &&
        String(entry.content || "").trim()
    )
    .slice(-ASK_SNOOZER_HISTORY_LIMIT)
    .map((entry) => ({
      role: entry.role,
      content: String(entry.content || "").trim(),
      createdAt: entry.createdAt || nowIso(),
    }));
}

function readReferrerRoute(explicitReferrerRoute) {
  const explicit = String(explicitReferrerRoute || "").trim();
  if (explicit && explicit !== ASK_SNOOZER_ROUTE) return explicit;

  const stored = String(safeGetItem("snooze.lastRoute") || "").trim();
  if (stored && stored !== ASK_SNOOZER_ROUTE) return stored;

  try {
    if (!document.referrer) return null;
    const referrer = new URL(document.referrer);
    if (referrer.origin !== window.location.origin) return null;
    return `${referrer.pathname}${referrer.search}${referrer.hash}` || null;
  } catch {
    return null;
  }
}

function readIdentity(sessionId) {
  const session = typeof getSessionState === "function" ? getSessionState() : {};
  const accessCode = firstNonEmptyString([getAccessCode(), safeGetItem("snooze.accessCode")]);
  const shopperId = firstNonEmptyString([
    getShopperId(),
    session?.shopperId,
    safeGetItem("snooze.shopperId"),
    accessCode,
  ]);

  return {
    snoozeCode: accessCode || null,
    shopperId: shopperId || null,
    accessCode: accessCode || null,
    sessionId: sessionId || null,
  };
}

function readContext() {
  const session = typeof getSessionState === "function" ? getSessionState() : {};
  const storeState = typeof useStore?.getState === "function" ? useStore.getState() : {};
  const assessment =
    storeState?.assessment && typeof storeState.assessment === "object"
      ? storeState.assessment
      : readStoredObject(["snooze.assessment"]);
  const recommendation =
    storeState?.recommendations && typeof storeState.recommendations === "object"
      ? storeState.recommendations
      : readStoredObject(["snooze.recommendations"]);
  const sessionPrep = readStoredObject([
    "snooze.sessionPrep",
    "snooze.session_prep",
    "snooze.session-prep",
  ]);
  const cartIdentity = getStoredShopifyCartIdentity();
  const cartId = firstNonEmptyString([cartIdentity.cartId, session?.cartId]);
  const cartLines = (Array.isArray(storeState?.snoozepod) ? storeState.snoozepod : [])
    .slice(0, 8)
    .map((line) => ({
      title: firstNonEmptyString([line?.title, line?.productTitle]) || null,
      variantTitle: firstNonEmptyString([line?.variantTitle, line?.size]) || null,
      quantity: Math.max(1, Number(line?.quantity) || 1),
      handle: firstNonEmptyString([line?.handle, line?.productHandle]) || null,
    }));

  return {
    assessment: assessment || null,
    recommendation: recommendation || null,
    sessionPrep: sessionPrep || null,
    cartId: cartId || null,
    cartSummary: {
      totalQuantity: cartLines.reduce((sum, line) => sum + line.quantity, 0),
      lines: cartLines,
    },
  };
}

function readClientContext() {
  const locale = firstNonEmptyString([
    navigator?.language,
    document?.documentElement?.lang,
  ]);
  const timezone = firstNonEmptyString([
    Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone,
  ]);

  return {
    timezone: timezone || "UTC",
    locale: locale || "en-US",
    viewport: {
      width: Number(window?.innerWidth || 0),
      height: Number(window?.innerHeight || 0),
    },
  };
}

function normalizeChipType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (type === "route" || type === "action") return type;
  return "prompt";
}

function inferRouteTarget(label, value) {
  const direct = firstNonEmptyString([value?.target, value?.url, value?.href]);
  if (direct.startsWith("/")) return direct;

  const haystack = `${label} ${value?.value || ""}`.toLowerCase();
  if (haystack.includes("assessment")) return "/assessment";
  if (haystack.includes("session")) return "/what-to-expect";
  if (haystack.includes("recommend")) return "/results";
  if (haystack.includes("build")) return "/pod/pod-1";
  return null;
}

function normalizeChips(raw) {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.chips)
      ? raw.chips
      : Array.isArray(raw?.suggestedPrompts)
        ? raw.suggestedPrompts
        : [];

  return list
    .map((chip) => {
      if (typeof chip === "string") {
        return {
          label: chip,
          value: chip,
          type: "prompt",
          target: null,
        };
      }

      if (!chip || typeof chip !== "object") return null;

      const label = firstNonEmptyString([chip.label, chip.title, chip.text, chip.value]);
      const value = firstNonEmptyString([chip.value, chip.prompt, chip.target, chip.url]);
      if (!label || !value) return null;

      const type = normalizeChipType(chip.type);
      return {
        label,
        value,
        type,
        target: type === "route" ? inferRouteTarget(label, chip) : null,
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeActionType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (
    type === "navigate" ||
    type === "start_assessment" ||
    type === "open_builder" ||
    type === "request_human" ||
    type === "view_recommendation"
  ) {
    return type;
  }
  return "none";
}

function normalizeActions(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((action) => {
      if (!action || typeof action !== "object") return null;
      const label = firstNonEmptyString([action.label, action.title, action.text]);
      if (!label) return null;
      return {
        type: normalizeActionType(action.type),
        label,
        target: firstNonEmptyString([action.target, action.url]) || null,
        payload:
          action.payload && typeof action.payload === "object" ? action.payload : {},
      };
    })
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeRecommendationType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (
    type === "pod" ||
    type === "mattress" ||
    type === "base" ||
    type === "accessory" ||
    type === "page"
  ) {
    return type;
  }
  return "page";
}

function normalizeRecommendationImageUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^(https?:)?\/\//i.test(text)) return text;
  if (text.startsWith("/")) return text;
  if (/^data:image\//i.test(text)) return text;
  return null;
}

function normalizeRecommendation(item) {
  if (!item || typeof item !== "object") return null;

  const id = firstNonEmptyString([item.id, item.handle, item.slug, item.title]);
  const title = firstNonEmptyString([item.title, item.name, item.label, item.handle]);
  if (!id || !title) return null;

  const handle = firstNonEmptyString([item.handle, item.slug]);
  const url = firstNonEmptyString([
    item.url,
    item.href,
    handle ? `/products/${handle}` : "",
  ]);

  return {
    type: normalizeRecommendationType(item.type || item.kind || item.category),
    id,
    title,
    subtitle: firstNonEmptyString([
      item.subtitle,
      item.description,
      item.summary,
      item.vendor,
    ]) || null,
    url: url || null,
    imageUrl: normalizeRecommendationImageUrl(
      firstNonEmptyString([
        item.imageUrl,
        item.image,
        item.featuredImage?.url,
        item.featuredImage?.src,
        item.images?.[0]?.url,
        item.images?.[0]?.src,
      ])
    ),
  };
}

function normalizeRecommendations(root) {
  const source = Array.isArray(root?.recommendations)
    ? root.recommendations
    : Array.isArray(root?.products)
      ? root.products
      : Array.isArray(root?.data?.products)
        ? root.data.products
        : [];

  return source.map(normalizeRecommendation).filter(Boolean).slice(0, 6);
}

function extractReplyContent(root, top) {
  return firstNonEmptyString([
    root?.reply?.content,
    root?.reply?.text,
    root?.reply,
    root?.content,
    root?.text,
    root?.message?.content,
    root?.message?.text,
    root?.hud?.captions,
    root?.hud?.speech,
    root?.captions,
    root?.speech,
    top?.message,
  ]);
}

function normalizeStatus(value, { fallbackUsed = false } = {}) {
  const status = String(value || "").trim().toLowerCase();
  if (
    status === "answered" ||
    status === "fallback" ||
    status === "needs_human" ||
    status === "blocked"
  ) {
    return status;
  }
  return fallbackUsed ? "fallback" : "answered";
}

function normalizeSource(value, { fallbackUsed = false, recommendations = [] } = {}) {
  const source = String(value || "").trim().toLowerCase();
  if (
    source === "profile" ||
    source === "session_prep" ||
    source === "s3_retrieval" ||
    source === "shopify" ||
    source === "fallback" ||
    source === "mixed"
  ) {
    return source;
  }
  if (fallbackUsed) return "fallback";
  return recommendations.length ? "mixed" : "profile";
}

function buildFallbackChips() {
  return [
    {
      label: "Start the assessment",
      value: "Help me start the Snooze Assessment",
      type: "route",
      target: "/assessment",
    },
    {
      label: "Explain Snooze Sessions",
      value: "What happens during a Snooze Session?",
      type: "prompt",
      target: null,
    },
    {
      label: "Talk to a human",
      value: "I need human help",
      type: "action",
      target: null,
    },
  ];
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeTextForIntent(value) {
  return String(value || "").trim().toLowerCase();
}

function messageIncludesAny(message, terms = []) {
  const normalized = normalizeTextForIntent(message);
  return terms.some((term) => normalized.includes(term));
}

function buildChip(label, value, type = "prompt", target = null) {
  return {
    label,
    value: value || label,
    type,
    target,
  };
}

function buildAction(type, label, target = null) {
  return {
    type,
    label,
    target,
    payload: {},
  };
}

function extractMetaRoot(root, top) {
  return {
    ...normalizeObject(top?.metadata),
    ...normalizeObject(top?.meta),
    ...normalizeObject(root?.metadata),
    ...normalizeObject(root?.meta),
  };
}

function inferIntentGroup({ message, qualityGate }) {
  const explicitIntentGroup = String(qualityGate?.intentGroup || "").trim();
  if (explicitIntentGroup) return explicitIntentGroup;
  if (messageIncludesAny(message, RECOMMENDATION_TERMS)) return "recommendation";
  if (messageIncludesAny(message, POLICY_TERMS)) return "policy";
  if (messageIncludesAny(message, COMMERCE_TERMS)) return "commerce";
  if (messageIncludesAny(message, SNOOZE_CODE_TERMS)) return "identity_guidance";
  if (messageIncludesAny(message, SESSION_TERMS)) return "session_guidance";
  return "fallback";
}

function buildContextualFallbackReply({ message, context }) {
  const intentGroup = inferIntentGroup({ message, qualityGate: null });
  const hasStoredRecommendation = Boolean(normalizeObject(context?.recommendation)?.topPodId);

  if (intentGroup === "recommendation") {
    if (hasStoredRecommendation) {
      return "I can still help explain your latest recommendation. Ask me why that pod fits, what to compare next, or whether you should keep it mattress-only or add a base.";
    }
    return "I can still help narrow the right setup. The fastest route is the Snooze Assessment, or tell me your sleep position, firmness, whether you share the bed, and whether you want a base.";
  }

  if (intentGroup === "policy") {
    return "I can still help with returns, delivery, financing, or booking questions. Pick one of those lanes and I will keep it simple.";
  }

  if (intentGroup === "commerce") {
    return "I can still help with pricing and setup questions. Tell me the mattress or base you mean and the size you want, and I will narrow the next step.";
  }

  if (intentGroup === "identity_guidance") {
    return "I can still help with Snooze Code access. Ask me how to unlock your session, recover your code, or prep for your Snooze Session.";
  }

  if (intentGroup === "session_guidance") {
    return "I can still help with what to do next in the showroom. Ask me where to start, what to notice during a Rest Test, or how to build your setup.";
  }

  return FALLBACK_MESSAGE;
}

function buildAdaptiveChips({ message, qualityGate, recommendations = [] }) {
  const intentGroup = inferIntentGroup({ message, qualityGate });

  if (
    qualityGate?.reason === "missing_assessment" ||
    (intentGroup === "recommendation" && !recommendations.length)
  ) {
    return [
      buildChip("Start the assessment", "Help me start the Snooze Assessment", "route", "/assessment"),
      buildChip("I sleep on my side", "I sleep on my side"),
      buildChip("I sleep hot", "I sleep hot"),
      buildChip("Mattress only", "I want a mattress only setup"),
    ];
  }

  if (intentGroup === "policy") {
    return [
      buildChip("Return policy", "What is your return policy?"),
      buildChip("Delivery timing", "How long does delivery take?"),
      buildChip("Financing", "Do you offer financing?"),
    ];
  }

  if (intentGroup === "commerce") {
    return [
      buildChip("Queen pricing", "What is the Queen price?"),
      buildChip("Mattress only", "I want a mattress only setup"),
      buildChip("Adjustable base", "How do adjustable bases help?"),
    ];
  }

  if (intentGroup === "identity_guidance") {
    return [
      buildChip("Use my Snooze Code", "How do I use my Snooze Code?"),
      buildChip("Unlock my session", "Help me unlock my session"),
      buildChip("Talk to human", "I need human help", "action"),
    ];
  }

  if (intentGroup === "session_guidance") {
    return [
      buildChip("What should I try first?", "What should I try first?"),
      buildChip("Rest Test help", "What should I notice during a Rest Test?"),
      buildChip("Build my pod", "Help me build my pod"),
    ];
  }

  return buildFallbackChips();
}

function buildAdaptiveActions({ message, qualityGate, recommendations = [] }) {
  const intentGroup = inferIntentGroup({ message, qualityGate });

  if (
    qualityGate?.reason === "missing_assessment" ||
    (intentGroup === "recommendation" && !recommendations.length)
  ) {
    return [buildAction("start_assessment", "Start assessment", "/assessment")];
  }

  if (intentGroup === "policy") {
    return [buildAction("request_human", "Talk to human")];
  }

  return [];
}

function buildFallbackResponse({ conversationId, requestId, message = "", context = null }) {
  const nextConversationId = ensureConversationId(conversationId);
  const reply = buildContextualFallbackReply({ message, context });

  return {
    ok: false,
    status: "fallback",
    reply: {
      id: createId("assistant"),
      role: "assistant",
      content: reply,
      createdAt: nowIso(),
    },
    chips: buildAdaptiveChips({
      message,
      qualityGate: null,
      recommendations: [],
    }),
    actions: buildAdaptiveActions({
      message,
      qualityGate: null,
      recommendations: [],
    }),
    recommendations: [],
    voice: {
      speak: false,
      speech: null,
      ttsEndpoint: "/hud/tts",
      audioUrl: null,
    },
    meta: {
      intent: inferIntentGroup({ message, qualityGate: null }),
      source: "fallback",
      fallbackUsed: true,
      conversationId: nextConversationId,
      requestId: requestId || createId("request"),
    },
  };
}

function unwrapPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.data && typeof payload.data === "object") return payload.data;
  return payload;
}

function normalizeSuccessResponse(payload, { conversationId, requestId, message = "", context = null }) {
  const top = unwrapPayload(payload);
  const root =
    top?.response && typeof top.response === "object"
      ? top.response
      : top && typeof top === "object"
        ? top
        : {};

  const replyContent = extractReplyContent(root, top);
  if (!replyContent) {
    return buildFallbackResponse({ conversationId, requestId, message, context });
  }

  const nextConversationId = ensureConversationId(
    root?.conversationId ||
      root?.thread_id ||
      top?.conversationId ||
      top?.thread_id ||
      conversationId
  );

  const recommendations = normalizeRecommendations(root);
  const metaRoot = extractMetaRoot(root, top);
  const qualityGate = normalizeObject(metaRoot?.qualityGate);
  const backendFallbackUsed =
    root?.ok === false ||
    top?.ok === false ||
    metaRoot?.fallbackUsed === true ||
    metaRoot?.metrics?.fallbackUsed === true ||
    String(root?.status || "").trim().toLowerCase() === "fallback";
  const status = normalizeStatus(root?.status, {
    fallbackUsed: backendFallbackUsed,
  });

  const chips = normalizeChips(root?.chips || root?.suggestedPrompts);
  const actions = normalizeActions(root?.actions);
  const safeChips = chips.length
    ? chips
    : buildAdaptiveChips({
        message,
        qualityGate,
        recommendations,
      });
  const safeActions = actions.length
    ? actions
    : buildAdaptiveActions({
        message,
        qualityGate,
        recommendations,
      });
  const sourceToken =
    typeof metaRoot?.source === "string"
      ? metaRoot.source
      : typeof root?.source === "string"
        ? root.source
        : "";

  return {
    ok: !backendFallbackUsed,
    reply: {
      id: firstNonEmptyString([root?.reply?.id, root?.id]) || createId("assistant"),
      role: "assistant",
      content: replyContent,
      createdAt: firstNonEmptyString([root?.reply?.createdAt, root?.createdAt]) || nowIso(),
    },
    status,
    chips: safeChips,
    actions: safeActions,
    recommendations,
    voice: {
      speak: Boolean(root?.voice?.speak),
      speech: firstNonEmptyString([root?.voice?.speech]) || null,
      ttsEndpoint:
        firstNonEmptyString([root?.voice?.ttsEndpoint, root?.voice?.tts_endpoint]) ||
        "/hud/tts",
      audioUrl: firstNonEmptyString([root?.voice?.audioUrl, root?.voice?.url]) || null,
    },
    meta: {
      intent:
        firstNonEmptyString([qualityGate?.intentGroup, metaRoot?.intent, root?.intent]) ||
        "unknown",
      source: normalizeSource(sourceToken, {
        fallbackUsed: backendFallbackUsed,
        recommendations,
      }),
      fallbackUsed: backendFallbackUsed,
      conversationId: nextConversationId,
      requestId:
        firstNonEmptyString([
          metaRoot?.requestId,
          root?.requestId,
          top?.requestId,
          root?.traceId,
          top?.traceId,
          requestId,
        ]) || createId("request"),
    },
  };
}

async function postAskSnoozer(payload) {
  const requestId = createId("request");
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    ASK_SNOOZER_REQUEST_TIMEOUT_MS
  );
  let response;
  try {
    response = await fetch(buildApiUrl("/ask-snoozer"), {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(payload?.identity?.sessionId
          ? { "x-session-id": String(payload.identity.sessionId) }
          : {}),
        "x-request-id": requestId,
      },
      body: JSON.stringify({
        ...payload,
        thread_id: payload.conversationId,
        shopperId: payload.identity?.shopperId || null,
        sessionId: payload.identity?.sessionId || null,
      }),
    });
  } finally {
    window.clearTimeout(timeoutId);
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const responseBody = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().then((raw) => {
        const text = String(raw || "").trim();
        if (!text) return null;
        return safeParseJson(text) || {
          ok: false,
          status: "error",
          reply: text,
          message: { text },
        };
      }).catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error("Ask Snoozer request failed."), {
      status: response.status,
      requestId,
      responseBody,
    });
  }

  return {
    payload: responseBody,
    requestId,
  };
}

export async function sendAskSnoozerMessage({
  message,
  history,
  referrerRoute = null,
  deviceContext = null,
} = {}) {
  const trimmedMessage = String(message || "").trim();
  if (!trimmedMessage) {
    return buildFallbackResponse({
      conversationId: ensureConversationId(),
      requestId: createId("request"),
    });
  }

  const sessionId =
    (await ensureSession().catch(() => null)) || getSessionId() || createId("session");
  const conversationId = ensureConversationId();
  const requestContext = readContext();
  const operationalDeviceContext =
    deviceContext && typeof deviceContext === "object"
      ? {
          deviceId: firstNonEmptyString([deviceContext.deviceId]) || null,
          deviceMode: firstNonEmptyString([deviceContext.deviceMode]) || null,
          podId: firstNonEmptyString([deviceContext.podId]) || null,
          zoneId: firstNonEmptyString([deviceContext.zoneId]) || null,
        }
      : null;
  const mergedContext = operationalDeviceContext
    ? {
        ...requestContext,
        device: operationalDeviceContext,
      }
    : requestContext;
  const requestPayload = {
    message: trimmedMessage,
    conversationId,
    surface: "react_app",
    mode: "ask_snoozer_page",
    page: {
      route: ASK_SNOOZER_ROUTE,
      referrerRoute: readReferrerRoute(referrerRoute),
      device: operationalDeviceContext,
    },
    identity: readIdentity(sessionId),
    context: mergedContext,
    history: normalizeHistory(history),
    client: readClientContext(),
  };

  try {
    const { payload, requestId } = await postAskSnoozer(requestPayload);
    return normalizeSuccessResponse(payload, {
      conversationId,
      requestId,
      message: trimmedMessage,
      context: mergedContext,
    });
  } catch (error) {
    if (error?.responseBody) {
      const salvaged = normalizeSuccessResponse(error.responseBody, {
        conversationId,
        requestId: error?.requestId || createId("request"),
        message: trimmedMessage,
        context: mergedContext,
      });
      if (String(salvaged?.reply?.content || "").trim()) {
        return {
          ...salvaged,
          ok: false,
          status: salvaged.status === "answered" ? "fallback" : salvaged.status,
        };
      }
    }

    return buildFallbackResponse({
      conversationId,
      requestId: error?.requestId || createId("request"),
      message: trimmedMessage,
      context: mergedContext,
    });
  }
}

export { ASK_SNOOZER_ROUTE };
