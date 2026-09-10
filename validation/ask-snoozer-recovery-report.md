# Ask Snoozer recovery evaluation report

Generated for Big Pass 3 on 2026-09-10.

## Result

- Evaluation version: `ask-snoozer-recovery-eval-v1`
- Recovery cases: 12
- Criteria per case: 10
- Criteria passed: 120/120
- Complete recoveries: 12/12
- Deterministic recovery success rate: 100%
- Human validation: not performed; this is repository-side deterministic evaluation only

## Covered recovery cases

1. Shopper corrects “the other one.”
2. Shopper changes size after a quote.
3. Shopper changes a bundle to mattress-only.
4. Shopper contradicts an earlier firmness preference.
5. Shopper returns to a product discussed six turns earlier.
6. “That one” is genuinely ambiguous.
7. Model composition is rejected and safely falls back.
8. Shopper says Snoozer misunderstood.
9. Shopper changes their mind after an objection.
10. A changed configuration becomes incompatible.
11. A cart action cannot be completed safely.
12. An active visit expires and the shopper returns.

## Scoring contract

Each case must recognize the problem, preserve valid context, discard invalid context, maintain commercial truth, acknowledge the correction naturally, avoid defensiveness, avoid restarting, avoid an unnecessary assessment, offer the correct next action, and complete the recovery.

Reproduce with:

```text
node tests/runAskSnoozerRecoveryEvaluations.js
```
