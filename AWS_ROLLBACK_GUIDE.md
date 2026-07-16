# AWS Rollback Guide

Status: Phase 3 rollback guide  
Scope: MySnoozePod IoT backend infrastructure only

## Purpose

This guide describes how to safely stop or roll back the IoT backend stack without touching React, Shopify, cart, checkout, Snoozer, Calendly, Zoho, firmware, lighting, or manual showroom flows.

## Fastest Safe Stop

Disable the IoT Rule. This stops new MQTT messages from invoking Lambda while preserving DynamoDB history and latest state.

```powershell
aws iot disable-topic-rule --rule-name msp_dev_zone_event_ingest_rule
```

Prod:

```powershell
aws iot disable-topic-rule --rule-name msp_prod_zone_event_ingest_rule
```

Re-enable:

```powershell
aws iot enable-topic-rule --rule-name msp_dev_zone_event_ingest_rule
```

## Roll Back Lambda Code Only

If a deployment changes Lambda code and infrastructure is still healthy, redeploy the previous Git commit:

```powershell
git checkout <previous-good-commit>
sam build --template-file template.yaml
sam deploy `
  --template-file .aws-sam/build/template.yaml `
  --stack-name mysnoozepod-iot-dev `
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM `
  --parameter-overrides DeploymentEnv=dev StoreId=severn-pilot EventTtlDays=180 LogLevel=info LogRetentionDays=30
```

Return to main after rollback if needed:

```powershell
git checkout main
```

## Quarantine Investigation Before Delete

Before deleting the stack, inspect quarantine messages:

```powershell
aws sqs get-queue-attributes `
  --queue-url <IoTQuarantineQueueUrl> `
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```

If messages exist, export or inspect them before deleting the stack.

## Preserve Data Before Full Stack Delete

DynamoDB tables have point-in-time recovery enabled, but CloudFormation stack deletion can still delete tables unless deletion protection is added later.

Before deleting, export tables if data matters:

```powershell
aws dynamodb export-table-to-point-in-time `
  --table-arn <ZoneEventsTableArn> `
  --s3-bucket <backup-bucket> `
  --s3-prefix iot-backups/zone-events
```

Repeat for:

- `msp-{env}-zone-state`
- `msp-{env}-zone-events`
- `msp-{env}-websocket-connections`

## Delete Dev Stack

Use this for dev only after confirming no useful test data needs to be preserved:

```powershell
sam delete --stack-name mysnoozepod-iot-dev
```

Or:

```powershell
aws cloudformation delete-stack --stack-name mysnoozepod-iot-dev
```

Watch completion:

```powershell
aws cloudformation wait stack-delete-complete --stack-name mysnoozepod-iot-dev
```

## Delete Prod Stack

Prod delete should be a deliberate break-glass action:

1. Disable IoT Rule.
2. Confirm manual showroom flow still works.
3. Export DynamoDB tables if needed.
4. Export or drain SQS quarantine if needed.
5. Delete stack.

```powershell
aws iot disable-topic-rule --rule-name msp_prod_zone_event_ingest_rule
sam delete --stack-name mysnoozepod-iot-prod
```

## Alarm Rollback

If alarms are noisy but ingestion is healthy, disable alarm actions without deleting the stack:

```powershell
aws cloudwatch disable-alarm-actions `
  --alarm-names `
    msp-dev-zone-event-lambda-errors `
    msp-dev-zone-event-rejected `
    msp-dev-iot-quarantine-visible `
    msp-dev-zone-state-write-throttles `
    msp-dev-zone-events-write-throttles
```

Re-enable:

```powershell
aws cloudwatch enable-alarm-actions `
  --alarm-names `
    msp-dev-zone-event-lambda-errors `
    msp-dev-zone-event-rejected `
    msp-dev-iot-quarantine-visible `
    msp-dev-zone-state-write-throttles `
    msp-dev-zone-events-write-throttles
```

## Device-Specific Rollback

If one physical controller misbehaves, do not delete the whole stack.

Preferred order:

1. Disable the controller certificate in AWS IoT.
2. Disable the device in `data/iot-device-registry.v1.json` and redeploy Lambda.
3. Keep other zones ingesting normally.

## What Not To Roll Back

Do not roll back:

- Shopify cart.
- Checkout.
- React showroom.
- Snoozer answer logic.
- Zoho.
- Calendly.
- Product catalog.

The IoT layer is isolated and should fail safely by disabling the IoT Rule or rejecting events.
