# Rewards Runtime Deployment

This runbook connects the existing shared `snoozer-backend` Lambda to the
source-controlled rewards stack. It does not create a second API.

## Prerequisites

- AWS account `851725413787`
- Region `us-east-1`
- AWS SAM CLI
- Permission to deploy CloudFormation, create the template resources, update
  `snoozer-backend`, and pass the Lambda execution roles
- Existing customer profile table name

## Validate and deploy infrastructure

```powershell
sam validate --template-file infrastructure/rewards-template.yaml --lint
sam build --template-file infrastructure/rewards-template.yaml
sam deploy `
  --stack-name msp-staging-rewards `
  --region us-east-1 `
  --capabilities CAPABILITY_IAM `
  --resolve-s3 `
  --parameter-overrides DeploymentEnv=staging CustomerProfileTableName=<profile-table>
```

Read the stack outputs before configuring the shared Lambda:

```powershell
aws cloudformation describe-stacks `
  --stack-name msp-staging-rewards `
  --region us-east-1 `
  --query "Stacks[0].Outputs"
```

## Upload and validate active documents

The application validator must pass before the feature is enabled:

```powershell
node tests/runRewardsFoundationTests.js
node tests/runRewardsProductionTests.js
aws s3 cp data/rewards-rules.staging.v1.json `
  s3://msp-staging-rewards-rules-851725413787/rewards/staging/rewards-rules.v1.json
aws s3 cp data/rewards-product-classifications.staging.v1.json `
  s3://msp-staging-rewards-rules-851725413787/rewards/staging/rewards-product-classifications.v1.json
```

## Shared Lambda environment

Merge these values with the current environment. Do not replace unrelated
Shopify, Zoho, IoT, profile, S3, or voice variables.

```text
REWARDS_FEATURE_ENABLED=true
REWARDS_ENVIRONMENT=staging
REWARDS_TABLE_NAME=msp-staging-rewards
REWARDS_RULES_BUCKET=msp-staging-rewards-rules-851725413787
REWARDS_RULES_KEY=rewards/staging/rewards-rules.v1.json
REWARDS_RULES_CACHE_TTL_MS=60000
REWARDS_CLASSIFICATIONS_BUCKET=msp-staging-rewards-rules-851725413787
REWARDS_CLASSIFICATIONS_KEY=rewards/staging/rewards-product-classifications.v1.json
REWARDS_CLASSIFICATIONS_CACHE_TTL_MS=60000
REWARDS_ZOHO_QUEUE_URL=<RewardsZohoQueueUrl stack output>
REWARDS_REDEMPTION_ENABLED=false
```

The `snoozer-backend` execution role requires read/write access to
`msp-staging-rewards`, read access to both S3 objects, and `sqs:SendMessage`
to the rewards Zoho queue. Keep redemption disabled until Shopify mappings
are verified.

## Package and deploy the shared Lambda

```powershell
npm run package:lambda
aws lambda update-function-code `
  --function-name snoozer-backend `
  --zip-file fileb://snoozer-backend.zip `
  --region us-east-1
aws lambda wait function-updated `
  --function-name snoozer-backend `
  --region us-east-1
```

Update the Lambda environment with a merged JSON document, then wait for
`LastUpdateStatus=Successful`. A cold container must emit
`rewards.configuration.ready` with no missing required keys.

## Live verification

Create an active showroom session, bind the Snooze Code to it, and send both
identity headers expected by `services/rewards/identity.js`.

```powershell
$base = "https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod"
$session = Invoke-WebRequest "$base/session/start" `
  -Method POST `
  -ContentType "application/json" `
  -Body (@{ source = "amplify_staging"; storeId = "mysnoozepod-1" } | ConvertTo-Json)
$sessionId = [string]$session.Headers["X-Session-Id"]
Invoke-RestMethod "$base/identity/check-in" `
  -Method POST `
  -ContentType "application/json" `
  -Body (@{
    snoozeCode = "1234"
    accessCode = "1234"
    sessionId = $sessionId
    sourceSurface = "amplify_staging"
  } | ConvertTo-Json)
$headers = @{
  "x-snooze-code" = "1234"
  "x-session-id" = $sessionId
}
Invoke-RestMethod "$base/rewards/summary" -Headers $headers
Invoke-RestMethod "$base/rewards/history" -Headers $headers
Invoke-RestMethod "$base/rewards/offers" -Headers $headers
Invoke-RestMethod "$base/rewards/gift" -Headers $headers
```

Repeat and concurrently invoke summary to confirm the canonical profile and
assessment bootstrap claims remain exactly-once. Verify claims, ledger,
summary, and outbox entities in DynamoDB rather than trusting a browser total.

## Rollback

Set `REWARDS_FEATURE_ENABLED=false` on `snoozer-backend` without changing
other environment variables. Deploy the prior Lambda package if code rollback
is also required. The rewards table and bucket are retained by the template;
do not delete them during an application rollback.
