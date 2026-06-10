# Calendly Webhook Setup

Use the local Calendly setup script to check or create webhook subscriptions for the deployed Snoozer booking routes.

Primary backend route:
- `POST /booking/calendly-webhook`

Alias route:
- `POST /calendly/webhook`

Recommended callback URL:
- `https://<your-api-host>/prod/booking/calendly-webhook`

## Required env vars

For listing:
- `CALENDLY_ACCESS_TOKEN` or `CALENDLY_PAT`

For creating:
- `CALENDLY_ACCESS_TOKEN` or `CALENDLY_PAT`
- `CALENDLY_WEBHOOK_URL`

Optional:
- `CALENDLY_ORGANIZATION_URI`
- `CALENDLY_USER_URI`

If the organization or user URI is missing, the script will call `GET https://api.calendly.com/users/me` and discover them automatically.

## Commands

List current subscriptions:

```powershell
$env:CALENDLY_ACCESS_TOKEN="your-calendly-pat"
npm run calendly:webhooks:list
```

List with an explicit webhook URL so matching callbacks are easy to spot:

```powershell
$env:CALENDLY_ACCESS_TOKEN="your-calendly-pat"
$env:CALENDLY_WEBHOOK_URL="https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod/booking/calendly-webhook"
npm run calendly:webhooks:list
```

Create the subscription:

```powershell
$env:CALENDLY_ACCESS_TOKEN="your-calendly-pat"
$env:CALENDLY_WEBHOOK_URL="https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod/booking/calendly-webhook"
npm run calendly:webhooks:create
```

Direct CLI usage:

```powershell
node scripts/calendlyWebhookSetup.js --create --webhook-url "https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod/booking/calendly-webhook"
```

## Behavior

- The script lists organization-scoped subscriptions first.
- If organization scope is not permitted, it falls back to user scope.
- `--create` only creates a subscription when one does not already exist.
- Duplicate/409 responses are reported cleanly and do not fail the script.
- Output is sanitized. Query-string values in callback URLs are redacted.

## Safety

- Do not commit your Calendly PAT.
- Do not paste the PAT into docs, source, or screenshots.
- Store it in your shell session or a local `.env` file that stays uncommitted.
