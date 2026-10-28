# Snoozer Node.js 24 and Performance & Truth Engine V2 migration

## Deployment target verified on 2026-10-28

- AWS account: `851725413787`
- Region: `us-east-1`
- Function: `snoozer-backend`
- Package type: ZIP
- Handler: `index.lambdaHandler`
- API: HTTP API `snoozer-api` (`u6zcsiqgj0`), stage `prod`
- API integration: unqualified `arn:aws:lambda:us-east-1:851725413787:function:snoozer-backend`, so traffic reaches `$LATEST`
- Test-backend evidence: `REWARDS_ENVIRONMENT=staging`, rewards redemption disabled, Shopify domain `mysnoozepodtest.myshopify.com`, and the Lambda CORS origin is the staging Amplify application.

The API stage is named `prod` and the HTTP API also permits the public MySnoozePod origins. This mixed naming is an operational risk; the test designation above comes from the function's authoritative environment settings, not the stage name.

The function has no CloudFormation stack membership, tags, alias, or Lambda Function URL. It is deployed as a direct ZIP update. `template.yaml` and `infrastructure/rewards-template.yaml` define separate SAM-managed Lambda resources; their runtime declarations are aligned to Node.js 24, but neither template owns `snoozer-backend`.

## Dockerfile status

The root `Dockerfile` is not used by any repository deployment script or SAM template. It contains a stale Node.js 18 base image and an incorrect `app.lambdaHandler` command, while the live function is a ZIP package using `index.lambdaHandler`. It is intentionally unchanged so an inactive container path is not mistaken for the deployed architecture. If container-image deployment is adopted later, replace it with the Node.js 24 Lambda base image and validate a separate image release process.

## Runtime compatibility gates

- Node engine is pinned to major 24.
- Lambda handlers are async and do not use callback-era context APIs removed by Node.js 24.
- The backend remains CommonJS; there is no `type: module` conversion.
- AWS SDK v3 clients are explicitly bundled in the ZIP rather than relying on the runtime copy.
- No native Node add-ons are present in the dependency tree.
- `npm run test:lambda-node24-compatibility` checks the runtime, templates, handler shape, module mode, deprecated Lambda APIs, and bundled SDK clients.

## Rollback protocol

Before mutation, publish the current `$LATEST` code and configuration as an immutable Lambda version and download the current ZIP. Record the runtime, handler, code SHA-256, revision ID, published version, and local ZIP SHA-256 without persisting environment-variable values. Roll back by restoring the preserved ZIP and `nodejs20.x` runtime with revision checks, then re-run the live acceptance probes.

The preserved rollback is Lambda version `17`, runtime `nodejs20.x`, handler `index.lambdaHandler`, and code SHA-256 `5011TgbWUKITWrfgQwEwb3CNmzX+VnPDJJvp51Q9MQk=`. The downloaded rollback ZIP matched that AWS code hash exactly.

## IAM and inspection

The apparent runtime-inspection blocker was not an IAM denial. `lambda:GetFunctionConfiguration` succeeded; the Windows AWS CLI failed while rendering a malformed Unicode environment value. Setting `PYTHONUTF8=1` and `AWS_CLI_FILE_ENCODING=utf-8`, and querying only non-secret fields, resolves inspection.

IAM simulation for the `Tyree` principal reports `allowed` for the required Lambda read, rollback, deployment, and invoke actions: `lambda:GetFunctionConfiguration`, `lambda:GetFunction`, `lambda:ListVersionsByFunction`, `lambda:ListAliases`, `lambda:GetPolicy`, `lambda:ListTags`, `lambda:PublishVersion`, `lambda:UpdateFunctionConfiguration`, `lambda:UpdateFunctionCode`, and `lambda:InvokeFunction`. It also reports `allowed` for `apigateway:GET`, `logs:DescribeLogStreams`, `logs:GetLogEvents`, and `logs:FilterLogEvents`. There are no missing IAM permissions for this migration.

During the first unfiltered inspection, the CLI response included secret environment values before its encoding failure. Those values are not recorded here or in any artifact. Rotate the exposed credentials as an operational security follow-up.

## Deployment result

On 2026-10-28, the test backend was updated with revision checks in two steps:

1. The existing code was moved from `nodejs20.x` to `nodejs24.x`; a live API health probe returned HTTP 200 before the code update.
2. The V2 ZIP built from commit `35fb062f83c1164b89e4a9c25a992a638730bfe7` was deployed. Its local and AWS code hashes matched: `k0LOzXjfTfn25ZKdBIDb6XEzptwTcWlG6Ict7AjDtoA=`.

AWS reports the function `Active`, `LastUpdateStatus=Successful`, runtime `nodejs24.x`, and handler `index.lambdaHandler`. The deployed snapshot is immutable Lambda version `18`.

## Validation result

- Node.js `v24.13.0`, npm `11.6.2`, clean `npm ci`, and zero npm audit findings.
- Node 24 Lambda compatibility gate passed: async handler, no callback-era APIs, CommonJS loading, and bundled AWS SDK v3 clients.
- 22 of 22 local V2/runtime regressions passed across Conversation Core, routing, continuity, truth lanes, budget recovery, reliability, Active Journey, shopper feedback, semantic integrity, typed actions, quality loop, surface parity, legacy excision, Shopify API versions, shopper identity/session continuity, rewards foundation/configuration/identity/production, and the Performance & Truth benchmark.
- Integration-secret tests passed 7 of 7.
- `template.yaml` passed SAM lint. `infrastructure/rewards-template.yaml` passed basic SAM validation; lint still reports its pre-existing W3011 retention-policy warnings at lines 180 and 187.
- Live health, identity assessment, Active Journey creation, rewards summary, and Shopify product listing probes passed on Node 24.
- CloudWatch review found no import-module, handler-not-found, process-exit, unhandled-rejection, or Lambda task-timeout errors after deployment.

## Remaining acceptance blockers

Production readiness is not declared. These application-level gates remain open:

- The local trusted-advisor regression still fails the pre-existing bundle continuity assertion: the fixture expects the 12-inch All Foam mattress, while the reply uses the 14-inch Hybrid.
- Snoozer Academy's live nine-turn trust scenario passes turns 1-8 and falls back on turn 9 because response validation reports `claim_source_missing:product`.
- The live trusted-advisor scenario falls back at its compatibility turn.
- The live Active Journey browser flow passes identity creation, check-in, Rest Test feedback, rejection continuity, and recommendation selection, then fails a King-size continuity assertion because the expected size is undefined.
- Rotate the credentials exposed to the local terminal during the initial unfiltered Lambda configuration inspection.
