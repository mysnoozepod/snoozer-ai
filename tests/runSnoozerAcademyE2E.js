#!/usr/bin/env node

const assert = require("assert");
const fixture = require("./fixtures/snoozer-academy.v1.json");

const API_BASE = String(
  process.env.ASK_SNOOZER_API_BASE || "https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod"
).replace(/\/$/, "");
const selectedId = String(process.env.SNOOZER_ACADEMY_SCENARIO || "").trim();
const suite = String(process.env.SNOOZER_ACADEMY_SUITE || "live").trim().toLowerCase();

function responseText(body) {
  return String(body?.reply || body?.message?.text || body?.speech || body?.captions || "").trim();
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function selectedScenarios() {
  let scenarios = fixture.scenarios;
  if (selectedId) scenarios = scenarios.filter((item) => item.id === selectedId);
  else if (suite === "october8") scenarios = scenarios.filter((item) => item.id === "october-8-regression");
  else if (suite === "live") scenarios = scenarios.filter((item) => item.live === true);
  if (!scenarios.length) throw new Error(`No Academy scenarios selected for scenario=${selectedId || "all"}, suite=${suite}.`);
  return scenarios;
}

async function ask({ scenarioId, turnIndex, message, sessionId }) {
  const startedAt = Date.now();
  const response = await fetch(`${API_BASE}/ask-snoozer`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-session-id": sessionId,
      "x-request-id": `academy-${scenarioId}-${turnIndex}-${Date.now()}`,
    },
    body: JSON.stringify({
      message,
      mode: "ask_snoozer_page",
      source: "snoozer_academy_live",
      surface: "snoozer_academy_live",
      sessionId,
      testCaseId: `academy-${scenarioId}-${turnIndex}`,
    }),
  });
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { throw new Error(`${scenarioId}/${turnIndex} returned non-JSON HTTP ${response.status}: ${raw.slice(0, 400)}`); }
  return { response, body, elapsedMs: Date.now() - startedAt };
}

function validateTurn({ scenario, turn, turnIndex, response, body }) {
  const label = `${scenario.id}/${turnIndex + 1}`;
  assert.equal(response.status, 200, `${label} HTTP ${response.status}`);
  assert(body?.ok !== false, `${label} returned ok=false: ${JSON.stringify(body?.error || body?.reply)}`);
  const reply = responseText(body);
  assert(reply.length > 0, `${label} returned no shopper-visible reply`);
  assert(/[.!?]["')\]]?$/.test(reply), `${label} reply is incomplete: ${reply}`);
  assert(!/\b(?:shopify|s3|backend|resolver|database|function call|language model)\b/i.test(reply), `${label} leaked internal language: ${reply}`);
  assert(!/\bundefined\b|\bnull\b|ReferenceError/i.test(reply), `${label} leaked runtime data: ${reply}`);
  assert.equal(body?.metadata?.answerPath, "conversation_core", `${label} did not use the Conversation Core`);
  assert.equal(body?.metadata?.model, "gpt-6.1-sol", `${label} did not report GPT-6.1 Sol`);
  if (turn.allowFallback !== true) {
    assert.notEqual(body?.metadata?.metrics?.fallbackUsed, true, `${label} used fallback: ${reply}`);
  }
  if (turn.expectFallback === true) {
    assert.equal(body?.metadata?.metrics?.fallbackUsed, true, `${label} expected a classified fallback: ${reply}`);
  }
  const lower = reply.toLowerCase().replace(/[’‘]/g, "'");
  if (Array.isArray(turn.containsAny) && turn.containsAny.length) {
    assert(turn.containsAny.some((term) => lower.includes(String(term).toLowerCase().replace(/[’‘]/g, "'"))), `${label} missing expected concepts ${turn.containsAny.join(", ")}: ${reply}`);
  }
  if (Array.isArray(turn.containsAll) && turn.containsAll.length) {
    for (const term of turn.containsAll) {
      assert(lower.includes(String(term).toLowerCase().replace(/[’‘]/g, "'")), `${label} missing required continuity concept ${term}: ${reply}`);
    }
  }
  for (const forbidden of turn.forbidden || []) {
    assert(!lower.includes(String(forbidden).toLowerCase().replace(/[’‘]/g, "'")), `${label} included forbidden phrase ${forbidden}: ${reply}`);
  }
  if (Number(turn.minProducts) > 0) {
    assert((body.products || []).length >= Number(turn.minProducts), `${label} expected ${turn.minProducts} grounded product cards, got ${(body.products || []).length}`);
  }
  if (turn.expectAction) {
    assert((body.actions || []).some((action) => action?.type === turn.expectAction), `${label} expected ${turn.expectAction} proposal`);
  }
  return reply;
}

async function main() {
  const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  const results = [];
  for (const scenario of selectedScenarios()) {
    if (!scenario.live) {
      results.push({ id: scenario.id, status: "covered_by_unit_tier", coveredBy: scenario.coveredBy });
      continue;
    }
    const sessionId = `academy-${scenario.id}-${runId}`.slice(0, 120);
    const turns = [];
    for (let index = 0; index < scenario.turns.length; index += 1) {
      const turn = scenario.turns[index];
      const result = await ask({ scenarioId: scenario.id, turnIndex: index + 1, message: turn.message, sessionId });
      const reply = validateTurn({ scenario, turn, turnIndex: index, ...result });
      turns.push({
        turn: index + 1,
        elapsedMs: result.elapsedMs,
        modelMs: result.body?.metadata?.metrics?.modelMs ?? null,
        modelCallCount: result.body?.metadata?.metrics?.modelCallCount ?? null,
        products: (result.body?.products || []).map((item) => item.handle),
        actions: (result.body?.actions || []).map((item) => item.type),
        estimatedCostUsd: result.body?.metadata?.conversationCore?.estimatedCostUsd ?? null,
        reply,
      });
    }
    results.push({ id: scenario.id, status: "passed", sessionId, turns });
  }
  const liveTurns = results.flatMap((item) => item.turns || []);
  const latencies = liveTurns.map((item) => item.elapsedMs);
  console.log(JSON.stringify({
    ok: true,
    academyVersion: fixture.version,
    apiBase: API_BASE,
    suite,
    scenarioCount: results.length,
    liveTurnCount: liveTurns.length,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    totalEstimatedCostUsd: liveTurns.reduce((sum, item) => sum + Number(item.estimatedCostUsd || 0), 0),
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
