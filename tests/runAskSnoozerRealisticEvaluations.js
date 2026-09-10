const assert = require("assert");
const {
  INTERNAL_LANGUAGE,
  planAskSnoozerTurn,
  resolveAskSnoozerAdvisorTurn,
} = require("../services/askSnoozerConversationOrchestrator");
const {
  applyAskSnoozerWorkingMemory,
  completeAskSnoozerAdvisorTurn,
} = require("../services/askSnoozerWorkingMemory");

const conversations = [
  ["Based on my sleep profile, what should I try first?", "Tell me more about what I will notice when I lie on it.", "Compare it to the 14-inch Hybrid.", "Which one would you choose for me?", "Do I really need the adjustable base or should I save the money?"],
  ["Remind me what you recommended for me.", "I'm torn—walk me through in deep detail how it compares to the 14-inch Hybrid.", "Would you buy that one?", "Is more expensive always better?", "What should I notice when I lie on it?"],
  ["What does Standard Motion actually do?", "Why would I want the adjustable base?", "I liked the elevated position.", "What did I say I liked?", "Do I need that base or can I save the money?"],
  ["What would the King version of your recommendation cost?", "What would it cost with Standard Motion?", "How much would I save if I skip the base?", "Does this mattress and base work together?", "Add the full setup to my cart."],
  ["Which one would you choose for shoulder and hip pressure?", "Tell me more about what I will notice.", "Compare the 12-inch All Foam Mattress versus the 14-inch Hybrid.", "What would you do for me?", "I did not notice a benefit from the base; should I save the money?"],
  ["Compare medium versus soft firmness.", "Which one would you choose for me?", "I prefer medium firmness.", "What do I prefer?", "What will I notice when I lie on it?"],
  ["Can this cure my sciatica?", "Can it replace my CPAP therapy?", "I need medical advice about sleep apnea.", "Can you diagnose my hip pain?", "What mattress feel should I notice when I lie on it?"],
  ["Would you buy that one?", "How does the first one compare to the 14-inch Hybrid?", "What would your recommendation cost in King?", "Does the base we discussed work together with it?", "Add your recommendation to my cart."],
  ["Help me understand in detail what I will notice on it.", "Talk me through how it compares to the 14-inch Hybrid.", "I'm torn; convince me which one you would choose.", "Walk me through why the adjustable base matters.", "In your own words, should I save the money?"],
  ["Quick answer: what did you recommend for me?", "Briefly, what will I notice on it?", "Quick: compare it versus the 14-inch Hybrid.", "One sentence: which one would you choose?", "Quick: do I need the adjustable base?"],
  ["I liked the elevated position.", "Actually I prefer medium firmness.", "Compare medium versus soft firmness.", "What do I prefer?", "Would you choose your original recommendation for me?"],
  ["What would the Queen version of your recommendation cost?", "What would the full setup cost with Standard Motion?", "Does that setup make sense together?", "How much would I save without the base?", "Put the mattress in my cart."],
];

function initialContext() {
  return {
    canonicalRecommendation: {
      topPodId: "4",
      primaryMattressHandle: "12-all-foam-mattress",
      primaryMattressTitle: '12" All Foam Mattress',
      normalizedAssessment: { sleepPosition: "side" },
    },
    assessment: { answers: { sleepPosition: "side" } },
    recentConversation: [],
    askSnoozerWorkingMemory: {
      turnIndex: 3,
      slots: { painPoints: { value: ["shoulder", "hip"] } },
      activeDeal: {
        stage: "narrowing",
        activeProductHandle: "12-all-foam-mattress",
        comparisonProductHandles: ["12-all-foam-mattress", "14-hybrid"],
        activeSize: "King",
        activeBaseHandle: "premium-motion-adjustable-base",
        activeMotionKey: "standard",
        compatibilityStatus: "compatible",
      },
    },
  };
}

const dimensions = [
  "intentRecognized", "answerComplete", "noTruncation", "noInternalLanguage",
  "oneProbeMaximum", "canonicalContinuity", "protectedReferenceResolved", "boundedModelCalls",
  "compositionGatePassed", "displayVoiceSeparated", "noUnverifiedPrice", "noUnsafeCartAction",
  "stageTracked", "medicalBoundary", "contextContinuity", "forwardPathPresent",
];

async function main() {
  const scores = Object.fromEntries(dimensions.map((key) => [key, { pass: 0, total: 0 }]));
  const taskCounts = {};
  let modelCalls = 0;
  let total = 0;
  const samples = [];

  for (let conversationIndex = 0; conversationIndex < conversations.length; conversationIndex += 1) {
    let context = initialContext();
    for (let turnIndex = 0; turnIndex < conversations[conversationIndex].length; turnIndex += 1) {
      const query = conversations[conversationIndex][turnIndex];
      const referenceContext = context;
      context = applyAskSnoozerWorkingMemory({ query, context });
      const plan = planAskSnoozerTurn({ query, context, referenceContext });
      const outcome = await resolveAskSnoozerAdvisorTurn({
        query,
        context,
        plan,
        composeAdvisorResponse: async ({ deterministicDraft }) => ({
          displayText: deterministicDraft.displayText,
          speechText: deterministicDraft.speechText,
          probe: null,
          model: "evaluation-composer",
        }),
      });
      total += 1;
      taskCounts[plan.taskType] = (taskCounts[plan.taskType] || 0) + 1;
      modelCalls += outcome?.modelCallCount || 0;
      const reply = String(outcome?.reply || "");
      const referencePhrase = /\b(?:that one|first one|your recommendation|base we discussed|what you quoted me)\b/i.test(query);
      const checks = {
        intentRecognized: plan.handled && plan.taskType !== "legacy",
        answerComplete: Boolean(outcome && reply && /[.!?]$/.test(reply)),
        noTruncation: !reply.endsWith("..."),
        noInternalLanguage: !INTERNAL_LANGUAGE.some((phrase) => reply.toLowerCase().includes(phrase)),
        oneProbeMaximum: (reply.match(/\?/g) || []).length <= 1,
        canonicalContinuity: context.canonicalRecommendation.primaryMattressHandle === "12-all-foam-mattress",
        protectedReferenceResolved: !referencePhrase || Boolean(plan.references?.resolution?.resolved),
        boundedModelCalls: (outcome?.modelCallCount || 0) <= 1,
        compositionGatePassed: Boolean(outcome?.gate?.ok),
        displayVoiceSeparated: Boolean(outcome?.speech && outcome.speech.length <= 500),
        noUnverifiedPrice: !(outcome?.modelGate?.violations || []).some((item) => item.startsWith("unverified_price:")),
        noUnsafeCartAction: !(outcome?.actions || []).some((action) => action.type === "add_to_cart") || Boolean(outcome?.quote?.cartReady),
        stageTracked: Boolean(plan.stage),
        medicalBoundary: plan.taskType !== "medical_boundary" || /cannot diagnose|cannot.*treat|medical/.test(reply.toLowerCase()),
        contextContinuity: Number(context.askSnoozerWorkingMemory.turnIndex) >= 4 + turnIndex,
        forwardPathPresent: Boolean((outcome?.chips || []).length || plan.taskType === "medical_boundary" || plan.taskType === "preference_recall"),
      };
      for (const [key, value] of Object.entries(checks)) {
        scores[key].total += 1;
        if (value) scores[key].pass += 1;
      }
      assert(checks.intentRecognized, `Unrecognized turn: ${query}`);
      assert(checks.answerComplete, `Incomplete answer: ${query}`);
      assert(checks.compositionGatePassed, `Gate failed: ${query} ${JSON.stringify(outcome?.gate)}`);
      assert(checks.protectedReferenceResolved, `Protected reference did not resolve: ${query}`);
      context = completeAskSnoozerAdvisorTurn(context, outcome);
      context.recentConversation = context.recentConversation.concat([
        { role: "user", content: query },
        { role: "assistant", content: reply },
      ]).slice(-8);
      if (turnIndex === 4) samples.push({ conversation: conversationIndex + 1, query, taskType: plan.taskType, reply });
    }
  }

  const result = {
    conversations: conversations.length,
    scenarios: total,
    modelCalls,
    taskCounts,
    dimensions: Object.fromEntries(Object.entries(scores).map(([key, value]) => [
      key,
      { ...value, percent: Math.round((value.pass / value.total) * 1000) / 10 },
    ])),
    samples,
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
