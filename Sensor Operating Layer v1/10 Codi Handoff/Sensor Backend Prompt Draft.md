# Sensor Backend Prompt Draft

## Purpose

This is a draft prompt for future Codi implementation.

This prompt is not ready to run until Ty approves the Codi Handoff Packet.

## Future Codi Prompt Draft

Codi, build the first Sensor Operating Layer proof for MySnoozePod.

This is a one-zone proof only. Do not build the full showroom sensor system yet.

Target zone:

- zoneId: pod-1
- deviceId: pod-1-edge-01
- zoneType: pod

Approved event types for this proof:

- occupied
- vacated
- heartbeat
- fault

Architecture:

Sensor / edge controller  
→ AWS IoT Core MQTT over TLS  
→ IoT Rule  
→ Node.js 20 Lambda validator / normalizer  
→ DynamoDB ZoneState + ZoneEvents  
→ WebSocket push  
→ React Showroom App / Snoozer HUD / Operator View

Rules:

- Use Node.js 20 for Lambda.
- Validate all incoming ZoneEvent messages.
- Reject malformed events.
- Store latest state in ZoneState.
- Store append-only history in ZoneEvents.
- Push live updates through WebSocket.
- Do not use polling.
- Do not touch Shopify pricing.
- Do not touch Shopify availability.
- Do not touch product handles.
- Do not touch variant IDs.
- Do not touch cart logic.
- Do not touch checkout logic.
- Do not break the existing showroom journey.
- Sensor failure must degrade gracefully.

Starter ZoneEvent:

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
  "sessionId": null,
  "snoozeCode": null,
  "timestamp": "2026-07-03T13:10:00.000Z",
  "firmwareVersion": "1.0.0"
}