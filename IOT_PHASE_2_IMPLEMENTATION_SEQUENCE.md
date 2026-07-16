# IoT Phase 2 Implementation Sequence

Status: Phase 1 planning document  
Scope: Exact coding and deployment sequence after contracts are approved  
Runtime code: not implemented in this pass

## Purpose

This document defines the implementation order for the MySnoozePod IoT layer after Phase 1 contracts are approved.

Do not implement any phase from this document during Phase 1.

## Recommended Order

| # | Phase | Goal | Likely Files Added | Likely Files Modified | AWS Resources Touched | Acceptance Criteria | Risk | Rollback | Dependency | Difficulty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ZoneEvent validation library | Validate canonical event schema and enums. | `services/iot/zoneEventValidator.js`, tests | none | none | Valid/invalid fixtures pass. | Low | Remove library before integration. | Approved schema | Medium |
| 2 | IoT registry loader | Load device/zone registry by env/store. | `services/iot/iotDeviceRegistry.js`, `data/iot-device-registry.*.json` | none | none | Unknown/disabled/mismatched devices fail closed. | Medium | Revert registry loader. | Phase 1 docs | Medium |
| 3 | Node.js 20 IoT ingestion Lambda | Create Lambda handler for IoT Rule events. | `routes/iotIngest.js` or `services/iot/ingestHandler.js` | `index.js` only if existing Lambda entrypoint is reused | Lambda | Handler accepts fixture events locally. | Medium | Disable route/rule or revert Lambda alias. | Phases 1-2 | Medium |
| 4 | DynamoDB latest-state writes | Write current zone state with stale protection. | `services/iot/zoneStateStore.js` | ingestion handler | `msp_{env}_zone_state` | Older events cannot overwrite newer state. | Medium | Disable latest-state write path. | Phase 3 | Medium |
| 5 | DynamoDB append-only event writes | Persist full event history. | `services/iot/zoneEventHistoryStore.js` | ingestion handler | `msp_{env}_zone_events` | Events append; duplicate event IDs suppressed. | Medium | Disable event rule; preserve table. | Phase 3 | Medium |
| 6 | Malformed-event quarantine | Preserve rejected payloads safely. | `services/iot/zoneEventQuarantine.js` | ingestion handler | SQS/table/logs | Bad events do not break Lambda or UI. | Low | Disable quarantine writes. | Phase 3 | Low |
| 7 | CloudWatch metrics and alarms | Add observability for ingestion health. | `docs/iot-cloudwatch-runbook.md` | ingestion handler | CloudWatch metrics/alarms | Metrics emitted for accepted/rejected/stale/duplicate. | Low | Remove alarms; keep logs. | Phases 3-6 | Low |
| 8 | WebSocket connection handlers | Add connect/disconnect/subscription support. | `services/iot/websocketConnections.js`, route handlers | `index.js` if same Lambda | API Gateway WebSocket, connection table | Connections register/delete cleanly. | Medium | Disable WebSocket API stage. | DynamoDB connection table | Medium |
| 9 | WebSocket broadcast | Push accepted events to subscribed clients. | `services/iot/zoneBroadcaster.js` | ingestion handler | API Gateway Management API | Pod event reaches correct pod client only. | Medium | Turn off broadcast while keeping storage. | Phase 8 | Medium |
| 10 | React zone-state subscriber | Add client WebSocket subscriber. | `omnia-journey/src/iot/*` | relevant providers only | WebSocket API | Client receives snapshot/event without polling. | Medium | Disable subscriber flag. | Phase 9 | Medium |
| 11 | Reset-controller occupancy adapter | Feed occupancy into existing reset logic carefully. | `omnia-journey/src/device/zoneOccupancyAdapter.js` | reset provider only if needed | none | Occupancy delays reset but never hides manual controls. | Medium | Feature flag off. | Phase 10 | Medium |
| 12 | Welcome wake integration | Wake/activate welcome kiosk from presence. | `omnia-journey/src/iot/welcomeWake.js` | Welcome page/provider | none | Presence activates screen without greeting/audio. | Low | Feature flag off. | Phase 10 | Low |
| 13 | Pod lighting integration | Allow pod presence to activate pod lighting path. | `services/iot/lightingCommands.js` | ingestion handler | IoT command topics if approved | Lighting activation tested; no cart/checkout impact. | High | Disable command topic/rule. | Command contract approval | High |
| 14 | Rest Test eligibility integration | Derive start/pause/end eligibility from occupancy/session state. | `services/iot/restTestEligibility.js` | ingestion handler, pod UI subscriber | DynamoDB state/event tables | Occupied pod can show eligible state; no auto-start. | High | Disable derived event production. | Phases 4,5,10 | High |
| 15 | Ask Snoozer proximity context | Pass kiosk proximity into Snoozer context. | `services/iot/proximityContext.js` | Ask Snoozer request context only | latest-state table | Snoozer sees proximity context but does not repeatedly speak. | Medium | Remove context field. | Phase 10 | Medium |
| 16 | Bedding proximity context | Provide bedding-zone proximity context. | same as above | Sleep Essentials/Bedding surface later | latest-state table | No product truth invented. | Medium | Remove context field. | Phase 10 | Medium |
| 17 | Checkout proximity context | Provide checkout-zone proximity context. | same as above | checkout surface context only | latest-state table | No cart/checkout mutation. | High | Remove context field. | Phase 10 | Medium |
| 18 | Operator diagnostics | Build internal status view. | operator/admin files TBD | none or admin route | WebSocket/latest-state | Operator sees device health and zone state. | Low | Hide admin route. | Phases 7-10 | Medium |
| 19 | Commissioning tests | Add full physical test checklist and scripts. | `tests/iot/*`, docs | none | dev/prod resources | Each sensor/controller has pass/fail evidence. | Medium | Revert scripts only. | Hardware installed | Medium |
| 20 | Production hardening | Lock IAM, alarms, runbooks, failover. | runbooks, IaC later | IAM/resource config | all IoT resources | Prod ready with rollback and alarms. | High | Environment rollback plan. | All prior phases | High |

## Phase Details

### 1. ZoneEvent Validation Library

Goal:

- Create one backend library that validates ZoneEvent payloads.

Files likely added:

- `services/iot/zoneEventValidator.js`
- `tests/runZoneEventValidatorTests.js`
- `tests/fixtures/iot/zone-events/*.json`

AWS resources touched:

- None.

Acceptance criteria:

- Required fields enforced.
- Enums enforced.
- Environment mismatch detected.
- Privacy boundary enforced.

Rollback:

- Remove library before any Lambda integration.

### 2. IoT Registry Loader

Goal:

- Load registered devices, sensors, outputs, zones, and topic bindings by environment.

Files likely added:

- `services/iot/iotDeviceRegistry.js`
- `data/iot-device-registry.dev.json`
- `data/iot-device-registry.prod.template.json`

Acceptance criteria:

- Unknown device rejected.
- Disabled device rejected.
- Sensor-zone mismatch rejected.
- Pod binding mismatch rejected.

Rollback:

- Revert registry loader and fixture data.

### 3. Node.js 20 IoT Ingestion Lambda

Goal:

- Add the Lambda handler that IoT Rule invokes.

Files likely added:

- `services/iot/zoneEventIngest.js`

Files likely modified:

- `index.js` only if the existing Lambda entrypoint hosts the handler.

Acceptance criteria:

- Local fixture invocation succeeds.
- Invalid payload returns controlled failure.
- No React/cart/checkout changes.

Rollback:

- Disable IoT Rule or point Lambda alias to previous version.

### 4-5. DynamoDB Writes

Goal:

- Persist latest zone state and append-only history.

Acceptance criteria:

- Duplicate event ID suppressed.
- Older sequence cannot overwrite latest state.
- Event history remains append-only.

Rollback:

- Disable writes through feature flag or Lambda alias rollback.

### 6-7. Quarantine and Observability

Goal:

- Make failures visible without impacting manual showroom flow.

Acceptance criteria:

- Malformed events quarantined.
- Metrics and alarms emit.
- No customer-facing crash.

Rollback:

- Disable alarms or quarantine writes.

### 8-10. WebSocket Push and React Subscription

Goal:

- Push accepted events to authorized clients without polling.

Acceptance criteria:

- Pod 3 event reaches Pod 3 iPad.
- Pod 3 event does not reach Pod 4 iPad.
- Admin can receive all zones when authorized.
- Reconnect receives latest snapshot.

Rollback:

- Disable React subscriber flag and WebSocket API stage.

### 11-17. Experience Adapters

Goal:

- Introduce sensor context to existing experiences without changing product/cart/checkout truth.

Acceptance criteria:

- Manual journey works if sensors fail.
- Rest Test is not auto-started by sensor.
- Checkout truth remains untouched.
- Snoozer does not repeatedly speak.

Rollback:

- Disable adapter feature flags.

### 18-20. Diagnostics, Commissioning, Hardening

Goal:

- Make the system operable in the real showroom.

Acceptance criteria:

- Operator sees health.
- Commissioning evidence exists.
- Prod alarms and rollback are documented.

Rollback:

- Disable operator surfaces or alarms without impacting customer flow.

## Phase 2 Non-Goals

Do not add:

- Pressure mapping.
- Wearables.
- Entry automation.
- Exit automation.
- Environmental controls.
- Multi-zone audio.
- Biometrics.
- Consumer IoT hubs.
- Polling.

