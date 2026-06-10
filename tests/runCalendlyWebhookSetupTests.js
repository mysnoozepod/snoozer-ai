#!/usr/bin/env node

const assert = require("assert");
const {
  WEBHOOK_EVENTS,
  buildSubscriptionPayload,
  buildListUrl,
  matchesTarget,
  sanitizeSubscriptionSummary,
  sanitizeUrl,
  shouldFallbackToUserScope,
  isDuplicateError,
} = require("../scripts/calendlyWebhookSetup");

function testOrganizationPayload() {
  const payload = buildSubscriptionPayload({
    webhookUrl: "https://example.com/prod/booking/calendly-webhook",
    organizationUri: "https://api.calendly.com/organizations/ORG123",
  });

  assert.deepStrictEqual(payload, {
    url: "https://example.com/prod/booking/calendly-webhook",
    events: [...WEBHOOK_EVENTS].sort(),
    organization: "https://api.calendly.com/organizations/ORG123",
    scope: "organization",
  });
}

function testUserPayload() {
  const payload = buildSubscriptionPayload({
    webhookUrl: "https://example.com/prod/booking/calendly-webhook",
    organizationUri: "https://api.calendly.com/organizations/ORG123",
    userUri: "https://api.calendly.com/users/USER123",
    scope: "user",
  });

  assert.deepStrictEqual(payload, {
    url: "https://example.com/prod/booking/calendly-webhook",
    events: [...WEBHOOK_EVENTS].sort(),
    organization: "https://api.calendly.com/organizations/ORG123",
    scope: "user",
    user: "https://api.calendly.com/users/USER123",
  });
}

function testSanitizeUrlAndSummary() {
  assert.strictEqual(
    sanitizeUrl("https://example.com/hook?secret=abc123&foo=bar"),
    "https://example.com/hook?secret=REDACTED&foo=REDACTED"
  );

  const summary = sanitizeSubscriptionSummary({
    uri: "https://api.calendly.com/webhook_subscriptions/ABC123",
    callback_url: "https://example.com/hook?secret=abc123",
    state: "active",
    scope: "organization",
    events: ["invitee.canceled", "invitee.created", "invitee.created"],
  });

  assert.deepStrictEqual(summary, {
    uri: "https://api.calendly.com/webhook_subscriptions/ABC123",
    callback_url: "https://example.com/hook?secret=REDACTED",
    state: "active",
    scope: "organization",
    events: ["invitee.canceled", "invitee.created"],
  });
}

function testListUrlAndTargetMatching() {
  const url = buildListUrl({
    organizationUri: "https://api.calendly.com/organizations/ORG123",
    userUri: "https://api.calendly.com/users/USER123",
    scope: "user",
    count: 50,
  });

  assert.strictEqual(
    url,
    "https://api.calendly.com/webhook_subscriptions?organization=https%3A%2F%2Fapi.calendly.com%2Forganizations%2FORG123&scope=user&count=50&user=https%3A%2F%2Fapi.calendly.com%2Fusers%2FUSER123"
  );

  assert.strictEqual(
    matchesTarget(
      {
        callback_url: "https://example.com/prod/booking/calendly-webhook",
        scope: "organization",
        organization: "https://api.calendly.com/organizations/ORG123",
        events: ["invitee.created", "invitee.canceled"],
      },
      {
        webhookUrl: "https://example.com/prod/booking/calendly-webhook",
        organizationUri: "https://api.calendly.com/organizations/ORG123",
        scope: "organization",
      }
    ),
    true
  );

  assert.strictEqual(
    matchesTarget(
      {
        callback_url: "https://example.com/prod/booking/calendly-webhook",
        scope: "organization",
        organization: "https://api.calendly.com/organizations/ORG123",
        events: ["invitee.created"],
      },
      {
        webhookUrl: "https://example.com/prod/booking/calendly-webhook",
        organizationUri: "https://api.calendly.com/organizations/ORG123",
        scope: "organization",
      }
    ),
    false
  );
}

function testFallbackAndDuplicateHelpers() {
  assert.strictEqual(
    shouldFallbackToUserScope({
      status: 403,
      payload: { title: "Forbidden", message: "Organization scope is not permitted for this token." },
    }),
    true
  );

  assert.strictEqual(
    shouldFallbackToUserScope({
      status: 500,
      payload: { title: "Internal Server Error" },
    }),
    false
  );

  assert.strictEqual(
    isDuplicateError({
      status: 409,
      payload: { title: "Conflict", message: "Webhook subscription already exists." },
    }),
    true
  );

  assert.strictEqual(
    isDuplicateError({
      status: 400,
      payload: { title: "Bad Request", message: "Missing callback URL." },
    }),
    false
  );
}

function main() {
  testOrganizationPayload();
  testUserPayload();
  testSanitizeUrlAndSummary();
  testListUrlAndTargetMatching();
  testFallbackAndDuplicateHelpers();
  console.log("All Calendly webhook setup tests passed.");
}

main();
