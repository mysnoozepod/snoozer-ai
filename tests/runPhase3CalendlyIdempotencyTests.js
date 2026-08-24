#!/usr/bin/env node

const assert = require("assert");
const {
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const bookingSession = require("../services/bookingSession");
const customerProfile = require("../services/customerProfile");
const calendlyWebhookIdempotency = require("../services/calendlyWebhookIdempotency");
const { resolveRecommendation } = require("../services/recommendationResolver");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

async function buildCanonicalRecommendation(assessment) {
  const resolved = await resolveRecommendation({
    assessment,
    includeProducts: true,
    includePods: true,
    source: "phase3_idempotency_test",
  });

  return {
    manifestVersion: resolved.manifestVersion,
    normalizedAssessment: resolved.normalizedAssessment,
    ...resolved.recommendation,
  };
}

function buildExistingProfile({ shopperId, assessmentAnswers, canonicalRecommendation }) {
  return customerProfile.buildCustomerProfilePatch({
    shopperId,
    snoozeCode: shopperId,
    accessCode: shopperId,
    profileId: `shopper#${shopperId}`,
    identityType: "snooze_code",
    identitySource: "test_seed",
    assessmentAnswers,
    canonicalRecommendation,
    leadStage: "assessment_completed",
  });
}

function createLedgerClient(options = {}) {
  const store = new Map();
  const state = {
    failPut: Boolean(options.failPut),
  };

  return {
    store,
    state,
    async send(command) {
      const input = command.input || {};
      const key = input.Key || {};
      const sessionId = String(key.sessionId || input.Item?.sessionId || "").trim();

      if (command instanceof GetCommand) {
        return { Item: clone(store.get(sessionId) || null) };
      }

      if (command instanceof PutCommand) {
        if (state.failPut) {
          const error = new Error("LEDGER_WRITE_DENIED");
          error.code = "AccessDeniedException";
          throw error;
        }

        if (store.has(sessionId)) {
          const error = new Error("Conditional request failed");
          error.name = "ConditionalCheckFailedException";
          error.code = "ConditionalCheckFailedException";
          throw error;
        }

        store.set(sessionId, clone(input.Item));
        return {};
      }

      if (command instanceof UpdateCommand) {
        const existing = clone(store.get(sessionId) || {});
        if (!Object.keys(existing).length) {
          const error = new Error("Missing ledger record");
          error.name = "ConditionalCheckFailedException";
          error.code = "ConditionalCheckFailedException";
          throw error;
        }

        const values = input.ExpressionAttributeValues || {};
        if (
          Object.prototype.hasOwnProperty.call(values, ":failed") &&
          existing.status !== values[":failed"] &&
          String(input.ConditionExpression || "").includes("#status = :failed")
        ) {
          const error = new Error("Conditional request failed");
          error.name = "ConditionalCheckFailedException";
          error.code = "ConditionalCheckFailedException";
          throw error;
        }

        if (Object.prototype.hasOwnProperty.call(values, ":processing")) {
          existing.status = values[":processing"];
        }
        if (Object.prototype.hasOwnProperty.call(values, ":processed")) {
          existing.status = values[":processed"];
        }
        if (Object.prototype.hasOwnProperty.call(values, ":failed")) {
          existing.status = existing.status === "failed" ? existing.status : existing.status;
        }
        if (Object.prototype.hasOwnProperty.call(values, ":lastAttemptAt")) {
          existing.lastAttemptAt = values[":lastAttemptAt"];
        }
        if (Object.prototype.hasOwnProperty.call(values, ":attemptCount")) {
          existing.attemptCount = values[":attemptCount"];
        }
        if (Object.prototype.hasOwnProperty.call(values, ":reason")) {
          existing.reason = values[":reason"];
        }
        if (Object.prototype.hasOwnProperty.call(values, ":failedAt")) {
          existing.failedAt = values[":failedAt"];
        }
        if (Object.prototype.hasOwnProperty.call(values, ":processedAt")) {
          existing.processedAt = values[":processedAt"];
          existing.status = values[":processed"];
        }
        if (Object.prototype.hasOwnProperty.call(values, ":shopperId")) {
          existing.shopperId = values[":shopperId"];
        }
        if (Object.prototype.hasOwnProperty.call(values, ":profileId")) {
          existing.profileId = values[":profileId"];
        }
        if (Object.prototype.hasOwnProperty.call(values, ":bookingId")) {
          existing.bookingId = values[":bookingId"];
        }
        if (Object.prototype.hasOwnProperty.call(values, ":resultSummary")) {
          existing.resultSummary = clone(values[":resultSummary"]);
        }
        if (
          Object.prototype.hasOwnProperty.call(values, ":failed") &&
          String(input.UpdateExpression || "").includes("#status = :failed")
        ) {
          existing.status = values[":failed"];
        }

        store.set(sessionId, existing);
        return {};
      }

      return {};
    },
  };
}

function createHarness({ initialProfiles = [], ddbDoc, failFirstUpsert = false } = {}) {
  const profiles = new Map(
    initialProfiles.map((profile) => [String(profile.profileId), clone(profile)])
  );
  const logs = [];
  const stats = {
    profileWriteCount: 0,
    zohoWriteCount: 0,
    successfulProfileWrites: 0,
  };
  const state = {
    failFirstUpsert: Boolean(failFirstUpsert),
  };

  return {
    profiles,
    logs,
    stats,
    state,
    options: {
      route: "/booking/calendly-webhook",
      log: (src, msg, extra) => {
        logs.push({
          src: String(src || ""),
          msg: String(msg || ""),
          extra: clone(extra || {}),
        });
      },
      ddbDoc,
      tableName: "snoozer_sessions_test",
      getProfileById: async (profileId) => clone(profiles.get(String(profileId)) || null),
      upsertCustomerProfile: async (patch) => {
        stats.profileWriteCount += 1;
        if (state.failFirstUpsert) {
          state.failFirstUpsert = false;
          const error = new Error("PROFILE_UPSERT_FAILED");
          error.code = "PROFILE_UPSERT_FAILED";
          throw error;
        }

        const normalizedPatch = customerProfile.buildCustomerProfilePatch(patch);
        const profileId =
          normalizedPatch.profileId || `shopper#${normalizedPatch.shopperId || ""}`;
        const previous = clone(profiles.get(profileId) || {});
        const next = customerProfile.mergeCustomerProfile(previous, normalizedPatch);
        profiles.set(profileId, next);
        stats.successfulProfileWrites += 1;
        return {
          ok: true,
          skipped: false,
          profileId,
          profile: clone(next),
        };
      },
      buildCustomerProfilePatch: customerProfile.buildCustomerProfilePatch,
      syncCustomerProfileToZoho: async (profile) => {
        stats.zohoWriteCount += 1;
        return {
          ok: true,
          skipped: false,
          operation: "update",
          shopperId: profile.shopperId,
          contactId: "zoho-phase3-idempotency",
        };
      },
      claimCalendlyWebhook: async (input, options) =>
        calendlyWebhookIdempotency.claimCalendlyWebhook(input, {
          ddbDoc,
          tableName: options.tableName,
        }),
      markCalendlyWebhookProcessed: async (input, options) =>
        calendlyWebhookIdempotency.markCalendlyWebhookProcessed(input, {
          ddbDoc,
          tableName: options.tableName,
        }),
      markCalendlyWebhookFailed: async (input, options) =>
        calendlyWebhookIdempotency.markCalendlyWebhookFailed(input, {
          ddbDoc,
          tableName: options.tableName,
        }),
      assessCalendlyWebhookIdempotency:
        calendlyWebhookIdempotency.assessCalendlyWebhookIdempotency,
      deriveCalendlyIdempotencyKey:
        calendlyWebhookIdempotency.deriveCalendlyIdempotencyKey,
    },
  };
}

function buildPayload({
  eventType = "invitee.created",
  inviteeUri,
  eventUri,
  email,
  name,
  startTime,
  endTime,
  trackingCode,
} = {}) {
  return {
    event: eventType,
    payload: {
      invitee: {
        uri: inviteeUri,
        email,
        name,
      },
      scheduled_event: {
        uri: eventUri,
        start_time: startTime,
        end_time: endTime,
      },
      tracking: trackingCode
        ? {
            utm_content: trackingCode,
          }
        : undefined,
    },
  };
}

async function testDuplicateInviteeCreatedIsIdempotent() {
  const assessment = {
    size: "Queen",
    motionMode: "No Motion",
    firmness: "Soft",
    sleepPosition: "Side",
    sleepPartner: "No",
    baseType: "No Base",
  };
  const canonicalRecommendation = await buildCanonicalRecommendation(assessment);
  const ddbDoc = createLedgerClient();
  const harness = createHarness({
    initialProfiles: [
      buildExistingProfile({
        shopperId: "1234",
        assessmentAnswers: assessment,
        canonicalRecommendation,
      }),
    ],
    ddbDoc,
  });

  const payload = buildPayload({
    eventType: "invitee.created",
    inviteeUri: "https://api.calendly.com/invitees/idempotent-created-1",
    eventUri: "https://api.calendly.com/scheduled_events/idempotent-created-1",
    email: "created@example.com",
    name: "Created First",
    startTime: "2026-06-26T15:00:00Z",
    endTime: "2026-06-26T15:30:00Z",
    trackingCode: "1234",
  });

  const first = await bookingSession.upsertBookingSession(payload, harness.options);
  const writesAfterFirst = harness.stats.profileWriteCount;
  const zohoAfterFirst = harness.stats.zohoWriteCount;
  const second = await bookingSession.upsertBookingSession(payload, harness.options);

  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.skipped, false);
  assert.strictEqual(first.idempotency?.claimed, true);
  assert.strictEqual(first.sessionPrep?.status, "ready");
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.skipped, true);
  assert.strictEqual(second.duplicate, true);
  assert.strictEqual(harness.stats.profileWriteCount, writesAfterFirst);
  assert.strictEqual(harness.stats.zohoWriteCount, zohoAfterFirst);
  assert.strictEqual(second.sessionPrep, null);
}

async function testDuplicateInviteeCanceledIsIdempotent() {
  const assessment = {
    size: "King",
    motionMode: "Half Split Motion",
    firmness: "Medium",
    partnerFirmness: "Firm",
    sleepPosition: "Side",
    sleepPartner: "Yes",
    baseType: "Adjustable Base",
  };
  const canonicalRecommendation = await buildCanonicalRecommendation(assessment);
  const ddbDoc = createLedgerClient();
  const canonicalProfile = buildExistingProfile({
    shopperId: "777111",
    assessmentAnswers: assessment,
    canonicalRecommendation,
  });
  const aliasProfile = customerProfile.buildCustomerProfilePatch({
    profileId: "alias#booking_invitee:https://api.calendly.com/invitees/idempotent-cancel-1",
    shopperId: "777111",
    snoozeCode: "777111",
    accessCode: "777111",
    identityType: "identity_alias",
    identitySource: "booking_alias",
    aliasOfShopperId: "777111",
    aliasOfProfileId: "shopper#777111",
  });

  const harness = createHarness({
    initialProfiles: [canonicalProfile, aliasProfile],
    ddbDoc,
  });

  const payload = buildPayload({
    eventType: "invitee.canceled",
    inviteeUri: "https://api.calendly.com/invitees/idempotent-cancel-1",
    eventUri: "https://api.calendly.com/scheduled_events/idempotent-cancel-1",
    email: "cancel@example.com",
    name: "Cancel First",
    startTime: "2026-06-26T17:00:00Z",
    endTime: "2026-06-26T17:30:00Z",
  });

  const first = await bookingSession.upsertBookingSession(payload, harness.options);
  const writesAfterFirst = harness.stats.profileWriteCount;
  const zohoAfterFirst = harness.stats.zohoWriteCount;
  const second = await bookingSession.upsertBookingSession(payload, harness.options);

  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.idempotency?.claimed, true);
  assert.strictEqual(first.sessionPrep?.status, "canceled");
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.skipped, true);
  assert.strictEqual(second.duplicate, true);
  assert.strictEqual(harness.stats.profileWriteCount, writesAfterFirst);
  assert.strictEqual(harness.stats.zohoWriteCount, zohoAfterFirst);
}

async function testSameInviteeDifferentEventTypesDoNotConflict() {
  const assessment = {
    size: "Queen",
    motionMode: "Standard Motion",
    firmness: "Firm",
    sleepPosition: "Back",
    sleepPartner: "No",
    baseType: "Adjustable Base",
  };
  const canonicalRecommendation = await buildCanonicalRecommendation(assessment);
  const ddbDoc = createLedgerClient();
  const harness = createHarness({
    initialProfiles: [
      buildExistingProfile({
        shopperId: "880022",
        assessmentAnswers: assessment,
        canonicalRecommendation,
      }),
    ],
    ddbDoc,
  });

  const base = {
    inviteeUri: "https://api.calendly.com/invitees/shared-event-1",
    eventUri: "https://api.calendly.com/scheduled_events/shared-event-1",
    email: "shared@example.com",
    name: "Shared Event",
    startTime: "2026-06-27T15:00:00Z",
    endTime: "2026-06-27T15:30:00Z",
  };

  const created = await bookingSession.upsertBookingSession(
    buildPayload({ ...base, eventType: "invitee.created", trackingCode: "880022" }),
    harness.options
  );
  const canceled = await bookingSession.upsertBookingSession(
    buildPayload({ ...base, eventType: "invitee.canceled" }),
    harness.options
  );

  assert.strictEqual(created.ok, true);
  assert.strictEqual(created.skipped, false);
  assert.strictEqual(canceled.ok, true);
  assert.strictEqual(canceled.skipped, false);
  assert.notStrictEqual(
    created.idempotency?.record?.sessionId,
    canceled.idempotency?.record?.sessionId,
    "event type should namespace idempotency so cancel does not collide with create"
  );
}

async function testMalformedPayloadDoesNotClaimLedgerKey() {
  const ddbDoc = createLedgerClient();
  const harness = createHarness({ ddbDoc });

  const result = await bookingSession.upsertBookingSession(
    {
      event: "invitee.created",
      payload: {},
    },
    harness.options
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "BOOKING_IDENTITY_UNRESOLVED");
  assert.strictEqual(ddbDoc.store.size, 0, "malformed payload should not claim idempotency");
  assert(
    harness.logs.some(
      (entry) =>
        entry.src === "booking.webhook.idempotency" &&
        entry.msg === "INSUFFICIENT_IDEMPOTENCY_EVIDENCE" &&
        entry.extra?.idempotencyStatus === "unclaimed"
    ),
    "malformed payload should log a clear idempotency skip reason"
  );
}

async function testSparsePayloadWithEventUriClaimsIdempotency() {
  const ddbDoc = createLedgerClient();
  const harness = createHarness({ ddbDoc });

  const result = await bookingSession.upsertBookingSession(
    {
      event: "invitee.canceled",
      payload: {
        scheduled_event: {
          uri: "https://api.calendly.com/scheduled_events/sparse-event-uri-1",
        },
      },
    },
    harness.options
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "BOOKING_IDENTITY_UNRESOLVED");
  assert.strictEqual(result.idempotency?.claimed, true);
  assert.strictEqual(result.idempotency?.derived?.source, "event_uri");
  assert.strictEqual(ddbDoc.store.size, 1, "event URI evidence should claim idempotency");
}

async function testSparsePayloadWithInviteeUriClaimsIdempotency() {
  const ddbDoc = createLedgerClient();
  const harness = createHarness({ ddbDoc });

  const result = await bookingSession.upsertBookingSession(
    {
      event: "invitee.canceled",
      payload: {
        invitee: {
          uri: "https://api.calendly.com/invitees/sparse-invitee-uri-1",
        },
      },
    },
    harness.options
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "BOOKING_IDENTITY_UNRESOLVED");
  assert.strictEqual(result.idempotency?.claimed, true);
  assert.strictEqual(result.idempotency?.derived?.source, "invitee_uri");
  assert.strictEqual(ddbDoc.store.size, 1, "invitee URI evidence should claim idempotency");
}

async function testSparsePayloadWithPayloadEventIdClaimsIdempotency() {
  const ddbDoc = createLedgerClient();
  const harness = createHarness({ ddbDoc });

  const result = await bookingSession.upsertBookingSession(
    {
      event: "invitee.created",
      payload: {
        id: "calendly-payload-event-1",
      },
    },
    harness.options
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "BOOKING_IDENTITY_UNRESOLVED");
  assert.strictEqual(result.idempotency?.claimed, true);
  assert.strictEqual(result.idempotency?.derived?.source, "payload_event_id");
  assert.strictEqual(ddbDoc.store.size, 1, "payload event id should claim idempotency");
}

async function testLedgerWriteFailureBlocksMutation() {
  const assessment = {
    size: "Queen",
    motionMode: "No Motion",
    firmness: "Soft",
    sleepPosition: "Side",
    sleepPartner: "No",
    baseType: "No Base",
  };
  const canonicalRecommendation = await buildCanonicalRecommendation(assessment);
  const ddbDoc = createLedgerClient({ failPut: true });
  const harness = createHarness({
    initialProfiles: [
      buildExistingProfile({
        shopperId: "1234",
        assessmentAnswers: assessment,
        canonicalRecommendation,
      }),
    ],
    ddbDoc,
  });

  await assert.rejects(
    () =>
      bookingSession.upsertBookingSession(
        buildPayload({
          eventType: "invitee.created",
          inviteeUri: "https://api.calendly.com/invitees/fail-put-1",
          eventUri: "https://api.calendly.com/scheduled_events/fail-put-1",
          email: "fail-put@example.com",
          name: "Fail Put",
          startTime: "2026-06-27T17:00:00Z",
          endTime: "2026-06-27T17:30:00Z",
          trackingCode: "1234",
        }),
        harness.options
      ),
    /LEDGER_WRITE_DENIED/
  );

  assert.strictEqual(
    harness.stats.profileWriteCount,
    0,
    "profile mutation should not proceed when ledger claim fails"
  );
  assert.strictEqual(
    harness.stats.zohoWriteCount,
    0,
    "Zoho mutation should not proceed when ledger claim fails"
  );
}

async function testFailureAfterClaimMarksFailedAndAllowsRetry() {
  const assessment = {
    size: "Queen",
    motionMode: "Standard Motion",
    firmness: "Firm",
    sleepPosition: "Back",
    sleepPartner: "No",
    baseType: "Adjustable Base",
  };
  const canonicalRecommendation = await buildCanonicalRecommendation(assessment);
  const ddbDoc = createLedgerClient();
  const harness = createHarness({
    initialProfiles: [
      buildExistingProfile({
        shopperId: "1234",
        assessmentAnswers: assessment,
        canonicalRecommendation,
      }),
    ],
    ddbDoc,
    failFirstUpsert: true,
  });

  const payload = buildPayload({
    eventType: "invitee.created",
    inviteeUri: "https://api.calendly.com/invitees/retry-after-fail-1",
    eventUri: "https://api.calendly.com/scheduled_events/retry-after-fail-1",
    email: "retry@example.com",
    name: "Retry After Fail",
    startTime: "2026-06-28T15:00:00Z",
    endTime: "2026-06-28T15:30:00Z",
    trackingCode: "1234",
  });

  await assert.rejects(
    () => bookingSession.upsertBookingSession(payload, harness.options),
    /PROFILE_UPSERT_FAILED/
  );

  const derived = calendlyWebhookIdempotency.deriveCalendlyIdempotencyKey(payload);
  const failedKey = calendlyWebhookIdempotency.buildLedgerSessionId(derived.keyHash);
  const failedRecord = ddbDoc.store.get(failedKey);
  assert.strictEqual(failedRecord?.status, "failed");

  const retry = await bookingSession.upsertBookingSession(payload, harness.options);
  const retriedRecord = ddbDoc.store.get(failedKey);

  assert.strictEqual(retry.ok, true);
  assert.strictEqual(retry.skipped, false);
  assert.strictEqual(retriedRecord?.status, "processed");
  assert.strictEqual(
    retriedRecord?.attemptCount,
    2,
    "retry after failed processing should reclaim the ledger item"
  );
}

async function main() {
  const tests = [
    ["duplicate_invitee_created_is_idempotent", testDuplicateInviteeCreatedIsIdempotent],
    ["duplicate_invitee_canceled_is_idempotent", testDuplicateInviteeCanceledIsIdempotent],
    ["same_invitee_different_event_types_do_not_conflict", testSameInviteeDifferentEventTypesDoNotConflict],
    ["malformed_payload_does_not_claim_ledger_key", testMalformedPayloadDoesNotClaimLedgerKey],
    ["sparse_payload_with_event_uri_claims_idempotency", testSparsePayloadWithEventUriClaimsIdempotency],
    ["sparse_payload_with_invitee_uri_claims_idempotency", testSparsePayloadWithInviteeUriClaimsIdempotency],
    ["sparse_payload_with_payload_event_id_claims_idempotency", testSparsePayloadWithPayloadEventIdClaimsIdempotency],
    ["ledger_write_failure_blocks_mutation", testLedgerWriteFailureBlocksMutation],
    ["failure_after_claim_marks_failed_and_allows_retry", testFailureAfterClaimMarksFailedAndAllowsRetry],
  ];

  const failures = [];

  for (const [name, testFn] of tests) {
    try {
      await testFn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push({ name, message: error.message });
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} failure(s) detected.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${tests.length} Phase 3 Calendly idempotency tests passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
