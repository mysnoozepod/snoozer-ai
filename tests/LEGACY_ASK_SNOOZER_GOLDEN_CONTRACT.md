# Retired Ask Snoozer HUD v1 golden contract

`tests/askSnoozerGoldenSet.json` is intentionally retained as historical evidence. It described the former `/hud/ask` contract, including root-level intent/confidence fields and a 220-character maximum reply. Those constraints conflict with the current dedicated Ask Snoozer station, normalized response metadata, separate display/voice text, commercial continuity, and variable response depth.

The old runner is therefore retired rather than silently adjusted. `tests/runAskSnoozerGoldenTests.js` now records this decision and delegates to the active authoritative suite in `scripts/runAskSnoozerGoldenTests.js`.

Current coverage is split deliberately:

- `scripts/runAskSnoozerGoldenTests.js`: active station response and copy contract.
- `tests/runAskSnoozerTrustedAdvisorTests.js`: exact multi-turn advisor, commerce, and cross-device behavior.
- `tests/runAskSnoozerModelComposerTests.js`: bounded model selection and post-model truth enforcement.
- `tests/runAskSnoozerVisitLifecycleTests.js`: active-visit expiry and durable profile retention.
- `tests/runAskSnoozerRealisticEvaluations.js`: 60 realistic turns across 12 conversations and 16 quality dimensions.

The historical fixture must not be used as a release gate unless it is explicitly migrated to the current response contract.
