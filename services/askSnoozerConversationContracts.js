const { loadShowroomManifest } = require("./showroomManifest");

const CONVERSATION_CONTRACT_VERSION = "conversation-core.v1";
const HUD_STATES = ["idle", "listening", "thinking", "speaking", "celebrate", "warning"];
const HUD_PRIORITIES = ["low", "normal", "high"];
const ACTION_TYPES = ["navigate", "start_assessment", "open_builder", "request_human", "view_recommendation", "add_to_cart"];
const PREFERENCE_KEYS = [
  "sleep_position", "temperature", "pressure_area", "firmness", "partner_sleep_position",
  "partner_firmness", "size", "budget", "product_exclusion",
];
const DECISION_STATUSES = ["candidate", "recommended", "considering", "accepted", "rejected", "quoted", "cart_proposed", "cart_confirmed"];

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function unique(values = []) {
  return [...new Set(values.map((value) => clean(value).toLowerCase()).filter(Boolean))];
}

function nullableString(description) {
  return { type: ["string", "null"], description };
}

const snoozerConversationResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string" },
    speech: { type: "string" },
    captions: { type: "string" },
    state: { type: "string", enum: HUD_STATES },
    priority: { type: "string", enum: HUD_PRIORITIES },
    ttlMs: { type: "integer", minimum: 1000, maximum: 30000 },
    responseMode: { type: "string", enum: ["answer", "clarification", "safe_fallback", "medical_boundary"] },
    productHandles: { type: "array", maxItems: 6, items: { type: "string" } },
    chips: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          type: { type: "string", enum: ["prompt", "route", "action"] },
          target: nullableString("Optional route target."),
        },
        required: ["label", "value", "type", "target"],
      },
    },
    actionProposals: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ACTION_TYPES },
          label: { type: "string" },
          target: nullableString("Optional navigation target."),
          productHandles: { type: "array", maxItems: 4, items: { type: "string" } },
          size: nullableString("Requested setup size."),
          baseHandle: nullableString("Approved base handle."),
          motionKey: nullableString("Approved motion key."),
          scope: { type: "string", enum: ["none", "product", "bundle"] },
        },
        required: ["type", "label", "target", "productHandles", "size", "baseHandle", "motionKey", "scope"],
      },
    },
    preferences: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string", enum: PREFERENCE_KEYS },
          value: { type: "string" },
          subject: { type: "string", enum: ["shopper", "partner", "household"] },
          operation: { type: "string", enum: ["set", "correct", "remove"] },
          evidence: { type: "string" },
        },
        required: ["key", "value", "subject", "operation", "evidence"],
      },
    },
    references: {
      type: "object",
      additionalProperties: false,
      properties: {
        presentedProductHandles: { type: "array", maxItems: 6, items: { type: "string" } },
        comparisonProductHandles: { type: "array", maxItems: 2, items: { type: "string" } },
        lastDiscussedProductHandle: nullableString("Last discussed product handle."),
        lastDiscussedBaseHandle: nullableString("Last discussed base handle."),
      },
      required: ["presentedProductHandles", "comparisonProductHandles", "lastDiscussedProductHandle", "lastDiscussedBaseHandle"],
    },
    decisions: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: DECISION_STATUSES },
          productHandle: nullableString("Related product handle."),
          configurationKey: nullableString("Related grounded configuration key."),
          evidence: { type: "string" },
        },
        required: ["status", "productHandle", "configurationKey", "evidence"],
      },
    },
    claims: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["product", "commerce", "compatibility", "policy", "rewards", "cart", "general_guidance"] },
          value: { type: "string" },
          sourceTool: nullableString("Tool that supplied the claim."),
          sourceKey: nullableString("Source handle, key, or identifier."),
        },
        required: ["kind", "value", "sourceTool", "sourceKey"],
      },
    },
    fallback: {
      type: "object",
      additionalProperties: false,
      properties: {
        used: { type: "boolean" },
        reason: nullableString("Specific fallback reason."),
      },
      required: ["used", "reason"],
    },
  },
  required: [
    "reply", "speech", "captions", "state", "priority", "ttlMs", "responseMode",
    "productHandles", "chips", "actionProposals", "preferences", "references", "decisions", "claims", "fallback",
  ],
};

// The model produces the semantic payload; the server deterministically adds the
// duplicated HUD delivery fields. This keeps the wire contract unchanged while
// avoiding three copies of every shopper-facing answer in model output.
const MODEL_DERIVED_HUD_FIELDS = new Set(["speech", "captions", "state", "priority", "ttlMs"]);
const snoozerConversationModelSchema = {
  ...snoozerConversationResponseSchema,
  properties: Object.fromEntries(
    Object.entries(snoozerConversationResponseSchema.properties)
      .filter(([key]) => !MODEL_DERIVED_HUD_FIELDS.has(key))
  ),
  required: snoozerConversationResponseSchema.required
    .filter((key) => !MODEL_DERIVED_HUD_FIELDS.has(key)),
};

function withHudDeliveryFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const reply = clean(value.reply);
  const warning = ["safe_fallback", "medical_boundary"].includes(value.responseMode);
  return {
    ...value,
    speech: clean(value.speech) || reply,
    captions: clean(value.captions) || reply,
    state: HUD_STATES.includes(value.state) ? value.state : warning ? "warning" : "speaking",
    priority: HUD_PRIORITIES.includes(value.priority) ? value.priority : warning ? "high" : "normal",
    ttlMs: Number.isFinite(Number(value.ttlMs)) ? Number(value.ttlMs) : warning ? 7000 : 5000,
  };
}

function parseStructuredConversationResponse(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return withHudDeliveryFields(value);
  const text = clean(value);
  if (!text) return null;
  try {
    return withHudDeliveryFields(JSON.parse(text));
  } catch {
    return null;
  }
}

function approvedHandles(manifest = loadShowroomManifest()) {
  return new Set((manifest?.products || [])
    .filter((item) => item?.active !== false)
    .map((item) => clean(item?.handle).toLowerCase())
    .filter(Boolean));
}

function evidenceAppears(message, evidence) {
  const haystack = clean(message).toLowerCase().replace(/\s+/g, " ");
  const needle = clean(evidence).toLowerCase().replace(/\s+/g, " ");
  return Boolean(needle && haystack.includes(needle));
}

function validateConversationResponse(raw, {
  message = "",
  groundedProductHandles = [],
  existingReferenceHandles = [],
  rejectedProductHandles = [],
  successfulTools = [],
  manifest = loadShowroomManifest(),
} = {}) {
  const value = parseStructuredConversationResponse(raw);
  const errors = [];
  if (!value) return { valid: false, errors: ["structured_response_invalid"], value: null };
  for (const field of ["reply", "speech", "captions"]) {
    if (!clean(value[field])) errors.push(`${field}_required`);
  }
  if (!HUD_STATES.includes(value.state)) errors.push("hud_state_invalid");
  if (!HUD_PRIORITIES.includes(value.priority)) errors.push("hud_priority_invalid");
  if (!Number.isFinite(Number(value.ttlMs))) errors.push("hud_ttl_invalid");
  for (const field of ["productHandles", "chips", "actionProposals", "preferences", "decisions", "claims"]) {
    if (!Array.isArray(value[field])) errors.push(`${field}_must_be_array`);
  }
  if (!value.references || typeof value.references !== "object") errors.push("references_required");
  if (!value.fallback || typeof value.fallback.used !== "boolean") errors.push("fallback_required");

  const approved = approvedHandles(manifest);
  const grounded = new Set(unique([...groundedProductHandles, ...existingReferenceHandles]));
  const responseHandles = unique([
    ...(value.productHandles || []),
    ...(value.references?.presentedProductHandles || []),
    ...(value.references?.comparisonProductHandles || []),
    value.references?.lastDiscussedProductHandle,
    value.references?.lastDiscussedBaseHandle,
    ...(value.decisions || []).map((item) => item?.productHandle),
    ...(value.actionProposals || []).flatMap((item) => item?.productHandles || []),
    ...(value.actionProposals || []).map((item) => item?.baseHandle),
  ]);
  for (const handle of responseHandles) {
    if (!approved.has(handle)) errors.push(`product_not_approved:${handle}`);
    else if (!grounded.has(handle)) errors.push(`product_not_grounded:${handle}`);
  }

  const toolSet = new Set(successfulTools.map((name) => clean(name)));
  for (const claim of value.claims || []) {
    if (claim?.kind === "general_guidance") continue;
    if (!clean(claim?.sourceTool) || !toolSet.has(clean(claim.sourceTool)) || !clean(claim?.sourceKey)) {
      errors.push(`claim_source_missing:${clean(claim?.kind) || "unknown"}`);
    }
  }
  const acceptedPreferences = [];
  const rejectedPreferences = [];
  for (const preference of value.preferences || []) {
    if (!PREFERENCE_KEYS.includes(preference?.key) || !clean(preference?.value)) {
      rejectedPreferences.push({ preference, reason: "preference_invalid" });
    } else if (!evidenceAppears(message, preference.evidence)) {
      rejectedPreferences.push({ preference, reason: "preference_evidence_missing" });
    } else {
      acceptedPreferences.push(preference);
    }
  }
  const hypothetical = /\b(?:what if|would|could|suppose|if i|if we|hypothetical)\b/i.test(message);
  const explicitReversal = /\b(?:reconsider|bring (?:it|that) back|changed my mind|include (?:it|that) again|actually want)\b/i.test(message);
  const rejectedSet = new Set(unique(rejectedProductHandles));
  const acceptedDecisions = [];
  const rejectedDecisions = [];
  for (const decision of value.decisions || []) {
    const status = clean(decision?.status);
    const requiresAssertion = ["accepted", "rejected", "cart_confirmed"].includes(status);
    if (!DECISION_STATUSES.includes(status)) {
      rejectedDecisions.push({ decision, reason: "decision_invalid" });
    } else if (["candidate", "recommended", "considering"].includes(status) && rejectedSet.has(clean(decision?.productHandle).toLowerCase()) && !explicitReversal) {
      rejectedDecisions.push({ decision, reason: "rejected_product_not_reactivated" });
    } else if (requiresAssertion && (hypothetical || !evidenceAppears(message, decision.evidence))) {
      rejectedDecisions.push({ decision, reason: hypothetical ? "hypothetical_not_commitment" : "decision_evidence_missing" });
    } else {
      acceptedDecisions.push(decision);
    }
  }
  if (value.fallback?.used === true && (value.references?.comparisonProductHandles || []).length > 1) {
    errors.push("fallback_cannot_complete_comparison");
  }
  return {
    valid: errors.length === 0,
    errors,
    value: {
      ...value,
      productHandles: unique(value.productHandles || []),
      preferences: acceptedPreferences,
      decisions: acceptedDecisions,
    },
    stateValidation: {
      acceptedPreferenceCount: acceptedPreferences.length,
      rejectedPreferences,
      acceptedDecisionCount: acceptedDecisions.length,
      rejectedDecisions,
    },
  };
}

module.exports = {
  ACTION_TYPES,
  CONVERSATION_CONTRACT_VERSION,
  DECISION_STATUSES,
  HUD_PRIORITIES,
  HUD_STATES,
  PREFERENCE_KEYS,
  parseStructuredConversationResponse,
  snoozerConversationModelSchema,
  snoozerConversationResponseSchema,
  validateConversationResponse,
};
