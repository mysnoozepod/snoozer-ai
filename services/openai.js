// services/openai.js
// Snoozer intelligence: model-led conversation planning + deterministic truth/tool enforcement.
//
// Key rules:
// - Deterministic paths handle ALL commerce (price + cart) via tools.
// - Model path is talk-only (NO tools, NO commerce).
// - Pod mode MUST be anchored (podId + explore/exploreContext), or we fail fast.
// - Deterministic retrieval:
//   - Load + cache routing_rules.json
//   - Load + cache catalog.json + canon.json
//   - Route intent -> specific keys (no filename-heuristic soup)
//   - If retrieval required but missing -> DO NOT call model (fallback response)
//
// Contract (internal → index.js):
// {
//   reply: string,
//   text: string,
//   actions: Array<string|object>,
//   products?: Array<{ id, title, variantId?, price?, handle?, imageUrl?, images? }>,
//   meta: {
//     path: "deterministic"|"model",
//     latency_ms: number,
//     error?: string,
//     retrievalMs?: number,
//     modelMs?: number,
//     totalMs?: number,
//     fallbackUsed?: boolean
//   },
//   model?: string,
//   tokens?: { prompt?: number, completion?: number, total?: number },
//   s3Prompts?: string[],
//   context?: object,
//   contextPatch?: object,
//   cartId?: string,
//   checkoutUrl?: string,
//   cart?: any,
//   raw?: any,
//   thread_id: string,
//   status: "completed"|"error"
// }

const { initializeSession, rememberTurn, getLastTurns } = require("./conversationState.js");
const { clampAskSnoozerDisplayReply } = require("./askSnoozerAnswerEngine");
const {
  resolveExplicitProductHandle,
  resolveRequestedProductHandle,
} = require("./askSnoozerWorkingMemory");
const advisorModelCore = require("./askSnoozerModelCore");
const {
  FAST_MODEL,
  FINAL_MODEL,
  callOpenAIChat,
} = require("./openaiModelRuntime");
const {
  KNOWLEDGE_BUCKET,
  PROMPT_BUCKET,
  ROUTING_BUCKET,
  S3_RETRIEVAL_TIMEOUT_MS,
  getObjectJson,
  getObjectText,
  listMarkdownKeys,
} = require("./s3TextLoader");
const { SYSTEM_PROMPT_KEY, getBasePromptOnce } = require("./snoozerBasePrompt");

// Shopify service (used deterministically for variant resolution by size)
let shopifySvc = null;
try {
  shopifySvc = require("./shopify.js");
} catch (err) {
  console.log("⚠️ Shopify service not loaded:", err.message);
  shopifySvc = null;
}

// Snoozer tools (Shopify truth: pricing + carts)
let snoozerTools = null;
try {
  snoozerTools = require("./tools");
} catch (err) {
  console.log("⚠️ Snoozer tools not loaded:", err.message);
  snoozerTools = null;
}

// ──────────────────────────────
// Config
// ──────────────────────────────
// Deterministic retrieval meta files
const ROUTING_RULES_KEY = process.env.ROUTING_RULES_KEY || "meta/routing_rules.json";
const CATALOG_KEY = process.env.CATALOG_KEY || "meta/catalog.json";
const CANON_KEY = process.env.CANON_KEY || "meta/canon.json";

// Timeouts / TTLs
// Deterministic meta TTLs (separate)
const META_TTL_MS = Number(process.env.S3_META_CACHE_TTL_MS || 300000);

// Limits
const MAX_CTX_FILES = Number(process.env.MAX_CTX_FILES || 4);
const MAX_CTX_BYTES = Number(process.env.MAX_CTX_BYTES || 10000);
const MAX_HISTORY_TURNS = Number(process.env.MAX_HISTORY_TURNS || 3);
const POD_PRODUCT_DOC_KEY_BY_HANDLE = Object.freeze({
  "10-all-foam-mattress": "products/mattress/10-all-foam-mattress.md",
  "12-all-foam-mattress": "products/mattress/12-all-foam-mattress.md",
  "12-dual-comfort-hybrid": "products/mattress/12-dual-comfort-hybrid.md",
  "14-hybrid": "products/mattress/14-hybrid.md",
  "premium-motion-adjustable-base": "products/bases/premium-motion-adjustable-base.md",
});

// STRICT pod anchoring (fail fast instead of drifting)
const STRICT_POD_ANCHOR = String(process.env.STRICT_POD_ANCHOR || "1") === "1";

// If true: unknown intents do NOT run heuristic retrieval. (Recommended)
const STRICT_DETERMINISTIC_RETRIEVAL =
  String(process.env.STRICT_DETERMINISTIC_RETRIEVAL || "1") === "1";

// Guardrails for the model path only (model is NOT allowed to do commerce)
const CONCISE_GUARDRAILS = [
  "INSTRUCTIONS:",
  "- Use 2 to 5 concise sentences when useful; answer first, then explain and offer a next step.",
  "- Do NOT guess prices, availability, financing math, or checkout details.",
  "- If asked price/cart/checkout, say: “I’ll pull live pricing/checkout for you” and ask what size they want if needed.",
  "- If you do not have relevant showroom knowledge loaded, say you don't have it and offer options instead.",
  "- Be direct, calm, and on-brand for MySnoozePod: friendly, clear, practical.",
  "- Return JSON-friendly text (no markdown tables).",
].join("\n");

// ──────────────────────────────
// Logging / helpers
// ──────────────────────────────
const cache = {
  // deterministic meta caches
  routingRules: { value: null, ts: 0 },
  catalog: { value: null, ts: 0 },
  canon: { value: null, ts: 0 },
};

const isFresh = (ts, ttl) => Boolean(ts) && Date.now() - ts < ttl;

function logEvent(event, data = {}) {
  try {
    console.log(
      JSON.stringify({
        source: "snoozer",
        event,
        ts: new Date().toISOString(),
        ...data,
      })
    );
  } catch {
    console.log(`[snoozer:${event}]`, data);
  }
}

function truncateForLog(val, max = 1400) {
  try {
    if (val === null || val === undefined) return val;
    const s = typeof val === "string" ? val : JSON.stringify(val);
    if (s.length <= max) return s;
    return s.slice(0, max) + `…(truncated ${s.length - max} chars)`;
  } catch {
    return "[unserializable]";
  }
}

const SAFE_FALLBACK =
  "I hit a snag. Try again in a moment, or flag a human if you need help right now.";

function safeReply(text, fallback = SAFE_FALLBACK) {
  if (typeof text === "string") {
    const t = text.trim();
    if (t) return clampAskSnoozerDisplayReply(t, fallback);
  }
  return clampAskSnoozerDisplayReply(fallback);
}

function safeStringContent(v) {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  try {
    return String(v);
  } catch {
    return "";
  }
}

function elapsedMs(startedAt) {
  return Math.max(0, Date.now() - Number(startedAt || Date.now()));
}

async function measureStep(label, fn) {
  const startedAt = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: elapsedMs(startedAt), value, label };
  } catch (error) {
    return { ok: false, ms: elapsedMs(startedAt), error, label };
  }
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildMetrics({
  retrievalMs = 0,
  modelMs = 0,
  totalMs = 0,
  fallbackUsed = false,
} = {}) {
  return {
    retrievalMs: safeNumber(retrievalMs, 0),
    modelMs: safeNumber(modelMs, 0),
    totalMs: safeNumber(totalMs, 0),
    fallbackUsed: Boolean(fallbackUsed),
  };
}

function buildDeterministicFallbackContract({
  reply,
  thread_id,
  context = null,
  error = "fallback",
  latency_ms = 0,
  retrievalMs = 0,
  modelMs = 0,
  raw = null,
  meta = null,
}) {
  return toContract({
    reply,
    actions: [],
    products: [],
    meta: {
      path: "deterministic",
      latency_ms,
      error,
      ...buildMetrics({
        retrievalMs,
        modelMs,
        totalMs: latency_ms,
        fallbackUsed: true,
      }),
      ...(isObject(meta) ? meta : {}),
    },
    thread_id,
    status: "completed",
    model: FAST_MODEL,
    tokens: null,
    s3Prompts: [],
    context,
    raw,
  });
}

// ──────────────────────────────
// Merge helpers
// ──────────────────────────────
function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function deepMerge(target, patch) {
  if (!isObject(target)) return isObject(patch) ? { ...patch } : patch;
  if (!isObject(patch)) return target;

  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (isObject(v) && isObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function normalizeContextPatch(patch) {
  const p = isObject(patch) ? { ...patch } : {};

  if (!p.checkoutUrl && typeof p.lastCheckoutUrl === "string") {
    p.checkoutUrl = p.lastCheckoutUrl;
  }

  if (typeof p.cartId === "string" && p.cartId) {
    p.ids = isObject(p.ids) ? { ...p.ids, cartId: p.cartId } : { cartId: p.cartId };
    delete p.cartId;
  }

  if (p.ids && !isObject(p.ids)) delete p.ids;

  return p;
}

// ──────────────────────────────
// Variant sanity
// ──────────────────────────────
function isValidVariantGid(id) {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  if (!trimmed) return false;
  if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(trimmed)) return false;
  if (trimmed.endsWith("/0")) return false;
  return true;
}

function normalizeSizeKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/^california king$/, "cal king");
}

// ──────────────────────────────
// Deterministic intent detection
// ──────────────────────────────
function detectCartIntent(message = "") {
  const t = String(message || "").toLowerCase();
  const wantsCart =
    /\b(add to cart|add .* to (my )?cart|put .* (in|into) (my )?cart|cart it|checkout|check out|buy now|purchase now|i'?ll take it|i want this)\b/.test(
      t
    );
  const wantsRemove =
    /\b(remove|take out|delete)\b.*\b(cart)\b/.test(t) || /\b(remove|take out|delete)\b/.test(t);
  const wantsViewCart = /\b(view cart|open cart|show cart|my cart)\b/.test(t);
  return { wantsCart, wantsRemove, wantsViewCart };
}

function detectPriceIntent(message = "") {
  const t = String(message || "").toLowerCase();
  return /\b(price|cost|how much|monthly|payment|\$)\b/.test(t);
}

function detectUpdateQuantityIntent(message = "") {
  const t = String(message || "").toLowerCase();
  const hasQtyWord = /\b(qty|quantity|update|change|set)\b/.test(t);
  const hasNumber = /\b(\d{1,2})\b/.test(t);
  const mentionsCart = /\b(cart)\b/.test(t);
  const saysRemove = /\b(remove|delete|take out)\b/.test(t);
  if (saysRemove) return false;
  return (hasQtyWord && hasNumber) || (mentionsCart && hasNumber && /\bto\b/.test(t));
}

function parseQuantity(message = "") {
  const t = String(message || "");
  const m1 = t.match(/\b(?:qty|quantity)\s*[:=]?\s*(\d{1,2})\b/i);
  if (m1 && m1[1]) return Math.max(1, Number(m1[1]) || 1);

  const m2 = t.match(/\bx\s*(\d{1,2})\b/i);
  if (m2 && m2[1]) return Math.max(1, Number(m2[1]) || 1);

  const m3 = t.match(/\b(\d{1,2})\s*(?:of|units?)\b/i);
  if (m3 && m3[1]) return Math.max(1, Number(m3[1]) || 1);

  const m4 = t.match(/\bto\s*(\d{1,2})\b/i);
  if (m4 && m4[1]) return Math.max(0, Number(m4[1]) || 0);

  return 1;
}

// IMPORTANT: return ONLY canonical Shopify Size values.
function parseSizeFromMessage(message = "") {
  const t = String(message || "").toLowerCase();

  if (t.includes("split cal king")) return "Split Cal King";
  if (t.includes("half split cal king")) return "Half Split Cal King";
  if (t.includes("half split queen")) return "Half Split Queen";
  if (t.includes("half split king")) return "Half Split King";
  if (t.includes("split king")) return "Split King";
  if (t.includes("queen (2pc)") || t.includes("queen 2pc") || t.includes("queen two piece")) return "Queen (2pc)";
  if (t.includes("king (2pc)") || t.includes("king 2pc") || t.includes("king two piece")) return "King (2pc)";
  if (t.includes("cal king (2pc)") || t.includes("cal king 2pc") || t.includes("cal king two piece"))
    return "Cal King (2pc)";
  if (t.includes("split california king")) return "Split Cal King";
  if (t.includes("cal king") || t.includes("california king")) return "Cal King";
  if (t.includes("twin/twin xl")) return "Twin/Twin XL";
  if (t.includes("twin xl") || t.includes("twinxl") || t.includes("txl")) return "Twin XL";
  if (t.includes("king/ cal king") || t.includes("king/cal king")) return "King/ Cal King";
  if (t.includes("split king/ cal king") || t.includes("split king/cal king")) return "Split King/ Cal King";
  if (t.includes("oversize queen")) return "Oversize Queen";
  if (t.includes("oversize king")) return "Oversize King";

  if (t.includes("king")) return "King";
  if (t.includes("queen")) return "Queen";
  if (t.includes("full") || t.includes("double")) return "Full";
  if (t.includes("twin")) return "Twin";

  return null;
}

function looksLikeBaseRequest(message = "") {
  const t = String(message || "").toLowerCase();
  return /\b(base|adjustable|motion|zero gravity|head up|feet up)\b/.test(t);
}

// ──────────────────────────────
// Deterministic routing intent (knowledge/policy)
// ──────────────────────────────
function detectKnowledgeIntent(message = "") {
  const t = String(message || "").toLowerCase();

  if (/\b(return|refund|exchange)\b/.test(t)) return "returns";
  if (/\b(warranty|guarantee)\b/.test(t)) return "warranty";
  if (/\b(delivery|deliver|shipping|ship|setup|install)\b/.test(t)) return "delivery";
  if (/\b(financing|finance|affirm|monthly plan|0%|interest)\b/.test(t)) return "financing";
  if (/\b(price|pricing|cost)\b/.test(t)) return "pricing";
  if (/\b(sleep assessment|assessment|quiz)\b/.test(t)) return "sleep_assessment";
  if (/\b(help me choose|recommend|which should i|get)\b/.test(t)) return "help_me_choose";

  return null;
}

function requiresDeterministicKnowledge(intent) {
  if (!intent) return false;
  return [
    "returns",
    "warranty",
    "delivery",
    "financing",
    "pricing",
    "sleep_assessment",
    "help_me_choose",
  ].includes(intent);
}

// ──────────────────────────────
// Context normalization: Pod.jsx sends exploreContext; normalize to context.explore
// ──────────────────────────────
function normalizeIncomingContext(ctx = {}) {
  const context = isObject(ctx) ? { ...ctx } : {};

  const explore =
    (Array.isArray(context.explore) && context.explore) ||
    (Array.isArray(context.exploreContext) && context.exploreContext) ||
    (Array.isArray(context.podContext) && context.podContext) ||
    (Array.isArray(context.items) && context.items) ||
    [];

  if (!Array.isArray(context.explore) || context.explore.length === 0) {
    if (explore.length) context.explore = explore;
  }

  if (Array.isArray(context.explore) && context.explore.length) {
    const firstHandle = context.explore[0]?.handle ? String(context.explore[0].handle).trim() : "";
    if (firstHandle) {
      context.cartState = isObject(context.cartState) ? { ...context.cartState } : {};
      if (!context.cartState.lastViewedHandle) context.cartState.lastViewedHandle = firstHandle;
    }
  }

  return context;
}

function summarizeCanonicalRecommendationForPrompt(context = {}) {
  const canonical = isObject(context?.canonicalRecommendation) ? context.canonicalRecommendation : null;
  if (!canonical) return "";

  const summary = {
    manifestVersion: safeStringContent(canonical.manifestVersion || ""),
    normalizedAssessment: isObject(canonical.normalizedAssessment)
      ? canonical.normalizedAssessment
      : {},
    topPodId: safeStringContent(canonical.topPodId || ""),
    topPodIds: Array.isArray(canonical.topPodIds) ? canonical.topPodIds : [],
    primaryMattressHandle: safeStringContent(canonical.primaryMattressHandle || ""),
    baseHandle: canonical.baseHandle == null ? null : safeStringContent(canonical.baseHandle || ""),
    motionKey:
      safeStringContent(canonical.motionKey || canonical.normalizedAssessment?.motionKey || ""),
    motionLabel:
      safeStringContent(canonical.motionLabel || canonical.normalizedAssessment?.motionLabel || ""),
    reasonKeys: Array.isArray(canonical.reasonKeys) ? canonical.reasonKeys : [],
    warnings: Array.isArray(canonical.warnings) ? canonical.warnings : [],
  };

  try {
    return JSON.stringify(summary);
  } catch {
    return "";
  }
}

function pickCompactFields(source = {}, keys = []) {
  if (!isObject(source)) return {};
  const output = {};
  for (const key of keys) {
    const value = source[key];
    if (value == null || value === "") continue;
    if (typeof value === "string") {
      output[key] = value.trim().slice(0, 240);
    } else if (typeof value === "number" || typeof value === "boolean") {
      output[key] = value;
    } else if (Array.isArray(value)) {
      output[key] = value
        .slice(0, 6)
        .map((item) =>
          typeof item === "string" || typeof item === "number"
            ? String(item).slice(0, 160)
            : null
        )
        .filter(Boolean);
    }
  }
  return output;
}

function summarizeBoundedShopperContextForPrompt(context = {}, userMessage = "") {
  const safeContext = isObject(context) ? context : {};
  const canonical = isObject(safeContext.canonicalRecommendation)
    ? safeContext.canonicalRecommendation
    : {};
  const assessment = isObject(safeContext.assessment) ? safeContext.assessment : {};
  const normalizedAssessment = isObject(canonical.normalizedAssessment)
    ? canonical.normalizedAssessment
    : assessment;
  const selection = isObject(safeContext.selection)
    ? safeContext.selection
    : isObject(safeContext.buildSelection)
      ? safeContext.buildSelection
      : {};
  const restTest = isObject(safeContext.restTest) ? safeContext.restTest : {};
  const cartSummary = isObject(safeContext.cartSummary) ? safeContext.cartSummary : {};
  const workingMemory = isObject(safeContext.askSnoozerWorkingMemory)
    ? safeContext.askSnoozerWorkingMemory
    : {};
  const activeSlots = isObject(workingMemory.slots) ? workingMemory.slots : {};
  const activeGoal = isObject(workingMemory.activeGoal) ? workingMemory.activeGoal : {};
  const effectiveAssessment = {
    ...pickCompactFields(normalizedAssessment, [
      "size",
      "sleepPosition",
      "position",
      "temperature",
      "sleepsHot",
      "firmness",
      "pressureRelief",
      "partner",
      "motionKey",
      "motionLabel",
    ]),
  };
  if (activeSlots?.size?.value) effectiveAssessment.size = activeSlots.size.value;
  if (activeSlots?.firmness?.value) effectiveAssessment.firmness = activeSlots.firmness.value;
  if (activeSlots?.painPoints?.value) effectiveAssessment.painPoints = activeSlots.painPoints.value;
  const bounded = {
    identity: pickCompactFields(safeContext, ["shopperId", "snoozeCode"]),
    assessment: effectiveAssessment,
    activeConversation: {
      turnIndex: Number(workingMemory.turnIndex || 0) || undefined,
      goal: pickCompactFields(activeGoal, [
        "intent",
        "status",
        "scope",
        "productHandle",
        "size",
        "firmness",
        "baseHandle",
        "motionKey",
        "missingSlots",
      ]),
      slotProvenance: isObject(activeGoal.slotProvenance) ? activeGoal.slotProvenance : {},
      conflicts: (Array.isArray(workingMemory.conflicts) ? workingMemory.conflicts : [])
        .slice(0, 5)
        .map((entry) => pickCompactFields(entry, ["slot", "conversationValue", "savedValue"])),
    },
    current: {
      ...pickCompactFields(safeContext, ["path", "pageType", "podId", "currentProductHandle"]),
      device: pickCompactFields(safeContext.device, ["deviceId", "deviceMode", "podId", "zoneId"]),
    },
    restTest: pickCompactFields(restTest, ["favorite", "bestPosition", "preferredPosition", "ratings"]),
    selection: pickCompactFields(selection, [
      "mattress",
      "mattressHandle",
      "size",
      "base",
      "baseHandle",
      "motion",
      "motionKey",
      "selectedEssentials",
    ]),
    cart: {
      ...pickCompactFields(safeContext, ["cartId"]),
      ...pickCompactFields(cartSummary, ["totalQuantity", "subtotal"]),
      lines: (Array.isArray(cartSummary.lines) ? cartSummary.lines : [])
        .slice(0, 6)
        .map((line) =>
          pickCompactFields(line, ["title", "variantTitle", "quantity", "handle"])
        ),
    },
    explore: (Array.isArray(safeContext.explore) ? safeContext.explore : [])
      .slice(0, 8)
      .map((item) =>
        pickCompactFields(item, [
          "handle",
          "title",
          "variantId",
          "selectedVariantId",
          "variantTitle",
        ])
      ),
  };

  try {
    return JSON.stringify(bounded).slice(0, 3200);
  } catch {
    return "";
  }
}

function buildBoundedModelHistory(memory = [], recentConversation = [], userMessage = "") {
  const currentMessage = String(userMessage || "").trim();
  const combined = [...(Array.isArray(memory) ? memory : []), ...(Array.isArray(recentConversation) ? recentConversation : [])];
  const seen = new Set();

  return combined
    .map((turn) => ({
      role: String(turn?.role || "").trim() === "assistant" ? "assistant" : "user",
      content: String(turn?.content || "").trim().slice(0, 700),
    }))
    .filter((turn) => {
      if (!turn.content || (turn.role === "user" && turn.content === currentMessage)) return false;
      const key = `${turn.role}:${turn.content}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-MAX_HISTORY_TURNS);
}

function resolveHandleFromContext(message = "", context = {}) {
  const explore = Array.isArray(context?.explore) ? context.explore : [];

  const lastViewed =
    String(context?.cartState?.lastViewedHandle || "").trim() ||
    String(context?.lastViewedHandle || "").trim();

  const wantsBase = looksLikeBaseRequest(message);

  if (wantsBase && explore.length) {
    const base = explore.find((x) => {
      const title = String(x?.title || "").toLowerCase();
      const handle = String(x?.handle || "").toLowerCase();
      return (
        title.includes("base") ||
        title.includes("adjustable") ||
        title.includes("motion") ||
        handle.includes("base") ||
        handle.includes("adjust") ||
        handle.includes("motion")
      );
    });
    if (base?.handle) return String(base.handle).trim();
  }

  if (lastViewed) return lastViewed;

  const firstItem = explore[0];
  return firstItem?.handle ? String(firstItem.handle).trim() : null;
}

function resolveVariantFromContext(context = {}, message = "") {
  const explore = Array.isArray(context?.explore) ? context.explore : [];
  if (!explore.length) return null;

  const wantsBase = looksLikeBaseRequest(message);

  const candidates = wantsBase
    ? explore.filter((x) =>
        /base|adjust|motion/i.test(String(x?.title || "") + " " + String(x?.handle || ""))
      )
    : explore;

  const best = candidates[0] || explore[0] || null;
  const vid =
    best?.firstAvailableVariantId ||
    best?.variantId ||
    best?.meta?.firstAvailableVariantId ||
    best?.meta?.variantId ||
    null;

  return isValidVariantGid(vid || "") ? vid : null;
}

// Resolve variant by handle + Size option deterministically (no model)
async function resolveVariantByHandleAndSize(handle, sizeLabel) {
  try {
    const canonResult = await getCanonOnce();
    const v = resolveVariantFromCanon(canonResult.value, handle, sizeLabel);
    if (isValidVariantGid(v || "")) return v;
  } catch {
    // ignore canon errors
  }

  if (!shopifySvc?.fetchProductsByHandles) return null;

  const out = await shopifySvc.fetchProductsByHandles({ handles: [String(handle).trim()], lite: false });
  const list = Array.isArray(out?.items) ? out.items : out;
  const prod = Array.isArray(list) ? list[0] : null;
  if (!prod || !Array.isArray(prod.variants) || !prod.variants.length) return null;

  const want = normalizeSizeKey(sizeLabel || "");
  if (!want) {
    const firstAvail = prod.variants.find((v) => v?.availableForSale || v?.available) || prod.variants[0];
    return isValidVariantGid(firstAvail?.id || "") ? firstAvail.id : null;
  }

  const match = prod.variants.find((v) => {
    const so = Array.isArray(v?.selectedOptions) ? v.selectedOptions : [];
    const sizeOpt = so.find((x) => String(x?.name || "").toLowerCase() === "size");
    return sizeOpt && normalizeSizeKey(sizeOpt.value || "") === want;
  });

  const chosen = match || prod.variants.find((v) => v?.availableForSale || v?.available) || prod.variants[0];
  return isValidVariantGid(chosen?.id || "") ? chosen.id : null;
}

function getPodIdFromContext(context) {
  if (!context || typeof context !== "object") return null;
  const direct = context.podId ?? context.pod_id ?? context.zone?.podId ?? null;
  if (direct != null) {
    const s = String(direct).trim().toLowerCase();
    const match = s.match(/^(?:pod-)?([1-9]\d*)$/);
    if (match) return `pod-${match[1]}`;
  }
  return null;
}

// ──────────────────────────────
// Cart line selection helpers (deterministic)
// ──────────────────────────────
function parseOrdinalIndex(message = "") {
  const t = String(message || "").toLowerCase();

  if (/\b(first|1st)\b/.test(t)) return 0;
  if (/\b(second|2nd)\b/.test(t)) return 1;
  if (/\b(third|3rd)\b/.test(t)) return 2;
  if (/\b(fourth|4th)\b/.test(t)) return 3;
  if (/\b(fifth|5th)\b/.test(t)) return 4;

  const m = t.match(/\bitem\s*(\d{1,2})\b/);
  if (m && m[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1) return n - 1;
  }

  return null;
}

function pickLineFromCartSummary(cartSummary, message = "") {
  const lines = Array.isArray(cartSummary?.lines) ? cartSummary.lines : [];
  if (!lines.length) return { line: null, reason: "empty_cart" };

  if (lines.length === 1) return { line: lines[0], reason: "single_item" };

  const idx = parseOrdinalIndex(message);
  if (idx != null && lines[idx]) return { line: lines[idx], reason: "ordinal" };

  const t = String(message || "").toLowerCase();
  const byId = lines.find((l) => {
    const id = String(l?.lineId || "").toLowerCase();
    if (!id) return false;
    return t.includes(id) || (id.length >= 10 && t.includes(id.slice(-10)));
  });
  if (byId) return { line: byId, reason: "id_match" };

  const words = t.split(/[^a-z0-9]+/).filter((w) => w.length >= 4).slice(0, 12);
  const byTitle = lines.find((l) => {
    const title = String(l?.title || "").toLowerCase();
    const handle = String(l?.handle || "").toLowerCase();
    return words.some((w) => title.includes(w) || handle.includes(w));
  });
  if (byTitle) return { line: byTitle, reason: "title_match" };

  return { line: null, reason: "ambiguous" };
}

function buildCartDisambiguationPrompt(cartSummary) {
  const lines = Array.isArray(cartSummary?.lines) ? cartSummary.lines : [];
  const picks = lines.slice(0, 3).map((l, i) => `${i + 1}) ${l.title} (qty ${l.quantity})`);
  if (!picks.length) return "Your cart is empty.";
  return `Which item do you mean? Say “item 1”, “item 2”, etc.\n${picks.join("\n")}`;
}

// ──────────────────────────────
// Deterministic meta loaders
// ──────────────────────────────
async function getRoutingRulesOnce(options = {}) {
  const { timeoutMs = S3_RETRIEVAL_TIMEOUT_MS, forceFresh = false } = options;

  if (!forceFresh && cache.routingRules.value && isFresh(cache.routingRules.ts, META_TTL_MS)) {
    return { value: cache.routingRules.value, cacheHit: true, error: null };
  }

  const result = await getObjectJson(ROUTING_BUCKET, ROUTING_RULES_KEY, { timeoutMs, forceFresh });
  const rules = Array.isArray(result.value) ? result.value : null;

  if (!rules) {
    return {
      value: [],
      cacheHit: Boolean(result.cacheHit),
      error: result.error || new Error("routing_rules.json missing or invalid"),
    };
  }

  cache.routingRules = { value: rules, ts: Date.now() };
  return { value: rules, cacheHit: Boolean(result.cacheHit), error: null };
}

async function getCatalogOnce(options = {}) {
  const { timeoutMs = S3_RETRIEVAL_TIMEOUT_MS, forceFresh = false } = options;

  if (!forceFresh && cache.catalog.value && isFresh(cache.catalog.ts, META_TTL_MS)) {
    return { value: cache.catalog.value, cacheHit: true, error: null };
  }

  const result = await getObjectJson(KNOWLEDGE_BUCKET, CATALOG_KEY, { timeoutMs, forceFresh });
  if (!result.value) {
    return {
      value: null,
      cacheHit: Boolean(result.cacheHit),
      error: result.error || new Error("catalog.json missing or invalid"),
    };
  }

  cache.catalog = { value: result.value, ts: Date.now() };
  return { value: result.value, cacheHit: Boolean(result.cacheHit), error: null };
}

async function getCanonOnce(options = {}) {
  const { timeoutMs = S3_RETRIEVAL_TIMEOUT_MS, forceFresh = false } = options;

  if (!forceFresh && cache.canon.value && isFresh(cache.canon.ts, META_TTL_MS)) {
    return { value: cache.canon.value, cacheHit: true, error: null };
  }

  const result = await getObjectJson(KNOWLEDGE_BUCKET, CANON_KEY, { timeoutMs, forceFresh });
  if (!result.value) {
    return {
      value: null,
      cacheHit: Boolean(result.cacheHit),
      error: result.error || new Error("canon.json missing or invalid"),
    };
  }

  cache.canon = { value: result.value, ts: Date.now() };
  return { value: result.value, cacheHit: Boolean(result.cacheHit), error: null };
}

async function preloadDeterministicMeta(reqId) {
  const startedAt = Date.now();

  const [routingStep, catalogStep, canonStep] = await Promise.all([
    measureStep("routing_rules", () => getRoutingRulesOnce()),
    measureStep("catalog", () => getCatalogOnce()),
    measureStep("canon", () => getCanonOnce()),
  ]);

  const ok =
    routingStep.ok &&
    !routingStep.value.error &&
    catalogStep.ok &&
    !catalogStep.value.error &&
    canonStep.ok &&
    !canonStep.value.error;

  const result = {
    ok,
    ms: elapsedMs(startedAt),
    routingRules: routingStep.ok ? routingStep.value.value : [],
    catalog: catalogStep.ok ? catalogStep.value.value : null,
    canon: canonStep.ok ? canonStep.value.value : null,
    errors: [
      routingStep.ok ? routingStep.value.error : routingStep.error,
      catalogStep.ok ? catalogStep.value.error : catalogStep.error,
      canonStep.ok ? canonStep.value.error : canonStep.error,
    ].filter(Boolean),
    details: {
      routingRules: {
        ms: routingStep.ms,
        cacheHit: routingStep.ok ? Boolean(routingStep.value.cacheHit) : false,
        ok: routingStep.ok && !routingStep.value.error,
      },
      catalog: {
        ms: catalogStep.ms,
        cacheHit: catalogStep.ok ? Boolean(catalogStep.value.cacheHit) : false,
        ok: catalogStep.ok && !catalogStep.value.error,
      },
      canon: {
        ms: canonStep.ms,
        cacheHit: canonStep.ok ? Boolean(canonStep.value.cacheHit) : false,
        ok: canonStep.ok && !canonStep.value.error,
      },
    },
  };

  logEvent("retrieval.meta.preload", {
    reqId,
    ok: result.ok,
    retrievalMs: result.ms,
    details: result.details,
    errors: result.errors.map((e) => String(e.message || e)),
  });

  return result;
}

function catalogHasHandle(catalog, handle) {
  const h = String(handle || "").trim();
  if (!catalog || !h) return true;

  try {
    const lower = h.toLowerCase();

    if (Array.isArray(catalog.handles)) {
      return catalog.handles.map(String).some((x) => x.toLowerCase() === lower);
    }

    if (isObject(catalog.categories)) {
      return Object.values(catalog.categories).some((arr) =>
        Array.isArray(arr) && arr.map(String).some((x) => x.toLowerCase() === lower)
      );
    }

    if (Array.isArray(catalog.products)) {
      return catalog.products.map((p) => String(p?.handle || "")).some((x) => x.toLowerCase() === lower);
    }

    if (Array.isArray(catalog.items)) {
      return catalog.items.map((p) => String(p?.handle || "")).some((x) => x.toLowerCase() === lower);
    }

    if (isObject(catalog.productsByHandle)) {
      return Boolean(catalog.productsByHandle[h] || catalog.productsByHandle[lower]);
    }

    return true;
  } catch {
    return true;
  }
}

function resolveVariantFromCanon(canon, handle, sizeLabel) {
  if (!canon || !handle) return null;

  const h = String(handle).trim();
  const wantedSize = normalizeSizeKey(sizeLabel || "");
  if (!h || !wantedSize) return null;

  try {
    const directProduct =
      (isObject(canon.products) && (canon.products[h] || canon.products[h.toLowerCase()])) ||
      (isObject(canon.productsByHandle) &&
        (canon.productsByHandle[h] || canon.productsByHandle[h.toLowerCase()])) ||
      null;

    if (isObject(directProduct?.sizeMap)) {
      for (const [sizeKey, gid] of Object.entries(directProduct.sizeMap)) {
        if (normalizeSizeKey(sizeKey) === wantedSize && isValidVariantGid(gid)) {
          return gid;
        }
      }
    }

    if (Array.isArray(directProduct?.variants)) {
      const optionKey = `size:${wantedSize}`;
      const match = directProduct.variants.find((v) => {
        const rawOptionKey = normalizeSizeKey(String(v?.optionKey || "").replace(/^size:/i, ""));
        return rawOptionKey === wantedSize || normalizeSizeKey(v?.size || "") === wantedSize || normalizeSizeKey(v?.title || "") === wantedSize || normalizeSizeKey(v?.label || "") === wantedSize || normalizeSizeKey(optionKey) === rawOptionKey;
      });

      const gid = match?.variantGid || match?.variantId || null;
      if (isValidVariantGid(gid || "")) return gid;
    }

    const legacyDirect = canon[h];
    if (isObject(legacyDirect)) {
      for (const [key, value] of Object.entries(legacyDirect)) {
        const normalizedKey = normalizeSizeKey(String(key).replace(/^size:/i, ""));
        if (normalizedKey === wantedSize && isValidVariantGid(value)) {
          return value;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

function bucketForKey(key) {
  const k = String(key || "");
  if (k.startsWith("system/")) return PROMPT_BUCKET;
  return KNOWLEDGE_BUCKET;
}

function normalizeRoutingKey(key) {
  const k = String(key || "").trim();
  if (!k) return null;

  if (k.startsWith("PROMPT:")) return { bucket: PROMPT_BUCKET, key: k.slice("PROMPT:".length) };
  if (k.startsWith("KNOWLEDGE:")) return { bucket: KNOWLEDGE_BUCKET, key: k.slice("KNOWLEDGE:".length) };

  return { bucket: bucketForKey(k), key: k };
}

async function loadKeysAsSnippets(keys = [], limitBytes = MAX_CTX_BYTES) {
  const startedAt = Date.now();
  const snippets = [];
  const usedKeys = [];
  let used = 0;
  let cacheHits = 0;
  let misses = 0;

  for (const raw of Array.isArray(keys) ? keys : []) {
    const normalized = normalizeRoutingKey(raw);
    if (!normalized) continue;

    const txtResult = await getObjectText(normalized.bucket, normalized.key);
    if (!txtResult?.value) continue;

    if (txtResult.cacheHit) cacheHits += 1;
    else misses += 1;

    const trimmed = txtResult.value.trim().slice(0, 3500);
    if (used + trimmed.length > limitBytes) break;

    const label = normalized.bucket === PROMPT_BUCKET ? "PROMPT_CTX" : "KNOWLEDGE_CTX";
    snippets.push(`### ${label}: ${normalized.key}\n${trimmed}`);
    usedKeys.push(`${normalized.bucket}/${normalized.key}`);
    used += trimmed.length;
  }

  return {
    snippets,
    usedKeys,
    retrievalOk: snippets.length > 0,
    ms: elapsedMs(startedAt),
    cacheHits,
    misses,
  };
}

// ──────────────────────────────
// Prompt + mode instructions (model path only)
// ──────────────────────────────
function buildModeInstructions(mode) {
  const m = String(mode || "").toLowerCase();

  const lines = [
    "You are Snoozer, the in-store AI assistant for MySnoozePod.",
    "IMPORTANT RULES:",
    "- Do not guess prices, availability, financing math, or checkout details.",
    "- If the guest asks price/cart/checkout, say: “I’ll pull live pricing/checkout for you” and ask what size they want if needed.",
    "- Never invent product, policy, delivery, warranty, financing, medical, or availability claims.",
    "- When context exists, make the answer specific to the shopper's pod, mattress, base, motion mode, or session.",
    "- Keep it practical and short unless asked for more.",
    "- End with a clear test or next step when helpful.",
  ];

  if (m === "pod") {
    lines.push(
      "",
      "MODE: POD",
      "- The guest is at a specific SnoozePod.",
      "- Use the POD BRIEF as authoritative for what's on this pod.",
      "- Focus on what to feel for and what to do next."
    );
  }

  return lines.join("\n");
}

// ──────────────────────────────
// Knowledge context
// POD MODE: load only pod file (+ optional single product card)
// NON-POD: deterministic routing_rules.json intent -> keys
// ──────────────────────────────
async function getKnowledgeContext({ mode, query, context, intent, retrievalMeta } = {}, limitBytes = MAX_CTX_BYTES) {
  const startedAt = Date.now();
  const m = String(mode || "").toLowerCase();
  const snippets = [];
  const keys = [];
  const errors = [];
  let cacheHits = 0;
  let misses = 0;

  const catalog = retrievalMeta?.catalog || null;
  const routingRules = Array.isArray(retrievalMeta?.routingRules) ? retrievalMeta.routingRules : [];
  const requestedProductHandle = resolveRequestedProductHandle(query, context || {});

  if (m === "pod") {
    let used = 0;

    const podId = getPodIdFromContext(context || {});
    if (podId) {
      const podKey = `pods/${podId}.md`;
      const podTxtResult = await getObjectText(KNOWLEDGE_BUCKET, podKey);
      if (podTxtResult?.value) {
        if (podTxtResult.cacheHit) cacheHits += 1;
        else misses += 1;

        const trimmed = podTxtResult.value.trim().slice(0, 3500);
        if (used + trimmed.length <= limitBytes) {
          snippets.push(`### POD BRIEF: ${podKey}\n${trimmed}`);
          keys.push(`${KNOWLEDGE_BUCKET}/${podKey}`);
          used += trimmed.length;
        }
      } else {
        errors.push(new Error(`Missing pod brief: ${podKey}`));
        logEvent("pod.brief.missing", { podKey });
      }
    }

    const firstHandle = requestedProductHandle || null;

    if (firstHandle) {
      if (!catalogHasHandle(catalog, firstHandle)) {
        errors.push(new Error(`Handle not allowed by catalog: ${firstHandle}`));
        logEvent("catalog.blocked_handle", { handle: firstHandle });
      } else {
        const normalizedHandle = String(firstHandle || "").trim().toLowerCase();
        const directKey = POD_PRODUCT_DOC_KEY_BY_HANDLE[normalizedHandle] || "";
        const candidates = directKey ? [directKey] : [`products/${normalizedHandle}.md`];

        for (const k of candidates) {
          const txtResult = await getObjectText(KNOWLEDGE_BUCKET, k);
          if (!txtResult?.value) continue;

          if (txtResult.cacheHit) cacheHits += 1;
          else misses += 1;

          const trimmed = txtResult.value.trim().slice(0, 2000);
          if (used + trimmed.length > limitBytes) break;
          snippets.push(`### PRODUCT CARD: ${k}\n${trimmed}`);
          keys.push(`${KNOWLEDGE_BUCKET}/${k}`);
          used += trimmed.length;
          break;
        }
      }
    }

    const retrievalOk = snippets.length > 0;

    logEvent("s3.knowledge.loaded", {
      mode,
      keys,
      retrievalOk,
      retrievalMs: elapsedMs(startedAt),
      cacheHits,
      misses,
      requestedProductHandle: requestedProductHandle || null,
      loadedProductKnowledgeHandles: keys
        .map((key) => String(key).match(/products\/(?:mattress|bases)\/([^/]+)\.md$/i)?.[1] || "")
        .filter(Boolean),
    });

    return {
      snippets,
      keys,
      retrievalOk,
      ms: elapsedMs(startedAt),
      cacheHits,
      misses,
      errors,
      requestedProductHandle: requestedProductHandle || null,
      loadedProductKnowledgeHandles: keys
        .map((key) => String(key).match(/products\/(?:mattress|bases)\/([^/]+)\.md$/i)?.[1] || "")
        .filter(Boolean),
    };
  }

  const explicitProductHandle = resolveExplicitProductHandle(query);
  const queryHasProductReference = /\b(?:it|this|that|mattress|foam|hybrid|dual comfort)\b/i.test(
    String(query || "")
  );
  const authoritativeProductHandle =
    explicitProductHandle || (queryHasProductReference ? requestedProductHandle : "");
  if (authoritativeProductHandle) {
    if (!catalogHasHandle(catalog, authoritativeProductHandle)) {
      return {
        snippets: [],
        keys: [],
        retrievalOk: false,
        ms: elapsedMs(startedAt),
        cacheHits,
        misses,
        errors: [new Error(`Handle not allowed by catalog: ${authoritativeProductHandle}`)],
        requestedProductHandle: authoritativeProductHandle,
        loadedProductKnowledgeHandles: [],
      };
    }
    const key =
      POD_PRODUCT_DOC_KEY_BY_HANDLE[String(authoritativeProductHandle).trim().toLowerCase()] ||
      `products/${String(authoritativeProductHandle).trim().toLowerCase()}.md`;
    const loaded = await getObjectText(KNOWLEDGE_BUCKET, key);
    if (!loaded?.value) {
      return {
        snippets: [],
        keys: [],
        retrievalOk: false,
        ms: elapsedMs(startedAt),
        cacheHits,
        misses: misses + 1,
        errors: [new Error(`Missing product knowledge: ${key}`)],
        requestedProductHandle: authoritativeProductHandle,
        loadedProductKnowledgeHandles: [],
      };
    }
    if (loaded.cacheHit) cacheHits += 1;
    else misses += 1;
    return {
      snippets: [`### PRODUCT CARD: ${key}\n${loaded.value.trim().slice(0, limitBytes)}`],
      keys: [`${KNOWLEDGE_BUCKET}/${key}`],
      retrievalOk: true,
      ms: elapsedMs(startedAt),
      cacheHits,
      misses,
      errors: [],
      requestedProductHandle: authoritativeProductHandle,
      loadedProductKnowledgeHandles: [authoritativeProductHandle],
    };
  }

  const wantedIntent = String(intent || "").trim();
  const rule =
    routingRules.find((r) => String(r?.intent || "").trim() === wantedIntent) || null;

  if (!rule) {
    if (STRICT_DETERMINISTIC_RETRIEVAL) {
      logEvent("routing_rules.intent.missing", { intent: wantedIntent, strict: true });
      return {
        snippets: [],
        keys: [],
        retrievalOk: false,
        ms: elapsedMs(startedAt),
        cacheHits: 0,
        misses: 0,
        errors: [new Error(`Missing routing rule for intent: ${wantedIntent || "unknown"}`)],
      };
    }

    const prefixes = ["global/", "products/"];
    const allKeys = [];
    for (const prefix of prefixes) {
      const listResult = await listMarkdownKeys(KNOWLEDGE_BUCKET, prefix);
      (listResult?.value || []).forEach((k) => allKeys.push(k));
    }

    const q = String(query || "").toLowerCase();
    const ranked = allKeys
      .map((key) => {
        const k = String(key || "").toLowerCase();
        let score = 0;
        if (k.includes("global/")) score += 1;
        if (k.includes("products/")) score += 2;

        const words = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
        for (const w of words) if (k.includes(w)) score += 1;

        return { key, score };
      })
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.key.localeCompare(b.key)));

    const chosen = ranked.slice(0, MAX_CTX_FILES).map((r) => r.key);
    const heuristicResult = await loadKeysAsSnippets(chosen, limitBytes);

    return {
      snippets: heuristicResult.snippets,
      keys: heuristicResult.usedKeys,
      retrievalOk: heuristicResult.retrievalOk,
      ms: elapsedMs(startedAt),
      cacheHits: heuristicResult.cacheHits,
      misses: heuristicResult.misses,
      errors: heuristicResult.retrievalOk ? [] : [new Error("Heuristic retrieval returned no snippets")],
    };
  }

  const ruleKeys = Array.isArray(rule.keys) ? rule.keys : [];
  const loaded = await loadKeysAsSnippets(ruleKeys, limitBytes);

  logEvent("routing_rules.used", {
    intent: wantedIntent,
    keyCount: ruleKeys.length,
    loadedCount: loaded.usedKeys.length,
    retrievalMs: elapsedMs(startedAt),
    cacheHits: loaded.cacheHits,
    misses: loaded.misses,
  });

  return {
    snippets: loaded.snippets,
    keys: loaded.usedKeys,
    retrievalOk: loaded.retrievalOk,
    ms: elapsedMs(startedAt),
    cacheHits: loaded.cacheHits,
    misses: loaded.misses,
    errors: loaded.retrievalOk ? [] : [new Error(`No snippets loaded for intent: ${wantedIntent}`)],
  };
}

// ──────────────────────────────
// Contract builder
// ──────────────────────────────
function toContract({
  reply,
  actions = [],
  products = [],
  meta = {},
  thread_id,
  status = "completed",
  model = FAST_MODEL,
  tokens = null,
  s3Prompts = [],
  context = null,
  contextPatch = null,
  cartId = null,
  checkoutUrl = null,
  cart = null,
  raw = null,
}) {
  const safe = safeReply(reply);

  const metrics = buildMetrics({
    retrievalMs: meta.retrievalMs,
    modelMs: meta.modelMs,
    totalMs: meta.totalMs || meta.latency_ms || 0,
    fallbackUsed: meta.fallbackUsed,
  });

  const out = {
    reply: safe,
    text: safe,
    actions: Array.isArray(actions) ? actions : [],
    ...(Array.isArray(products) && products.length ? { products } : {}),
    meta: {
      path: meta.path || "deterministic",
      latency_ms: safeNumber(meta.latency_ms, 0),
      ...(meta.error ? { error: String(meta.error) } : {}),
      ...metrics,
    },
    model,
    tokens: tokens || null,
    thread_id,
    status,
  };

  if (Array.isArray(s3Prompts) && s3Prompts.length) out.s3Prompts = s3Prompts;
  if (context && typeof context === "object") out.context = context;
  if (contextPatch && typeof contextPatch === "object") out.contextPatch = contextPatch;
  if (cartId) out.cartId = cartId;
  if (checkoutUrl) out.checkoutUrl = checkoutUrl;
  if (cart) out.cart = cart;
  if (raw) out.raw = raw;

  return out;
}

// ──────────────────────────────
// Deterministic handlers (TOOLS ONLY)
// ──────────────────────────────
async function deterministicPricePath(userMessage, { reqId, thread_id, mode, context, retrievalMeta } = {}) {
  const t0 = Date.now();
  const retrievalMs = safeNumber(retrievalMeta?.ms, 0);

  if (!snoozerTools?.getProductPrice) {
    return buildDeterministicFallbackContract({
      reply: "Pricing is temporarily unavailable.",
      thread_id,
      context,
      error: "tools_missing",
      latency_ms: elapsedMs(t0),
      retrievalMs,
      raw: { route: "price" },
    });
  }

  const size = parseSizeFromMessage(userMessage);
  const handle = resolveHandleFromContext(userMessage, context || {});

  if (!handle) {
    const explore = Array.isArray(context?.explore) ? context.explore : [];
    const names = explore
      .map((x) => String(x?.title || x?.handle || "").trim())
      .filter(Boolean)
      .slice(0, 3);

    const reply = names.length
      ? `Which one do you mean: ${names.join(" / ")}?`
      : "Do you mean the mattress or the base?";

    return toContract({
      reply,
      actions: [],
      meta: {
        path: "deterministic",
        latency_ms: elapsedMs(t0),
        retrievalMs,
        modelMs: 0,
        totalMs: elapsedMs(t0),
        fallbackUsed: false,
      },
      thread_id,
      status: "completed",
      model: FAST_MODEL,
      context,
    });
  }

  if (retrievalMeta?.catalog && !catalogHasHandle(retrievalMeta.catalog, handle)) {
    return buildDeterministicFallbackContract({
      reply: "That item is not in the curated showroom catalog.",
      thread_id,
      context,
      error: "catalog_blocked_handle",
      latency_ms: elapsedMs(t0),
      retrievalMs,
      raw: { route: "price", handle },
    });
  }

  if (!size) {
    return toContract({
      reply: "What size are you pricing (Twin XL, Queen, King, etc.)?",
      actions: [],
      meta: {
        path: "deterministic",
        latency_ms: elapsedMs(t0),
        retrievalMs,
        modelMs: 0,
        totalMs: elapsedMs(t0),
        fallbackUsed: false,
      },
      thread_id,
      status: "completed",
      model: FAST_MODEL,
      context,
      raw: { route: "price", reason: "missing_size", handle },
    });
  }

  logEvent("route.deterministic.price", { reqId, handle, size, mode });

  const result = await snoozerTools.getProductPrice({
    handle,
    options: { Size: size },
    thread_id,
    context,
  });

  if (result?.error) {
    return buildDeterministicFallbackContract({
      reply: result.message || "I couldn't pull live pricing right now.",
      thread_id,
      context,
      error: result.error,
      latency_ms: elapsedMs(t0),
      retrievalMs,
      raw: { route: "price", result },
    });
  }

  const contextPatch = normalizeContextPatch({
    cartState: { lastViewedHandle: result.handle || handle },
  });

  const mergedContext = isObject(context) ? deepMerge(context, contextPatch) : contextPatch;

  rememberTurn(thread_id, "user", userMessage);
  rememberTurn(thread_id, "assistant", result.message || "");

  return toContract({
    reply: result.message || `${result.title} is $${result.price} ${result.currencyCode}.`,
    actions: [],
    meta: {
      path: "deterministic",
      latency_ms: elapsedMs(t0),
      retrievalMs,
      modelMs: 0,
      totalMs: elapsedMs(t0),
      fallbackUsed: false,
    },
    thread_id,
    status: "completed",
    model: FAST_MODEL,
    context: mergedContext,
    contextPatch,
    raw: { route: "price", result },
  });
}

async function deterministicCheckoutPath(userMessage, { reqId, thread_id, mode, context, retrievalMeta } = {}) {
  const t0 = Date.now();
  const retrievalMs = safeNumber(retrievalMeta?.ms, 0);

  if (!snoozerTools?.createCheckout) {
    return buildDeterministicFallbackContract({
      reply: "Checkout is temporarily unavailable.",
      thread_id,
      context,
      error: "tools_missing",
      latency_ms: elapsedMs(t0),
      retrievalMs,
      raw: { route: "checkout" },
    });
  }

  const qty = parseQuantity(userMessage);
  const size = parseSizeFromMessage(userMessage);
  const handle = resolveHandleFromContext(userMessage, context || {});
  let variantId = resolveVariantFromContext(context || {}, userMessage);

  if (handle && retrievalMeta?.catalog && !catalogHasHandle(retrievalMeta.catalog, handle)) {
    return buildDeterministicFallbackContract({
      reply: "That item is not in the curated showroom catalog.",
      thread_id,
      context,
      error: "catalog_blocked_handle",
      latency_ms: elapsedMs(t0),
      retrievalMs,
      raw: { route: "checkout", handle },
    });
  }

  if (handle && size) {
    try {
      const v = await resolveVariantByHandleAndSize(handle, size);
      if (isValidVariantGid(v || "")) variantId = v;
    } catch (e) {
      logEvent("checkout.variant_by_size.error", { reqId, handle, size, error: e.message });
    }
  }

  if (!isValidVariantGid(variantId || "")) {
    if (handle && !size) {
      return toContract({
        reply: "What size should I add to the cart (Twin XL, Queen, King, etc.)?",
        actions: [],
        meta: {
          path: "deterministic",
          latency_ms: elapsedMs(t0),
          retrievalMs,
          modelMs: 0,
          totalMs: elapsedMs(t0),
          fallbackUsed: false,
        },
        thread_id,
        status: "completed",
        model: FAST_MODEL,
        context,
        raw: { route: "checkout", reason: "missing_size_or_variant", handle },
      });
    }

    return buildDeterministicFallbackContract({
      reply: "I need the exact item and size first so I can add it correctly.",
      thread_id,
      context,
      error: "missing_variant",
      latency_ms: elapsedMs(t0),
      retrievalMs,
      raw: { route: "checkout", reason: "missing_variant", handle, size },
    });
  }

  logEvent("route.deterministic.checkout", { reqId, variantId, qty, mode });

  const result = await snoozerTools.createCheckout({
    variantId,
    quantity: qty,
    thread_id,
    context,
  });

  if (result?.error || (!result.cartId && !result.checkoutUrl)) {
    return buildDeterministicFallbackContract({
      reply: result?.message || "I couldn't add that to the cart right now.",
      thread_id,
      context,
      error: result?.error || "checkout_failed",
      latency_ms: elapsedMs(t0),
      retrievalMs,
      raw: { route: "checkout", result },
    });
  }

  const cartId = result.cartId || null;
  const checkoutUrl = result.checkoutUrl || null;
  const cart = result.cart || null;

  const contextPatch = normalizeContextPatch({
    ...(cartId ? { ids: { cartId } } : {}),
    ...(checkoutUrl ? { checkoutUrl } : {}),
    cartState: {
      ...(isObject(context?.cartState) ? context.cartState : {}),
      ...(handle ? { lastAddedHandle: handle } : {}),
    },
  });

  const mergedContext = isObject(context) ? deepMerge(context, contextPatch) : contextPatch;

  const reply =
    result.message || "Added to your cart. You can keep shopping or open the cart when you’re ready.";

  rememberTurn(thread_id, "user", userMessage);
  rememberTurn(thread_id, "assistant", reply);

  return toContract({
    reply,
    actions: [{ type: "add_to_cart", variantId, quantity: qty }, { type: "go_to_cart" }],
    meta: {
      path: "deterministic",
      latency_ms: elapsedMs(t0),
      retrievalMs,
      modelMs: 0,
      totalMs: elapsedMs(t0),
      fallbackUsed: false,
    },
    thread_id,
    status: "completed",
    model: FAST_MODEL,
    tokens: null,
    s3Prompts: [],
    context: mergedContext,
    contextPatch,
    cartId,
    checkoutUrl,
    cart,
    raw: { route: "checkout", result },
  });
}

async function deterministicViewCartPath(userMessage, { reqId, thread_id, mode, context, retrievalMeta } = {}) {
  const t0 = Date.now();
  const retrievalMs = safeNumber(retrievalMeta?.ms, 0);

  if (!snoozerTools?.getCart) {
    return buildDeterministicFallbackContract({
      reply: "Cart is temporarily unavailable.",
      thread_id,
      context,
      error: "tools_missing",
      latency_ms: elapsedMs(t0),
      retrievalMs,
      raw: { route: "cart_view" },
    });
  }

  logEvent("route.deterministic.cart_view", { reqId, mode });

  const result = await snoozerTools.getCart({ thread_id, context });

  if (result?.error) {
    return buildDeterministicFallbackContract({
      reply: result.message || "I couldn't load your cart right now.",
      thread_id,
      context,
      error: result.error,
      latency_ms: elapsedMs(t0),
      retrievalMs,
      raw: { route: "cart_view", result },
    });
  }

  const contextPatch = normalizeContextPatch(result.contextPatch || {});
  const mergedContext = isObject(context) ? deepMerge(context, contextPatch) : contextPatch;

  return toContract({
    reply: result.message || "Here’s your cart.",
    actions: [{ type: "cart_view" }, { type: "go_to_cart" }],
    meta: {
      path: "deterministic",
      latency_ms: elapsedMs(t0),
      retrievalMs,
      modelMs: 0,
      totalMs: elapsedMs(t0),
      fallbackUsed: false,
    },
    thread_id,
    status: "completed",
    model: FAST_MODEL,
    context: mergedContext,
    contextPatch,
    cartId: result.cartId || null,
    checkoutUrl: result.checkoutUrl || null,
    cart: result.cart || null,
    raw: { route: "cart_view", cartSummary: result.cartSummary || null },
  });
}

async function deterministicRemoveFromCartPath(
  userMessage,
  { reqId, thread_id, mode, context, retrievalMeta } = {}
) {
  const t0 = Date.now();
  const retrievalMs = safeNumber(retrievalMeta?.ms, 0);

  if (!snoozerTools?.getCart || !snoozerTools?.removeCartLines) {
    return buildDeterministicFallbackContract({
      reply: "Cart updates are temporarily unavailable.",
      thread_id,
      context,
      error: "tools_missing",
      latency_ms: elapsedMs(t0),
      retrievalMs,
      raw: { route: "cart_remove" },
    });
  }

  logEvent("route.deterministic.cart_remove.start", { reqId, mode });

  const cartRes = await snoozerTools.getCart({ thread_id, context });
  if (cartRes?.error) {
    return buildDeterministicFallbackContract({
      reply: cartRes.message || "I couldn't load your cart right now.",
      thread_id,
      context,
      error: cartRes.error,
      latency_ms: elapsedMs(t0),
      retrievalMs,
      raw: { route: "cart_remove", step: "getCart", cartRes },
    });
  }

  const cartSummary =
    cartRes.cartSummary ||
    (typeof snoozerTools.summarizeCart === "function" ? snoozerTools.summarizeCart(cartRes.cart) : null);

  const pick = pickLineFromCartSummary(cartSummary, userMessage);
  if (!pick.line) {
    return toContract({
      reply: buildCartDisambiguationPrompt(cartSummary),
      actions: [],
      meta: {
        path: "deterministic",
        latency_ms: elapsedMs(t0),
        retrievalMs,
        modelMs: 0,
        totalMs: elapsedMs(t0),
        fallbackUsed: false,
      },
      thread_id,
      status: "completed",
      model: FAST_MODEL,
      context,
      raw: { route: "cart_remove", reason: pick.reason, cartSummary },
    });
  }

  const removeRes = await snoozerTools.removeCartLines({
    thread_id,
    context,
    lineIds: [pick.line.lineId],
  });

  if (removeRes?.error) {
    return buildDeterministicFallbackContract({
      reply: removeRes.message || "I couldn't remove that right now.",
      thread_id,
      context,
      error: removeRes.error,
      latency_ms: elapsedMs(t0),
      retrievalMs,
      raw: { route: "cart_remove", step: "remove", removeRes },
    });
  }

  const contextPatch = normalizeContextPatch(removeRes.contextPatch || {});
  const mergedContext = isObject(context) ? deepMerge(context, contextPatch) : contextPatch;

  return toContract({
    reply: removeRes.message || `Removed ${pick.line.title} from your cart.`,
    actions: [{ type: "remove_from_cart", lineId: pick.line.lineId }, { type: "go_to_cart" }],
    meta: {
      path: "deterministic",
      latency_ms: elapsedMs(t0),
      retrievalMs,
      modelMs: 0,
      totalMs: elapsedMs(t0),
      fallbackUsed: false,
    },
    thread_id,
    status: "completed",
    model: FAST_MODEL,
    context: mergedContext,
    contextPatch,
    cartId: removeRes.cartId || cartRes.cartId || null,
    checkoutUrl: removeRes.checkoutUrl || cartRes.checkoutUrl || null,
    cart: removeRes.cart || null,
    raw: { route: "cart_remove", removed: pick, cartSummary: removeRes.cartSummary || null },
  });
}

async function deterministicUpdateCartQtyPath(
  userMessage,
  { reqId, thread_id, mode, context, retrievalMeta } = {}
) {
  const t0 = Date.now();
  const retrievalMs = safeNumber(retrievalMeta?.ms, 0);

  if (!snoozerTools?.getCart || !snoozerTools?.updateCartLines) {
    return buildDeterministicFallbackContract({
      reply: "Cart updates are temporarily unavailable.",
      thread_id,
      context,
      error: "tools_missing",
      latency_ms: elapsedMs(t0),
      retrievalMs,
      raw: { route: "cart_update" },
    });
  }

  logEvent("route.deterministic.cart_update.start", { reqId, mode });

  const qty = parseQuantity(userMessage);

  const cartRes = await snoozerTools.getCart({ thread_id, context });
  if (cartRes?.error) {
    return buildDeterministicFallbackContract({
      reply: cartRes.message || "I couldn't load your cart right now.",
      thread_id,
      context,
      error: cartRes.error,
      latency_ms: elapsedMs(t0),
      retrievalMs,
      raw: { route: "cart_update", step: "getCart", cartRes },
    });
  }

  const cartSummary =
    cartRes.cartSummary ||
    (typeof snoozerTools.summarizeCart === "function" ? snoozerTools.summarizeCart(cartRes.cart) : null);

  const pick = pickLineFromCartSummary(cartSummary, userMessage);
  if (!pick.line) {
    return toContract({
      reply: buildCartDisambiguationPrompt(cartSummary),
      actions: [],
      meta: {
        path: "deterministic",
        latency_ms: elapsedMs(t0),
        retrievalMs,
        modelMs: 0,
        totalMs: elapsedMs(t0),
        fallbackUsed: false,
      },
      thread_id,
      status: "completed",
      model: FAST_MODEL,
      context,
      raw: { route: "cart_update", reason: pick.reason, cartSummary },
    });
  }

  const updateRes = await snoozerTools.updateCartLines({
    thread_id,
    context,
    lines: [{ id: pick.line.lineId, quantity: qty }],
  });

  if (updateRes?.error) {
    return buildDeterministicFallbackContract({
      reply: updateRes.message || "I couldn't update that quantity right now.",
      thread_id,
      context,
      error: updateRes.error,
      latency_ms: elapsedMs(t0),
      retrievalMs,
      raw: { route: "cart_update", step: "update", updateRes },
    });
  }

  const contextPatch = normalizeContextPatch(updateRes.contextPatch || {});
  const mergedContext = isObject(context) ? deepMerge(context, contextPatch) : contextPatch;

  const verb = qty === 0 ? "Removed" : "Updated";

  return toContract({
    reply: updateRes.message || `${verb} ${pick.line.title} in your cart.`,
    actions: [
      qty === 0
        ? { type: "remove_from_cart", lineId: pick.line.lineId }
        : { type: "update_cart_qty", lineId: pick.line.lineId, quantity: qty },
      { type: "go_to_cart" },
    ],
    meta: {
      path: "deterministic",
      latency_ms: elapsedMs(t0),
      retrievalMs,
      modelMs: 0,
      totalMs: elapsedMs(t0),
      fallbackUsed: false,
    },
    thread_id,
    status: "completed",
    model: FAST_MODEL,
    context: mergedContext,
    contextPatch,
    cartId: updateRes.cartId || cartRes.cartId || null,
    checkoutUrl: updateRes.checkoutUrl || cartRes.checkoutUrl || null,
    cart: updateRes.cart || null,
    raw: { route: "cart_update", updated: pick, qty, cartSummary: updateRes.cartSummary || null },
  });
}

// ──────────────────────────────
// Model path (NO TOOLS, NO COMMERCE) + retrieval enforcement
// ──────────────────────────────
async function modelPath(userMessage, { reqId, thread_id, mode, context, intent, retrievalMeta } = {}) {
  const t0 = Date.now();
  const retrievalMs = safeNumber(retrievalMeta?.ms, 0);
  const base = await getBasePromptOnce(reqId);
  const memory = getLastTurns(thread_id, MAX_HISTORY_TURNS);
  const boundedHistory = buildBoundedModelHistory(
    memory,
    context?.recentConversation,
    userMessage
  );

  const knowledgeStep = await measureStep("knowledge_context", () =>
    getKnowledgeContext(
      { mode, query: userMessage, context, intent, retrievalMeta },
      Math.floor(MAX_CTX_BYTES * 0.85)
    )
  );

  if (!knowledgeStep.ok) {
    logEvent("retrieval.block_model", {
      reqId,
      intent,
      mode,
      reason: "knowledge_context_error",
      error: knowledgeStep.error.message,
    });

    return buildDeterministicFallbackContract({
      reply:
        "I don’t have that showroom knowledge loaded cleanly right now. I can still help with the next step in-store.",
      thread_id,
      context,
      error: "E_RETRIEVAL_CONTEXT_ERROR",
      latency_ms: elapsedMs(t0),
      retrievalMs: retrievalMs + knowledgeStep.ms,
      raw: { intent, mode, error: knowledgeStep.error.message },
    });
  }

  const knowledge = knowledgeStep.value;
  const totalRetrievalMs = retrievalMs + safeNumber(knowledge.ms, knowledgeStep.ms);

  const requestedProductHandle = String(knowledge.requestedProductHandle || "")
    .trim()
    .toLowerCase();
  const loadedProductKnowledgeHandles = Array.isArray(knowledge.loadedProductKnowledgeHandles)
    ? knowledge.loadedProductKnowledgeHandles.map((handle) => String(handle || "").trim().toLowerCase())
    : [];
  if (requestedProductHandle && !loadedProductKnowledgeHandles.includes(requestedProductHandle)) {
    logEvent("retrieval.block_model", {
      reqId,
      intent,
      mode,
      reason: "product_knowledge_handle_mismatch",
      requestedProductHandle,
      loadedProductKnowledgeHandles,
    });

    return buildDeterministicFallbackContract({
      reply:
        "I do not have the matching product guide loaded cleanly right now, so I will not guess about that mattress.",
      thread_id,
      context,
      error: "E_PRODUCT_KNOWLEDGE_MISMATCH",
      latency_ms: elapsedMs(t0),
      retrievalMs: totalRetrievalMs,
      meta: {
        resolved_requested_product_handle: requestedProductHandle,
        loaded_product_knowledge_handles: loadedProductKnowledgeHandles,
      },
      raw: {
        intent,
        kbKeys: knowledge.keys,
        requestedProductHandle,
        loadedProductKnowledgeHandles,
      },
    });
  }

  if (requiresDeterministicKnowledge(intent) && !knowledge.retrievalOk) {
    logEvent("retrieval.block_model", {
      reqId,
      intent,
      mode,
      reason: "required_knowledge_missing",
      errors: (knowledge.errors || []).map((e) => String(e.message || e)),
    });

    return buildDeterministicFallbackContract({
      reply:
        "I don’t have that showroom policy or guide loaded right now. I can help with the next in-store step, but I won’t guess the policy.",
      thread_id,
      context,
      error: "E_RETRIEVAL_MISSING",
      latency_ms: elapsedMs(t0),
      retrievalMs: totalRetrievalMs,
      raw: { intent, kbKeys: knowledge.keys, retrievalOk: knowledge.retrievalOk },
    });
  }

  const modeInstructions = buildModeInstructions(mode);

  const systemContextLines = [modeInstructions];
  if (knowledge.snippets.length) systemContextLines.push("", "CONTEXT:", knowledge.snippets.join("\n\n"));

  const boundedShopperContext = summarizeBoundedShopperContextForPrompt(
    context,
    userMessage
  );
  if (boundedShopperContext) {
    systemContextLines.push(
      "",
      "BOUNDED SHOPPER CONTEXT:",
      boundedShopperContext,
      "Use this only for continuity and personalization. Never infer missing commerce, product, compatibility, or policy facts."
    );
  }

  const canonicalRecommendationSummary = summarizeCanonicalRecommendationForPrompt(context);
  if (canonicalRecommendationSummary) {
    systemContextLines.push(
      "",
      "CANONICAL RECOMMENDATION (SOURCE OF TRUTH - DO NOT OVERRIDE):",
      canonicalRecommendationSummary.slice(0, 1800),
      "Use these exact pod, mattress, base, motion, reason, and warning values when explaining results."
    );
  }

  const messages = [
    { role: "system", content: base },
    { role: "system", content: systemContextLines.join("\n") },
    ...boundedHistory,
    { role: "user", content: String(userMessage || "").trim() },
  ];

  const modelStep = await measureStep("openai_chat", () => callOpenAIChat({ messages, reqId }));
  if (!modelStep.ok) {
    logEvent("model.fail", {
      reqId,
      error: modelStep.error.message,
      latency_ms: elapsedMs(t0),
      openai_status: modelStep.error?.response?.status || null,
      openai_body: truncateForLog(modelStep.error?.response?.data),
    });

    return buildDeterministicFallbackContract({
      reply: SAFE_FALLBACK,
      thread_id,
      context,
      error: modelStep.error.message,
      latency_ms: elapsedMs(t0),
      retrievalMs: totalRetrievalMs,
      modelMs: modelStep.ms,
      raw: { intent, mode, openaiError: modelStep.error.message },
    });
  }

  const chat = modelStep.value;
  const reply = safeReply(chat.text || "");

  rememberTurn(thread_id, "user", userMessage);
  rememberTurn(thread_id, "assistant", reply);

  const s3Prompts = [
    `PROMPT:${PROMPT_BUCKET}/${SYSTEM_PROMPT_KEY}`,
    ...knowledge.keys.map((k) => `CTX:${k}`),
  ];

  return toContract({
    reply,
    actions: [],
    products: [],
    meta: {
      path: "model",
      latency_ms: elapsedMs(t0),
      retrievalMs: totalRetrievalMs,
      modelMs: modelStep.ms,
      totalMs: elapsedMs(t0),
      fallbackUsed: false,
      resolved_requested_product_handle: knowledge.requestedProductHandle || null,
      loaded_product_knowledge_handles: Array.isArray(knowledge.loadedProductKnowledgeHandles)
        ? knowledge.loadedProductKnowledgeHandles
        : [],
    },
    thread_id,
    status: "completed",
    model: chat.model,
    tokens: chat.tokens,
    s3Prompts,
    raw: chat.raw,
    context,
  });
}

// ──────────────────────────────
// Orchestrator: deterministic routing first
// ──────────────────────────────
async function fastPath(
  userMessage,
  { reqId, thread_id, mode, context, allowGeneralConversation = false } = {}
) {
  const pathStartedAt = Date.now();
  const normalizedContext = normalizeIncomingContext(context || {});
  const m = String(mode || "").toLowerCase();

  if (allowGeneralConversation) {
    logEvent("route.model.general_conversation", {
      reqId,
      mode,
      protectedTruthRequired: false,
    });
    return await modelPath(userMessage, {
      reqId,
      thread_id,
      mode,
      context: normalizedContext,
      intent: "general_conversation",
      retrievalMeta: {
        ok: true,
        ms: 0,
        catalog: null,
        canon: null,
        routingRules: [],
        errors: [],
      },
    });
  }

  const retrievalMeta = await preloadDeterministicMeta(reqId);

  if (!retrievalMeta.ok) {
    return buildDeterministicFallbackContract({
      reply:
        "I do not have enough confirmed product information to answer that safely right now. Please try again in a moment.",
      thread_id,
      context: normalizedContext,
      error: "E_RETRIEVAL_META_FAILED",
      latency_ms: elapsedMs(pathStartedAt),
      retrievalMs: retrievalMeta.ms,
      raw: {
        mode,
        errors: retrievalMeta.errors.map((e) => String(e.message || e)),
        details: retrievalMeta.details,
      },
    });
  }

  if (STRICT_POD_ANCHOR && m === "pod") {
    const hasPodId = !!String(getPodIdFromContext(normalizedContext) || "").trim();
    const hasExplore = Array.isArray(normalizedContext.explore) && normalizedContext.explore.length > 0;
    if (!hasPodId || !hasExplore) {
      logEvent("pod.anchor.missing", {
        reqId,
        hasPodId,
        hasExplore,
        note: "Pod mode requires podId + explore/exploreContext to be deterministic.",
      });

      return buildDeterministicFallbackContract({
        reply:
          "Pod mode is missing required context (podId + exploreContext). The UI must send podId and the pod items so Snoozer can be deterministic.",
        thread_id,
        context: normalizedContext,
        error: "E_POD_CONTEXT_MISSING",
        latency_ms: elapsedMs(pathStartedAt),
        retrievalMs: retrievalMeta.ms,
        raw: { hasPodId, hasExplore },
      });
    }
  }

  const { wantsCart, wantsRemove, wantsViewCart } = detectCartIntent(userMessage);

  if (wantsViewCart) {
    return await deterministicViewCartPath(userMessage, {
      reqId,
      thread_id,
      mode,
      context: normalizedContext,
      retrievalMeta,
    });
  }

  if (wantsRemove) {
    return await deterministicRemoveFromCartPath(userMessage, {
      reqId,
      thread_id,
      mode,
      context: normalizedContext,
      retrievalMeta,
    });
  }

  if (detectUpdateQuantityIntent(userMessage)) {
    return await deterministicUpdateCartQtyPath(userMessage, {
      reqId,
      thread_id,
      mode,
      context: normalizedContext,
      retrievalMeta,
    });
  }

  if (wantsCart) {
    return await deterministicCheckoutPath(userMessage, {
      reqId,
      thread_id,
      mode,
      context: normalizedContext,
      retrievalMeta,
    });
  }

  if (detectPriceIntent(userMessage)) {
    return await deterministicPricePath(userMessage, {
      reqId,
      thread_id,
      mode,
      context: normalizedContext,
      retrievalMeta,
    });
  }

  const knowledgeIntent = detectKnowledgeIntent(userMessage);

  return await modelPath(userMessage, {
    reqId,
    thread_id,
    mode,
    context: normalizedContext,
    intent: knowledgeIntent,
    retrievalMeta,
  });
}

// ──────────────────────────────
// Public entrypoints
// ──────────────────────────────
async function getSnoozerResponse(
  userMessage,
  {
    thread_id = null,
    reqId,
    mode,
    context,
    allowGeneralConversation = false,
  } = {}
) {
  const sid =
    thread_id ||
    `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  try {
    initializeSession && initializeSession(sid);
  } catch {
    // ignore
  }

  return await fastPath(userMessage, {
    reqId,
    thread_id: sid,
    mode,
    context,
    allowGeneralConversation,
  });
}

async function runSnoozer({ message, mode, context, thread_id } = {}) {
  const reqId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const result = await getSnoozerResponse(message, { reqId, mode, context, thread_id });
  return { ok: true, response: result };
}

module.exports = {
  getSnoozerResponse,
  runSnoozer,
  getCatalogOnce,
  getCanonOnce,
  getObjectText,
  catalogHasHandle,
  resolveVariantFromCanon,
  resolveVariantByHandleAndSize,
};

// Temporary compatibility surface for legacy callers. The active Ask Snoozer
// route loads askSnoozerModelCore directly; these accessors keep older tests and
// callers on the single extracted implementations without copying them here.
for (const exportName of [
  "composeTrustedAdvisorResponse",
  "planTrustedAdvisorTurnWithModel",
  "loadTrustedAdvisorFactPack",
  "parseTrustedAdvisorComposition",
]) {
  Object.defineProperty(module.exports, exportName, {
    configurable: true,
    enumerable: true,
    get() {
      return advisorModelCore[exportName];
    },
    set(value) {
      advisorModelCore[exportName] = value;
    },
  });
}
