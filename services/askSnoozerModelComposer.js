const {
  ADVISOR_COMPOSER_TIMEOUT_MS,
  callOpenAIChat,
} = require("./openaiModelRuntime");
const { getBasePromptOnce } = require("./snoozerBasePrompt");

function parseTrustedAdvisorComposition(
  value = "",
  { taskType = null, comparisonTitles = [], fallbackSpeechText = "" } = {}
) {
  const source = String(value || "").trim();
  const unfenced = source
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    const error = new Error("Trusted-advisor composer returned invalid JSON.");
    error.code = "E_ADVISOR_COMPOSER_JSON";
    throw error;
  }
  const shopperSafeText = (text) =>
    String(text || "")
      .replace(/\bmodels\b/gi, "mattresses")
      .replace(/\bmodel\b/gi, "mattress")
      .trim();
  const displayText = shopperSafeText(parsed?.displayText);
  const sentenceMatches = displayText.match(/[^.!?]+[.!?]+/g) || [];
  const exactTitles = comparisonTitles
    .map((title) => String(title || "").trim())
    .filter(Boolean)
    .slice(0, 2);
  const titleSentence = (title) =>
    sentenceMatches.find((sentence) => sentence.toLowerCase().includes(title.toLowerCase()));
  const bothTitlesSentence =
    exactTitles.length === 2
      ? sentenceMatches.find((sentence) =>
          exactTitles.every((title) => sentence.toLowerCase().includes(title.toLowerCase()))
        )
      : null;
  const speechSentences = bothTitlesSentence
    ? [bothTitlesSentence]
    : exactTitles.length === 2
      ? exactTitles.map(titleSentence).filter(Boolean)
      : sentenceMatches.slice(0, 2);
  if (!speechSentences.length) speechSentences.push(...sentenceMatches.slice(0, 2));
  const comparisonCue =
    /\b(?:while|whereas|compared|difference|more|less|both|original|current)\b/i;
  if (
    exactTitles.length === 2 &&
    !speechSentences.some((sentence) => comparisonCue.test(sentence))
  ) {
    const comparisonSentence = sentenceMatches.find((sentence) => comparisonCue.test(sentence));
    if (comparisonSentence) speechSentences.push(comparisonSentence);
  }
  const requiredSpeechCue =
    taskType === "comparison_value"
      ? /\b(?:worth|value|pay|spend|save|cost)\b/i
      : taskType === "firmness_choice"
        ? /\b(?:pick|choose|recommend|favor|favour|would|prefer|lean|better fit|start with)\b/i
        : null;
  if (
    requiredSpeechCue &&
    !speechSentences.some((sentence) => requiredSpeechCue.test(sentence))
  ) {
    const requiredSentence = sentenceMatches.find((sentence) =>
      requiredSpeechCue.test(sentence)
    );
    if (requiredSentence) speechSentences.push(requiredSentence);
  }
  const speechText = shopperSafeText(
    parsed?.speechText ||
      parsed?.spokenSummary ||
      fallbackSpeechText ||
      [...new Set(speechSentences)].join(" ") ||
      displayText
  );
  let probe = parsed?.probe == null ? null : String(parsed.probe).trim();
  const nextActionIntent =
    parsed?.nextActionIntent == null ? null : String(parsed.nextActionIntent).trim();
  const confidence = Number(parsed?.confidence);
  if (!displayText || !speechText || displayText.length > 1800 || speechText.length > 500) {
    const error = new Error("Trusted-advisor composer violated its response contract.");
    error.code = "E_ADVISOR_COMPOSER_CONTRACT";
    throw error;
  }
  if (probe && !probe.endsWith("?") && !/[.!]$/.test(probe)) probe = `${probe}?`;
  if (probe && (displayText.match(/\?/g) || []).length === 1) probe = null;
  if (probe && ((probe.match(/\?/g) || []).length !== 1 || probe.length > 180)) {
    const error = new Error("Trusted-advisor composer returned an invalid probe.");
    error.code = "E_ADVISOR_COMPOSER_PROBE";
    throw error;
  }
  if (
    (displayText.match(/\?/g) || []).length > 1 ||
    (speechText.match(/\?/g) || []).length > 1
  ) {
    const error = new Error("Trusted-advisor composer returned more than one probe.");
    error.code = "E_ADVISOR_COMPOSER_PROBE";
    throw error;
  }
  return {
    displayText,
    speechText,
    probe,
    nextActionIntent: nextActionIntent || null,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
  };
}

async function composeTrustedAdvisorResponse({
  requestId,
  userMessage,
  strategy,
  factPack,
  deterministicDraft,
} = {}) {
  const startedAt = Date.now();
  const comparisonHandles = strategy?.references?.comparisonProductHandles || [];
  const comparisonTask =
    [
      "product_comparison",
      "canonical_comparison",
      "comparison_value",
      "firmness_choice",
      "firmness_compare",
    ].includes(String(strategy?.taskType || "")) ||
    (["advisor_choice", "durability_objection"].includes(String(strategy?.taskType || "")) &&
      comparisonHandles.length >= 2);
  const fullPolicy = await getBasePromptOnce(
    requestId || `advisor_${Date.now().toString(36)}`
  );
  const policySentences = String(fullPolicy || "")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20 && sentence.length <= 360)
    .filter((sentence) =>
      /\b(?:advisor|shopper|recommend|price|availability|compatib|cart|medical|truth|invent|pressure|decision)\b/i.test(
        sentence
      )
    )
    .slice(0, comparisonTask ? 6 : 12);
  const trustedAdvisorPolicy = policySentences
    .join(" ")
    .slice(0, comparisonTask ? 1400 : 2400);
  let compactStrategy = {
    taskType: strategy?.taskType,
    stage: strategy?.stage,
    responseDepth: strategy?.responseDepth,
    references: strategy?.references,
    knownFacts: strategy?.knownFacts,
    commercialState: strategy?.commercialState,
    interpretedActs: strategy?.interpretedActs,
    allowedActions: strategy?.allowedActions,
    medicalBoundary: strategy?.medicalBoundary,
  };
  if (comparisonTask) {
    compactStrategy = {
      taskType: strategy?.taskType,
      responseDepth: strategy?.responseDepth,
      comparisonProductHandles: strategy?.references?.comparisonProductHandles || [],
      comparisonTitles: (factPack?.products || [])
        .slice(0, 2)
        .map((product) => product?.title)
        .filter(Boolean),
      activeProductHandle: strategy?.references?.activeProductHandle || null,
      sessionRecommendationHandle: strategy?.references?.sessionRecommendationHandle || null,
      allowedActions: strategy?.allowedActions || [],
    };
  }
  const boundedPayload = JSON.stringify({
    shopperQuestion: String(userMessage || "").slice(0, comparisonTask ? 600 : 1000),
    strategy: compactStrategy,
    verifiedFactPack: factPack,
    deterministicDraft: comparisonTask
      ? { displayText: deterministicDraft?.displayText }
      : deterministicDraft,
  });
  const systemContent = [
    trustedAdvisorPolicy,
    "You are the language composer for a mattress showroom advisor.",
    comparisonTask
      ? "Return JSON only with displayText, probe (string or null), nextActionIntent (string or null), and confidence (0 to 1). Speech is derived from displayText."
      : "Return JSON only with displayText, speechText, probe (string or null), nextActionIntent (string or null), and confidence (0 to 1).",
    "Rewrite the deterministic draft so it is natural, engaged, decisive, and shopper-friendly.",
    "Use only the verified fact pack and deterministic draft. Never invent or change products, titles, sizes, prices, availability, compatibility, configuration, cart state, rewards, policies, or actions.",
    "Treat the original assessment recommendation as history and the current session recommendation as the active advice when shopper feedback changed it.",
    "Do not expose implementation language. Do not diagnose or promise a medical outcome.",
    "Never claim that a mattress ensures comfort, treats pain, or guarantees relief. Describe verified construction and likely feel as tradeoffs, not outcomes.",
    "Ask at most one useful forward-moving question. Use null when a probe is not warranted.",
    ["price_quote", "price_value", "bundle_quote", "savings_quote", "cart_add"].includes(
      String(strategy?.taskType || "")
    )
      ? "For a price answer, preserve every exact resolved line price, the exact total when there is more than one line, the size, and the requested scope. Do not omit or alter any number."
      : "",
    comparisonTask
      ? "Use the supplied response depth and finish the comparison. Use both exact full names in strategy.comparisonTitles and clearly contrast them in the first two sentences so the spoken summary covers both. Use product names instead of the word model. Keep displayText under 1800 characters."
      : "Use the supplied response depth and finish the thought. Keep displayText under 1800 characters. Keep speechText to two short complete sentences.",
  ]
    .filter(Boolean)
    .join(" ");
  const response = await callOpenAIChat({
    reqId: requestId || `advisor_${Date.now().toString(36)}`,
    timeoutMs: ADVISOR_COMPOSER_TIMEOUT_MS,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: boundedPayload },
    ],
  });
  const parsed = parseTrustedAdvisorComposition(response.text, {
    taskType: strategy?.taskType,
    comparisonTitles: (factPack?.products || [])
      .slice(0, 2)
      .map((product) => product?.title)
      .filter(Boolean),
    fallbackSpeechText: comparisonTask ? deterministicDraft?.speechText : "",
  });
  return {
    ...parsed,
    model: response.model,
    tokens: response.tokens,
    modelMs: Date.now() - startedAt,
    inputChars: systemContent.length + boundedPayload.length,
    estimatedInputTokens: Math.ceil((systemContent.length + boundedPayload.length) / 4),
    systemChars: systemContent.length,
    payloadChars: boundedPayload.length,
    factPackChars: JSON.stringify(factPack || {}).length,
    factPackBudget: factPack?.budget || null,
    timeoutMs: ADVISOR_COMPOSER_TIMEOUT_MS,
  };
}

module.exports = {
  composeTrustedAdvisorResponse,
  parseTrustedAdvisorComposition,
};
