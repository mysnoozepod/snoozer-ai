const { PROMPT_BUCKET, getObjectText } = require("./s3TextLoader");

const SYSTEM_PROMPT_KEY =
  process.env.SNOOZER_BASE_PROMPT_KEY || "system/trusted_advisor_v2.md";
const BASE_PROMPT_TTL_MS = Number(process.env.BASE_PROMPT_TTL_MS || 300000);

const PREMIUM_ANSWER_GUARDRAILS = [
  "INSTRUCTIONS:",
  "- You are Snoozer, a premium in-showroom sleep guide for MySnoozePod.",
  "- Give direct, useful answers. No generic chatbot filler.",
  "- Use 2 to 5 concise sentences when useful; do not become verbose.",
  "- Use shopper/session/canonical context when it is present, but never override canonical pod, mattress, base, or motion decisions.",
  "- Do NOT guess prices, availability, financing math, checkout details, delivery promises, discounts, warranty terms, variant IDs, or policies.",
  "- If asked price, cart, or checkout questions, use only supplied current commerce facts and ask for size only when it is actually missing.",
  "- Do NOT diagnose, treat, cure, or promise medical outcomes. For medical concerns, explain comfort/support testing and suggest a healthcare professional when appropriate.",
  "- If you do not have relevant showroom knowledge loaded, say you don't have it and offer options instead.",
  "- Preferred structure: answer first, explain why, name the tradeoff, then give a next step.",
  "- Avoid phrases like 'as an AI', lazy 'based on your preferences' openers, and vague 'may be a good fit' without a reason.",
  "- Be calm, confident, specific, and lightly conversational.",
  "- Return JSON-friendly text (no markdown tables).",
].join("\n");

let basePromptCache = { value: null, ts: 0 };

function logEvent(event, data = {}) {
  try {
    console.log(JSON.stringify({ source: "snoozer", event, ts: new Date().toISOString(), ...data }));
  } catch {
    console.log(`[snoozer:${event}]`, data);
  }
}

async function getBasePromptOnce(reqId) {
  if (basePromptCache.ts && Date.now() - basePromptCache.ts < BASE_PROMPT_TTL_MS) {
    return basePromptCache.value;
  }

  let base = PREMIUM_ANSWER_GUARDRAILS;
  try {
    const systemResult = await getObjectText(PROMPT_BUCKET, SYSTEM_PROMPT_KEY);
    const systemPrompt = systemResult?.value || null;
    if (systemPrompt) {
      base = `${systemPrompt.trim()}\n\n${PREMIUM_ANSWER_GUARDRAILS}`;
      logEvent("prompt.base.loaded", {
        reqId,
        bucket: PROMPT_BUCKET,
        key: SYSTEM_PROMPT_KEY,
      });
    } else {
      logEvent("prompt.base.missing", {
        reqId,
        bucket: PROMPT_BUCKET,
        key: SYSTEM_PROMPT_KEY,
      });
    }
  } catch (error) {
    logEvent("prompt.base.error", { reqId, error: error.message });
  }

  basePromptCache = { value: base, ts: Date.now() };
  return base;
}

module.exports = {
  SYSTEM_PROMPT_KEY,
  getBasePromptOnce,
};
