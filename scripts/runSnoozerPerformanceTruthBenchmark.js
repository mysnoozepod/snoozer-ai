#!/usr/bin/env node

"use strict";

const manifest = require("../data/showroom-manifest.v1.json");
const { runSnoozerConversationCore } = require("../services/askSnoozerModelCore");

const ITERATIONS = Math.max(5, Math.min(100, Number(process.argv[2] || 30)));
const HANDLE = "12-all-foam-mattress";
const ENV = {
  ASK_SNOOZER_CONVERSATION_CORE_MODE: "active",
  ASK_SNOOZER_CONVERSATION_CORE_MODEL: "gpt-6.1-sol",
  ASK_SNOOZER_CONVERSATION_CORE_REASONING_EFFORT: "low",
  ASK_SNOOZER_CONVERSATION_CORE_MAX_TOOL_ROUNDS: "2",
  ASK_SNOOZER_CONVERSATION_CORE_MAX_TOOL_CALLS: "6",
  ASK_SNOOZER_CONVERSATION_CORE_TOTAL_TIMEOUT_MS: "5000",
  ASK_SNOOZER_CONVERSATION_CORE_MODEL_TIMEOUT_MS: "2000",
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(ordered.length * fraction) - 1);
  return ordered[index];
}

function structuredAnswer() {
  const text = "The 12-inch All Foam remains the grounded option for the pressure relief you asked about.";
  return JSON.stringify({
    reply: text,
    speech: text,
    captions: text,
    state: "speaking",
    priority: "normal",
    ttlMs: 5000,
    responseMode: "answer",
    productHandles: [HANDLE],
    chips: [],
    actionProposals: [],
    preferences: [],
    references: {
      presentedProductHandles: [HANDLE],
      comparisonProductHandles: [],
      lastDiscussedProductHandle: HANDLE,
      lastDiscussedBaseHandle: null,
    },
    decisions: [],
    claims: [{
      kind: "product",
      value: "Pressure relief construction.",
      sourceTool: "get_product_facts",
      sourceKey: HANDLE,
    }],
    monetaryClaims: [],
    fallback: { used: false, reason: null },
  });
}

async function runIteration(iteration) {
  let modelCall = 0;
  let factPackExecutions = 0;
  const runtime = async () => {
    modelCall += 1;
    if (modelCall === 1) {
      const argumentsJson = JSON.stringify({
        productHandles: [HANDLE],
        factClasses: ["product_features", "comfort", "support", "temperature", "partner_fit"],
      });
      return {
        text: "",
        output: [{ type: "function_call", name: "get_product_facts", call_id: `facts_${iteration}`, arguments: argumentsJson }],
        functionCalls: [{ name: "get_product_facts", callId: `facts_${iteration}`, arguments: argumentsJson }],
        tokens: { prompt: 200, cached: 100, completion: 20, reasoning: 0, total: 220 },
      };
    }
    return {
      text: structuredAnswer(),
      output: [],
      functionCalls: [],
      tokens: { prompt: 300, cached: 150, completion: 60, reasoning: 0, total: 360 },
    };
  };
  const startedAt = Date.now();
  const result = await runSnoozerConversationCore({
    requestId: `performance-truth-${iteration}`,
    message: "Why is that mattress still the better fit for my pressure relief needs?",
    context: {
      snoozerConversationState: {
        references: {
          presentedProductHandles: [HANDLE],
          comparisonProductHandles: [],
          lastDiscussedProductHandle: HANDLE,
          lastDiscussedBaseHandle: null,
        },
      },
    },
    shopify: { fetchProductsByHandles: async () => ({ items: [] }) },
    runtime,
    env: ENV,
    toolOverrides: {
      manifest,
      loadTrustedAdvisorFactPack: async ({ productHandles = [] } = {}) => {
        factPackExecutions += 1;
        await wait(35);
        return {
          productFacts: productHandles.map((handle) => ({
            handle,
            status: "verified_fact",
            sourceKey: `products/${handle}.md`,
            facts: ["Pressure relief construction."],
          })),
        };
      },
    },
  });
  if (!result.ok) throw new Error(`Benchmark iteration failed: ${JSON.stringify(result.telemetry)}`);
  return {
    totalMs: Date.now() - startedAt,
    factPackExecutions,
    modelCalls: result.telemetry.modelCallCount,
    proposedToolCalls: result.telemetry.toolCallCount,
    executedToolCalls: result.telemetry.toolExecutionCount ?? factPackExecutions,
    duplicateCallsAvoided: result.telemetry.duplicateCallsAvoided || 0,
    inputTokens: result.telemetry.usage?.prompt || 0,
    outputTokens: result.telemetry.usage?.completion || 0,
  };
}

async function main() {
  const samples = [];
  for (let index = 0; index < ITERATIONS; index += 1) samples.push(await runIteration(index));
  const totals = samples.map((sample) => sample.totalMs);
  const report = {
    benchmark: "performance-truth-engine-v2-follow-up-evidence-reuse",
    iterations: ITERATIONS,
    p50Ms: percentile(totals, 0.5),
    p95Ms: percentile(totals, 0.95),
    modelCallsPerTurn: samples[0].modelCalls,
    proposedToolCallsPerTurn: samples[0].proposedToolCalls,
    executedToolCallsPerTurn: samples[0].executedToolCalls,
    duplicateCallsAvoidedPerTurn: samples[0].duplicateCallsAvoided,
    inputTokensPerTurn: samples[0].inputTokens,
    outputTokensPerTurn: samples[0].outputTokens,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
