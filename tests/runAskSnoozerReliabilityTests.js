#!/usr/bin/env node

const assert = require("assert");

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-only-openai-key";

const { fetchWithDeadline } = require("../services/boundedHttp");
const {
  callOpenAIResponses,
  classifyOpenAIError,
} = require("../services/openaiModelRuntime");
const {
  getConversationCoreConfig,
  runSnoozerConversationCore,
} = require("../services/askSnoozerModelCore");

function responseError(status, code = null, name = "Error") {
  const error = new Error(`fault ${status || code}`);
  error.name = name;
  if (status) error.response = { status, data: { error: "sanitized test fault" }, headers: {} };
  if (code) error.code = code;
  return error;
}

async function testNeverReturningHttpRequestIsBounded() {
  let transportAborted = false;
  const startedAt = Date.now();
  await assert.rejects(
    fetchWithDeadline("https://example.invalid/hang", {}, {
      timeoutMs: 40,
      label: "never-returning test request",
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          transportAborted = true;
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true });
      }),
    }),
    (error) => error.code === "HTTP_DEADLINE_EXCEEDED" && error.abortOrigin === "application_deadline"
  );
  const elapsedMs = Date.now() - startedAt;
  assert(transportAborted, "bounded client must abort the underlying transport");
  assert(elapsedMs >= 30 && elapsedMs < 500, `bounded client escaped outside deadline window: ${elapsedMs}ms`);
}

function testFailureClassificationMatrix() {
  const cases = [
    [responseError(null, "ECONNABORTED"), "sdk_timeout", true],
    [responseError(null, "ETIMEDOUT"), "sdk_timeout", true],
    [responseError(null, "ECONNRESET"), "transport_interruption", true],
    [responseError(429), "upstream_rate_limit", true],
    [responseError(500), "upstream_server_error", true],
    [responseError(502), "upstream_server_error", true],
    [responseError(503), "upstream_server_error", true],
    [responseError(400), "upstream_request_error", false],
  ];
  for (const [error, kind, transient] of cases) {
    const classified = classifyOpenAIError(error);
    assert.equal(classified.kind, kind);
    assert.equal(classified.transient, transient);
  }
  const aborted = classifyOpenAIError(responseError(null, "ERR_CANCELED", "CanceledError"), { applicationAbort: true });
  assert.equal(aborted.kind, "application_deadline");
  assert.equal(aborted.abortOrigin, "application_deadline");
  assert.equal(aborted.transient, false);
}

async function testBoundedRetryAndRetryExhaustion() {
  let attempts = 0;
  const successTransport = {
    async post() {
      attempts += 1;
      if (attempts === 1) throw responseError(null, "ECONNRESET");
      return {
        headers: { "x-request-id": "req_test_retry" },
        data: {
          id: "resp_test_retry",
          model: "gpt-6.1-sol",
          output_text: "ok",
          output: [],
          usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
        },
      };
    },
  };
  const recovered = await callOpenAIResponses({
    input: "test",
    reqId: "bounded-retry",
    deadlineAt: Date.now() + 12000,
    timeoutMs: 5000,
    transport: successTransport,
    maxRetries: 1,
    maxRetryWaitMs: 0,
  });
  assert.equal(recovered.id, "resp_test_retry");
  assert.equal(attempts, 2);

  attempts = 0;
  const exhaustedTransport = {
    async post() {
      attempts += 1;
      throw responseError(503);
    },
  };
  await assert.rejects(callOpenAIResponses({
    input: "test",
    reqId: "retry-budget-exhausted",
    deadlineAt: Date.now() + 6000,
    timeoutMs: 3000,
    transport: exhaustedTransport,
    maxRetries: 1,
    maxRetryWaitMs: 0,
  }), (error) => error.openaiFailure?.retryDecision === "stop");
  assert.equal(attempts, 1, "retry must not start without the minimum deadline budget");
}

async function testLambdaConstraintAndCircuitRecovery() {
  const env = {
    ASK_SNOOZER_CONVERSATION_CORE_MODE: "active",
    ASK_SNOOZER_CONVERSATION_CORE_MODEL: "gpt-6.1-sol",
    ASK_SNOOZER_CONVERSATION_CORE_TOTAL_TIMEOUT_MS: "5000",
    ASK_SNOOZER_CONVERSATION_CORE_MODEL_TIMEOUT_MS: "1000",
    ASK_SNOOZER_CONVERSATION_CORE_BREAKER_THRESHOLD: "1",
    ASK_SNOOZER_CONVERSATION_CORE_BREAKER_COOLDOWN_MS: "1000",
  };
  let runtimeCalls = 0;
  const noLambdaBudget = await runSnoozerConversationCore({
    requestId: "lambda-budget",
    message: "Help me compare mattresses.",
    context: {},
    env,
    remainingTimeMs: 6000,
    runtime: async () => { runtimeCalls += 1; throw new Error("must not run"); },
  });
  assert.equal(noLambdaBudget.fallback.reason, "lambda_deadline_insufficient");
  assert.equal(runtimeCalls, 0);
  assert.deepEqual(noLambdaBudget.actions, []);

  const failingRuntime = async () => {
    runtimeCalls += 1;
    throw responseError(null, "ECONNRESET");
  };
  const failed = await runSnoozerConversationCore({ requestId: "breaker-1", message: "Hello", context: {}, env, runtime: failingRuntime });
  assert.equal(failed.status, "fallback");
  const callsAfterFailure = runtimeCalls;
  const open = await runSnoozerConversationCore({ requestId: "breaker-2", message: "Hello", context: {}, env, runtime: failingRuntime });
  assert.equal(open.fallback.reason, "model_circuit_open");
  assert.equal(runtimeCalls, callsAfterFailure, "open circuit must not call the model transport");
  await new Promise((resolve) => setTimeout(resolve, 1050));
  await runSnoozerConversationCore({ requestId: "breaker-3", message: "Hello", context: {}, env, runtime: failingRuntime });
  assert.equal(runtimeCalls, callsAfterFailure + 1, "circuit must permit a probe after cooldown");
}

function testCoherentDefaults() {
  const config = getConversationCoreConfig({
    ASK_SNOOZER_MODEL_ONLY: "cc_active",
    OPENAI_FINAL_MODEL: "gpt-6.1-sol",
    MODEL_TIMEOUT_MS: "26000",
    OPENAI_TIMEOUT_MS: "18000",
  });
  assert.equal(config.totalTimeoutMs, 26000);
  assert.equal(config.modelTimeoutMs, 18000);
  assert(config.modelTimeoutMs < config.totalTimeoutMs);
}

async function main() {
  testFailureClassificationMatrix();
  testCoherentDefaults();
  await testNeverReturningHttpRequestIsBounded();
  await testBoundedRetryAndRetryExhaustion();
  await testLambdaConstraintAndCircuitRecovery();
  console.log(JSON.stringify({
    status: "passed",
    suite: "ask-snoozer-latency-reliability",
    coveredFaults: [
      "ECONNABORTED", "ETIMEDOUT", "ECONNRESET", "HTTP_429", "HTTP_500", "HTTP_502", "HTTP_503",
      "application_deadline", "lambda_remaining_time", "academy_client_hang", "retry_budget_exhaustion",
      "successful_bounded_retry", "circuit_breaker_open", "circuit_breaker_recovery",
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
