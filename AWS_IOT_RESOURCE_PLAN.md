# AWS IoT Resource Plan

<!-- LIVING_STATUS_START -->
## Current Implementation Status — 2026-07-20

- The planned AWS IoT resources are represented in `template.yaml` and supporting Node.js 20 handlers.
- Zone event ingestion, quarantine, latest state, append-only history, WebSocket subscriptions, and physical command acknowledgement/reported-state paths are implemented in source.
- Canonical store ID remains `severn-pilot`; dev and prod topic isolation remains mandatory.
- AWS IoT Things, certificates, policies, physical controller provisioning, and showroom commissioning are not complete.
- This document remains the resource authority for deployment planning; Shopify cart and checkout remain outside IoT ownership.
<!-- LIVING_STATUS_END -->


Status: Phase 1 architecture plan  
Scope: AWS resources required for MySnoozePod IoT sensor layer  
Runtime code: not implemented in this pass

## Purpose

This document defines the AWS resource architecture for the MySnoozePod sensor and IoT layer.

Do not create resources in this pass.

## Environment Naming

Use environment-specific names:

```text
msp-dev-...
msp-prod-...
```

Dev and prod must remain isolated across IoT Core, Lambda, DynamoDB, WebSocket API, IAM, logs, metrics, and alarms.

## Required AWS Resources

| Resource | Example Name | Purpose |
| --- | --- | --- |
| IoT Things | `msp-prod-severn-pilot-pod-3-edge-01` | Identity for physical edge controller. |
| X.509 certificates | AWS-generated certificate IDs | TLS MQTT authentication. |
| IoT policies | `msp-prod-iot-policy-pod-edge` | Least-privilege topic publish permissions. |
| MQTT topics | `mysnoozepod/prod/...` | Device event transport. |
| IoT Rule | `msp-prod-zone-event-ingest-rule` | Route MQTT messages to Lambda. |
| Ingestion Lambda | `msp-prod-zone-event-ingest` | Validate, dedupe, write DynamoDB, push WebSocket. |
| Lambda DLQ or failure target | `msp-prod-zone-event-failures` | Preserve failed events. |
| Latest-state table | `msp_prod_zone_state` | Current zone state. |
| Event-history table | `msp_prod_zone_events` | Append-only event history. |
| WebSocket connection table | `msp_prod_websocket_connections` | Active clients/subscriptions. |
| API Gateway WebSocket API | `msp-prod-zone-ws` | Push zone events to React/operator clients. |
| WebSocket connect Lambda | `msp-prod-ws-connect` | Authorize/register connection. |
| WebSocket disconnect Lambda | `msp-prod-ws-disconnect` | Remove stale connection. |
| WebSocket subscription Lambda | `msp-prod-ws-subscribe` | Optional subscribe/unsubscribe handling. |
| CloudWatch log groups | `/aws/lambda/msp-prod-zone-event-ingest` | Logs. |
| CloudWatch metrics | `MySnoozePod/IoT` | Operational metrics. |
| CloudWatch alarms | `msp-prod-zone-event-error-alarm` | Alert on failures. |
| IAM roles/policies | `msp-prod-zone-event-ingest-role` | Least privilege runtime access. |
| Optional SQS failure queue | `msp-prod-zone-event-failures` | Justified for retry/quarantine durability. |

## AWS IoT Things

Create one Thing per edge controller:

- `msp-prod-severn-pilot-pod-1-edge-01`
- `msp-prod-severn-pilot-pod-2-edge-01`
- `msp-prod-severn-pilot-pod-3-edge-01`
- `msp-prod-severn-pilot-pod-4-edge-01`
- `msp-prod-severn-pilot-pod-5-edge-01`
- `msp-prod-severn-pilot-showroom-zone-edge-01`
- `msp-prod-severn-pilot-spare-edge-01`

Create matching dev Things with `msp-dev-...` names.

## Certificates

Rules:

- One active certificate per physical edge controller.
- Certificates are environment-specific.
- Cert rotation must be auditable.
- Disabled or replaced devices must have old certificates deactivated.

## IoT Policies

Policies must restrict publish permissions to the device's assigned topics.

Pod controller policy should allow publish only to:

```text
mysnoozepod/{env}/stores/{storeId}/zones/{podZone}/events
mysnoozepod/{env}/stores/{storeId}/devices/{deviceId}/heartbeat
mysnoozepod/{env}/stores/{storeId}/devices/{deviceId}/fault
mysnoozepod/{env}/stores/{storeId}/devices/{deviceId}/status
```

Shared-zone controller policy may publish to approved non-pod zones only.

## IoT Rule

Recommended rule name:

```text
msp-{env}-zone-event-ingest-rule
```

Rule SQL:

```sql
SELECT
  *,
  topic(2) AS topicEnv,
  topic(4) AS topicStoreId,
  topic(6) AS topicScope,
  topic(7) AS topicEntityId,
  topic() AS mqttTopic,
  timestamp() AS iotReceivedAt
FROM 'mysnoozepod/+/stores/+/+/+/#'
```

Lambda must reject unsupported topic shapes after receiving the event.

Alternative stricter event-only rule:

```sql
SELECT
  *,
  topic(2) AS topicEnv,
  topic(4) AS topicStoreId,
  topic(6) AS topicZoneId,
  topic() AS mqttTopic,
  timestamp() AS iotReceivedAt
FROM 'mysnoozepod/+/stores/+/zones/+/events'
```

If heartbeat/fault/status use the same Lambda, create additional IoT Rules or use broader SQL and validate topic shape in Lambda.

## Node.js 20 Ingestion Lambda

Name:

```text
msp-{env}-zone-event-ingest
```

Responsibilities:

1. Parse payload.
2. Validate topic shape.
3. Validate environment and store.
4. Validate registered device and zone.
5. Validate schema and event type.
6. Enforce idempotency by `eventId`.
7. Write event history.
8. Conditionally update latest state.
9. Emit CloudWatch metrics.
10. Broadcast WebSocket event to subscribed clients.
11. Quarantine malformed events.

Node.js 20 is required.

## Failure Handling

Use either:

- Lambda async failure destination to SQS, or
- Explicit SQS failure queue writes from Lambda.

Recommended queue:

```text
msp-{env}-zone-event-failures
```

Justification:

- Preserves malformed or failed events without blocking customer journey.
- Supports replay after validation bugs are fixed.
- Keeps sensor failure from breaking manual showroom flow.

## DynamoDB Tables

- `msp_{env}_zone_state`
- `msp_{env}_zone_events`
- `msp_{env}_websocket_connections`

Details are defined in `DYNAMODB_ZONE_TABLE_DESIGN.md`.

## API Gateway WebSocket

Name:

```text
msp-{env}-zone-ws
```

Routes:

- `$connect`
- `$disconnect`
- `subscribe`
- `unsubscribe`
- `ping`

Lambdas:

- `msp-{env}-ws-connect`
- `msp-{env}-ws-disconnect`
- `msp-{env}-ws-subscribe`

## IAM Boundaries

### Ingestion Lambda

Allow:

- Read IoT registry source.
- Put event-history item.
- Update latest-state item conditionally.
- Put malformed/failure item or SQS message.
- Query WebSocket connection table by store/zone if needed.
- Post to API Gateway Management API for authorized connections.
- CloudWatch logs and metrics.

Deny:

- Shopify/cart/checkout mutation.
- Broad DynamoDB table access outside IoT tables.
- Cross-environment table access.
- IoT certificate management at runtime.

### WebSocket Lambdas

Allow:

- Put/delete/update connection records.
- Read latest-state for allowed zones.
- Post messages to the connection if needed.

Deny:

- IoT publish unless later explicitly needed.
- Shopify/cart/checkout mutation.

## Deployment Order

1. Create dev DynamoDB tables.
2. Create dev Lambda IAM roles.
3. Create dev ingestion Lambda.
4. Create dev WebSocket API and handlers.
5. Create dev IoT Things/certs/policies.
6. Create dev IoT Rules.
7. Run dev simulator tests.
8. Repeat in prod after acceptance.
9. Commission one pod before all pods.
10. Commission shared-zone controller last.

## Rollback Considerations

- Disable IoT Rule to stop ingestion.
- Disable affected certificate to stop one device.
- Disable device in registry to reject events without touching cert.
- Revert Lambda version/alias.
- Keep manual showroom journey available.
- Do not rollback cart/checkout for sensor issues.

## Logging

Log structured fields:

- `traceId`
- `eventId`
- `env`
- `storeId`
- `zoneId`
- `deviceId`
- `eventType`
- `validationStatus`
- `duplicateSuppressed`
- `latestStateUpdated`
- `websocketBroadcastCount`
- `failureReason`

Do not log raw Snooze Code unless redacted.

## Metrics

Namespace:

```text
MySnoozePod/IoT
```

Metrics:

- `ZoneEventReceived`
- `ZoneEventAccepted`
- `ZoneEventRejected`
- `ZoneEventMalformed`
- `ZoneEventDuplicateSuppressed`
- `ZoneLatestStateUpdated`
- `ZoneLatestStateStaleIgnored`
- `WebSocketBroadcastAttempted`
- `WebSocketBroadcastFailed`
- `DeviceHeartbeatReceived`
- `DeviceFaultReceived`
- `DisabledDeviceRejected`

## Alarms

Recommended prod alarms:

- Ingestion Lambda errors > 1% over 5 minutes.
- Malformed events spike.
- Device heartbeat missing for each controller.
- WebSocket broadcast failures spike.
- DynamoDB throttling.
- SQS failure queue visible messages > 0 for more than 5 minutes.

## Retries

- IoT Rule Lambda invocation should rely on AWS retry behavior.
- Lambda writes should be idempotent.
- WebSocket post failures for gone connections should remove stale connection rows.
- Do not retry customer-facing speech repeatedly from sensor triggers.

## Idempotency Behavior

- `eventId` is the primary idempotency key.
- Duplicate events write no second history row.
- Duplicate events do not repeat latest-state updates.
- Duplicate events do not repeat WebSocket broadcasts.

## Stale WebSocket Connection Removal

When API Gateway Management API returns Gone/410:

1. Delete connection from `msp_{env}_websocket_connections`.
2. Emit metric `WebSocketStaleConnectionRemoved`.
3. Continue broadcasting to remaining connections.
