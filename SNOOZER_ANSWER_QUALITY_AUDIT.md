# Snoozer Answer Quality Audit

Starting branch: `main`

Starting latest commit observed before edits: `efe653b Add showroom regression matrix and stability checks`

Unrelated dirty files/artifacts were already present in the worktree and are not part of this pass.

## Summary

The architecture is in better shape than the copy. `/ask-snoozer` already routes canonical recommendations, policy, commerce, product education, FAQ, and fallback paths before the model path. The quality failures come from thin deterministic templates, weak final model instructions, and tests that previously accepted a response as long as JSON existed.

## Golden Question Audit

| Question | Detected lane | Source selected | Model used | Pre-change answer pattern | Grade | Failure reason | Required fix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Why is this pod recommended for me? | canonical recommendation | canonical resolver/profile | none | Specific but often started with "Got it" and compressed the reason too aggressively. | needs work | tone and specificity | Improve canonical voice template. |
| What mattress do you recommend for me? | canonical recommendation | canonical resolver/profile | none | Named matched mattress but did not always explain feel tradeoff. | needs work | weak next step | Improve canonical voice template and tests. |
| Compare my top mattresses. | product comparison | S3/product/canon when present | none/model fallback depending context | Foam vs hybrid template was safe but generic. | needs work | thin comparison | Tighten voice and quality assertions. |
| What if I sleep hot? | product education | S3/product/canon when present | none | "Start with airflow" phrasing was useful but too generic. | needs work | generic/slop | Replace with cooling setup guidance. |
| What if I have back pain? | product education | S3/product/canon when present | none | Support-first answer existed but was too terse. | needs work | weak medical guardrail | Add no-diagnosis language and testable quality. |
| I sleep on my side. What should I look for? | product education | S3/product/canon when present | none | Mentioned shoulder/hip but lacked spine/support clarity. | needs work | incomplete education | Tighten side-sleeper template. |
| My partner moves a lot. What matters? | product comparison/couple fit | S3/product/canon when present | none | Couple conflict route existed, but answer could over-focus current product. | needs work | thin tradeoff | Keep partner-friendly comparison voice. |
| Do I need an adjustable base? | base education | S3/product/canon when present | none | Over-emphasized elevation and snoring. | fail | unsupported medical implication risk | Reframe as comfort/control, not required. |
| What is your return policy? | policy | S3/local policy | none | Source-grounded but did not consistently match founder-approved concise version. | needs work | weak policy copy | Improve route policy builder. |
| How does delivery work? | policy | S3/local policy | none | Source-grounded, but answer did not consistently remind checkout confirmation. | needs work | weak next step | Improve delivery policy builder. |
| Can I finance this? | policy | S3/local skills | none | Source-grounded, but could over-emphasize 0% APR. | needs work | financing specificity risk | Make checkout terms the boundary. |
| I do not know what to choose. Help me decide. | recommendation/session guidance | canonical/context or fallback | none/model fallback | Missing context path was safe, but generic. | needs work | weak guidance | Improve fallback voice and tests. |
| What happens after I buy? | policy/commerce boundary | Shopify/checkout boundary | none/model fallback | Not consistently covered by golden tests. | needs work | missing regression | Document golden target. |
| Can I talk to a human? | support fallback | deterministic support | none | Existing answer safe, slightly operational. | pass with notes | tone could improve later | Keep no feature changes. |
| Why is this one more expensive? | commerce/product compare | Shopify/catalog boundary | none/model fallback | Risk of guessing if model path used. | needs work | commerce boundary | Strengthen prompt guardrails. |

## Most Common Failure Categories

- `generic/slop`: fallback and model path could sound like a generic chatbot.
- `weak next step`: several deterministic answers explained but did not guide what to do next.
- `policy not grounded enough in wording`: policy retrieval was present, but copy did not always honor the founder-approved concise framing.
- `unsupported claim risk`: adjustable-base and back-pain language needed stronger medical/necessity boundaries.
- `tests too shallow`: previous smoke test asserted renderable text and no runtime leaks, not answer quality.

## Fixes Applied In This Pass

- Added `SNOOZER_ANSWER_QUALITY_STANDARD.md`.
- Added `SNOOZER_GOLDEN_ANSWERS.md`.
- Upgraded shared Snoozer voice templates in `services/snoozerVoice.js`.
- Improved route policy copy in `services/askSnoozerPolicy.js`.
- Strengthened model fallback guardrails and moved final model fallback to `OPENAI_FINAL_MODEL || gpt-4o` in `services/openai.js`.
- Expanded `/ask-snoozer` and `/ask` route smoke tests with quality assertions in `tests/runAskSnoozerRouteSmokeTests.js`.
