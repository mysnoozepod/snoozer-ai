# MySnoozePod Rewards Production Implementation

## Trust model

The AWS rewards engine owns rules and current reward state. The rewards table
owns the immutable ledger, summaries, claims, unlocks, redemptions, gifts, and
outbox. Customer Profile OS receives a non-authoritative summary. Zoho receives
asynchronous projections only. Shopify remains the only source for live cart,
price, variant, availability, discount application, and checkout truth. React
is a read-only cache.

## Active staging program

The versioned program is `data/rewards-rules.staging.v1.json`. It is not loaded
implicitly. Upload it to the configured S3 key and explicitly enable rewards.

| Milestone | Points | Scope |
| --- | ---: | --- |
| Canonical profile established | 100 | shopper lifetime |
| Assessment saved | 100 | shopper lifetime |
| First three distinct Pod completions | 50 each | Pod |
| Sleep Essentials completed | 100 | showroom journey |
| Favorites and ratings completed | 25 | showroom journey |
| Full Rest Test completed | 25 | showroom journey |

Badges end at Explorer (0), Rest Tester (100), Sleep Scholar (250), and Snooze
Specialist (500). At 500 points one complimentary sleep mask is unlocked without
deducting points.

## API routes

Public routes require the canonical Snooze Code plus its active session:

- `GET /rewards/summary`
- `GET /rewards/history`
- `GET /rewards/offers`
- `GET /rewards/gift`
- `POST /rewards/redemptions/preview`
- `POST /rewards/redemptions`
- `GET /rewards/redemptions/{redemptionId}`
- `POST /rewards/gift/claim`

Trusted producers use `POST /rewards/events` with the internal rewards token.
Fulfillment staff use `POST /rewards/internal/gift/fulfill`. Legacy arbitrary
earn and redeem routes return HTTP 410.

Shopify sends signed commerce lifecycle events to:

- `POST /webhooks/shopify/rewards`

Subscribe the route to `orders/create`, `orders/paid`, `orders/cancelled`,
`refunds/create`, and `returns/close`. The handler verifies the raw request body
with `SHOPIFY_WEBHOOK_SECRET`, claims the Shopify webhook ID transactionally,
and resolves the reward from its exact discount-code binding. It never scans
customer profiles or guesses an identity.

## Deployment

```powershell
sam validate --lint -t infrastructure/rewards-template.yaml
sam build -t infrastructure/rewards-template.yaml
sam deploy --guided --template-file .aws-sam/build/template.yaml

$bucket = "<RewardsRulesBucketName output>"
$key = "rewards/staging/rewards-rules.v1.json"
aws s3 cp data/rewards-rules.staging.v1.json "s3://$bucket/$key"
```

Apply the stack outputs to the existing backend Lambda:

```text
REWARDS_FEATURE_ENABLED=true
REWARDS_REDEMPTION_ENABLED=false
REWARDS_ENVIRONMENT=staging
REWARDS_TABLE_NAME=<stack output>
REWARDS_RULES_BUCKET=<stack output>
REWARDS_RULES_KEY=rewards/staging/rewards-rules.v1.json
REWARDS_RULES_CACHE_TTL_MS=300000
REWARDS_ZOHO_QUEUE_URL=<stack output>
REWARDS_INTERNAL_TOKEN=<secure value>
REWARDS_ZOHO_FIELD_MAP_JSON=<verified mapping JSON>
REWARDS_PRODUCT_CLASSIFICATIONS_BUCKET=<verified catalog bucket>
REWARDS_PRODUCT_CLASSIFICATIONS_KEY=<verified catalog key>
REWARDS_SHOPIFY_PRICE_RULE_IDS_JSON=<verified mapping JSON>
SHOPIFY_WEBHOOK_SECRET=<secure Shopify app webhook secret>
```

Keep `REWARDS_REDEMPTION_ENABLED=false` until every Shopify price-rule mapping
has been verified against staging. Missing product classifications, current
prices, Zoho mappings, or Shopify mappings fail the reward operation closed.
They do not block normal cart or checkout.

## Outbox behavior

Every reward transaction writes an OUTBOX item in the same DynamoDB transaction.
The table stream publishes only new pending OUTBOX items to SQS. The Zoho worker
loads the latest summary, rejects stale projections, maps only configured Zoho
Contact fields, and marks the outbox delivered only after Zoho confirms success.
Retryable failures remain visible and are retried; exhausted messages go to the
DLQ. Reward awards never wait for Zoho.

## Rollback

1. Set `REWARDS_FEATURE_ENABLED=false` on the backend Lambda.
2. Leave the rewards table and S3 rules object intact for audit/history.
3. Set the Zoho queue event-source mapping to disabled if CRM delivery must stop.
4. Redeploy the previous backend and frontend artifacts if runtime rollback is
   required.
5. Do not delete the rewards table, ledger, or claims. The SAM table and rules
   bucket use retention policies.

Normal Shopify cart and checkout remain available throughout rollback.

## Staging activation blockers

Do not enable redemption until all of the following are verified in the staging
accounts:

1. Live Shopify price-rule IDs for all three offers.
2. Live catalog classifications for standard pillows and accessories. The
   checked-in staging classification intentionally includes only verified
   mattress and base handles, so pillow and accessory rewards currently fail
   closed.
3. Zoho Contact field API names in `REWARDS_ZOHO_FIELD_MAP_JSON`.
4. A Shopify webhook secret and subscriptions pointing to the staging backend.
5. Staging AWS credentials and stack parameters.

These are external configuration requirements, not reasons to weaken validation
or substitute hardcoded product/price truth.
