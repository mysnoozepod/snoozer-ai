# AWS Deployment Guide

<!-- LIVING_STATUS_START -->
## Current Implementation Status — 2026-07-20

- IoT Phases 1–7 are implemented in source: contracts, validated ingestion, DynamoDB persistence, quarantine, SAM infrastructure, WebSocket push, React zone state, experience integration, and the physical control bridge.
- The software control loop now covers command issue → MQTT publish → controller acknowledgement/reported state → DynamoDB/WebSocket → React status.
- Live AWS deployment validation remains pending because SAM CLI validation was unavailable locally and CloudFormation validation was blocked by IAM permissions.
- Deployment still requires live values and permissions for `IOT_PHYSICAL_CONTROL_TABLE`, `IOT_DATA_ENDPOINT`, DynamoDB access, IoT publish, and WebSocket `ManageConnections`.
- No physical sensor/controller fleet is commissioned yet. Cart, checkout, Shopify truth, and manual showroom flows must continue operating when IoT is disabled or unavailable.
<!-- LIVING_STATUS_END -->


Status: Phase 4 infrastructure deployment guide
Scope: MySnoozePod IoT backend stack only

## Purpose

This guide deploys the AWS infrastructure needed by the existing IoT ZoneEvent ingestion runtime.

It does not deploy React, Shopify, cart, checkout, firmware, lighting automation, or frontend WebSocket client wiring.

## Prerequisites

- AWS CLI configured with the target account.
- AWS SAM CLI installed.
- Node.js 20 available locally.
- An S3 bucket for SAM packaging, or permission for SAM guided deploy to create/use one.
- IAM permission to create CloudFormation, Lambda, DynamoDB, SQS, SNS, IoT Rule, IAM roles/policies, CloudWatch log groups, metric filters, and alarms.

## Stack Name

Recommended stack names:

```powershell
mysnoozepod-iot-dev
mysnoozepod-iot-prod
```

## Environment Values

The IoT runtime uses these environment variables. The SAM template sets them automatically:

| Variable | Source |
| --- | --- |
| `IOT_ENV` | `DeploymentEnv` parameter |
| `IOT_STORE_ID` | `StoreId` parameter |
| `IOT_DEVICE_REGISTRY_PATH` | `data/iot-device-registry.v1.json` |
| `IOT_ZONE_STATE_TABLE` | `msp-{env}-zone-state` |
| `IOT_ZONE_EVENTS_TABLE` | `msp-{env}-zone-events` |
| `IOT_QUARANTINE_QUEUE_URL` | `msp-{env}-iot-quarantine` queue URL |
| `IOT_EVENT_TTL_DAYS` | `EventTtlDays` parameter |
| `IOT_LOG_LEVEL` | `LogLevel` parameter |
| `SHOWROOM_DEVICE_REGISTRY_PATH` | `data/showroom-device-registry.v1.json` |
| `WEBSOCKET_CONNECTIONS_TABLE` | `msp-{env}-websocket-connections` |
| `WEBSOCKET_API_ENDPOINT` | WebSocket API management endpoint |
| `WEBSOCKET_CONNECTION_TTL_SECONDS` | `WebSocketConnectionTtlSeconds` parameter |

## Validate Locally

```powershell
node tests/runIotZoneEventIngestionTests.js
node tests/runIotWebSocketTests.js
sam validate --template-file template.yaml
```

If `sam validate` is unavailable, install the SAM CLI before deploying.

## Build

```powershell
sam build --template-file template.yaml
```

The repository includes `.aws-samignore` so the SAM Lambda artifact excludes the React app, Shopify theme files, screenshots, zip archives, local debug output, and other non-runtime assets.

## Deploy Dev

```powershell
sam deploy `
  --template-file .aws-sam/build/template.yaml `
  --stack-name mysnoozepod-iot-dev `
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    DeploymentEnv=dev `
    StoreId=severn-pilot `
    EventTtlDays=180 `
    LogLevel=info `
    LogRetentionDays=30 `
    WebSocketConnectionTtlSeconds=86400
```

Optional alarm email:

```powershell
sam deploy `
  --template-file .aws-sam/build/template.yaml `
  --stack-name mysnoozepod-iot-dev `
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    DeploymentEnv=dev `
    StoreId=severn-pilot `
    EventTtlDays=180 `
    LogLevel=info `
    LogRetentionDays=30 `
    WebSocketConnectionTtlSeconds=86400 `
    AlarmEmail=you@example.com
```

If you provide `AlarmEmail`, confirm the SNS email subscription before relying on alarm notifications.

## Deploy Prod

Deploy prod only after dev validation:

```powershell
sam deploy `
  --template-file .aws-sam/build/template.yaml `
  --stack-name mysnoozepod-iot-prod `
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    DeploymentEnv=prod `
    StoreId=severn-pilot `
    EventTtlDays=180 `
    LogLevel=info `
    LogRetentionDays=30 `
    WebSocketConnectionTtlSeconds=86400
```

## WebSocket Backend

The stack creates an API Gateway WebSocket API for realtime showroom zone events.

Routes:

| Route | Purpose |
| --- | --- |
| `$connect` | Validates `deviceId` and stores the connection. |
| `$disconnect` | Deletes the connection and subscriptions. |
| `subscribe` | Authorizes and stores zone subscriptions. |
| `unsubscribe` | Removes zone subscriptions. |

Connect:

```text
wss://{api-id}.execute-api.{region}.amazonaws.com/{env}?deviceId=pod-3-ipad-01
```

Subscribe:

```json
{ "action": "subscribe", "zoneId": "pod-3" }
```

Authorization:

- Pod iPads can subscribe only to their assigned pod zone.
- `welcome-01` can subscribe only to `welcome-kiosk`.
- `ask-snoozer-01` can subscribe only to `ask-snoozer`.
- `sleep-essentials-01` can subscribe only to `sleep-essentials-zone`.
- `checkout-01` can subscribe only to `checkout-zone`.
- `admin-dev` can subscribe to all registered zones.
- Unknown devices, disabled devices, unknown zones, and unauthorized zones are rejected.

## IoT Rule SQL

The stack creates one broad validated rule:

```sql
SELECT *, topic() AS mqttTopic, timestamp() AS iotReceivedAt FROM 'mysnoozepod/+/stores/+/+/+/#'
```

The Lambda runtime still rejects unsupported topic shapes, cross-env messages, cross-store messages, unregistered devices, unregistered sensors, disabled devices, stale latest-state updates, and malformed payloads.

## Post-Deploy Smoke Test

Get stack outputs:

```powershell
aws cloudformation describe-stacks `
  --stack-name mysnoozepod-iot-dev `
  --query "Stacks[0].Outputs"
```

Use the `ShowroomWebSocketUrl` output for realtime clients.

Optional WebSocket smoke test:

```powershell
npx wscat -c "wss://<api-id>.execute-api.us-east-1.amazonaws.com/dev?deviceId=pod-3-ipad-01"
```

Then send:

```json
{ "action": "subscribe", "zoneId": "pod-3" }
```

Invoke Lambda directly with a known-good event:

```powershell
aws lambda invoke `
  --function-name msp-dev-zone-event-ingest `
  --payload file://tests/fixtures/iot-zone-event-valid.json `
  response.json
```

If you do not have the fixture file, create a temporary payload shaped like:

```json
{
  "mqttTopic": "mysnoozepod/dev/stores/severn-pilot/zones/pod-3/events",
  "payload": {
    "schemaVersion": "1.0",
    "eventId": "evt-dev-pod-3-smoke-001",
    "env": "dev",
    "storeId": "severn-pilot",
    "zoneId": "pod-3",
    "zoneType": "pod",
    "podId": "pod-3",
    "deviceId": "pod-3-edge-01",
    "sensorId": "pod-3-presence-01",
    "sensorType": "mmwave-presence",
    "eventType": "presence_detected",
    "state": "active",
    "value": true,
    "unit": null,
    "confidence": 0.95,
    "sequence": 1,
    "timestamp": "2026-07-16T12:00:00.000Z",
    "source": "edge-controller",
    "firmwareVersion": "1.0.0",
    "sessionId": null,
    "snoozeCode": null,
    "metadata": {}
  }
}
```

Important: update the timestamp before invoking. Events more than the stale window old are accepted into history but will not update latest state.

## Verify DynamoDB

```powershell
aws dynamodb get-item `
  --table-name msp-dev-zone-state `
  --key "{""PK"":{""S"":""STORE#severn-pilot""},""SK"":{""S"":""ZONE#pod-3""}}"
```

Query history:

```powershell
aws dynamodb query `
  --table-name msp-dev-zone-events `
  --key-condition-expression "PK = :pk" `
  --expression-attribute-values "{ "":pk"": { ""S"": ""STORE#severn-pilot#ZONE#pod-3"" } }"
```

## Verify Quarantine

Send a malformed direct invoke and confirm it lands in SQS:

```powershell
aws sqs get-queue-attributes `
  --queue-url <IoTQuarantineQueueUrl> `
  --attribute-names ApproximateNumberOfMessages
```

## Verify CloudWatch

Log group:

```text
/aws/lambda/msp-{env}-zone-event-ingest
```

Metrics namespace:

```text
MySnoozePod/IoT
```

Check:

- Lambda Errors.
- `ZoneEventAcceptedLog`.
- `ZoneEventRejectedLog`.
- `ZoneEventDuplicateSuppressedLog`.
- `ZoneEventQuarantineFailedLog`.
- SQS visible messages alarm.
- DynamoDB write throttle alarms.

## Phase 7 Physical Control Bridge

Deploy the SAM stack with the IoT Data-ATS endpoint when physical command publishing is enabled:

```powershell
$iotEndpoint = aws iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text

sam deploy `
  --stack-name mysnoozepod-iot-dev `
  --capabilities CAPABILITY_IAM `
  --parameter-overrides `
    DeploymentEnv=dev `
    StoreId=severn-pilot `
    IotDataEndpoint=$iotEndpoint
```

Physical command HTTP route used by the React showroom backend:

```text
POST /iot/physical-control/commands
```

Minimum request:

```json
{
  "commandType": "set_lighting_state",
  "zoneId": "pod-3",
  "desiredState": {
    "lightingState": "rest-test"
  },
  "source": "frontend",
  "sourceSurface": "pod"
}
```

Expected command topic:

```text
mysnoozepod/{env}/stores/{storeId}/devices/{deviceId}/commands
```

Controller ack topic:

```text
mysnoozepod/{env}/stores/{storeId}/devices/{deviceId}/ack
```

Controller reported-state topic:

```text
mysnoozepod/{env}/stores/{storeId}/devices/{deviceId}/reported-state
```

If the main manually deployed backend Lambda owns `POST /iot/physical-control/commands`, its execution role also needs:

- `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem`, and `dynamodb:Query` on `msp-{env}-physical-control`.
- `iot:Publish` on `arn:aws:iot:{region}:{account}:topic/mysnoozepod/{env}/stores/{storeId}/devices/*/commands`.
- `execute-api:ManageConnections` for the showroom WebSocket API if command status should broadcast immediately.

Physical failures are expected to fail softly. Manual showroom flows, cart, checkout, and Shopify truth must continue working even if command publish, ack, or reported-state handling is unavailable.

## What This Stack Does Not Do

- Does not create IoT Things or certificates.
- Does not flash firmware.
- Does not wire React clients to the WebSocket URL.
- Does not flash edge firmware.
- Does not change cart, checkout, Shopify, Zoho, or Calendly behavior.
- Does not migrate existing Lambda/API Gateway stack.
