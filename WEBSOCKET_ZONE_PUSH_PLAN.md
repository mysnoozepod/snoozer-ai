# WebSocket Zone Push Plan

Status: Phase 1 architecture plan  
Scope: API Gateway WebSocket push model for MySnoozePod zone state  
Runtime code: not implemented in this pass

## Purpose

The WebSocket layer pushes validated zone events and latest-state changes to React showroom and operator surfaces.

No polling is part of this plan.

## API Gateway WebSocket Routes

| Route | Required | Purpose |
| --- | --- | --- |
| `$connect` | Yes | Authorize and store connection. |
| `$disconnect` | Yes | Remove connection. |
| `subscribe` | Optional Phase 1 | Subscribe to zones. |
| `unsubscribe` | Optional Phase 1 | Remove zone subscriptions. |
| `ping` | Optional Phase 1 | Keepalive and lastSeen update. |

## Connection Authorization

Authorization should validate:

- Environment.
- Store.
- Device mode.
- Device ID if a kiosk is connecting.
- Operator/admin authorization for broad zone access.

Anonymous customer sessions may connect only through approved kiosk device context.

## Device-Mode Authorization

| Client | Allowed Zones |
| --- | --- |
| Welcome kiosk | `welcome-kiosk` only. |
| Pod 1 iPad | `pod-1` only. |
| Pod 2 iPad | `pod-2` only. |
| Pod 3 iPad | `pod-3` only. |
| Pod 4 iPad | `pod-4` only. |
| Pod 5 iPad | `pod-5` only. |
| Ask Snoozer kiosk | `ask-snoozer` only. |
| Sleep Essentials kiosk | `sleep-essentials-zone` only. |
| Checkout kiosk | `checkout-zone` only. |
| Admin/operator | All store zones when authorized. |

## Store Authorization

Connections are scoped to one `storeId`.

MVP store:

```text
severn-pilot
```

Clients must not subscribe across stores.

## Zone Subscription Rules

- Device clients default to their own zone.
- Operator clients may subscribe to all zones.
- Unknown zones are rejected.
- Disabled devices may not subscribe.
- A pod iPad may not subscribe to another pod's zone unless in admin-dev/review mode.

## Broadcast Model

On accepted ZoneEvent:

1. Update event history.
2. Conditionally update latest state.
3. Find WebSocket connections subscribed to the event zone.
4. Send event envelope.
5. Remove stale connections that return 410 Gone.

Broadcast must occur only after validation and idempotency checks.

Duplicate events must not broadcast twice.

## Event Envelope Sent to React

```json
{
  "type": "zone.event",
  "eventId": "evt-prod-pod-3-edge-01-000042",
  "storeId": "severn-pilot",
  "zoneId": "pod-3",
  "eventType": "pod_occupied",
  "state": "active",
  "timestamp": "2026-07-16T12:30:45.123Z",
  "receivedAt": "2026-07-16T12:30:45.789Z",
  "sequence": 42,
  "payload": {
    "schemaVersion": "1.0",
    "zoneType": "pod",
    "podId": "pod-3",
    "deviceId": "pod-3-edge-01",
    "sensorId": "pod-3-occupancy-01",
    "sensorType": "bed-occupancy",
    "value": true,
    "unit": null,
    "confidence": 0.94,
    "source": "edge-controller",
    "sessionId": null,
    "snoozeCode": null,
    "metadata": {}
  }
}
```

## `$connect`

Responsibilities:

- Validate request.
- Resolve device/store context.
- Create connection table record.
- Assign default zone subscription.
- Optionally return current latest state after connect through a separate message.

Connection record:

```json
{
  "connectionId": "abc123",
  "storeId": "severn-pilot",
  "deviceId": "pod-3-ipad-01",
  "deviceMode": "pod-ipad",
  "subscribedZoneIds": ["pod-3"],
  "connectedAt": "2026-07-16T12:30:45.000Z",
  "lastSeenAt": "2026-07-16T12:30:45.000Z",
  "expiresAt": 1792153845
}
```

## `$disconnect`

Responsibilities:

- Delete connection record.
- Log disconnect.
- Do not modify zone state.
- Do not modify cart/checkout.

## `subscribe`

Example payload:

```json
{
  "action": "subscribe",
  "storeId": "severn-pilot",
  "zoneIds": ["pod-3"]
}
```

Rules:

- Validate requested zones.
- Enforce device-mode authorization.
- Update `subscribedZoneIds`.
- Send latest state for subscribed zones after success.

## `unsubscribe`

Example payload:

```json
{
  "action": "unsubscribe",
  "zoneIds": ["pod-3"]
}
```

Rules:

- Remove only allowed zones.
- Device clients should normally keep their default zone.

## `ping`

Example payload:

```json
{
  "action": "ping"
}
```

Response:

```json
{
  "type": "pong",
  "serverTime": "2026-07-16T12:30:45.000Z"
}
```

## Stale Connection Cleanup

Cleanup paths:

- `$disconnect`.
- TTL expiry.
- Delete on API Gateway 410 Gone during broadcast.
- Operator cleanup job if needed.

## Reconnect Behavior

React client should:

- Reconnect with backoff.
- Resubscribe after reconnect.
- Request latest state after reconnect.
- Show stale-state UI if disconnected too long.

## React Subscription Model

No React implementation in this pass.

Planned behavior:

- Device mode determines default zone subscription.
- Pod iPad subscribes to its pod zone.
- Welcome kiosk subscribes to welcome zone.
- Operator surface can subscribe to all zones.
- Zone state updates should feed local UI state, not replace cart/checkout truth.

## Offline Behavior

When disconnected:

- Manual showroom journey remains usable.
- Rest Test touch controls remain available where existing app allows.
- UI can show sensor state as unavailable/stale.
- No cart/checkout behavior changes.

## Last-Known-State Behavior

On connect or reconnect:

- Client requests latest state for subscribed zones.
- Server sends `zone.snapshot` envelope.

Example:

```json
{
  "type": "zone.snapshot",
  "storeId": "severn-pilot",
  "zoneId": "pod-3",
  "state": {
    "currentState": "active",
    "lastEventType": "pod_occupied",
    "lastEventId": "evt-prod-pod-3-edge-01-000042",
    "lastReceivedAt": "2026-07-16T12:30:45.789Z",
    "staleAfter": "2026-07-16T12:35:45.789Z"
  }
}
```

## Stale-State UI Behavior

React may show:

- `Sensor unavailable`
- `Last seen X minutes ago`
- `Manual controls still available`

Sensor failure must never block the manual showroom journey.

## No-Polling Guarantee

The real-time path is WebSocket push.

Allowed non-polling cases:

- Initial snapshot on connect.
- Explicit reconnect recovery.
- Operator manual refresh.

Continuous polling is not part of MVP architecture.

