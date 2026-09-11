# Ask Snoozer production conversation-quality report

Generated: 2026-09-11T06:59:21.363Z
Source: /aws/lambda/snoozer-backend (last 240 minutes)
Telemetry status: **available**

## Conversation quality

| Metric | Result |
|---|---:|
| Total turns | 30 |
| Deterministic | 96.7% |
| Model-assisted | 3.3% |
| Probe rate | 3.3% |
| Successful advancement | 73.3% |
| Neutral complete | 6.7% |
| Friction | 13.3% |
| Recovery outcomes | 6.7% |
| Ready-goal completion | 75% |
| Commercial stranding | 2 |
| Repeated known question | 1 |
| Quote presented when ready | 75% |
| Compatibility resolved when possible | 100% |
| Unresolved reference rate | 3.3% |
| Consistency-gate rejection rate | 0% |
| Deterministic fallback rate | 0% |
| Overall fallback rate | 3.3% |
| Quote consistency failures | 0 |
| Compatibility conflicts | 0 |
| Language-firewall violations | 0 |
| Medical-boundary triggers | 0 |
| Visit rotations | 0 |
| Recovery attempts | 3 |
| Recovery success rate | 100% |
| Conversations with repeated questions | 0 |
| Natural ending rate | 3.3% |
| Justified natural-ending rate | 3.3% |
| Contextual next-action rate | 86.7% |
| Generic-answer rate | 0% |

## Latency

| Mode | Count | Average | p95 |
|---|---:|---:|---:|
| Deterministic | 29 | 546 ms | 1945 ms |
| Model-assisted | 1 | 2942 ms | 2942 ms |
| Client first feedback | 22 events | 32 ms avg | — |
| Response to display | 9 samples | 533 ms avg | — |
| Response to TTS start | 7 samples | 2636 ms avg | — |
| Speech queue wait | 7 samples | 2 ms avg | — |
| TTS preparation | 7 samples | 2634 ms avg | — |
| Speech duration | 3 samples | 13359 ms avg | — |
| Superseded speech | 3 events | 0 stale plays prevented | — |

## Alerts and review

Alert counts: P0=0, P1=3, P2=1, P3=2.
Human review: missing; average=missing; reviews=missing.

Severity definitions:

- **P0:** Commercial truth, cart integrity, canonical identity, compatibility, or safety integrity failure.
- **P1:** Broken conversation or failed recovery that prevents a trustworthy answer.
- **P2:** Quality friction such as an unnecessary probe, generic answer, or recovered model rejection.
- **P3:** Polish or performance degradation that does not change commercial truth.

Zero is an observed zero. `missing` means the source did not provide that telemetry.
