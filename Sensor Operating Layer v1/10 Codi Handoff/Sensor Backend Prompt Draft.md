# Sensor Backend Prompt Draft

Purpose: Captures the future architecture direction for a later implementation phase after approval is complete.

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

## Future Architecture Note
```text
Sensor / edge controller
-> AWS IoT Core MQTT over TLS
-> IoT Rule
-> Node.js 20 Lambda validator / normalizer
-> DynamoDB ZoneState + ZoneEvents
-> WebSocket push
-> React Showroom App / Snoozer HUD / Operator View
```

## Future Build Rules
- This future build must use WebSocket push, not polling.
- Event contract must be finalized before implementation starts.
- Sensor failure must degrade safely without breaking the shopper journey.
- No checkout, cart, Shopify pricing, product handle, or variant ID changes are allowed in this workstream.

## Prompt Draft Inputs
- Approved scope:
- Approved schema:
- Approved devices:
- Success criteria:
- Open architecture questions:
