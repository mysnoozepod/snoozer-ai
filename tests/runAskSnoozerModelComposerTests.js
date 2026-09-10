const assert = require("assert");
const {
  buildRelevantFactPack,
  planAskSnoozerTurn,
  resolveAskSnoozerAdvisorTurn,
  validateResponseConsistency,
} = require("../services/askSnoozerConversationOrchestrator");
const { parseTrustedAdvisorComposition } = require("../services/openai");

const context = {
  canonicalRecommendation: {
    topPodId: "4",
    primaryMattressHandle: "12-all-foam-mattress",
    primaryMattressTitle: '12" All Foam Mattress',
    normalizedAssessment: { sleepPosition: "side" },
  },
  askSnoozerWorkingMemory: {
    turnIndex: 4,
    slots: { painPoints: { value: ["shoulder", "hip"] } },
    activeDeal: {
      stage: "comparing",
      activeProductHandle: "12-all-foam-mattress",
      comparisonProductHandles: ["12-all-foam-mattress", "14-hybrid"],
      activeSize: "King",
      activeMotionKey: "standard",
      compatibilityStatus: "compatible",
    },
  },
};

async function main() {
  const query = "I'm torn—walk me through in deep detail how it compares to the 14-inch Hybrid.";
  const plan = planAskSnoozerTurn({ query, context });
  assert.equal(plan.taskType, "product_comparison");
  assert.equal(plan.needsModel, true);
  assert.equal(plan.responseDepth, "deep");

  let calls = 0;
  const accepted = await resolveAskSnoozerAdvisorTurn({
    query,
    context,
    plan,
    composeAdvisorResponse: async ({ deterministicDraft, factPack }) => {
      calls += 1;
      assert.equal(factPack.permittedJudgment.compareVerifiedProducts, true);
      assert.equal(factPack.verifiedCommercialFacts.products.length, 2);
      return {
        displayText: deterministicDraft.displayText.replace("The 12-inch", "Here is the practical difference: the 12-inch"),
        speechText: "The 12-inch All Foam Mattress gives you closer contouring; the 14-inch Hybrid feels more lifted and springy.",
        probe: null,
        model: "composer-test",
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(accepted.compositionMode, "model_assisted");
  assert.equal(accepted.modelCallCount, 1);
  assert.equal(accepted.compositionFallbackUsed, false);
  assert.equal(accepted.gate.ok, true);

  const rejected = await resolveAskSnoozerAdvisorTurn({
    query,
    context,
    plan: planAskSnoozerTurn({ query, context }),
    composeAdvisorResponse: async () => ({
      displayText: "Buy the 12-inch Dual Comfort Hybrid for $9,999. It is compatible.",
      speechText: "Buy the 12-inch Dual Comfort Hybrid for $9,999.",
      probe: null,
      model: "composer-test",
    }),
  });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.compositionMode, "deterministic");
  assert.equal(rejected.compositionFallbackUsed, true);
  assert(rejected.modelGate.violations.some((item) => item.startsWith("unverified_price:")));
  assert(rejected.modelGate.violations.some((item) => item.startsWith("unverified_product:")));
  assert(!rejected.reply.includes("$9,999"));

  const simple = planAskSnoozerTurn({ query: "What did you recommend for me again?", context });
  assert.equal(simple.needsModel, false);
  const quote = planAskSnoozerTurn({ query: "What would the King version of your recommendation cost?", context });
  assert.equal(quote.needsModel, false);
  const protectedPlan = planAskSnoozerTurn({ query: "Would you buy that one?", context });
  assert.equal(protectedPlan.references.resolution.resolved, true);
  assert.equal(protectedPlan.references.resolution.handle, "12-all-foam-mattress");
  assert(protectedPlan.protectedReferences.includes("active_product"));

  const factPack = buildRelevantFactPack({ query, context, plan });
  assert(!JSON.stringify(factPack).includes("shopperId"));
  assert(factPack.verifiedCommercialFacts);
  assert(factPack.conversationContext);
  assert(factPack.permittedJudgment);
  assert(Array.isArray(factPack.missingUnknown));
  assert(Array.isArray(factPack.allowedActions));

  const conflictGate = validateResponseConsistency({
    reply: "The Queen full-split setup is compatible.",
    quote: { size: "King", motionKey: "standard", compatibility: { status: "incompatible" } },
    plan: { knownFacts: { size: "King" }, technicalLanguageAllowed: false, protectedReferences: [] },
    factPack: { products: [] },
  });
  assert(conflictGate.violations.includes("size_mismatch"));
  assert(conflictGate.violations.includes("compatibility_contradiction"));
  assert(conflictGate.violations.includes("motion_configuration_mismatch"));

  const parsed = parseTrustedAdvisorComposition('```json\n{"displayText":"Clear answer.","speechText":"Clear answer.","probe":null}\n```');
  assert.equal(parsed.displayText, "Clear answer.");
  assert.throws(
    () => parseTrustedAdvisorComposition('{"displayText":"One? Two?","speechText":"Okay.","probe":null}'),
    /more than one probe/
  );

  console.log("Ask Snoozer model-composer tests passed (selection, fact pack, accepted composition, semantic rejection, deterministic fallback, references, parser)." );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
