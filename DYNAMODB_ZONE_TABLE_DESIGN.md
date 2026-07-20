# DynamoDB Zone Table Design

<!-- LIVING_STATUS_START -->
## Current Implementation Status — 2026-07-20

- The latest-state and append-only event-history patterns are implemented in the IoT ingestion services and SAM template.
- Idempotent history writes, stale-event protection, command status, and latest physical reported state are covered in source and tests.
- The optional `eventType + receivedAt` GSI remains deferred.
- Live tables, capacity behavior, alarms, TTL operation, and production retention still require deployed-environment validation.
<!-- LIVING_STATUS_END -->


Status: Phase 1 architecture contract  
Scope: DynamoDB tables for MySnoozePod IoT latest state, event history, and WebSocket connections  
Runtime code: not implemented in this pass

## Purpose

The IoT layer uses DynamoDB for:

- Current zone state.
- Append-only event history.
- Active WebSocket connection subscriptions.

Tables are environment-specific. Dev and prod must remain isolated.

## Latest State Table

Suggested name:

```text
msp_{env}_zone_state
```

Examples:

- `msp_dev_zone_state`
- `msp_prod_zone_state`

### Primary Key

```text
PK = STORE#{storeId}
SK = ZONE#{zoneId}
```

Example:

```text
PK = STORE#severn-pilot
SK = ZONE#pod-3
```

### Fields

| Field | Purpose |
| --- | --- |
| `PK` | Store partition key. |
| `SK` | Zone sort key. |
| `storeId` | Store ID. |
| `zoneId` | Zone ID. |
| `zoneType` | `entry`, `kiosk`, `pod`, `checkout`, or `help`. |
| `currentState` | Current normalized state. |
| `lastEventType` | Last accepted event type. |
| `lastEventId` | Last accepted event ID. |
| `lastSequence` | Last accepted sequence for device/zone. |
| `lastDeviceTimestamp` | Timestamp from edge event. |
| `lastReceivedAt` | Lambda received time. |
| `deviceId` | Last reporting device. |
| `sensorId` | Last reporting sensor. |
| `podId` | Pod ID or null. |
| `sessionId` | Associated session or null. |
| `snoozeCode` | Associated Snooze Code or null. |
| `confidence` | Confidence value or null. |
| `staleAfter` | ISO timestamp when state should be considered stale. |
| `updatedAt` | Last write timestamp. |
| `metadata` | Small object for diagnostics. |

### Conditional Update Behavior

Latest-state update should reject older events.

Recommended condition:

```text
attribute_not_exists(lastDeviceTimestamp)
OR :deviceTimestamp > lastDeviceTimestamp
OR (
  :deviceTimestamp = lastDeviceTimestamp
  AND :sequence > lastSequence
)
```

If `deviceId` changes for the same zone, the Lambda must validate registry ownership before allowing update.

### Older Events

Older or stale events:

- May be written to event history.
- Must not overwrite latest state.
- Must emit metric `ZoneLatestStateStaleIgnored`.

### Latest-State Retention

Latest-state records should not expire automatically.

State becomes stale using:

- `staleAfter`
- heartbeat absence
- operator diagnostics

## Event History Table

Suggested name:

```text
msp_{env}_zone_events
```

Examples:

- `msp_dev_zone_events`
- `msp_prod_zone_events`

### Primary Key

```text
PK = STORE#{storeId}#ZONE#{zoneId}
SK = {receivedAt}#{eventId}
```

Example:

```text
PK = STORE#severn-pilot#ZONE#pod-3
SK = 2026-07-16T12:30:45.789Z#evt-prod-pod-3-edge-01-000042
```

### Fields

| Field | Purpose |
| --- | --- |
| `PK` | Store/zone partition. |
| `SK` | Received time plus event ID. |
| `eventId` | Idempotency and lookup key. |
| `env` | `dev` or `prod`. |
| `storeId` | Store ID. |
| `zoneId` | Zone ID. |
| `zoneType` | Zone type. |
| `podId` | Pod ID or null. |
| `deviceId` | Device ID. |
| `sensorId` | Sensor ID. |
| `eventType` | Event type. |
| `state` | Event state. |
| `value` | Event value. |
| `confidence` | Confidence or null. |
| `sequence` | Device sequence. |
| `deviceTimestamp` | Event timestamp. |
| `receivedAt` | Lambda receive timestamp. |
| `sessionId` | Session or null. |
| `snoozeCode` | Snooze Code or null. |
| `accepted` | Boolean. |
| `stale` | Boolean. |
| `duplicate` | Boolean. |
| `validationErrors` | Array. |
| `ttl` | Expiration epoch seconds. |

### GSIs

#### GSI 1: Event ID Lookup

```text
GSI1PK = EVENT#{eventId}
GSI1SK = RECEIVED#{receivedAt}
```

Purpose:

- Idempotency lookup.
- Operator event trace.

#### GSI 2: Device Timeline

```text
GSI2PK = DEVICE#{deviceId}
GSI2SK = RECEIVED#{receivedAt}
```

Purpose:

- Device diagnostics.
- Heartbeat and fault trace.

#### GSI 3: Session Timeline

```text
GSI3PK = SESSION#{sessionId}
GSI3SK = RECEIVED#{receivedAt}
```

Only write when `sessionId` is present.

Purpose:

- Session analytics.
- Rest Test trace.

#### GSI 4: Event Type Timeline

```text
GSI4PK = EVENTTYPE#{eventType}
GSI4SK = RECEIVED#{receivedAt}
```

Justification:

- Operator diagnostics.
- Fault and eligibility analytics.
- Can be omitted initially if write cost must be lower.

## Idempotent Writes

Use conditional write for event history:

```text
ConditionExpression: attribute_not_exists(eventId)
```

Because primary key includes received time, a separate idempotency item or GSI-based lookup may be needed for strict duplicate suppression.

Recommended strict pattern:

- Write an idempotency item with `PK = EVENT#{eventId}` in the same table or a small companion table.
- Use transactional write:
  - Put idempotency item if not exists.
  - Put event history item.
  - Update latest state conditionally.

## Conditional Expressions

History insert:

```text
attribute_not_exists(PK) AND attribute_not_exists(SK)
```

Idempotency insert:

```text
attribute_not_exists(PK)
```

Latest state update:

```text
attribute_not_exists(lastDeviceTimestamp)
OR :deviceTimestamp > lastDeviceTimestamp
OR (:deviceTimestamp = lastDeviceTimestamp AND :sequence > lastSequence)
```

## Retention and TTL

Recommendations:

- Event history TTL: 180 days for MVP.
- Malformed event TTL: 30 days.
- Idempotency TTL: 7 days minimum.
- Latest state: no TTL.
- WebSocket connections: TTL based on `expiresAt`.

## Append-Only Requirements

Event history is append-only:

- Never update accepted event payloads.
- Add correction events rather than mutating history.
- Operator annotations may be stored separately or as immutable annotation records.

## Query Patterns

| Pattern | Table/Index |
| --- | --- |
| Current state for a zone | Latest-state table PK/SK. |
| All current zones for store | Latest-state table PK query. |
| Zone timeline | Event-history PK query. |
| Event by ID | GSI1. |
| Device diagnostics | GSI2. |
| Session timeline | GSI3. |
| Fault trend | GSI4 for `device_fault`. |

## Operator Diagnostics

Operator tooling should show:

- Last heartbeat by device.
- Current state by zone.
- Recent event timeline.
- Malformed/rejected event count.
- Duplicate suppression count.
- Stale event count.

## Session Analytics

Session analytics may use:

- `sessionId`
- `zoneId`
- Rest Test eligibility events
- Pod occupied/vacated events

Do not infer shopper identity from presence alone.

## Malformed-Event Quarantine

Malformed events may be written to:

- `msp_{env}_zone_events` with `accepted = false`, or
- a dedicated queue/table if cleaner.

Required fields:

- raw payload if safe
- topic
- reason code
- receivedAt
- certificate principal if available
- env/store if parsed

Do not broadcast malformed events.

## Cost Considerations

Cost drivers:

- Heartbeat frequency.
- Event history write volume.
- WebSocket broadcast count.
- GSI count.

Low-cost controls:

- Keep heartbeat to 30 seconds.
- Avoid high-frequency raw telemetry.
- Use on-demand DynamoDB for MVP unless volume stabilizes.
- Start with essential GSIs only.
- Do not poll from React.

## WebSocket Connection Table

Suggested name:

```text
msp_{env}_websocket_connections
```

### Primary Key

```text
PK = CONNECTION#{connectionId}
```

### Fields

| Field | Purpose |
| --- | --- |
| `PK` | Connection key. |
| `connectionId` | API Gateway connection ID. |
| `env` | `dev` or `prod`. |
| `storeId` | Store ID. |
| `deviceId` | Frontend device ID if available. |
| `deviceMode` | Frontend device mode if available. |
| `subscribedZoneIds` | Array of zone IDs. |
| `connectedAt` | ISO timestamp. |
| `lastSeenAt` | ISO timestamp. |
| `expiresAt` | TTL epoch seconds. |
| `userRole` | `device`, `operator`, or `admin` when known. |

### Cleanup Behavior

- `$disconnect` deletes the connection.
- `ping` updates `lastSeenAt`.
- TTL removes abandoned records.
- Broadcast Lambda deletes connection on API Gateway 410 Gone.
