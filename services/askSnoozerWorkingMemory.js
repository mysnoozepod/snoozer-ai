const { loadShowroomManifest } = require("./showroomManifest");
const {
  normalizeAskSnoozerText,
  parseAskSnoozerSizeLabel,
} = require("./askSnoozerIntents");

const WORKING_MEMORY_VERSION = 1;
const PRICE_GOAL_INTENT = "price_quote";
const ACTIVE_GOAL_STATUSES = new Set(["collecting_slots", "ready", "completed"]);

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))
  );
}

function nowIso(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

function getProductMap() {
  const manifest = loadShowroomManifest();
  return new Map(
    (Array.isArray(manifest?.products) ? manifest.products : []).map((product) => [
      clean(product?.handle).toLowerCase(),
      product,
    ])
  );
}

function getPodMap() {
  const manifest = loadShowroomManifest();
  return new Map(
    (Array.isArray(manifest?.pods) ? manifest.pods : []).map((pod) => [
      clean(pod?.podId).toLowerCase(),
      pod,
    ])
  );
}

function normalizePodId(value = "") {
  return clean(value).toLowerCase().replace(/^snoozepod\s*/, "").replace(/^pod[-_\s]*/, "");
}

function resolveExplicitProductHandle(query = "") {
  const text = normalizeAskSnoozerText(query);
  if (!text) return "";

  const patterns = [
    ["12-dual-comfort-hybrid", /\b(?:12\s*(?:inch|in|-inch|["”])?\s*)?dual comfort(?:\s*hybrid)?\b/i],
    ["12-dual-comfort-hybrid", /\b12\s*(?:inch|in|-inch|["”])?\s*hybr(?:id|is)\b/i],
    ["14-hybrid", /\b14\s*(?:inch|in|-inch|["”])?\s*hybrid\b/i],
    ["10-all-foam-mattress", /\b(?:10|ten)\s*(?:inch|in|-inch|["”])?\s*all foam(?:\s*mattress)?\b/i],
    ["12-all-foam-mattress", /\b(?:12|twelve)\s*(?:inch|in|-inch|["”])?\s*all foam(?:\s*mattress)?\b/i],
    ["12-all-foam-mattress", /\ball foam(?:\s*mattress)?\b/i],
  ];

  for (const [handle, pattern] of patterns) {
    if (pattern.test(text)) return handle;
  }
  return "";
}

function resolveExplicitBaseSelection(query = "") {
  const text = normalizeAskSnoozerText(query);
  if (!text) return {};

  if (/\b(?:full split motion|full split)\b/.test(text)) {
    return { baseHandle: "premium-motion-adjustable-base", motionKey: "full_split" };
  }
  if (/\b(?:half split motion|half split)\b/.test(text)) {
    return { baseHandle: "premium-motion-adjustable-base", motionKey: "half_split" };
  }
  if (/\b(?:standard motion|standard)\b/.test(text)) {
    return { baseHandle: "premium-motion-adjustable-base", motionKey: "standard" };
  }
  if (/\b(?:platform base|platform)\b/.test(text)) {
    return { baseHandle: "platform-base", motionKey: "none" };
  }
  if (/\b(?:storage base|storage)\b/.test(text)) {
    return { baseHandle: "storage-base", motionKey: "none" };
  }
  if (/\b(?:no base|mattress only)\b/.test(text)) {
    return { baseHandle: null, motionKey: "none", explicitNoBase: true };
  }
  if (/\b(?:adjustable base|motion base|premium motion)\b/.test(text)) {
    return { baseHandle: "premium-motion-adjustable-base" };
  }
  return {};
}

function resolveExplicitFirmness(query = "") {
  const text = normalizeAskSnoozerText(query);
  if (!text) return "";
  if (/\bmedium\b|\bnot too soft\b|\bnot soft\b/.test(text)) return "Medium";
  if (/\bfirm\b|\bfirmer\b/.test(text)) return "Firm";
  if (/\bsoft\b|\bsofter\b/.test(text)) return "Soft";
  return "";
}

function resolveExplicitPainPoints(query = "") {
  const text = normalizeAskSnoozerText(query);
  const painPoints = [];
  if (/\bshoulder(?:s)?\b/.test(text)) painPoints.push("shoulders");
  if (/\bhip(?:s)?\b/.test(text)) painPoints.push("hips");
  if (/\blower back\b/.test(text)) painPoints.push("lower_back");
  else if (/\bback pain\b|\bmy back hurts\b|\bback soreness\b/.test(text)) painPoints.push("back");
  if (/\bneck\b/.test(text)) painPoints.push("neck");
  return uniqueStrings(painPoints);
}

function extractCurrentProductHandle(context = {}) {
  const candidates = [
    context?.currentProductHandle,
    context?.selection?.mattressHandle,
    context?.selection?.productHandle,
    context?.buildSelection?.mattressHandle,
    context?.buildSelection?.productHandle,
  ];
  for (const candidate of candidates) {
    if (clean(candidate)) return clean(candidate).toLowerCase();
  }
  const pathMatch = clean(context?.path).match(/^\/products\/([^/?#]+)/i);
  return pathMatch ? clean(pathMatch[1]).toLowerCase() : "";
}

function extractCurrentPodProductHandle(context = {}) {
  const podId = normalizePodId(
    context?.podId || context?.pod_id || context?.device?.podId || context?.iotSignals?.currentPod
  );
  const pod = podId ? getPodMap().get(podId) : null;
  if (clean(pod?.mattressHandle)) return clean(pod.mattressHandle).toLowerCase();

  const explore = Array.isArray(context?.explore) ? context.explore : [];
  const productMap = getProductMap();
  const mattress = explore.find((item) => {
    const handle = clean(item?.handle).toLowerCase();
    return productMap.get(handle)?.catalogType === "mattress";
  });
  return clean(mattress?.handle).toLowerCase();
}

function resolveSavedSlotValues(context = {}) {
  const canonical = isObject(context?.canonicalRecommendation)
    ? context.canonicalRecommendation
    : {};
  const assessment = isObject(canonical?.normalizedAssessment)
    ? canonical.normalizedAssessment
    : isObject(context?.assessment?.answers)
      ? context.assessment.answers
      : isObject(context?.assessment)
        ? context.assessment
        : {};

  return {
    size: clean(assessment?.size),
    firmness: clean(assessment?.firmness || assessment?.firmnessPref),
    productHandle: clean(canonical?.primaryMattressHandle).toLowerCase(),
    baseHandle:
      canonical && Object.prototype.hasOwnProperty.call(canonical, "baseHandle")
        ? canonical.baseHandle == null
          ? null
          : clean(canonical.baseHandle).toLowerCase()
        : undefined,
    motionKey: clean(canonical?.motionKey || assessment?.motionKey).toLowerCase(),
  };
}

function normalizeSlotRecord(record, fallbackUpdatedAt = "") {
  if (!isObject(record) || record.value === undefined) return null;
  return {
    value: Array.isArray(record.value) ? uniqueStrings(record.value) : record.value,
    provenance:
      clean(record.provenance) === "current_message"
        ? "current_conversation"
        : clean(record.provenance) || "current_conversation",
    updatedAt: clean(record.updatedAt) || fallbackUpdatedAt || null,
  };
}

function setSlot(slots, slotName, value, provenance, updatedAt) {
  if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) return;
  slots[slotName] = {
    value: Array.isArray(value) ? uniqueStrings(value) : value,
    provenance,
    updatedAt,
  };
}

function getSlotValue(workingMemory, slotName) {
  const record = workingMemory?.slots?.[slotName];
  return isObject(record) ? record.value : undefined;
}

function isPriceLikeQuery(query = "") {
  const text = normalizeAskSnoozerText(query);
  return /\b(?:price|pricing|cost|how much|quote)\b/.test(text);
}

function resolveCommerceScope(query = "", currentGoal = null) {
  const text = normalizeAskSnoozerText(query);
  if (
    isObject(currentGoal) &&
    !/\b(?:full pod|snoozepod|setup|mattress only|base only|mattress (?:and|plus|\+) base)\b/.test(text)
  ) {
    return clean(currentGoal.scope) || "unclear";
  }
  if (/\b(?:full pod|snoozepod|setup)\b/.test(text)) return "full_pod";
  const mentionsMattress = /\b(?:mattress|hybrid|foam|dual comfort)\b/.test(text);
  const mentionsBase = /\b(?:base|platform|storage|motion|adjustable)\b/.test(text);
  if (mentionsMattress && mentionsBase) return "mattress_plus_base";
  if (mentionsBase && !mentionsMattress) return "base_only";
  if (mentionsMattress) return "mattress_only";
  return clean(currentGoal?.scope) || "unclear";
}

function calculatePriceQuoteMissingSlots(goal = {}) {
  if (!isObject(goal) || clean(goal.intent) !== PRICE_GOAL_INTENT) return [];
  const scope = clean(goal.scope) || "unclear";
  const missing = [];
  if (scope !== "base_only" && !clean(goal.productHandle)) missing.push("productHandle");
  if (scope === "base_only" && !clean(goal.baseHandle)) missing.push("baseHandle");
  if (["mattress_plus_base", "full_pod"].includes(scope) && !clean(goal.baseHandle)) {
    missing.push("baseHandle");
  }
  if (!clean(goal.size)) missing.push("size");
  if (
    clean(goal.baseHandle) === "premium-motion-adjustable-base" &&
    !clean(goal.motionKey)
  ) {
    missing.push("motionKey");
  }
  return uniqueStrings(missing);
}

function buildGoalSlotProvenance(slots = {}, goal = {}) {
  const out = {};
  for (const slotName of ["productHandle", "size", "firmness", "baseHandle", "motionKey"]) {
    if (goal[slotName] === undefined || goal[slotName] === "") continue;
    const record = slots[slotName];
    out[slotName] = clean(record?.provenance) || "current_conversation";
  }
  return out;
}

function isContinuablePriceGoal(goal = null) {
  return (
    isObject(goal) &&
    clean(goal.intent) === PRICE_GOAL_INTENT &&
    ACTIVE_GOAL_STATUSES.has(clean(goal.status))
  );
}

function isContextualPriceFragment(query = "", workingMemory = null) {
  if (!isContinuablePriceGoal(workingMemory?.activeGoal)) return false;
  const text = normalizeAskSnoozerText(query);
  if (!text) return false;
  return Boolean(
    isPriceLikeQuery(text) ||
      parseAskSnoozerSizeLabel(text) ||
      resolveExplicitProductHandle(text) ||
      Object.keys(resolveExplicitBaseSelection(text)).length
  );
}

function buildConflicts(slots = {}, saved = {}) {
  const conflicts = [];
  for (const slotName of ["size", "firmness", "productHandle", "baseHandle", "motionKey"]) {
    const record = slots[slotName];
    if (!isObject(record) || !["current_message", "current_conversation"].includes(record.provenance)) {
      continue;
    }
    const savedValue = saved[slotName];
    if (savedValue === undefined || savedValue === "") continue;
    if (JSON.stringify(record.value) === JSON.stringify(savedValue)) continue;
    conflicts.push({
      slot: slotName,
      conversationValue: record.value,
      savedValue,
      durableProfileUpdated: false,
    });
  }
  return conflicts;
}

function applyAskSnoozerWorkingMemory({ query = "", context = {}, now = new Date() } = {}) {
  const updatedAt = nowIso(now);
  const previous = isObject(context?.askSnoozerWorkingMemory)
    ? context.askSnoozerWorkingMemory
    : {};
  const slots = {};
  for (const [slotName, record] of Object.entries(isObject(previous?.slots) ? previous.slots : {})) {
    const normalized = normalizeSlotRecord(record, clean(previous?.updatedAt));
    if (normalized) slots[slotName] = normalized;
  }

  const saved = resolveSavedSlotValues(context);
  for (const slotName of ["size", "firmness", "productHandle", "baseHandle", "motionKey"]) {
    if (slots[slotName] || saved[slotName] === undefined || saved[slotName] === "") continue;
    setSlot(slots, slotName, saved[slotName], "saved_profile", updatedAt);
  }

  const currentProductHandle = extractCurrentProductHandle(context);
  const currentPodProductHandle = extractCurrentPodProductHandle(context);
  if (!slots.productHandle && currentProductHandle) {
    setSlot(slots, "productHandle", currentProductHandle, "current_page", updatedAt);
  } else if (!slots.productHandle && currentPodProductHandle) {
    setSlot(slots, "productHandle", currentPodProductHandle, "current_page", updatedAt);
  }

  const explicitSize = parseAskSnoozerSizeLabel(query);
  const explicitFirmness = resolveExplicitFirmness(query);
  const explicitProductHandle = resolveExplicitProductHandle(query);
  const explicitBase = resolveExplicitBaseSelection(query);
  const explicitPainPoints = resolveExplicitPainPoints(query);

  setSlot(slots, "size", explicitSize, "current_message", updatedAt);
  setSlot(slots, "firmness", explicitFirmness, "current_message", updatedAt);
  setSlot(slots, "productHandle", explicitProductHandle, "current_message", updatedAt);
  if (Object.prototype.hasOwnProperty.call(explicitBase, "baseHandle")) {
    setSlot(slots, "baseHandle", explicitBase.baseHandle, "current_message", updatedAt);
  }
  setSlot(slots, "motionKey", explicitBase.motionKey, "current_message", updatedAt);
  if (
    explicitBase.baseHandle === "premium-motion-adjustable-base" &&
    !explicitBase.motionKey &&
    clean(getSlotValue({ slots }, "motionKey")) === "none"
  ) {
    delete slots.motionKey;
  }
  setSlot(slots, "painPoints", explicitPainPoints, "current_message", updatedAt);

  let activeGoal = isObject(previous?.activeGoal) ? { ...previous.activeGoal } : null;
  const continuesPriceGoal = isContinuablePriceGoal(activeGoal);
  const startsPriceGoal = isPriceLikeQuery(query);
  const updatesPriceGoal =
    startsPriceGoal || isContextualPriceFragment(query, { activeGoal });
  if (updatesPriceGoal) {
    const scope = resolveCommerceScope(query, activeGoal);
    activeGoal = {
      ...(continuesPriceGoal ? activeGoal : {}),
      intent: PRICE_GOAL_INTENT,
      scope,
      productHandle: getSlotValue({ slots }, "productHandle") || null,
      size: getSlotValue({ slots }, "size") || null,
      firmness: getSlotValue({ slots }, "firmness") || null,
      baseHandle:
        getSlotValue({ slots }, "baseHandle") === undefined
          ? null
          : getSlotValue({ slots }, "baseHandle"),
      motionKey: getSlotValue({ slots }, "motionKey") || null,
      currentPodId: clean(context?.podId || context?.pod_id) || null,
      updatedAt,
    };

    const product = getProductMap().get(clean(activeGoal.productHandle).toLowerCase());
    if (
      ["half_split", "full_split"].includes(clean(activeGoal.motionKey)) &&
      product &&
      product?.attributes?.supportsSplitMotion !== true
    ) {
      activeGoal.motionKey = null;
      delete slots.motionKey;
    }

    activeGoal.missingSlots = calculatePriceQuoteMissingSlots(activeGoal);
    activeGoal.status = activeGoal.missingSlots.length ? "collecting_slots" : "ready";
    activeGoal.slotProvenance = buildGoalSlotProvenance(slots, activeGoal);
  }

  const workingMemory = {
    version: WORKING_MEMORY_VERSION,
    turnIndex: Math.max(0, Number(previous?.turnIndex || 0)) + 1,
    slots,
    activeGoal,
    conflicts: buildConflicts(slots, saved),
    updatedAt,
  };

  return {
    ...context,
    askSnoozerWorkingMemory: workingMemory,
  };
}

function completeAskSnoozerPriceGoal(context = {}, { completed = false, now = new Date() } = {}) {
  const memory = isObject(context?.askSnoozerWorkingMemory)
    ? context.askSnoozerWorkingMemory
    : null;
  if (!memory || !isContinuablePriceGoal(memory.activeGoal)) return context;
  const updatedAt = nowIso(now);
  const activeGoal = {
    ...memory.activeGoal,
    status: completed ? "completed" : memory.activeGoal.missingSlots?.length ? "collecting_slots" : "ready",
    updatedAt,
  };
  return {
    ...context,
    askSnoozerWorkingMemory: {
      ...memory,
      activeGoal,
      updatedAt,
    },
  };
}

function resolveRequestedProductHandle(query = "", context = {}) {
  const explicit = resolveExplicitProductHandle(query);
  if (explicit) return explicit;
  const activeGoalHandle = clean(context?.askSnoozerWorkingMemory?.activeGoal?.productHandle).toLowerCase();
  if (activeGoalHandle) return activeGoalHandle;
  const selected = extractCurrentProductHandle(context);
  if (selected) return selected;
  const podProduct = extractCurrentPodProductHandle(context);
  if (podProduct) return podProduct;
  const canonicalHandle = clean(context?.canonicalRecommendation?.primaryMattressHandle).toLowerCase();
  if (canonicalHandle) return canonicalHandle;
  const explore = Array.isArray(context?.explore) ? context.explore : [];
  return clean(explore[0]?.handle).toLowerCase();
}

function buildWorkingMemoryLogMetadata(context = {}) {
  const memory = isObject(context?.askSnoozerWorkingMemory)
    ? context.askSnoozerWorkingMemory
    : {};
  const goal = isObject(memory?.activeGoal) ? memory.activeGoal : {};
  return {
    turnIndex: Number(memory?.turnIndex || 0) || null,
    activeGoalIntent: clean(goal?.intent) || null,
    activeGoalStatus: clean(goal?.status) || null,
    activeGoalSlots: goal?.intent
      ? {
          productHandle: goal.productHandle || null,
          size: goal.size || null,
          firmness: goal.firmness || null,
          baseHandle: goal.baseHandle || null,
          motionKey: goal.motionKey || null,
        }
      : null,
    slotProvenance: isObject(goal?.slotProvenance) ? goal.slotProvenance : {},
    activeGoalMissingSlots: Array.isArray(goal?.missingSlots) ? goal.missingSlots : [],
    sessionConflicts: Array.isArray(memory?.conflicts)
      ? memory.conflicts.map((entry) => clean(entry?.slot)).filter(Boolean)
      : [],
  };
}

function safeResponseFingerprint(value = "") {
  const text = clean(value).toLowerCase();
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

module.exports = {
  PRICE_GOAL_INTENT,
  WORKING_MEMORY_VERSION,
  applyAskSnoozerWorkingMemory,
  buildWorkingMemoryLogMetadata,
  calculatePriceQuoteMissingSlots,
  completeAskSnoozerPriceGoal,
  extractCurrentPodProductHandle,
  extractCurrentProductHandle,
  getSlotValue,
  isContextualPriceFragment,
  isContinuablePriceGoal,
  isPriceLikeQuery,
  resolveExplicitBaseSelection,
  resolveExplicitFirmness,
  resolveExplicitPainPoints,
  resolveExplicitProductHandle,
  resolveRequestedProductHandle,
  safeResponseFingerprint,
};
