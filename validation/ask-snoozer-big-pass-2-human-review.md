# Ask Snoozer Big Pass 2 — human-reviewable quality scorecard

Date: 2026-09-09
Scope: 12 multi-turn shopper conversations, 60 turns, plus adversarial model-composition checks.
Scale: 1 (unacceptable) to 5 (showroom-ready). This review is a repository-side qualitative review, not an independent customer study.

| Dimension | Score | Review note |
|---|---:|---|
| Engagement | 4 | Answers directly engage the shopper's decision; some deterministic lanes remain intentionally concise. |
| Probing discipline | 4 | At most one probe is enforced and every lane offers a forward path; live model wording still needs showroom observation. |
| Decisiveness | 5 | Advisor makes a recommendation and says when to save money. |
| Conversation continuity | 5 | Active product, recent product/base, goal, preference, quote, and stage persist across turns and devices. |
| Pronoun/reference handling | 5 | Common phrases resolve against pre-turn state before current-turn entities can change focus; automated score was 60/60. |
| Recommendation stability | 5 | Canonical recommendation remains assessment-owned through follow-ups. |
| Price integrity | 5 | Only Shopify-resolved line prices and subtotal may appear. |
| Compatibility integrity | 5 | Split-motion and incompatible-pair contradictions are rejected after composition. |
| Bundle arithmetic | 5 | Line items and subtotal are computed before wording; the model cannot calculate them. |
| Cart safety | 5 | Actions remain deterministic and require exact, available variant IDs. |
| Value honesty | 5 | The advisor explicitly recommends skipping an unhelpful base. |
| Natural shopper language | 4 | Expanded natural phrasings substantially; a few template phrases can still be polished. |
| Plain-language firewall | 5 | Internal implementation vocabulary is blocked from shopper-facing output. |
| Completeness/no truncation | 5 | Complete endings are enforced for display and voice outputs. |
| Voice suitability | 4 | Voice is separately bounded to two short sentences; showroom audio cadence remains a physical acceptance item. |
| Medical safety | 5 | General comfort guidance is allowed; diagnosis, treatment, and therapy replacement are refused. |

Average qualitative score: **4.8 / 5**.

Automated companion score: 60/60 across all 16 dimensions. Six of 60 turns selected bounded model assistance; the remaining 54 stayed deterministic.

Known review risks:

- The live model and actual TTS cadence must be checked after deployment.
- Some conservative failure replies lead to confirmation or human assistance instead of a cart action; this is intentional when exact variants cannot be verified.
- Physical showroom acceptance, shopper comprehension, and conversion lift require observed sessions rather than repository tests alone.
