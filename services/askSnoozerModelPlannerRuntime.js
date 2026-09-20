const {
  ALLOWED_TASKS,
  buildModelPlannerInput,
  parseModelPlannerDecision,
} = require("./askSnoozerModelPlanner");
const { FAST_MODEL, callOpenAIChat } = require("./openaiModelRuntime");

async function planTrustedAdvisorTurnWithModel({ requestId, query = "", context = {} } = {}) {
  const startedAt = Date.now();
  const plannerInput = buildModelPlannerInput({ query, context });
  const systemContent = [
    "You plan the next turn for Snoozer, an expert mattress showroom advisor.",
    "You decide conversational meaning and answer scope, but you have no authority over facts, prices, availability, variants, compatibility, cart state, policies, or the assessment result.",
    "Identify every shopper act and every fact the shopper requested. One message may contain multiple acts or questions.",
    "Classify utteranceMode as asserted, hypothetical, conditional, question, or reconsideration. Add modality to every act.",
    "Hypothetical, conditional, and question-only concerns must not become reject_product, product_feedback, explicit_exclusion, desired_direction, retain_preference, budget_value, or acceptance state changes. Example: 'What if I do not like it?' is a question, not a rejection.",
    "Resolve product references only to handles in the supplied catalog. Never invent a product or handle.",
    "The assessment recommendation is historical baseline. Explicit shopper feedback and the current session recommendation control active advice.",
    "Return JSON only with: utteranceMode, primaryTask, shopperGoal, acts, productReferences, comparisonProductHandles, requestedFacts, answerRequirements, requestedPodId, requiresComposition, confidence.",
    `primaryTask must be exactly one of: ${Array.from(ALLOWED_TASKS).join(", ")}. Never invent or paraphrase a task name.`,
    "Valid act types are reject_product, product_feedback, retain_preference, desired_direction, request_alternative, explicit_exclusion, accept_commitment, decline_commitment, trust_risk, confusion, reconsider_product, accept_recommendation, and budget_value. Include productHandle and value or reason when relevant.",
    "If a shopper says the current product feels too firm and asks what to try instead, emit reject_product, product_feedback with too_firm, desired_direction with feel=softer, and request_alternative in the same decision.",
    "For questions about adding a base, use compatibility when asking whether it can be added, bundle_quote only when price is requested, and base_education when asking what the base does.",
    "Use compound_fact_answer when the shopper requests more than one protected fact or a policy-only fact, product_sizes for an exact size question, durability_objection for lifespan/wear questions, store_value for why-buy-from-us questions, and recommendation_explanation for why an assessment or pod was chosen.",
    "A substantive question must always have a primaryTask. Resolve relational questions such as current choice versus the rejected, original, previous, or other choice from activeJourney and recent turns; use product_comparison when two products are involved.",
    "Valid requestedFacts include recommendation_reasons, product_sizes, product_features, warranty, delivery, returns, financing, price, availability, compatibility, cart, durability, and store_value.",
    "Use answerRequirements to require all requested facts, named comparisons, recommendation reasons, feedback acknowledgement, state recap, grounded opinion, unknown disclosure, or one useful next step.",
    "Do not write the shopper-facing answer.",
  ].join(" ");
  const payload = JSON.stringify(plannerInput);
  const response = await callOpenAIChat({
    reqId: requestId || `advisor_plan_${Date.now().toString(36)}`,
    model: FAST_MODEL,
    maxTokens: 500,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: payload },
    ],
  });
  return {
    decision: parseModelPlannerDecision(response.text, { query, context }),
    model: response.model,
    tokens: response.tokens,
    modelMs: Date.now() - startedAt,
    inputChars: systemContent.length + payload.length,
  };
}

module.exports = { planTrustedAdvisorTurnWithModel };
