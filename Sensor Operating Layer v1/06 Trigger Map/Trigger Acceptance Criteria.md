# Trigger Acceptance Criteria

Purpose: Defines what must be true before a trigger can be approved for controlled rollout or future implementation.

## Operating Guardrails
- Production-grade equipment only.
- Controlled rollout.
- No checkout, cart, Shopify pricing, product handle, or variant ID changes.
- No polling-based UI.
- Sensor failure cannot break the shopper journey.
- Pressure mapping only applies to the two non-adjustable-base pods.
- No medical claims.
- Event contract first.
- Codi implements only after Ty approves the Codi Handoff Packet.

## Acceptance Criteria
- Trigger:
- Required input events:
- Expected latency:
- Safe failure behavior:
- Monitoring requirement:
- Approval owner:

## Test Requirements
- Happy-path test:
- False-positive test:
- Missed-event test:
- Rollback condition:

## Signoff
- Status:
- Signoff date:
- Outstanding blockers:
