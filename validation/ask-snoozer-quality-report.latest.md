# Ask Snoozer production conversation-quality report

Generated: 2026-09-10T11:50:44.919Z
Source: /aws/lambda/snoozer-backend (last 30 minutes)
Telemetry status: **available**

## Conversation quality

| Metric | Result |
|---|---:|
| Total turns | 28 |
| Deterministic | 92.9% |
| Model-assisted | 7.1% |
| Probe rate | 3.6% |
| Unresolved reference rate | 3.6% |
| Consistency-gate rejection rate | 0% |
| Deterministic fallback rate | 0% |
| Overall fallback rate | 0% |
| Quote consistency failures | 0 |
| Compatibility conflicts | 0 |
| Language-firewall violations | 0 |
| Medical-boundary triggers | 0 |
| Visit rotations | 1 |
| Recovery attempts | 4 |
| Recovery success rate | 100% |
| Conversations with repeated questions | 0 |
| Natural ending rate | 0% |
| Contextual next-action rate | 96.4% |

## Latency

| Mode | Count | Average | p95 |
|---|---:|---:|---:|
| Deterministic | 26 | 147 ms | 585 ms |
| Model-assisted | 2 | 2158 ms | 2439 ms |
| Client first feedback | 0 events | missing | — |
| Response to display | 0 samples | missing | — |
| Response to TTS start | 0 samples | missing | — |
| Speech duration | 0 samples | missing | — |

## Alerts and review

Alert counts: P0=0, P1=0, P2=0, P3=0.
Human review: missing; average=missing; reviews=missing.

Severity definitions:

- **P0:** Commercial truth, cart integrity, canonical identity, compatibility, or safety integrity failure.
- **P1:** Broken conversation or failed recovery that prevents a trustworthy answer.
- **P2:** Quality friction such as an unnecessary probe, generic answer, or recovered model rejection.
- **P3:** Polish or performance degradation that does not change commercial truth.

Zero is an observed zero. `missing` means the source did not provide that telemetry.
