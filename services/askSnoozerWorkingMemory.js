const { loadShowroomManifest } = require("./showroomManifest");
const {
  normalizeAskSnoozerText,
  parseAskSnoozerSizeLabel,
} = require("./askSnoozerIntents");

const WORKING_MEMORY_VERSION = 4;
const PRICE_GOAL_INTENT = "price_quote";
const PENDING_COMMITMENT_TTL_MS = 15 * 60 * 1000;
const ACTIVE_GOAL_STATUSES = new Set([
  "collecting_slots",
  "ready",
  "resolving",
  "presented",
  "awaiting_decision",
  "completed",
]);

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

function normalizeHandle(value = "") {
  return clean(value).toLowerCase();
}

function normalizeRejectedProducts(values = []) {
  const byHandle = new Map();
  for (const item of Array.isArray(values) ? values : []) {
    const handle = normalizeHandle(item?.handle || item);
    if (!handle) continue;
    byHandle.set(handle, {
      handle,
      reason: clean(item?.reason) || "other",
      turnId: clean(item?.turnId) || null,
      rejectedAt: clean(item?.rejectedAt) || null,
      reconsideredAt: clean(item?.reconsideredAt) || null,
      status: clean(item?.status) === "reconsidered" ? "reconsidered" : "rejected",
    });
  }
  return Array.from(byHandle.values());
}

function rejectedHandleSet(deal = {}) {
  return new Set(
    normalizeRejectedProducts(deal?.rejectedProducts)
      .filter((item) => item.status === "rejected")
      .map((item) => item.handle)
  );
}

function activePendingCommitment(value, now = new Date()) {
  if (!isObject(value) || clean(value.status || "pending") !== "pending") return null;
  const expiresAt = Date.parse(clean(value.expiresAt));
  if (Number.isFinite(expiresAt) && expiresAt <= new Date(now).getTime()) {
    return { ...value, status: "expired", resolvedAt: nowIso(now) };
  }
  return { ...value, status: "pending" };
}

function resolveFeedbackReason(text = "") {
  if (/\btoo firm\b|\bfelt (?:far )?too firm\b/.test(text)) return "too_firm";
  if (/\btoo soft\b|\bfelt (?:far )?too soft\b/.test(text)) return "too_soft";
  if (/\btoo hot\b|\bslept hot\b|\bmade me hot\b/.test(text)) return "too_hot";
  if (/\buncomfortable\b|\bnot comfortable\b/.test(text)) return "uncomfortable";
  if (/\bdid not like\b|\bdidn.t like\b|\bdon.t like\b|\bdont like\b/.test(text)) return "did_not_like";
  if (/\bnot interested\b|\bdon.t want\b|\bdont want\b/.test(text)) return "not_interested";
  if (/\banything (?:but|except)\b|\bstop (?:telling|showing|recommending)\b|\bdo not show\b|\bdon.t show\b/.test(text)) {
    return "explicit_exclusion";
  }
  return "";
}

function resolveFeedbackSubject(query = "", previousDeal = {}) {
  const explicit = resolveExplicitProductHandle(query);
  if (explicit) return explicit;
  const text = normalizeAskSnoozerText(query);
  if (/\b(?:original one|original mattress|first mattress|first one)\b/.test(text)) {
    return normalizeHandle(
      previousDeal?.canonicalRecommendation?.primaryMattressHandle ||
      previousDeal?.canonicalRecommendation?.productHandle
    );
  }
  const shortReference = /\b(?:it|that one|this one|that mattress|this mattress|the first one)\b/.test(text);
  if (!shortReference && !/\btoo (?:firm|soft|hot)\b|\bdidn.t like\b|\bdid not like\b/.test(text)) return "";
  return normalizeHandle(
    previousDeal?.activeProductHandle ||
      previousDeal?.sessionRecommendation?.productHandle ||
      previousDeal?.recentProductHandle
  );
}

function interpretShopperActs({ query = "", previousDeal = {}, turnIndex = 1, now = new Date() } = {}) {
  const text = normalizeAskSnoozerText(query);
  const turnId = `turn-${Math.max(1, Number(turnIndex) || 1)}`;
  const subjectHandle = resolveFeedbackSubject(query, previousDeal);
  const pending = activePendingCommitment(previousDeal?.pendingCommitment, now);
  const acts = [];
  const add = (type, detail = {}) => acts.push({ type, ...detail });
  const reconsider = /\b(?:actually|again|reconsider|go back|show me|look at)\b.*\b(?:all foam|original (?:one|mattress)|first mattress|first one)\b|\b(?:reconsider|show me)\b.*\bagain\b/.test(text);

  if (reconsider && subjectHandle) {
    add("reconsider_product", { handle: subjectHandle, turnId });
  } else {
    const reason = resolveFeedbackReason(text);
    if (reason && subjectHandle) {
      add("reject_product", { handle: subjectHandle, reason, turnId });
      if (reason === "explicit_exclusion") add("explicit_exclusion", { handle: subjectHandle, turnId });
    }
    if (subjectHandle && ["too_firm", "too_soft", "too_hot", "uncomfortable", "did_not_like"].includes(reason)) {
      add("product_feedback", {
        handle: subjectHandle,
        feedback: reason,
        turnId,
      });
    }
  }

  if (/\b(?:like|liked|prefer|preferred)\b.*\b(?:motion|elevation|adjustable base|raised|head up|feet up)\b/.test(text)) {
    add("retain_preference", { key: "motion", value: "liked", turnId });
    if (subjectHandle) add("product_feedback", { handle: subjectHandle, feedback: "liked_motion", turnId });
  }
  if (/\b(?:did not|didn.t|don.t|dont) like\b.*\b(?:motion|elevation|adjustable base)\b/.test(text)) {
    add("retain_preference", { key: "motion", value: "disliked", turnId });
    if (subjectHandle) add("product_feedback", { handle: subjectHandle, feedback: "disliked_motion", turnId });
  }

  const direction = /\b(?:want|need|looking for|show me|find me)\b.*\bsofter\b|^softer[.!]?$/.test(text)
    ? { key: "feel", value: "softer" }
    : /\b(?:want|need|looking for|show me|find me)\b.*\bfirmer\b|^firmer[.!]?$/.test(text)
      ? { key: "feel", value: "firmer" }
      : /\b(?:want|need|looking for|show me|find me)\b.*\bcooler\b|^cooler[.!]?$/.test(text)
        ? { key: "temperature", value: "cooler" }
        : /\b(?:want|need|looking for|show me|find me)\b.*\b(?:more responsive|more bounce|bouncier)\b/.test(text)
          ? { key: "response", value: "more_responsive" }
          : /\b(?:want|need|looking for|show me|find me)\b.*\b(?:less motion|less movement)\b/.test(text)
            ? { key: "motionTransfer", value: "less_motion" }
            : null;
  if (direction) add("desired_direction", { ...direction, turnId });

  const requestsAlternative = /\b(?:show|find|recommend)\b.*\b(?:something else|another option|another mattress|anything else|any other mattress|alternative|instead)\b|\bwhat (?:else|would you recommend instead)\b|\banything (?:but|except)\b/.test(text) || Boolean(direction);
  if (requestsAlternative) add("request_alternative", { turnId });

  if (/\b(?:stop telling me|stop showing me|stop recommending|you are not listening|you.re not listening|you keep recommending|already said|this is confusing|store isn.t right|store is not right)\b/.test(text)) {
    add("trust_risk", { turnId });
  }
  if (/\b(?:i am|i.m|im) confused\b|\bgetting lost\b|\bwhat am i choosing\b|\bsimplify (?:this|it)\b/.test(text)) {
    add("confusion", { turnId });
  }

  const affirmative = /^(?:yes|yeah|yep|sure|please|do that|show me|go ahead|okay do it|ok do it)[.!]?$/.test(text);
  const negative = /^(?:no|nope|no thanks|not now|don.t do that|dont do that)[.!]?$/.test(text);
  if (pending?.status === "pending" && affirmative) {
    add("accept_commitment", { commitmentId: pending.id, commitmentType: pending.type, turnId });
  } else if (pending?.status === "pending" && negative) {
    add("decline_commitment", { commitmentId: pending.id, commitmentType: pending.type, turnId });
  }

  const explicitProduct = resolveExplicitProductHandle(query);
  const acceptanceCue = /\b(?:i like that one|i like this one|that works|this works|that one feels better|this one feels better|i want that mattress|let(?:'s| us) go with|i(?:'ll| will) take|that(?:'s| is) the one|go with that)\b/.test(text);
  const acceptedHandle = explicitProduct || normalizeHandle(
    previousDeal?.sessionRecommendation?.productHandle || previousDeal?.activeProductHandle
  );
  if (acceptanceCue && acceptedHandle && !/\b(?:motion|base|elevation)\b/.test(text)) {
    add("accept_recommendation", { handle: acceptedHandle, turnId });
  }

  const valueConcern = /\b(?:too expensive|more than i want to spend|over my budget|save money|lower price|cheaper|costs too much)\b/.test(text);
  if (valueConcern) {
    const amount = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/)?.[1];
    add("budget_value", {
      concern: /\b(?:save money|lower price|cheaper)\b/.test(text) ? "save_money" : "price_resistance",
      maxAmount: amount ? Number(amount.replace(/,/g, "")) : null,
      turnId,
    });
  }

  return { acts, subjectHandle: subjectHandle || null, pendingCommitment: pending };
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
  if (/\b(?:no base|mattress[- ]only)\b/.test(text)) {
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
  if (!/\bnot too (?:firm|soft)\b/.test(text) && /\btoo (?:firm|soft)\b|\bfelt (?:far )?too (?:firm|soft)\b/.test(text)) return "";
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
    !/\b(?:full pod|snoozepod|setup|mattress[- ]only|base only|mattress (?:and|plus|\+) base)\b/.test(text)
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
  if (isPriceLikeQuery(text)) return true;

  const words = text.split(/\s+/).filter(Boolean);
  const isTerseFragment =
    words.length <= 7 || /^(?:make that|switch(?: it)? to|change(?: it)? to|go with|what about with)\b/.test(text);
  if (!isTerseFragment) return false;

  return Boolean(
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

function normalizeCanonicalRecommendation(context = {}, previousDeal = {}) {
  const canonical = isObject(context?.canonicalRecommendation)
    ? context.canonicalRecommendation
    : isObject(previousDeal?.canonicalRecommendation)
      ? previousDeal.canonicalRecommendation
      : null;
  if (!canonical) return null;
  return {
    topPodId: clean(canonical.topPodId) || null,
    primaryMattressHandle: clean(canonical.primaryMattressHandle).toLowerCase() || null,
    baseHandle:
      canonical.baseHandle == null ? null : clean(canonical.baseHandle).toLowerCase() || null,
    motionKey: clean(canonical.motionKey).toLowerCase() || "none",
    manifestVersion: clean(canonical.manifestVersion) || null,
  };
}

function inferConversationTopic(query = "", previousTopic = "") {
  const text = normalizeAskSnoozerText(query);
  if (/\b(?:cart|add to cart|in my cart)\b/.test(text)) return "cart";
  if (/\b(?:compatible|compatibility|work together|make sense together|pair together)\b/.test(text)) {
    return "compatibility";
  }
  if (/\b(?:price|cost|how much|quote|save|savings)\b/.test(text)) return "pricing";
  if (/\b(?:adjustable base|motion|elevation|head and foot|head or foot)\b/.test(text)) return "motion";
  if (/\b(?:compare|versus|\bvs\b|which one)\b/.test(text)) return "comparison";
  if (/\b(?:recommend|try first|best for me)\b/.test(text)) return "recommendation";
  if (/\b(?:feel|notice|pressure|shoulder|hip|soft|medium|firm|comfort)\b/.test(text)) return "comfort";
  return clean(previousTopic) || "discovery";
}

function inferBuyingStage(query = "", previousStage = "exploring") {
  const text = normalizeAskSnoozerText(query);
  if (/\b(?:add|put)\b.*\bcart\b|\bready to (?:buy|order)\b/.test(text)) return "ready";
  if (/\b(?:need|worth|save|better value|more expensive)\b/.test(text)) return "evaluating_value";
  if (/\b(?:price|cost|quote|setup|compatible|motion|base)\b/.test(text)) return "configuring";
  if (/\b(?:compare|versus|\bvs\b|which one)\b/.test(text)) return "comparing";
  if (/\b(?:recommend|try first|tell me more|notice)\b/.test(text)) return "narrowing";
  return clean(previousStage) || "exploring";
}

function inferObjection(query = "") {
  const text = normalizeAskSnoozerText(query);
  if (/\b(?:sag|sagging|body impression|wear out|durability|hold up)\b/.test(text)) return "durability";
  if (/\b(?:not sure|uncertain|do i need|worth it|save the money)\b.*\b(?:motion|base)\b/.test(text)) {
    return "base_value";
  }
  if (/\b(?:save the money|need the|worth it|too expensive|more expensive)\b/.test(text)) {
    return "value";
  }
  if (/\b(?:not sure|uncertain|confused)\b/.test(text)) return "uncertainty";
  return null;
}

function inferDecision(query = "", previous = null) {
  const text = normalizeAskSnoozerText(query);
  if (/\b(?:not sure|uncertain)\b.*\b(?:motion|base)\b/.test(text)) {
    return { ...(isObject(previous) ? previous : {}), adjustableBase: "undecided" };
  }
  if (/\b(?:did not|didn.t) notice.*(?:elevation|base|motion)\b/.test(text)) {
    return { ...(isObject(previous) ? previous : {}), adjustableBase: "skip" };
  }
  if (/\b(?:liked|prefer|want).*(?:elevation|elevated|head up|feet up|raised)\b/.test(text)) {
    return { ...(isObject(previous) ? previous : {}), adjustableBase: "keep", elevation: "liked" };
  }
  const firmness = resolveExplicitFirmness(query);
  if (firmness) return { ...(isObject(previous) ? previous : {}), firmness };
  return isObject(previous) ? previous : null;
}

function resolveAdaptiveSessionRecommendation(deal = {}) {
  const manifest = loadShowroomManifest() || {};
  const rejected = rejectedHandleSet(deal);
  const desired = isObject(deal?.desiredDirection) ? deal.desiredDirection : {};
  const retained = isObject(deal?.retainedPreferences) ? deal.retainedPreferences : {};
  const feedback = isObject(deal?.productFeedback) ? deal.productFeedback : {};
  const canonicalHandle = normalizeHandle(
    deal?.canonicalRecommendation?.primaryMattressHandle || deal?.canonicalRecommendation?.productHandle
  );
  const size = clean(deal?.activeSize);
  const motionKey = clean(deal?.activeMotionKey);
  const budgetContext = isObject(deal?.budgetContext) ? deal.budgetContext : {};
  const restTestObservations = Array.isArray(deal?.restTestObservations) ? deal.restTestObservations : [];
  const liveAvailabilityRequired = deal?.liveAvailabilityRequired === true;
  const availableProductHandles = new Set(
    uniqueStrings(deal?.availableProductHandles || []).map(normalizeHandle)
  );
  const podsByProduct = new Map();
  for (const pod of Array.isArray(manifest.pods) ? manifest.pods : []) {
    const handle = normalizeHandle(pod?.mattressHandle);
    if (handle && !podsByProduct.has(handle)) podsByProduct.set(handle, []);
    if (handle) podsByProduct.get(handle).push(pod);
  }
  const excludedCandidates = [];
  const unknowns = [];
  const candidates = [];

  for (const product of Array.isArray(manifest.products) ? manifest.products : []) {
    const handle = normalizeHandle(product?.handle);
    if (clean(product?.catalogType) !== "mattress" || !handle) continue;
    let exclusionReason = "";
    if (product?.active === false) exclusionReason = "inactive";
    else if (product?.recommendable === false) exclusionReason = "not_recommendable";
    else if (rejected.has(handle)) exclusionReason = "shopper_rejected";
    else if (liveAvailabilityRequired && availableProductHandles.size && !availableProductHandles.has(handle)) {
      exclusionReason = "live_unavailable";
    }
    const pods = podsByProduct.get(handle) || [];
    const eligibleSizes = uniqueStrings(pods.flatMap((pod) => pod?.eligibility?.sizes || []));
    if (!exclusionReason && size && eligibleSizes.length && !eligibleSizes.includes(size)) exclusionReason = "size_incompatible";
    if (!exclusionReason && ["half_split", "full_split"].includes(motionKey) && product?.attributes?.supportsSplitMotion !== true) {
      exclusionReason = "motion_incompatible";
    }
    if (exclusionReason) {
      excludedCandidates.push({ handle, reason: exclusionReason });
      continue;
    }

    const reasons = [];
    let score = 0;
    const addReason = (code, points, evidence) => {
      score += points;
      reasons.push({ code, points, evidence });
    };
    if (handle === canonicalHandle) addReason("assessment_baseline", 1, "assessment");
    if (retained?.motion?.value === "liked") {
      const supportsRequestedMotion = ["half_split", "full_split"].includes(motionKey)
        ? product?.attributes?.supportsSplitMotion === true
        : true;
      if (supportsRequestedMotion) addReason("retains_motion_preference", product?.attributes?.supportsSplitMotion ? 5 : 2, "shopper_preference");
    }
    if (desired?.temperature === "cooler" && product?.attributes?.cooling === true) addReason("cooling_direction", 4, "product_fact");
    if (desired?.response === "more_responsive" && /hybrid/.test(handle)) addReason("responsive_hybrid_direction", 4, "product_fact");
    if (desired?.feel === "softer" && product?.attributes?.dualComfort === true) addReason("softer_side_available", 5, "showroom_configuration");
    if (desired?.feel === "firmer" && (/hybrid/.test(handle) || product?.attributes?.dualComfort === true)) addReason("firmer_support_option", 3, "showroom_configuration");
    if (desired?.motionTransfer === "less_motion" && /all-foam/.test(handle)) addReason("lower_motion_transfer_direction", 3, "product_family");
    if (/hybrid/.test(handle)) addReason("hybrid_alternative", 1, "product_family");
    if (product?.attributes?.preferredForPartnerSleep === true) addReason("partner_friendly", 2, "product_fact");
    const observations = Array.isArray(feedback?.[handle]?.observations) ? feedback[handle].observations : [];
    if (observations.includes("liked_feel")) addReason("liked_during_visit", 7, "shopper_feedback");
    if (restTestObservations.some((item) => normalizeHandle(item?.productHandle) === handle && item?.sentiment === "positive")) {
      addReason("positive_rest_test", 8, "rest_test");
    }
    if (budgetContext.concern && !Number.isFinite(Number(budgetContext.maxAmount))) unknowns.push("live_price_comparison_required");
    candidates.push({ handle, title: clean(product?.title) || handle, score, reasons });
  }

  candidates.sort((a, b) => b.score - a.score || a.handle.localeCompare(b.handle));
  if (liveAvailabilityRequired && !availableProductHandles.size) {
    unknowns.push("live_availability_required");
  }
  const top = candidates[0] || null;
  return {
    version: 1,
    sessionRecommendation: top
      ? { productHandle: top.handle, score: top.score, reasons: top.reasons, source: "adaptive_session_recommendation" }
      : null,
    rankedAlternatives: candidates,
    recommendationReasons: top?.reasons || [],
    excludedCandidates,
    unknowns: uniqueStrings(unknowns),
    eligibleCandidateHandles: candidates.map((candidate) => candidate.handle),
  };
}

function eligibleAlternativeHandles(deal = {}) {
  return resolveAdaptiveSessionRecommendation(deal).eligibleCandidateHandles;
}

function invalidateQuoteForRejectedProduct(quote, rejected) {
  if (!isObject(quote) || !rejected?.size) return quote || null;
  const quoteHandles = uniqueStrings([
    quote.productHandle,
    ...(Array.isArray(quote.items) ? quote.items.map((item) => item?.handle) : []),
  ]).map(normalizeHandle);
  const rejectedQuoteHandle = quoteHandles.find((handle) => rejected.has(handle));
  if (!rejectedQuoteHandle) return quote;
  return {
    ...quote,
    ok: false,
    cartReady: false,
    status: "invalidated",
    invalidationReason: "product_rejected",
    invalidatedProductHandle: rejectedQuoteHandle,
  };
}

function reduceShopperFeedbackState({ query = "", previousDeal = {}, baseDeal = {}, turnIndex = 1, now = new Date() } = {}) {
  const updatedAt = nowIso(now);
  const interpretation = interpretShopperActs({ query, previousDeal, turnIndex, now });
  const acts = interpretation.acts;
  const before = {
    activeProductHandle: normalizeHandle(previousDeal?.activeProductHandle) || null,
    rejectedProductHandles: Array.from(rejectedHandleSet(previousDeal)),
    sessionRecommendationHandle: normalizeHandle(previousDeal?.sessionRecommendation?.productHandle) || null,
    quoteStatus: clean(previousDeal?.activeQuote?.status) || (previousDeal?.activeQuote?.cartReady ? "ready" : null),
    pendingCommitment: clean(previousDeal?.pendingCommitment?.type) || null,
  };
  let rejectedProducts = normalizeRejectedProducts(previousDeal?.rejectedProducts);
  const productFeedback = isObject(previousDeal?.productFeedback) ? { ...previousDeal.productFeedback } : {};
  const retainedPreferences = isObject(previousDeal?.retainedPreferences) ? { ...previousDeal.retainedPreferences } : {};
  const desiredDirection = isObject(previousDeal?.desiredDirection) ? { ...previousDeal.desiredDirection } : {};
  let budgetContext = isObject(previousDeal?.budgetContext) ? { ...previousDeal.budgetContext } : {};
  let acceptedRecommendation = isObject(previousDeal?.acceptedRecommendation) ? { ...previousDeal.acceptedRecommendation } : null;
  let activeConfiguration = isObject(previousDeal?.activeConfiguration) ? { ...previousDeal.activeConfiguration } : {};
  let pendingCommitment = interpretation.pendingCommitment || null;
  let sessionRecommendation = isObject(previousDeal?.sessionRecommendation)
    ? { ...previousDeal.sessionRecommendation }
    : null;

  for (const act of acts) {
    if (act.type === "reconsider_product") {
      rejectedProducts = rejectedProducts.map((item) =>
        item.handle === act.handle
          ? { ...item, status: "reconsidered", reconsideredAt: updatedAt }
          : item
      );
      sessionRecommendation = {
        productHandle: act.handle,
        source: "shopper_reconsideration",
        reason: "explicit_reconsideration",
        updatedAt,
      };
    }
    if (act.type === "reject_product") {
      const existing = rejectedProducts.find((item) => item.handle === act.handle);
      const next = {
        ...(existing || {}),
        handle: act.handle,
        reason: act.reason || existing?.reason || "other",
        turnId: act.turnId,
        rejectedAt: updatedAt,
        reconsideredAt: null,
        status: "rejected",
      };
      rejectedProducts = rejectedProducts.filter((item) => item.handle !== act.handle).concat(next);
      if (sessionRecommendation?.productHandle === act.handle) sessionRecommendation = null;
    }
    if (act.type === "product_feedback") {
      const existing = isObject(productFeedback[act.handle]) ? productFeedback[act.handle] : {};
      const observations = uniqueStrings([...(existing.observations || []), act.feedback]);
      productFeedback[act.handle] = {
        ...existing,
        feel: ["too_firm", "too_soft", "uncomfortable"].includes(act.feedback) ? act.feedback : existing.feel || null,
        temperature: act.feedback === "too_hot" ? "too_hot" : existing.temperature || null,
        motion: act.feedback === "liked_motion" ? "liked" : act.feedback === "disliked_motion" ? "disliked" : existing.motion || null,
        sentiment: act.feedback === "did_not_like" ? "disliked" : existing.sentiment || null,
        observations,
        updatedAt,
        turnId: act.turnId,
      };
    }
    if (act.type === "retain_preference") {
      retainedPreferences[act.key] = { value: act.value, updatedAt, turnId: act.turnId };
    }
    if (act.type === "desired_direction") {
      desiredDirection[act.key] = act.value;
    }
    if (act.type === "budget_value") {
      budgetContext = {
        concern: act.concern,
        maxAmount: Number.isFinite(Number(act.maxAmount)) ? Number(act.maxAmount) : budgetContext.maxAmount || null,
        updatedAt,
        turnId: act.turnId,
      };
    }
    if (act.type === "accept_recommendation") {
      acceptedRecommendation = { productHandle: act.handle, acceptedAt: updatedAt, turnId: act.turnId };
      activeConfiguration = {
        ...activeConfiguration,
        productHandle: act.handle,
        size: baseDeal?.activeSize || activeConfiguration.size || null,
        baseHandle: baseDeal?.activeBaseHandle ?? activeConfiguration.baseHandle ?? null,
        motionKey: baseDeal?.activeMotionKey || activeConfiguration.motionKey || null,
        status: "accepted",
        updatedAt,
      };
    }
    if (act.type === "accept_commitment" && pendingCommitment?.id === act.commitmentId) {
      pendingCommitment = { ...pendingCommitment, status: "fulfilled", resolvedAt: updatedAt };
      const constraints = isObject(pendingCommitment?.payload?.constraints)
        ? pendingCommitment.payload.constraints
        : {};
      Object.assign(desiredDirection, constraints.desiredDirection || {});
      Object.assign(retainedPreferences, constraints.retainedPreferences || {});
    }
    if (act.type === "decline_commitment" && pendingCommitment?.id === act.commitmentId) {
      pendingCommitment = { ...pendingCommitment, status: "declined", resolvedAt: updatedAt };
    }
  }

  const rejected = new Set(rejectedProducts.filter((item) => item.status === "rejected").map((item) => item.handle));
  const explicitReconsider = acts.find((act) => act.type === "reconsider_product")?.handle || null;
  const wantsAlternative = acts.some((act) => act.type === "request_alternative") ||
    acts.some((act) => act.type === "accept_commitment" && act.commitmentType === "find_alternative");
  const candidateDeal = {
    ...baseDeal,
    rejectedProducts,
    productFeedback,
    retainedPreferences,
    desiredDirection,
    budgetContext,
    restTestObservations: previousDeal?.restTestObservations || baseDeal?.restTestObservations || [],
  };
  const adaptiveRecommendation = resolveAdaptiveSessionRecommendation(candidateDeal);
  const alternatives = adaptiveRecommendation.eligibleCandidateHandles;
  if (wantsAlternative && alternatives.length) {
    sessionRecommendation = {
      ...adaptiveRecommendation.sessionRecommendation,
      reason: clean(desiredDirection.feel || desiredDirection.temperature || desiredDirection.response || "eligible_alternative"),
      alternatives: adaptiveRecommendation.rankedAlternatives,
      updatedAt,
    };
  }

  let activeProductHandle = normalizeHandle(baseDeal?.activeProductHandle) || null;
  if (activeProductHandle && rejected.has(activeProductHandle)) activeProductHandle = null;
  const acceptedProductHandle = acts.find((act) => act.type === "accept_recommendation")?.handle || null;
  if (explicitReconsider) activeProductHandle = explicitReconsider;
  else if (acceptedProductHandle) activeProductHandle = acceptedProductHandle;
  else if (wantsAlternative && sessionRecommendation?.productHandle) activeProductHandle = sessionRecommendation.productHandle;
  if (sessionRecommendation?.productHandle && rejected.has(sessionRecommendation.productHandle)) sessionRecommendation = null;
  if (acceptedRecommendation?.productHandle && rejected.has(acceptedRecommendation.productHandle)) {
    acceptedRecommendation = null;
    activeConfiguration = {
      ...activeConfiguration,
      productHandle: null,
      status: "invalidated",
      invalidationReason: "product_rejected",
      updatedAt,
    };
  }

  const acceptedHandle = normalizeHandle(acceptedRecommendation?.productHandle);
  const acceptedProduct = acceptedHandle ? getProductMap().get(acceptedHandle) : null;
  let configurationInvalidation = null;
  if (
    acceptedProduct &&
    ["half_split", "full_split"].includes(clean(activeConfiguration.motionKey || baseDeal?.activeMotionKey)) &&
    acceptedProduct?.attributes?.supportsSplitMotion !== true
  ) {
    configurationInvalidation = {
      reason: "motion_incompatible_with_accepted_product",
      cleared: ["motionKey", "baseHandle"],
      preserved: ["productHandle", "size"],
      updatedAt,
    };
    activeConfiguration = { ...activeConfiguration, motionKey: null, baseHandle: null, updatedAt };
  }

  const comparisonProductHandles = uniqueStrings(baseDeal?.comparisonProductHandles || [])
    .map(normalizeHandle)
    .filter((handle) => !rejected.has(handle));
  const activeQuote = invalidateQuoteForRejectedProduct(baseDeal?.activeQuote, rejected);
  if (activeQuote?.status === "invalidated" && !activeQuote.invalidatedAt) activeQuote.invalidatedAt = updatedAt;

  if (
    pendingCommitment?.status === "pending" &&
    acts.length &&
    !acts.some((act) => ["accept_commitment", "decline_commitment"].includes(act.type)) &&
    !acts.some((act) => act.type === "product_feedback" && acts.length === 1)
  ) {
    pendingCommitment = { ...pendingCommitment, status: "superseded", resolvedAt: updatedAt };
  }

  const activeDeal = {
    ...baseDeal,
    activeProductHandle,
    recentProductHandle:
      acts.find((act) => act.type === "reject_product")?.handle ||
      baseDeal?.recentProductHandle ||
      null,
    comparisonProductHandles,
    activeQuote,
    rejectedProducts,
    productFeedback,
    retainedPreferences,
    desiredDirection,
    budgetContext,
    sessionRecommendation,
    adaptiveRecommendation,
    rankedAlternatives: adaptiveRecommendation.rankedAlternatives,
    recommendationReasons: adaptiveRecommendation.recommendationReasons,
    excludedCandidates: adaptiveRecommendation.excludedCandidates,
    recommendationUnknowns: adaptiveRecommendation.unknowns,
    acceptedRecommendation,
    activeConfiguration,
    configurationInvalidation,
    eligibleAlternativeHandles: alternatives,
    pendingCommitment,
  };
  const after = {
    activeProductHandle: activeDeal.activeProductHandle || null,
    rejectedProductHandles: Array.from(rejected),
    sessionRecommendationHandle: normalizeHandle(sessionRecommendation?.productHandle) || null,
    quoteStatus: clean(activeQuote?.status) || (activeQuote?.cartReady ? "ready" : null),
    pendingCommitment: clean(pendingCommitment?.type) || null,
    pendingCommitmentStatus: clean(pendingCommitment?.status) || null,
  };
  const stateDelta = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) stateDelta[key] = after[key];
  }
  return {
    activeDeal,
    interpretedActs: acts,
    transition: { turnId: `turn-${turnIndex}`, stateBefore: before, stateDelta, stateAfter: after, updatedAt },
  };
}

function buildActiveDeal({ query = "", context = {}, previous = {}, slots = {}, updatedAt = "" } = {}) {
  const previousDeal = isObject(previous?.activeDeal) ? previous.activeDeal : {};
  const canonicalRecommendation = normalizeCanonicalRecommendation(context, previousDeal);
  const canonicalHandle = clean(canonicalRecommendation?.primaryMattressHandle).toLowerCase();
  const explicitProductHandle = resolveExplicitProductHandle(query);
  const text = normalizeAskSnoozerText(query);
  const referencesCanonical = /\b(?:original recommendation|originally recommend|first recommendation|what did (?:the assessment|you originally|you) recommend)\b/.test(text);
  const previousActive = clean(previousDeal.activeProductHandle).toLowerCase();
  const previousRecent = clean(previousDeal.recentProductHandle).toLowerCase();
  let activeProductHandle = previousActive || canonicalHandle || null;
  let recentProductHandle = previousRecent || null;
  if (explicitProductHandle && explicitProductHandle !== previousActive) {
    recentProductHandle = previousActive || previousRecent || null;
    activeProductHandle = explicitProductHandle;
  } else if (referencesCanonical && canonicalHandle) {
    if (previousActive && previousActive !== canonicalHandle) recentProductHandle = previousActive;
    activeProductHandle = canonicalHandle;
  }

  let comparisonProductHandles = uniqueStrings(previousDeal.comparisonProductHandles || []);
  if (/\b(?:compare|versus|\bvs\b|which one)\b/.test(text)) {
    comparisonProductHandles = uniqueStrings([
      ...comparisonProductHandles,
      previousActive,
      explicitProductHandle,
      canonicalHandle,
    ]).slice(-2);
  }

  const explicitBase = resolveExplicitBaseSelection(query);
  const currentTopic = inferConversationTopic(query, previousDeal.currentTopic);
  const size = getSlotValue({ slots }, "size") || previousDeal.activeSize || null;
  const baseHandle = Object.prototype.hasOwnProperty.call(explicitBase, "baseHandle")
    ? explicitBase.baseHandle
    : previousDeal.activeBaseHandle ?? null;
  const recentBaseHandle = Object.prototype.hasOwnProperty.call(explicitBase, "baseHandle") &&
    explicitBase.baseHandle !== previousDeal.activeBaseHandle
      ? previousDeal.activeBaseHandle || previousDeal.recentBaseHandle || null
      : previousDeal.recentBaseHandle || null;
  const motionKey = explicitBase.motionKey || previousDeal.activeMotionKey || null;
  const stage = inferBuyingStage(query, previousDeal.stage);

  return {
    stage,
    goal: stage === "ready" ? "complete_configuration" : "advance_decision",
    canonicalRecommendation,
    activeProductHandle: activeProductHandle || null,
    recentProductHandle: recentProductHandle || null,
    comparisonProductHandles,
    activeSize: size,
    activeBaseHandle: baseHandle,
    recentBaseHandle,
    activeMotionKey: motionKey,
    restTestObservations: Array.isArray(previousDeal.restTestObservations)
      ? previousDeal.restTestObservations
      : Array.isArray(context?.restTest?.observations)
        ? context.restTest.observations
        : [],
    baseDecision:
      /\b(?:not sure|uncertain)\b.*\b(?:motion|base)\b/.test(text)
        ? "undecided"
        : explicitBase.explicitNoBase
          ? "skip"
          : clean(previousDeal.baseDecision) || null,
    activeQuote: isObject(previousDeal.activeQuote) ? previousDeal.activeQuote : null,
    compatibilityStatus: clean(previousDeal.compatibilityStatus) || "unknown",
    currentTopic,
    currentSubtopic:
      currentTopic === "comfort" && resolveExplicitPainPoints(query).length
        ? "pressure_points"
        : clean(previousDeal.currentSubtopic) || null,
    objection: inferObjection(query),
    decision: inferDecision(query, previousDeal.decision),
    missingInformation: [],
    lastAnsweredQuestionType: clean(previousDeal.lastAnsweredQuestionType) || null,
    lastProbe: clean(previousDeal.lastProbe) || null,
    nextAction: clean(previousDeal.nextAction) || null,
    updatedAt,
  };
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

  const parsedSize = parseAskSnoozerSizeLabel(query);
  const explicitSize =
    parsedSize === "Full" && /\b(?:full|complete|whole) setup\b/.test(normalizeAskSnoozerText(query))
      ? ""
      : parsedSize;
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

  const turnIndex = Math.max(0, Number(previous?.turnIndex || 0)) + 1;
  const baseDeal = buildActiveDeal({ query, context, previous, slots, updatedAt });
  const feedbackTransition = reduceShopperFeedbackState({
    query,
    previousDeal: isObject(previous?.activeDeal) ? previous.activeDeal : {},
    baseDeal,
    turnIndex,
    now,
  });
  const rejected = rejectedHandleSet(feedbackTransition.activeDeal);
  const rejectedGoalHandle = normalizeHandle(activeGoal?.productHandle);
  if (activeGoal && rejectedGoalHandle && rejected.has(rejectedGoalHandle)) {
    activeGoal = {
      ...activeGoal,
      status: "invalidated",
      invalidationReason: "product_rejected",
      invalidatedProductHandle: rejectedGoalHandle,
      updatedAt,
    };
  }
  const slotProductHandle = normalizeHandle(getSlotValue({ slots }, "productHandle"));
  if (slotProductHandle && rejected.has(slotProductHandle)) delete slots.productHandle;
  const sessionHandle = normalizeHandle(feedbackTransition.activeDeal?.sessionRecommendation?.productHandle);
  if (sessionHandle && !rejected.has(sessionHandle)) {
    setSlot(slots, "productHandle", sessionHandle, "session_recommendation", updatedAt);
  }

  const workingMemory = {
    version: WORKING_MEMORY_VERSION,
    turnIndex,
    slots,
    activeGoal,
    activeDeal: feedbackTransition.activeDeal,
    conversationFocus: {
      topic: inferConversationTopic(query, previous?.conversationFocus?.topic),
      relevantTurns: (Array.isArray(context?.recentConversation)
        ? context.recentConversation
        : Array.isArray(previous?.conversationFocus?.relevantTurns)
          ? previous.conversationFocus.relevantTurns
          : []
      ).slice(-6),
      updatedAt,
    },
    conflicts: buildConflicts(slots, saved),
    lastTransition: {
      ...feedbackTransition.transition,
      interpretedActs: feedbackTransition.interpretedActs,
    },
    updatedAt,
  };

  return {
    ...context,
    askSnoozerWorkingMemory: workingMemory,
  };
}

function buildPendingCommitmentFromOutcome(previousDeal = {}, outcome = {}, updatedAt = "") {
  const plan = isObject(outcome?.plan) ? outcome.plan : {};
  const existing = isObject(previousDeal?.pendingCommitment) ? previousDeal.pendingCommitment : null;
  if (["commitment_declined", "reconsider_product", "commitment_resolution"].includes(clean(plan.taskType))) {
    return existing;
  }
  const visibleOffer = [
    clean(outcome?.probe),
    clean(outcome?.reply),
    ...(Array.isArray(outcome?.chips) ? outcome.chips.flatMap((chip) => [clean(chip?.label), clean(chip?.value)]) : []),
  ].join(" ").toLowerCase();
  const shouldOfferAlternative =
    ["shopper_feedback", "trust_recovery"].includes(clean(plan.taskType)) &&
    /(?:find|show|recommend|compare).*(?:softer|alternative|another mattress|another option)/.test(visibleOffer);
  const shouldOfferComparison = clean(plan.taskType) === "alternative_resolution" &&
    /compare.*(?:eligible|option|alternative)/.test(visibleOffer);
  if (!shouldOfferAlternative && !shouldOfferComparison) return existing;
  const createdMs = Date.parse(updatedAt) || Date.now();
  return {
    id: `commitment-${Math.max(1, Number(outcome?.turnIndex || 0) || createdMs)}`,
    type: shouldOfferAlternative ? "find_alternative" : "compare_products",
    payload: {
      constraints: {
        exclude: Array.from(rejectedHandleSet(previousDeal)),
        desiredDirection: isObject(previousDeal?.desiredDirection) ? previousDeal.desiredDirection : {},
        retainedPreferences: isObject(previousDeal?.retainedPreferences) ? previousDeal.retainedPreferences : {},
      },
    },
    offeredOptions: ["yes", "no"],
    createdAt: updatedAt,
    expiresAt: new Date(createdMs + PENDING_COMMITMENT_TTL_MS).toISOString(),
    status: "pending",
  };
}

function completeAskSnoozerAdvisorTurn(context = {}, outcome = {}, { now = new Date() } = {}) {
  const memory = isObject(context?.askSnoozerWorkingMemory)
    ? context.askSnoozerWorkingMemory
    : null;
  if (!memory) return context;
  const updatedAt = nowIso(now);
  const previousDeal = isObject(memory.activeDeal) ? memory.activeDeal : {};
  const plan = isObject(outcome.plan) ? outcome.plan : {};
  const quote = isObject(outcome.quote) ? outcome.quote : null;
  const incompatibilityPresented = clean(quote?.compatibility?.status) === "incompatible";
  const commercialResultPresented = Boolean(
    quote &&
      (quote.ok || incompatibilityPresented) &&
      ["price_quote", "bundle_quote", "savings_quote", "compatibility", "cart_add"].includes(
        clean(plan.taskType)
      )
  );
  const quoteChangesBase = Boolean(
    quote &&
    Object.prototype.hasOwnProperty.call(quote, "baseHandle") &&
    quote.baseHandle !== previousDeal.activeBaseHandle
  );
  const rejected = rejectedHandleSet(previousDeal);
  const requestedHandle = normalizeHandle(plan?.references?.requestedProductHandle);
  const acceptedHandle = normalizeHandle(previousDeal?.acceptedRecommendation?.productHandle);
  const resolvedActiveHandle = acceptedHandle && !rejected.has(acceptedHandle)
    ? acceptedHandle
    : requestedHandle && !rejected.has(requestedHandle)
      ? requestedHandle
      : normalizeHandle(previousDeal.activeProductHandle) || null;
  const pendingCommitment = buildPendingCommitmentFromOutcome(previousDeal, outcome, updatedAt);
  const nextActiveQuote = quote?.ok
    ? quote
    : incompatibilityPresented && previousDeal.activeQuote
      ? {
          ...previousDeal.activeQuote,
          ok: false,
          cartReady: false,
          status: "invalidated",
          invalidationReason: "configuration_incompatible",
          invalidatedAt: updatedAt,
        }
      : previousDeal.activeQuote || null;
  const nextConfiguration = {
    ...(isObject(previousDeal.activeConfiguration) ? previousDeal.activeConfiguration : {}),
    productHandle: resolvedActiveHandle,
    size: quote?.size || plan?.knownFacts?.size || previousDeal.activeSize || null,
    baseHandle: incompatibilityPresented
      ? null
      : quote && Object.prototype.hasOwnProperty.call(quote, "baseHandle")
        ? quote.baseHandle
        : previousDeal.activeBaseHandle ?? null,
    motionKey: incompatibilityPresented
      ? null
      : quote?.motionKey || plan?.knownFacts?.motionKey || previousDeal.activeMotionKey || null,
    updatedAt,
  };
  const activeDeal = {
    ...previousDeal,
    stage: clean(plan.stage) || previousDeal.stage || "exploring",
    activeProductHandle: resolvedActiveHandle,
    comparisonProductHandles: uniqueStrings(
      plan?.references?.comparisonProductHandles || previousDeal.comparisonProductHandles || []
    ),
    activeSize: quote?.size || plan?.knownFacts?.size || previousDeal.activeSize || null,
    activeBaseHandle:
      quote && Object.prototype.hasOwnProperty.call(quote, "baseHandle")
        ? quote.baseHandle
        : previousDeal.activeBaseHandle ?? null,
    recentBaseHandle: quoteChangesBase
      ? previousDeal.activeBaseHandle || previousDeal.recentBaseHandle || null
      : previousDeal.recentBaseHandle || null,
    activeMotionKey: quote?.motionKey || plan?.knownFacts?.motionKey || previousDeal.activeMotionKey || null,
    activeQuote: nextActiveQuote,
    activeConfiguration: nextConfiguration,
    configurationInvalidation: incompatibilityPresented
      ? {
          reason: "configuration_incompatible",
          cleared: ["baseHandle", "motionKey"],
          preserved: ["productHandle", "size"],
          updatedAt,
        }
      : previousDeal.configurationInvalidation || null,
    compatibilityStatus:
      quote?.compatibility?.status || previousDeal.compatibilityStatus || "unknown",
    lastAnsweredQuestionType: clean(plan.taskType) || previousDeal.lastAnsweredQuestionType || null,
    lastProbe: clean(plan.probe) || null,
    nextAction:
      Array.isArray(outcome.actions) && outcome.actions.length
        ? clean(outcome.actions[0]?.type)
        : Array.isArray(outcome.chips) && outcome.chips.length
          ? clean(outcome.chips[0]?.value)
          : null,
    pendingCommitment,
    missingInformation: Array.isArray(plan.neededFacts) ? plan.neededFacts : [],
    updatedAt,
  };
  return {
    ...context,
    askSnoozerWorkingMemory: {
      ...memory,
      activeGoal:
        commercialResultPresented &&
        isObject(memory.activeGoal) &&
        memory.activeGoal.intent === PRICE_GOAL_INTENT
          ? {
              ...memory.activeGoal,
              productHandle: quote?.productHandle || memory.activeGoal.productHandle || null,
              size: quote?.size || memory.activeGoal.size || null,
              baseHandle:
                quote && Object.prototype.hasOwnProperty.call(quote, "baseHandle")
                  ? quote.baseHandle
                  : memory.activeGoal.baseHandle ?? null,
              motionKey: quote?.motionKey || memory.activeGoal.motionKey || null,
              missingSlots: [],
              status: "awaiting_decision",
              updatedAt,
            }
          : plan.commercialCompletionAttempted &&
              isObject(memory.activeGoal) &&
              memory.activeGoal.intent === PRICE_GOAL_INTENT &&
              memory.activeGoal.status === "resolving"
            ? {
                ...memory.activeGoal,
                status: "ready",
                updatedAt,
              }
          : memory.activeGoal,
      activeDeal,
      lastPlan: plan,
      updatedAt,
    },
  };
}

function markAskSnoozerPriceGoalResolving(context = {}, { now = new Date() } = {}) {
  const memory = isObject(context?.askSnoozerWorkingMemory)
    ? context.askSnoozerWorkingMemory
    : null;
  const activeGoal = isObject(memory?.activeGoal) ? memory.activeGoal : null;
  if (
    !memory ||
    !activeGoal ||
    activeGoal.intent !== PRICE_GOAL_INTENT ||
    activeGoal.status !== "ready" ||
    (Array.isArray(activeGoal.missingSlots) && activeGoal.missingSlots.length)
  ) {
    return context;
  }
  const updatedAt = nowIso(now);
  return {
    ...context,
    askSnoozerWorkingMemory: {
      ...memory,
      activeGoal: {
        ...activeGoal,
        status: "resolving",
        updatedAt,
      },
      updatedAt,
    },
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
    status: completed
      ? "completed"
      : memory.activeGoal.missingSlots?.length
        ? "collecting_slots"
        : "ready",
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
  const accepted = clean(context?.askSnoozerWorkingMemory?.activeDeal?.acceptedRecommendation?.productHandle).toLowerCase();
  if (accepted) return accepted;
  const session = clean(context?.askSnoozerWorkingMemory?.activeDeal?.sessionRecommendation?.productHandle).toLowerCase();
  if (session) return session;
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
  const deal = isObject(memory?.activeDeal) ? memory.activeDeal : {};
  const transition = isObject(memory?.lastTransition) ? memory.lastTransition : {};
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
    stage: clean(deal.stage) || null,
    activeProductHandle: clean(deal.activeProductHandle) || null,
    recentProductHandle: clean(deal.recentProductHandle) || null,
    comparisonProductHandles: Array.isArray(deal.comparisonProductHandles)
      ? deal.comparisonProductHandles
      : [],
    activeQuoteReady: Boolean(deal.activeQuote?.cartReady),
    activeQuoteStatus: clean(deal.activeQuote?.status) || (deal.activeQuote?.cartReady ? "ready" : null),
    compatibilityStatus: clean(deal.compatibilityStatus) || null,
    currentTopic: clean(deal.currentTopic) || null,
    interpretedActs: Array.isArray(transition.interpretedActs)
      ? transition.interpretedActs.map((act) => clean(act?.type)).filter(Boolean)
      : [],
    stateBefore: isObject(transition.stateBefore) ? transition.stateBefore : {},
    stateDelta: isObject(transition.stateDelta) ? transition.stateDelta : {},
    stateAfter: isObject(transition.stateAfter) ? transition.stateAfter : {},
    rejectedProductHandles: Array.from(rejectedHandleSet(deal)),
    productFeedbackHandles: Object.keys(isObject(deal.productFeedback) ? deal.productFeedback : {}),
    retainedPreferenceKeys: Object.keys(isObject(deal.retainedPreferences) ? deal.retainedPreferences : {}),
    desiredDirection: isObject(deal.desiredDirection) ? deal.desiredDirection : {},
    sessionRecommendationHandle: normalizeHandle(deal.sessionRecommendation?.productHandle) || null,
    acceptedRecommendationHandle: normalizeHandle(deal.acceptedRecommendation?.productHandle) || null,
    rankedAlternativeHandles: Array.isArray(deal.rankedAlternatives)
      ? deal.rankedAlternatives.map((candidate) => normalizeHandle(candidate?.handle)).filter(Boolean)
      : [],
    recommendationReasonCodes: Array.isArray(deal.recommendationReasons)
      ? deal.recommendationReasons.map((reason) => clean(reason?.code)).filter(Boolean)
      : [],
    excludedCandidates: Array.isArray(deal.excludedCandidates) ? deal.excludedCandidates : [],
    budgetContext: isObject(deal.budgetContext) ? deal.budgetContext : {},
    activeConfiguration: isObject(deal.activeConfiguration) ? deal.activeConfiguration : {},
    configurationInvalidation: isObject(deal.configurationInvalidation) ? deal.configurationInvalidation : null,
    pendingCommitment: isObject(deal.pendingCommitment)
      ? { type: clean(deal.pendingCommitment.type) || null, status: clean(deal.pendingCommitment.status) || null }
      : null,
    quoteInvalidation: clean(deal.activeQuote?.invalidationReason) || null,
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
  PENDING_COMMITMENT_TTL_MS,
  applyAskSnoozerWorkingMemory,
  buildWorkingMemoryLogMetadata,
  calculatePriceQuoteMissingSlots,
  completeAskSnoozerPriceGoal,
  completeAskSnoozerAdvisorTurn,
  markAskSnoozerPriceGoalResolving,
  extractCurrentPodProductHandle,
  extractCurrentProductHandle,
  getSlotValue,
  isContextualPriceFragment,
  isContinuablePriceGoal,
  isPriceLikeQuery,
  interpretShopperActs,
  eligibleAlternativeHandles,
  resolveAdaptiveSessionRecommendation,
  resolveExplicitBaseSelection,
  resolveExplicitFirmness,
  resolveExplicitPainPoints,
  resolveExplicitProductHandle,
  resolveRequestedProductHandle,
  safeResponseFingerprint,
};
