#!/usr/bin/env node

const assert = require("node:assert/strict");
const { isCompleteShopperResponse } = require("../services/askSnoozerResponsePresenter");

const API_BASE = String(process.env.ASK_SNOOZER_API_BASE || "https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod").replace(/\/$/, "");
const PACE_MS = Math.max(250, Number(process.env.ASK_SNOOZER_PACE_MS || 1000));
const ROUNDS = Math.max(2, Number(process.env.ASK_SNOOZER_COMPARISON_ROUNDS || 2));
const canonicalContext = {
  assessment: { answers: { size: "King", sleepPosition: "side", firmness: "soft", painPoints: ["shoulder", "hip"], motion: "standard" } },
  canonicalRecommendation: {
    topPodId: "4",
    primaryMattressHandle: "12-all-foam-mattress",
    primaryMattressTitle: "12-inch All Foam Mattress",
    size: "King",
    motionKey: "standard",
    normalizedAssessment: { size: "King", sleepPosition: "side", painPoints: ["shoulder", "hip"] },
  },
};
const seedTurns = [
  "The All Foam was too firm, but I liked the motion.",
  "I want something softer.",
  "What would you recommend instead?",
  "Okay, I like that one.",
  "I need King.",
];
const scenarios = [
  "Compare the Dual Comfort and 14 Hybrid.",
  "Which one would you pick for me?",
  "Which one is softer and which would you choose?",
  "Why does the Hybrid cost more and is it worth it?",
  "Which one should hold up better?",
  "Compare them.",
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value) => String(value == null ? "" : value).trim();
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : 0;
};

async function ask({ message, sessionId, testCaseId, turn }) {
  const startedAt = Date.now();
  const response = await fetch(`${API_BASE}/ask-snoozer`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-id": sessionId, "x-request-id": `${testCaseId}-${turn}` },
    body: JSON.stringify({ message, mode: "ask_snoozer_page", surface: "phase_4_comparison_latency", source: "phase_4_comparison_latency", sessionId, testCaseId, context: canonicalContext }),
  });
  const body = JSON.parse(await response.text());
  assert.equal(response.status, 200, `${message}: HTTP ${response.status}`);
  return { body, clientMs: Date.now() - startedAt };
}

async function main() {
  const suffix = Date.now().toString(36);
  const sessionId = `phase4-comparison-latency-${suffix}`;
  const seedId = `phase4-comparison-seed-${suffix}`;
  for (let index = 0; index < seedTurns.length; index += 1) {
    if (index) await wait(PACE_MS);
    await ask({ message: seedTurns[index], sessionId, testCaseId: seedId, turn: index + 1 });
  }
  const samples = [];
  let turn = 0;
  for (let round = 1; round <= ROUNDS; round += 1) {
    for (const message of scenarios) {
      turn += 1;
      await wait(PACE_MS);
      const { body, clientMs } = await ask({ message, sessionId, testCaseId: `phase4-comparison-latency-${suffix}`, turn });
      const reply = clean(body.reply);
      const metadata = body.metadata || {};
      const sample = {
        round,
        message,
        responsePath: metadata.answerPath,
        task: metadata.qualityGate?.intent,
        modelCalls: Number(metadata.composition?.modelCallCount || 0),
        factPackChars: Number(metadata.composition?.factPackChars || 0),
        inputChars: Number(metadata.composition?.inputChars || 0),
        inputTokens: Number(metadata.composition?.inputTokens || 0),
        systemChars: Number(metadata.composition?.systemChars || 0),
        payloadChars: Number(metadata.composition?.payloadChars || 0),
        timeoutMs: Number(metadata.composition?.timeoutMs || 0),
        modelMs: Number(metadata.metrics?.modelMs || 0),
        totalMs: Number(metadata.metrics?.totalMs || clientMs),
        validationMs: Number(metadata.metrics?.responseValidationMs || 0),
        fallbackUsed: Boolean(metadata.metrics?.fallbackUsed),
        alertSeverity: metadata.quality?.alertSeverity || null,
      };
      samples.push(sample);
      assert.equal(sample.responsePath, "structured_composer", `${message}: ${sample.responsePath}`);
      assert.equal(sample.modelCalls, 1, `${message}: expected one model call`);
      assert.equal(sample.fallbackUsed, false, `${message}: fallback`);
      assert.equal(sample.alertSeverity, null, `${message}: ${sample.alertSeverity}`);
      assert(isCompleteShopperResponse(reply), `${message}: incomplete response`);
      assert(/Dual Comfort|14-inch Hybrid|14 Hybrid|Hybrid/i.test(reply), `${message}: comparison subject missing`);
    }
  }
  const values = (key) => samples.map((sample) => sample[key]).filter((value) => Number.isFinite(value));
  const stats = (key) => ({
    min: Math.min(...values(key)),
    average: Math.round(average(values(key)) * 10) / 10,
    median: percentile(values(key), 0.5),
    p95: percentile(values(key), 0.95),
    max: Math.max(...values(key)),
  });
  console.log(JSON.stringify({
    ok: true,
    testCaseId: `phase4-comparison-latency-${suffix}`,
    sessionId,
    sampleCount: samples.length,
    timeoutCount: samples.filter((sample) => sample.modelMs >= sample.timeoutMs && sample.timeoutMs > 0).length,
    fallbackCount: samples.filter((sample) => sample.fallbackUsed).length,
    latencyMs: stats("modelMs"),
    totalMs: stats("totalMs"),
    factPackChars: stats("factPackChars"),
    inputChars: stats("inputChars"),
    inputTokens: stats("inputTokens"),
    systemChars: stats("systemChars"),
    payloadChars: stats("payloadChars"),
    validationMs: stats("validationMs"),
    samples,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
