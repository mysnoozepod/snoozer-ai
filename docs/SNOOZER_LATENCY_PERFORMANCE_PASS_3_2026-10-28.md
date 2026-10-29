# Snoozer Latency Optimization — Performance Pass 3

Date: 2026-10-28  
Branch: `codex/snoozer-latency-pass3-20261028`

## Outcome

**ACCEPT WITH LIMITATIONS.**

The optimized backend is deployed to the designated test Lambda and published as immutable version 20. It preserves the validated model, strict response contract, authoritative tools, state model, checkout behavior, and Node.js 24 runtime. Version 19 remains the known-good rollback.

The single production behavior change requests low-verbosity output from the same `gpt-6.1-sol` model while retaining low reasoning effort, the complete strict JSON schema, all seven tools, the 1,800-token safety ceiling, and all server-side validation.

This produced material median improvements on comparable live workloads with no required-gate correctness failure:

- Academy trust P50: 7,534/7,716 ms on version 19; 5,702/6,585 ms on version 20.
- Trusted Advisor average: 8,360/8,700 ms on version 19; 7,316/7,200 ms on version 20.
- Five-category directional benchmark: every category median improved by 118–626 ms.
- Zero fallbacks, corrections, or validation failures in the final category and Academy runs.

The target is not consistently met. The final 15-sample category benchmark was approximately 5,081 ms P50 and 7,152 ms P95, but Academy and Trusted Advisor tails still exceeded 10 seconds. The test account also reached its regional concurrency limit during browser acceptance.

The backend is suitable for controlled physical MVP software testing. This is not a production-readiness or physical-hardware acceptance declaration.

## A. Version 19 baseline and critical path

### Verified starting point

- Starting commit: `962db82dfaa0bceb3d1efa80f68607b11c042416`.
- Git ancestry: the performance branch was created directly from the validated recovery tip.
- Lambda: `snoozer-backend`, `us-east-1`.
- Runtime/handler: `nodejs24.x` / `index.lambdaHandler`.
- Version 19 and starting `$LATEST` hash: `A7S7Rsh8kq/NJBCOhC9jA9E9p90KYnYUFb7lmo10lJQ=`.
- Memory/timeout/architecture: 1,024 MB / 50 seconds / x86_64.
- All 25 HTTP API integrations used the unqualified Lambda ARN and therefore targeted `$LATEST`.
- No function-level reserved concurrency; regional concurrency quota was 10.

### Baseline category benchmark

Three samples per category were run sequentially. P95 values are directional at this sample size.

| Category | Client P50/P95 | Backend P50/P95 | Model P50/P95 | Retrieval P50/P95 | Calls/tools | Input/cached/output tokens | Fallback/validation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Simple | 4,767 / 5,289 ms | 4,544 / 4,647 ms | 4,491 / 4,589 ms | 0 / 0 ms | 1 / 0 | 2,811 / 2,808 / 223 | 0 / 0 |
| Product knowledge | 6,933 / 13,553 ms | 6,807 / 13,435 ms | 6,751 / 13,368 ms | 1 / 199 ms | 1 / 1 | 4,202 / 2,530 / 384 | 0 / 0 |
| Commerce | 3,818 / 4,039 ms | 3,757 / 3,972 ms | 3,691 / 3,918 ms | 1 / 2 ms | 1 / 2 | 4,437 / 2,530 / 256 | 0 / 0 |
| Multi-turn reasoning | 6,718 / 7,207 ms | 6,160 / 6,525 ms | 5,845 / 6,472 ms | 1 / 123 ms | 1 / 1 | 4,538 / 2,530 / 386 | 0 / 0 |
| Journey state | 5,199 / 5,247 ms | 4,846 / 4,915 ms | 4,809 / 4,878 ms | 1 / 1 ms | 1 / 2 | 4,574 / 2,530 / 260 | 0 / 0 |

The baseline Lambda/API window had 25 invocations, zero execution errors, zero throttles, and maximum concurrency 1. Lambda Duration was 5,229 ms P50, 7,030 ms P95, and 13,205 ms P99. API Gateway integration latency closely matched total API latency, so Gateway processing was not a separate bottleneck.

The first cold report showed 692 ms initialization, 6,217 ms execution, and 141 MB maximum memory. Warm maximum memory was approximately 158 MB.

### Ranked contributors by recoverable milliseconds

| Rank | Contributor | Measured duration/frequency | Critical path | Why/necessity | Safe opportunity and risk |
| --- | --- | --- | --- | --- | --- |
| 1 | OpenAI response request | Approximately 3.4–13.4 seconds on every model turn | Yes | Required semantic reasoning and structured answer | Reduce unnecessary output. Risk: shorter output can omit response fields or grounded products, so full semantic gates are mandatory. |
| 2 | Additional tool-driven model rounds | Approximately 1.5–3.8 seconds per additional round; Academy turns 1/2 used two calls and turn 7 used three | Yes | Necessary evidence acquisition and post-tool answer composition | No safe round was found to remove. Natural-language keyword routing was rejected as brittle and out of scope. |
| 3 | Lambda cold start | 692 ms on the observed cold invocation | Yes, cold only | Runtime/module initialization | Provisioned concurrency was excluded. Memory was not increased because execution was network/model dominated and memory use was low. |
| 4 | First-use evidence/card hydration | Approximately 123–225 ms on cold S3/Shopify/product hydration; 0–2 ms warm | Yes when used | Authoritative product and commerce truth | Existing cache and request-scoped parallel reuse already remove most warm overhead. Skipping live truth was not acceptable. |
| 5 | Request/state/validation/persistence/serialization | Usually 30–90 ms combined; validation 0–2 ms | Yes | Identity, state integrity, validation, and durable journey continuity | Too little recoverable time to justify correctness risk. |

Model time accounted for more than 90% of most measured shopper turns. OpenAI network time could not be separated from remote inference time; the measured model-call duration is therefore reported honestly as the full Responses request.

## B. Optimization

| Component | Problem | Change | Measured savings | Risk |
| --- | --- | --- | ---: | --- |
| Measurement | No repeatable live category harness | Added `benchmark:ask-snoozer-latency:live` with five categories, request IDs, lifecycle timing, calls, tool work, tokens, cost, fallback, and validation telemetry | Enables comparable baseline/final measurement; no runtime saving claimed | Test-only |
| Model output | Structured responses used 200–400 output tokens even for concise shopper answers | Added `text.verbosity = "low"` while preserving model, reasoning, tools, strict schema, output ceiling, and validation | Category median: 118–626 ms; Academy median: 949–2,014 ms across paired runs; Trusted Advisor average: 1,044–1,500 ms | Model may choose less content. Mitigated by all local and live truth/continuity gates. |

No model family, reasoning effort, tool schema, business logic, product truth, state reducer, cart/checkout path, memory, timeout, or concurrency configuration was changed.

The full live Academy `budget-language-spectrum` scenario exposed a turn-8 product-card assertion failure. The exact failure reproduced after restoring version 19, proving it was not introduced by low verbosity. It remains a baseline fixture/live behavior issue and is listed under limitations.

## C. Before-and-after live benchmarks

### Directional category benchmark

| Category | Version 19 client P50/P95 | Version 20 client P50/P95 | Median change | Output tokens, v19 → v20 | Cost/turn, v19 → v20 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Simple | 4,767 / 5,289 ms | 4,641 / 5,019 ms | −126 ms | 223 → 195 | $0.002520 → $0.004015* |
| Product knowledge | 6,933 / 13,553 ms | 6,307 / 6,462 ms | −626 ms | 384 → 359 | $0.007434 → $0.007190 |
| Commerce | 3,818 / 4,039 ms | 3,410 / 3,732 ms | −408 ms | 256 → 237 | $0.006630 → $0.006437 |
| Multi-turn reasoning | 6,718 / 7,207 ms | 6,236 / 7,152 ms | −482 ms | 386 → 372 | $0.008126 → $0.007976 |
| Journey state | 5,199 / 5,247 ms | 5,081 / 5,359 ms | −118 ms | 260 → 279 | $0.006945 → $0.007093 |

*The optimized simple average included the first uncached prompt; its three-sample cached-token average was 1,872 versus 2,808 in the warmed baseline. This cost comparison is cache-state sensitive. Across categories there was no systematic cost increase: three improved, one was nearly flat, and the uncached simple sample increased.

All category runs used one model call on their measured target turn. Tool executions remained 0/1/2/1/2 by category. Final fallback and validation-failure rates were 0%.

### Academy trust scenario

| Run | Version 19 P50/P95 | Version 20 P50/P95 | Model/tool calls | Fallbacks/recoveries |
| --- | ---: | ---: | ---: | ---: |
| 1 | 7,534 / 11,100 ms | 5,702 / 10,510 ms | 13 / 4 | 0 / 0 |
| 2 | 7,716 / 11,242 ms | 6,585 / 12,693 ms | 13 / 4 | 0 / 0 |

Version 20 passed 9/9 turns twice. Turn 7 remained the tail because it required three model calls and two evidence tools. The P50 improved materially; the P95 target was not consistently met.

### Trusted Advisor

| Run | Version 19 average/P95 | Version 20 average/P95 | Result |
| --- | ---: | ---: | --- |
| 1 | 8,360 / 12,315 ms | 7,316 / 10,727 ms | 10/10 plus cross-device continuity passed |
| 2 | 8,700 / 14,983 ms | 7,200 / 11,766 ms | 10/10 plus cross-device continuity passed |

### Shopper-perceived responsiveness

The existing frontend already sets the Ask Snoozer pending/thinking state before the network request, renders a visible “Snoozer is thinking” status, inserts validated captions after the response, and requests speech afterward. Caption insertion precedes the speech request, and speech failure is caught without removing captions.

In the final CloudWatch window, 18 client display-timing events reported:

- Request-to-first-feedback average: 16.7 ms.
- Response-to-display average: 12.3 ms.
- Backend round-trip P50/P95: 4,845 / 6,111 ms.
- Request-to-display average: 4,918 ms.
- Backend-reported average: 4,591 ms.

No `tts_start` event was recorded in this window, so first-audible-speech latency was not live-validated. The source path and captions-only failure behavior are present, but live Polly timing remains a follow-up measurement.

### AWS final window

The 46-minute deployment/acceptance window contained mixed API, Academy, and browser traffic:

- Lambda: 355 invocations, zero execution errors, two throttles.
- Maximum concurrency reached 10; the throttles occurred during bursty two-browser frontend traffic.
- API Gateway: 349 requests, one 4xx, two 5xx.
- Lambda Duration: 170 ms P50, 9,082 ms P95, 12,204 ms P99 across all routes.
- API Latency: 236 ms P50, 9,176 ms P95, 12,648 ms P99; IntegrationLatency was 232/9,171/12,645 ms.
- Conversation logs: 148 validated Conversation Core responses; zero fallback response logs, model failures, claim-source errors, or response-validation errors.

The aggregate AWS P50 includes many non-model routes and is not used as the shopper-answer comparison. The two throttles and two 5xx responses confirm the existing regional concurrency-10 capacity risk; they are not evidence of slower single-request inference.

## D. Correctness gates

| Gate | Result |
| --- | --- |
| Conversation Core and route | Passed |
| Existing Trusted Advisor fixture | Passed: 10 exact turns, 12 commerce turns, 12 planner/depth cases |
| Continuity/grounding | Passed: 8 transcripts |
| Truth lanes and provenance | Passed: 14/14 plus semantic integrity/authority |
| Budget and monetary recovery | Passed |
| Reliability, timeout, retry, and circuit breaker | Passed |
| Shopify API versions and configuration quote | Passed |
| Typed actions | Passed: 39 checks |
| Active Journey local | Passed: 22/22, routes 15/15, acceptance passed |
| Rewards foundation/configuration/identity/production | Passed |
| Integration-secret boundary | Passed: 7/7 |
| Node.js 24 Lambda compatibility | Passed on Node v24.13.0; async handler, CommonJS, bundled AWS SDK v3 |
| V2 deterministic benchmark | 48 ms P50 / 62 ms P95; unchanged 2 model calls, one proposed/executed tool, one dedup hit |
| Realistic quality evaluation | Passed 60/60 across all 16 dimensions |
| Academy trust live | Passed 9/9 twice on final hash |
| Trusted Advisor live | Passed 10/10 plus cross-device continuity twice on final hash |
| Active Journey live | Passed twice across two browsers on final hash |
| New five-category live benchmark | Passed; zero fallbacks/validation failures |

No assertions were weakened.

## E. Deployment, source, and rollback

- Starting commit: `962db82dfaa0bceb3d1efa80f68607b11c042416`.
- Benchmark commit: `cfa6242`.
- Deployed source commit: `a704c0e441d61500eec86ca38bc029a364504377`.
- Deployment-package commit: `9a895d1`.
- Branch: `codex/snoozer-latency-pass3-20261028`.
- Lambda: `snoozer-backend`, `us-east-1`.
- Runtime/handler: `nodejs24.x` / `index.lambdaHandler`.
- Memory/timeout: 1,024 MB / 50 seconds.
- Active `$LATEST` and immutable version: version 20.
- Version 20 code hash: `VNwqPaOWHvdYLuUT1sam//kD6QapzrHCSZB9p1QxOP8=`.
- Version 20 ZIP SHA-256: `54dc2a3da3961ef7582ee513d6c6a6fff903e906a9ceb1c249907da7543138ff`.
- Rollback version: immutable version 19.
- Version 19 code hash: `A7S7Rsh8kq/NJBCOhC9jA9E9p90KYnYUFb7lmo10lJQ=`.
- Preserved version 19 ZIP SHA-256: `03b4bb46c87c92afcd24108e842f6303d13da7dd0a62761415bee59a8d749494`.
- HTTP API integrations remain unqualified and continue to invoke `$LATEST`.

## F. Recommendation and limitations

**ACCEPT WITH LIMITATIONS.**

Keep version 20 on the designated test backend. It is measurably faster on category medians, Academy medians, and Trusted Advisor averages/tails while preserving all required truth, commerce, state, identity, Rewards, cart, and cross-device gates.

Remaining limitations:

1. The P50 ≤5-second target was narrowly missed in the pooled category sample and was not met in Academy; P95 ≤10 seconds was not consistently met in Academy or Trusted Advisor.
2. Necessary multi-call evidence turns remain model-latency dominated.
3. The regional concurrency quota of 10 caused two observed throttles and two API 5xx responses during browser acceptance. Capacity remediation requires a separate, approved AWS change.
4. The `budget-language-spectrum` Academy turn-8 card assertion fails on both version 20 and version 19 and needs a separate fixture/behavior investigation.
5. First-audible Polly latency was not captured in the final window; captions and failure isolation are source-verified, not live-audio accepted here.
6. Version 20 is ready for controlled physical MVP software testing only. Production readiness and physical hardware acceptance remain open.
