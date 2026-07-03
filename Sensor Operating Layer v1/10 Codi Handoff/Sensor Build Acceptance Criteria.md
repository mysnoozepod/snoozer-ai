# Sensor Build Acceptance Criteria

## Purpose

This document defines what future sensor implementation must prove before it is considered successful.

These criteria apply after Ty approves the Codi Handoff Packet.

## General Acceptance Criteria

A future sensor build must:

- Use event-driven architecture
- Use AWS IoT Core with MQTT over TLS
- Use Node.js 20 Lambda
- Validate incoming ZoneEvent messages
- Store latest zone state
- Store append-only event history
- Push live updates through WebSocket
- Avoid polling-based UI
- Degrade gracefully if sensors fail
- Avoid checkout, cart, Shopify, product, pricing, handle, and variant logic

## One-Zone Proof Acceptance Criteria

The first proof should show:

- One approved zone can publish events
- Events match the ZoneEvent schema
- Bad events are rejected
- Good events are stored
- Latest state updates correctly
- Event history is append-only
- WebSocket push works
- Device heartbeat is visible
- Device fault can be represented
- Shopper journey still works if sensor is offline

## Data Acceptance Criteria

Validated events must support:

- eventId
- env
- storeId
- deviceId
- zoneId
- zoneType
- eventType
- value
- timestamp

Optional fields:

- confidence
- sessionId
- snoozeCode
- firmwareVersion

## Failure Acceptance Criteria

The system must handle:

- Missing fields
- Invalid event types
- Unknown zone IDs
- Offline devices
- Duplicate events
- Delayed events
- Network interruption
- WebSocket disconnect
- Lambda error
- DynamoDB write failure

## Frontend Acceptance Criteria

The React showroom app or operator view must:

- Receive live updates through WebSocket
- Show current zone state where approved
- Avoid polling
- Avoid breaking route navigation
- Avoid breaking Snoozer HUD
- Avoid breaking assessment, cart, or checkout flow
- Show graceful fallback when sensor state is unavailable

## Shopper Experience Acceptance Criteria

The shopper must still be able to:

- Start the experience
- Complete assessment
- View results
- Test pods
- Build pod/cart
- Request help
- Continue if sensors fail

## Final Rule

A sensor build is successful only if it makes the showroom more aware without making the core journey more fragile.