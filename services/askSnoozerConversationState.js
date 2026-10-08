const CONVERSATION_STATE_VERSION = "conversation-state.v1";

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function unique(values = []) {
  return [...new Set(values.map((value) => clean(value).toLowerCase()).filter(Boolean))];
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizedConversationHistory(frontendHistory = [], persistedHistory = [], currentMessage = "") {
  const combined = Array.isArray(frontendHistory) && frontendHistory.length ? frontendHistory : persistedHistory;
  const out = [];
  for (const entry of Array.isArray(combined) ? combined : []) {
    const role = clean(entry?.role) === "assistant" ? "assistant" : "user";
    const content = clean(entry?.content).slice(0, 1000);
    if (!content) continue;
    const previous = out[out.length - 1];
    if (previous?.role === role && previous?.content === content) continue;
    out.push({ role, content });
  }
  if (out[out.length - 1]?.role === "user" && out[out.length - 1]?.content === clean(currentMessage)) out.pop();
  return out.slice(-10);
}

function legacyState(context = {}) {
  const deal = context?.askSnoozerWorkingMemory?.activeDeal || {};
  const slots = context?.askSnoozerWorkingMemory?.slots || {};
  const preferences = {};
  for (const [key, record] of Object.entries(slots)) {
    const value = record?.value ?? record;
    if (value == null || value === "") continue;
    preferences[`shopper:${key}`] = {
      key,
      subject: "shopper",
      value: clone(value),
      source: "legacy_normalized",
      status: "active",
      updatedAt: clean(record?.updatedAt) || null,
    };
  }
  const rejectedProductHandles = unique((deal.rejectedProducts || [])
    .filter((item) => clean(item?.status || "rejected") === "rejected")
    .map((item) => item?.handle));
  const comparisonProductHandles = unique(deal.comparisonProductHandles || []).slice(0, 2);
  const presentedProductHandles = unique([
    ...comparisonProductHandles,
    deal.sessionRecommendation?.productHandle,
    deal.activeProductHandle,
  ]);
  return {
    version: CONVERSATION_STATE_VERSION,
    preferences,
    references: {
      presentedProductHandles,
      comparisonProductHandles,
      lastDiscussedProductHandle: clean(deal.activeProductHandle || deal.sessionRecommendation?.productHandle) || null,
      lastDiscussedBaseHandle: clean(deal.activeBaseHandle) || null,
      lastVerifiedConfiguration: deal.activeQuote?.ok && deal.activeQuote?.cartReady ? clone(deal.activeQuote) : null,
      lastQuotedSetup: deal.activeQuote?.ok && deal.activeQuote?.cartReady ? clone(deal.activeQuote) : null,
    },
    decisions: [],
    rejectedProductHandles,
    updatedAt: null,
  };
}

function getConversationState(context = {}) {
  const existing = context?.snoozerConversationState;
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return legacyState(context);
  return {
    ...legacyState(context),
    ...clone(existing),
    preferences: { ...(legacyState(context).preferences || {}), ...(existing.preferences || {}) },
    references: { ...(legacyState(context).references || {}), ...(existing.references || {}) },
    decisions: Array.isArray(existing.decisions) ? clone(existing.decisions) : [],
    rejectedProductHandles: unique(existing.rejectedProductHandles || legacyState(context).rejectedProductHandles),
  };
}

function compactConversationState(context = {}) {
  const state = getConversationState(context);
  return {
    version: state.version,
    preferences: Object.values(state.preferences || {}).filter((item) => item?.status !== "removed").slice(-20),
    references: state.references,
    decisions: (state.decisions || []).slice(-12),
    rejectedProductHandles: state.rejectedProductHandles,
  };
}

function applyConversationState({ context = {}, response = {}, quote = null, now = new Date() } = {}) {
  const updatedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const state = getConversationState(context);
  const preferences = { ...(state.preferences || {}) };
  for (const preference of response.preferences || []) {
    const id = `${clean(preference.subject || "shopper")}:${clean(preference.key)}`;
    if (preference.operation === "remove") {
      preferences[id] = { ...(preferences[id] || {}), key: preference.key, subject: preference.subject, status: "removed", updatedAt, source: "shopper_statement" };
    } else {
      preferences[id] = {
        key: preference.key,
        subject: preference.subject,
        value: preference.value,
        status: "active",
        operation: preference.operation,
        source: "shopper_statement",
        evidence: preference.evidence,
        updatedAt,
      };
    }
  }
  const references = {
    ...(state.references || {}),
    presentedProductHandles: unique([
      ...(state.references?.presentedProductHandles || []),
      ...(response.references?.presentedProductHandles || []),
      ...(response.productHandles || []),
    ]).slice(-8),
    comparisonProductHandles: unique(response.references?.comparisonProductHandles || state.references?.comparisonProductHandles || []).slice(0, 2),
    lastDiscussedProductHandle: clean(response.references?.lastDiscussedProductHandle || state.references?.lastDiscussedProductHandle) || null,
    lastDiscussedBaseHandle: clean(response.references?.lastDiscussedBaseHandle || state.references?.lastDiscussedBaseHandle) || null,
    lastVerifiedConfiguration: quote?.ok && quote?.cartReady ? clone(quote) : state.references?.lastVerifiedConfiguration || null,
    lastQuotedSetup: quote?.ok && quote?.cartReady ? clone(quote) : state.references?.lastQuotedSetup || null,
  };
  const decisions = [...(state.decisions || [])];
  let rejectedProductHandles = unique(state.rejectedProductHandles || []);
  for (const decision of response.decisions || []) {
    decisions.push({ ...clone(decision), source: "validated_model_proposal", updatedAt });
    const handle = clean(decision.productHandle).toLowerCase();
    if (decision.status === "rejected" && handle) rejectedProductHandles = unique([...rejectedProductHandles, handle]);
    if (decision.status === "accepted" && handle) rejectedProductHandles = rejectedProductHandles.filter((item) => item !== handle);
  }
  const nextState = {
    version: CONVERSATION_STATE_VERSION,
    preferences,
    references,
    decisions: decisions.slice(-30),
    rejectedProductHandles,
    updatedAt,
  };

  const priorMemory = context.askSnoozerWorkingMemory && typeof context.askSnoozerWorkingMemory === "object"
    ? context.askSnoozerWorkingMemory
    : {};
  const priorDeal = priorMemory.activeDeal && typeof priorMemory.activeDeal === "object" ? priorMemory.activeDeal : {};
  const recommended = [...(response.decisions || [])].reverse().find((item) => item.status === "recommended" && item.productHandle);
  const rejectedProducts = rejectedProductHandles.map((handle) => ({ handle, status: "rejected", reason: "shopper_rejected", rejectedAt: updatedAt }));
  const retainedPreferences = { ...(priorDeal.retainedPreferences || {}) };
  for (const item of Object.values(preferences)) {
    if (item?.status === "active") retainedPreferences[`${item.subject}:${item.key}`] = { value: item.value, source: item.source, updatedAt: item.updatedAt };
  }
  const nextDeal = {
    ...priorDeal,
    comparisonProductHandles: references.comparisonProductHandles,
    activeProductHandle: references.lastDiscussedProductHandle || priorDeal.activeProductHandle || null,
    activeBaseHandle: references.lastDiscussedBaseHandle || priorDeal.activeBaseHandle || null,
    rejectedProducts,
    retainedPreferences,
    ...(recommended ? { sessionRecommendation: { productHandle: recommended.productHandle, source: "conversation_core", updatedAt } } : {}),
    ...(quote?.ok ? { activeQuote: clone(quote), compatibilityStatus: quote.compatibility?.status || "unknown" } : {}),
  };
  return clone({
    ...context,
    snoozerConversationState: nextState,
    askSnoozerWorkingMemory: {
      ...priorMemory,
      activeDeal: nextDeal,
      conversationFocus: {
        ...(priorMemory.conversationFocus || {}),
        topic: "conversation_core",
        updatedAt,
      },
      updatedAt,
    },
  });
}

function existingReferenceHandles(context = {}) {
  const state = getConversationState(context);
  return unique([
    ...(state.references?.presentedProductHandles || []),
    ...(state.references?.comparisonProductHandles || []),
    state.references?.lastDiscussedProductHandle,
    state.references?.lastDiscussedBaseHandle,
  ]);
}

module.exports = {
  CONVERSATION_STATE_VERSION,
  applyConversationState,
  compactConversationState,
  existingReferenceHandles,
  getConversationState,
  normalizedConversationHistory,
};
