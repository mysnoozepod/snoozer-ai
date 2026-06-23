import { ensureSession, getSessionId } from "@/lib/api";
import { getSessionState } from "@/state/sessionStore";

const ASK_SNOOZER_ROUTE = "/ask-snoozer";
const ASK_SNOOZER_CONVERSATION_KEY = "snooze.askSnoozer.conversationId";
const ASK_SNOOZER_HISTORY_LIMIT = 10;
const FALLBACK_MESSAGE =
  "I hit a snag, but I can still help. Try asking that another way, or choose one of these next steps.";

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

function resolveApiBase() {
  let apiBase = import.meta.env.VITE_API_BASE?.replace(/\/$/, "") || "";
  if (apiBase && !/\/(prod|staging|dev)$/i.test(apiBase)) {
    apiBase += "/prod";
  }
  return apiBase;
}

function buildApiUrl(path) {
  const cleanPath = String(path || "").startsWith("/") ? path : `/${path}`;
  const apiBase = resolveApiBase();
  return apiBase ? `${apiBase}${cleanPath}` : cleanPath;
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
  const accessCode = firstNonEmptyString([
    safeGetItem("snooze.accessCode"),
    safeGetItem("snooze.shopperId"),
  ]);
  const shopperId = firstNonEmptyString([
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
  const assessment = readStoredObject(["snooze.assessment"]);
  const recommendation = readStoredObject(["snooze.recommendations"]);
  const sessionPrep = readStoredObject([
    "snooze.sessionPrep",
    "snooze.session_prep",
    "snooze.session-prep",
  ]);
  const cartId = firstNonEmptyString([
    session?.cartId,
    safeGetItem("snooze.shopify.cartId"),
    safeGetItem("snooze.cartId"),
  ]);

  return {
    assessment: assessment || null,
    recommendation: recommendation || null,
    sessionPrep: sessionPrep || null,
    cartId: cartId || null,
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
  if (haystack.includes("build")) return "/pod/1";
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

function buildFallbackResponse({ conversationId, requestId }) {
  const nextConversationId = ensureConversationId(conversationId);
  return {
    ok: false,
    status: "fallback",
    reply: {
      id: createId("assistant"),
      role: "assistant",
      content: FALLBACK_MESSAGE,
      createdAt: nowIso(),
    },
    chips: buildFallbackChips(),
    actions: [],
    recommendations: [],
    voice: {
      speak: false,
      speech: null,
      ttsEndpoint: "/hud/tts",
      audioUrl: null,
    },
    meta: {
      intent: "unknown",
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

function normalizeSuccessResponse(payload, { conversationId, requestId }) {
  const top = unwrapPayload(payload);
  const root =
    top?.response && typeof top.response === "object"
      ? top.response
      : top && typeof top === "object"
        ? top
        : {};

  const replyContent = extractReplyContent(root, top);
  if (!replyContent) {
    return buildFallbackResponse({ conversationId, requestId });
  }

  const nextConversationId = ensureConversationId(
    root?.conversationId ||
      root?.thread_id ||
      top?.conversationId ||
      top?.thread_id ||
      conversationId
  );

  const recommendations = normalizeRecommendations(root);
  const metaRoot = root?.meta && typeof root.meta === "object" ? root.meta : {};
  const backendFallbackUsed =
    root?.ok === false ||
    metaRoot?.fallbackUsed === true ||
    String(root?.status || "").trim().toLowerCase() === "fallback";
  const status = normalizeStatus(root?.status, {
    fallbackUsed: backendFallbackUsed,
  });

  const chips = normalizeChips(root?.chips || root?.suggestedPrompts);
  const actions = normalizeActions(root?.actions);
  const safeChips = chips.length
    ? chips
    : status === "answered"
      ? []
      : buildFallbackChips();

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
    actions,
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
      intent: firstNonEmptyString([metaRoot?.intent, root?.intent]) || "unknown",
      source: normalizeSource(firstNonEmptyString([metaRoot?.source, root?.source]), {
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
  const response = await fetch(buildApiUrl("/ask-snoozer"), {
    method: "POST",
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

  const responseBody = await response.json().catch(() => null);
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
  const requestPayload = {
    message: trimmedMessage,
    conversationId,
    surface: "react_app",
    mode: "ask_snoozer_page",
    page: {
      route: ASK_SNOOZER_ROUTE,
      referrerRoute: readReferrerRoute(referrerRoute),
    },
    identity: readIdentity(sessionId),
    context: readContext(),
    history: normalizeHistory(history),
    client: readClientContext(),
  };

  try {
    const { payload, requestId } = await postAskSnoozer(requestPayload);
    return normalizeSuccessResponse(payload, {
      conversationId,
      requestId,
    });
  } catch (error) {
    return buildFallbackResponse({
      conversationId,
      requestId: error?.requestId || createId("request"),
    });
  }
}

export { ASK_SNOOZER_ROUTE };
