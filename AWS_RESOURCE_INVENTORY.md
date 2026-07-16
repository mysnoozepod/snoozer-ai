# AWS Resource Inventory

Status: Phase 3 infrastructure inventory  
Scope: MySnoozePod IoT backend stack

## Summary

The SAM template creates the AWS resources required for Phase 2 ZoneEvent ingestion to run without manually creating DynamoDB, SQS, Lambda, IoT Rule, IAM, or CloudWatch resources.

## Parameters

| Parameter | Default | Purpose |
| --- | --- | --- |
| `DeploymentEnv` | `dev` | `dev` or `prod`. Used in resource names and runtime env. |
| `StoreId` | `severn-pilot` | Store identifier used by topic and payload validation. |
| `EventTtlDays` | `180` | Event history and idempotency TTL. |
| `LogLevel` | `info` | Runtime IoT log level. |
| `LogRetentionDays` | `30` | CloudWatch log group retention. |
| `AlarmEmail` | empty | Optional SNS alarm email subscription. |

## DynamoDB Tables

### Latest Zone State

Name:

```text
msp-{env}-zone-state
```

Purpose:

- Stores the latest accepted state per zone.
- Uses conditional updates so stale events cannot overwrite newer state.
- Does not use TTL.

Keys:

| Attribute | Type | Role |
| --- | --- | --- |
| `PK` | String | `STORE#{storeId}` |
| `SK` | String | `ZONE#{zoneId}` |

Billing and safety:

- Pay-per-request.
- Server-side encryption enabled.
- Point-in-time recovery enabled.

### Append-Only Zone Events

Name:

```text
msp-{env}-zone-events
```

Purpose:

- Stores append-only valid ZoneEvent history.
- Stores idempotency records using `PK = EVENT#{eventId}`.
- Malformed events are not written here.

Keys:

| Attribute | Type | Role |
| --- | --- | --- |
| `PK` | String | `STORE#{storeId}#ZONE#{zoneId}` or `EVENT#{eventId}` |
| `SK` | String | `{receivedAt}#{eventId}` or `IDEMPOTENCY` |

GSIs:

| Index | Keys | Purpose |
| --- | --- | --- |
| `GSI1` | `GSI1PK`, `GSI1SK` | Event ID lookup. |
| `GSI2` | `GSI2PK`, `GSI2SK` | Device timeline. |
| `GSI3` | `GSI3PK`, `GSI3SK` | Session timeline when `sessionId` exists. |

No `eventType + receivedAt` GSI is created in Phase 3, per Phase 2 decision.

TTL:

- Attribute: `ttl`
- Enabled.

Billing and safety:

- Pay-per-request.
- Server-side encryption enabled.
- Point-in-time recovery enabled.

### WebSocket Connections

Name:

```text
msp-{env}-websocket-connections
```

Purpose:

- Reserved for later WebSocket push phases.
- Not used by the Phase 2 ingestion runtime yet.

Keys:

| Attribute | Type | Role |
| --- | --- | --- |
| `PK` | String | Connection key. |

GSIs:

| Index | Keys | Purpose |
| --- | --- | --- |
| `GSI1` | `GSI1PK`, `GSI1SK` | Future store/zone subscription queries. |

TTL:

- Attribute: `expiresAt`
- Enabled.

## SQS

Name:

```text
msp-{env}-iot-quarantine
```

Purpose:

- Stores malformed ZoneEvent payloads from Lambda runtime quarantine.
- Stores IoT Rule error-action messages if Lambda invocation fails.

Settings:

- 14-day retention.
- 60-second visibility timeout.
- SQS-managed server-side encryption enabled.

## Lambda

Name:

```text
msp-{env}-zone-event-ingest
```

Handler:

```text
index.iotZoneEventHandler
```

Runtime:

```text
nodejs20.x
```

Environment:

| Variable | Value |
| --- | --- |
| `IOT_ENV` | `DeploymentEnv` |
| `IOT_STORE_ID` | `StoreId` |
| `IOT_DEVICE_REGISTRY_PATH` | `data/iot-device-registry.v1.json` |
| `IOT_ZONE_STATE_TABLE` | `msp-{env}-zone-state` |
| `IOT_ZONE_EVENTS_TABLE` | `msp-{env}-zone-events` |
| `IOT_QUARANTINE_QUEUE_URL` | queue URL |
| `IOT_EVENT_TTL_DAYS` | `EventTtlDays` |
| `IOT_LOG_LEVEL` | `LogLevel` |

## IAM

The Lambda role allows:

- CloudWatch Logs through `AWSLambdaBasicExecutionRole`.
- `dynamodb:GetItem`, `dynamodb:Query`, `dynamodb:UpdateItem` on the latest-state table.
- `dynamodb:PutItem`, `dynamodb:TransactWriteItems`, `dynamodb:Query` on the event-history table and its indexes.
- `sqs:SendMessage` to the quarantine queue.

The IoT Rule error action role allows:

- `sqs:SendMessage` to the quarantine queue.

The stack does not grant Shopify, cart, checkout, Zoho, Calendly, or broad DynamoDB permissions.

## AWS IoT

Rule name:

```text
msp_{env}_zone_event_ingest_rule
```

SQL:

```sql
SELECT *, topic() AS mqttTopic, timestamp() AS iotReceivedAt FROM 'mysnoozepod/+/stores/+/+/+/#'
```

Action:

- Invoke `msp-{env}-zone-event-ingest`.

Error action:

- Send to `msp-{env}-iot-quarantine`.

## CloudWatch

Log group:

```text
/aws/lambda/msp-{env}-zone-event-ingest
```

Metric filters:

| Filter | Metric |
| --- | --- |
| `iot.zone_event.accepted` | `MySnoozePod/IoT:ZoneEventAcceptedLog` |
| `iot.zone_event.rejected` | `MySnoozePod/IoT:ZoneEventRejectedLog` |
| `iot.zone_event.duplicate_suppressed` | `MySnoozePod/IoT:ZoneEventDuplicateSuppressedLog` |
| `iot.zone_event.quarantine_failed` | `MySnoozePod/IoT:ZoneEventQuarantineFailedLog` |

Alarms:

| Alarm | Purpose |
| --- | --- |
| `msp-{env}-zone-event-lambda-errors` | Lambda runtime errors. |
| `msp-{env}-zone-event-rejected` | Malformed/rejected event spike. |
| `msp-{env}-iot-quarantine-visible` | Quarantine queue has visible messages. |
| `msp-{env}-zone-state-write-throttles` | Latest-state write throttling. |
| `msp-{env}-zone-events-write-throttles` | Event-history write throttling. |

## Outputs

The stack outputs:

- Zone event ingestion Lambda name.
- Zone event ingestion Lambda ARN.
- IoT Rule name.
- Zone state table name.
- Zone events table name.
- WebSocket connections table name.
- IoT quarantine queue URL.
- IoT alarm topic ARN.
