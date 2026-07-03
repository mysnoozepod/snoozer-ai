# ZoneEvent Schema

Purpose: Defines the starter event contract for zone-aware sensor events before any implementation work begins.

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

## Starter Schema
```json
{
  "eventId": "evt_20260703_abc123",
  "env": "dev",
  "storeId": "severn-pilot",
  "deviceId": "pod-1-edge-01",
  "zoneId": "pod-1",
  "zoneType": "pod",
  "eventType": "occupied",
  "value": true,
  "confidence": 0.94,
  "sessionId": "sess_optional",
  "snoozeCode": "optional",
  "timestamp": "2026-07-03T13:10:00.000Z",
  "firmwareVersion": "1.0.0"
}
```

## Field Notes
- Required fields:
- Optional fields:
- Field validation rules:
- Confidence interpretation:

## Contract Management
- Change request:
- Consumer impact:
- Versioning approach:
- Approval needed from:

## Open Questions
- Unknown fields:
- Edge cases:
- Test data needed:
