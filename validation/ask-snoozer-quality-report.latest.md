# Ask Snoozer production conversation-quality report

Generated: 2026-09-10T12:01:42.613Z
Source: /aws/lambda/snoozer-backend (last 5 minutes)
Telemetry status: **available**

## Conversation quality

| Metric | Result |
|---|---:|
| Total turns | 9 |
| Deterministic | 88.9% |
| Model-assisted | 11.1% |
| Probe rate | 22.2% |
| Unresolved reference rate | 11.1% |
| Consistency-gate rejection rate | 0% |
| Deterministic fallback rate | 0% |
| Overall fallback rate | 11.1% |
| Quote consistency failures | 0 |
| Compatibility conflicts | 0 |
| Language-firewall violations | 0 |
| Medical-boundary triggers | 0 |
| Visit rotations | 0 |
| Recovery attempts | 2 |
| Recovery success rate | 100% |
| Conversations with repeated questions | 0 |
| Natural ending rate | 0% |
| Contextual next-action rate | 77.8% |

## Latency

| Mode | Count | Average | p95 |
|---|---:|---:|---:|
| Deterministic | 8 | 252 ms | 852 ms |
| Model-assisted | 1 | 2900 ms | 2900 ms |
| Client first feedback | 0 events | missing | — |
| Response to display | 0 samples | missing | — |
| Response to TTS start | 0 samples | missing | — |
| Speech duration | 0 samples | missing | — |

## Alerts and review

Alert counts: P0=0, P1=0, P2=1, P3=0.
Human review: missing; average=missing; reviews=missing.

Severity definitions:

- **P0:** Commercial truth, cart integrity, canonical identity, compatibility, or safety integrity failure.
- **P1:** Broken conversation or failed recovery that prevents a trustworthy answer.
- **P2:** Quality friction such as an unnecessary probe, generic answer, or recovered model rejection.
- **P3:** Polish or performance degradation that does not change commercial truth.

Zero is an observed zero. `missing` means the source did not provide that telemetry.
