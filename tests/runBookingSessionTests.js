#!/usr/bin/env node

const assert = require("assert");
const {
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const bookingSession = require("../services/bookingSession");
const calendlyWebhookIdempotency = require("../services/calendlyWebhookIdempotency");
const customerProfile = require("../services/customerProfile");
const { resolveRecommendation } = require("../services/recommendationResolver");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

async function buildCanonicalRecommendation(assessment) {
  const resolved = await resolveRecommendation({
    assessment,
    includeProducts: true,
    includePods: true,
    source: "booking_session_test",
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

function createLedgerClient() {
  const store = new Map();

  return {
    async send(command) {
      const input = command.input || {};
      const key = input.Key || {};
      const sessionId = String(key.sessionId || input.Item?.sessionId || "").trim();

      if (command instanceof GetCommand) {
        return { Item: clone(store.get(sessionId) || null) };
      }

      if (command instanceof PutCommand) {
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
        const values = input.ExpressionAttributeValues || {};

        if (Object.prototype.hasOwnProperty.call(values, ":processing")) {
          existing.status = values[":processing"];
        }
        if (Object.prototype.hasOwnProperty.call(values, ":processed")) {
          existing.status = values[":processed"];
        }
        if (
          Object.prototype.hasOwnProperty.call(values, ":failed") &&
          String(input.UpdateExpression || "").includes("#status = :failed")
        ) {
          existing.status = values[":failed"];
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

        store.set(sessionId, existing);
        return {};
      }

      return {};
    },
  };
}

function withIdempotencyOptions(options = {}) {
  const ddbDoc = createLedgerClient();
  return {
    ...options,
    ddbDoc,
    tableName: "snoozer_sessions_test",
    claimCalendlyWebhook: async (input, runtimeOptions) =>
      calendlyWebhookIdempotency.claimCalendlyWebhook(input, {
        ddbDoc,
        tableName: runtimeOptions.tableName,
      }),
    markCalendlyWebhookProcessed: async (input, runtimeOptions) =>
      calendlyWebhookIdempotency.markCalendlyWebhookProcessed(input, {
        ddbDoc,
        tableName: runtimeOptions.tableName,
      }),
    markCalendlyWebhookFailed: async (input, runtimeOptions) =>
      calendlyWebhookIdempotency.markCalendlyWebhookFailed(input, {
        ddbDoc,
        tableName: runtimeOptions.tableName,
      }),
    deriveCalendlyIdempotencyKey:
      calendlyWebhookIdempotency.deriveCalendlyIdempotencyKey,
  };
}

async function testInviteeCreatedWithExistingSnoozeCodeUsesCanonicalProfile() {
  const assessment = {
    size: "Queen",
    motionMode: "No Motion",
    firmness: "Soft",
    sleepPosition: "Side",
    sleepPartner: "No",
    baseType: "No Base",
    temperature: "Hot",
  };
  const canonicalRecommendation = await buildCanonicalRecommendation(assessment);
  const existingProfile = buildExistingProfile({
    shopperId: "589424",
    assessmentAnswers: assessment,
    canonicalRecommendation,
  });

  const upserts = [];
  const zohoCalls = [];

  const result = await bookingSession.upsertBookingSession(
    {
      event: "invitee.created",
      payload: {
        invitee: {
          uri: "https://api.calendly.com/invitees/existing-1",
          email: "guest@example.com",
          name: "Alex Guest",
          timezone: "America/New_York",
        },
        scheduled_event: {
          uri: "https://api.calendly.com/scheduled_events/existing-1",
          start_time: "2026-06-15T15:00:00Z",
          end_time: "2026-06-15T15:30:00Z",
          location: { type: "in_person", location: "Charlotte showroom" },
        },
        tracking: {
          utm_content: "589424",
        },
      },
    },
    withIdempotencyOptions({
      route: "/booking/calendly-webhook",
      log: function noop() {},
      getProfileById: async (profileId) =>
        clone(profileId === "shopper#589424" ? existingProfile : null),
      upsertCustomerProfile: async (patch) => {
        upserts.push(clone(patch));
        return {
          ok: true,
          skipped: false,
          profileId: patch.profileId || `shopper#${patch.shopperId}`,
        };
      },
      buildCustomerProfilePatch: customerProfile.buildCustomerProfilePatch,
      syncCustomerProfileToZoho: async (profile) => {
        zohoCalls.push(clone(profile));
        return {
          ok: true,
          skipped: false,
          operation: "update",
          shopperId: profile.shopperId,
          contactId: "zoho-contact-1",
        };
      },
      resolveCanonicalIdentity: async () => ({
        shopperId: "589424",
        snoozeCode: "589424",
        accessCode: "589424",
        profileId: "shopper#589424",
        identityType: "snooze_code",
        identitySource: "utm_content",
        isTemporary: false,
      }),
      issueSnoozeCode: async () => {
        throw new Error("existing Snooze Code should not trigger issueSnoozeCode");
      },
    })
  );

  assert.strictEqual(result.ok, true, "booking upsert should succeed");
  assert.strictEqual(result.identity?.shopperId, "589424");
  assert.strictEqual(result.profilePatch?.leadStage, "booked");
  assert.strictEqual(result.profilePatch?.bookingStatus, "scheduled");
  assert.strictEqual(result.sessionPrep?.status, "ready");
  assert.strictEqual(
    result.sessionPrep?.recommendedStartingPod,
    canonicalRecommendation.topPodId,
    "session prep should use canonical starting pod"
  );
  assert.strictEqual(
    result.sessionPrep?.primaryMattressHandle,
    canonicalRecommendation.primaryMattressHandle,
    "session prep should use canonical mattress handle"
  );
  assert.strictEqual(zohoCalls.length, 1, "Zoho should sync once for canonical shopper");
  assert.strictEqual(zohoCalls[0].shopperId, "589424", "Zoho should use canonical Snooze Code");
  assert(
    upserts.some((patch) => patch.profileId === "alias#booking_invitee:https://api.calendly.com/invitees/existing-1"),
    "booking should create invitee alias profile"
  );
}

async function testInviteeCreatedWithTemporaryShopperIdIssuesCanonicalCodeAndCarriesAssessment() {
  const tempShopperId = "shopify-assessment-123";
  const canonicalShopperId = "631245";
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
  const temporaryProfile = customerProfile.buildCustomerProfilePatch({
    shopperId: tempShopperId,
    profileId: `shopper#${tempShopperId}`,
    identityType: "temporary",
    identitySource: "shopify_assessment",
    sourceShopperId: tempShopperId,
    assessmentAnswers: assessment,
    canonicalRecommendation,
    leadStage: "assessment_completed",
  });

  const profileReads = new Map([[`shopper#${tempShopperId}`, temporaryProfile]]);
  const upserts = [];
  const zohoCalls = [];

  const result = await bookingSession.upsertBookingSession(
    {
      event: "invitee.created",
      payload: {
        shopperId: tempShopperId,
        invitee: {
          uri: "https://api.calendly.com/invitees/temp-1",
          email: "temp@example.com",
          name: "Taylor Temp",
        },
        scheduled_event: {
          uri: "https://api.calendly.com/scheduled_events/temp-1",
          start_time: "2026-06-16T17:00:00Z",
          end_time: "2026-06-16T17:30:00Z",
          location: { type: "zoom", location: "Virtual session" },
        },
      },
    },
    withIdempotencyOptions({
      route: "/booking/calendly-webhook",
      log: function noop() {},
      getProfileById: async (profileId) => clone(profileReads.get(profileId) || null),
      upsertCustomerProfile: async (patch) => {
        upserts.push(clone(patch));
        return {
          ok: true,
          skipped: false,
          profileId: patch.profileId || `shopper#${patch.shopperId}`,
        };
      },
      buildCustomerProfilePatch: customerProfile.buildCustomerProfilePatch,
      syncCustomerProfileToZoho: async (profile) => {
        zohoCalls.push(clone(profile));
        return {
          ok: true,
          skipped: false,
          operation: "update",
          shopperId: profile.shopperId,
          contactId: "zoho-contact-2",
        };
      },
      resolveCanonicalIdentity: async () => ({
        shopperId: tempShopperId,
        snoozeCode: null,
        accessCode: null,
        profileId: `shopper#${tempShopperId}`,
        identityType: "temporary",
        identitySource: "shopperId",
        sourceShopperId: tempShopperId,
        isTemporary: true,
      }),
      issueSnoozeCode: async () => ({
        shopperId: canonicalShopperId,
        snoozeCode: canonicalShopperId,
        accessCode: canonicalShopperId,
        profileId: `shopper#${canonicalShopperId}`,
        identityType: "snooze_code",
        identitySource: "generated",
        sourceShopperId: tempShopperId,
        isTemporary: false,
        isNewCode: true,
      }),
      resolveRecommendation: async () => ({
        manifestVersion: canonicalRecommendation.manifestVersion,
        normalizedAssessment: canonicalRecommendation.normalizedAssessment,
        recommendation: canonicalRecommendation,
      }),
    })
  );

  assert.strictEqual(result.identity?.shopperId, canonicalShopperId);
  assert.strictEqual(result.profilePatch?.shopperId, canonicalShopperId);
  assert.strictEqual(result.profilePatch?.bookingStatus, "scheduled");
  assert.strictEqual(result.sessionPrep?.status, "ready");
  assert.strictEqual(
    result.sessionPrep?.recommendedStartingPod,
    canonicalRecommendation.topPodId,
    "temporary profile assessment should survive code issuance"
  );
  assert(
    upserts.some(
      (patch) =>
        patch.profileId === `shopper#${tempShopperId}` &&
        patch.mergedIntoShopperId === canonicalShopperId
    ),
    "temporary shopper profile should be marked as merged into canonical Snooze Code"
  );
  assert(zohoCalls.length >= 1, "Zoho should sync the canonical profile");
  assert(
    zohoCalls.every((call) => call.shopperId === canonicalShopperId),
    "Zoho sync should never use the temporary shopper id"
  );
}

async function testInviteeCanceledCanResolveByStoredInviteeAlias() {
  const assessment = {
    size: "Queen",
    motionMode: "Standard Motion",
    firmness: "Firm",
    sleepPosition: "Back",
    sleepPartner: "No",
    baseType: "Adjustable Base",
  };
  const canonicalRecommendation = await buildCanonicalRecommendation(assessment);
  const canonicalProfile = buildExistingProfile({
    shopperId: "777111",
    assessmentAnswers: assessment,
    canonicalRecommendation,
  });
  const aliasProfile = customerProfile.buildCustomerProfilePatch({
    profileId: "alias#booking_invitee:https://api.calendly.com/invitees/cancel-1",
    shopperId: "777111",
    snoozeCode: "777111",
    accessCode: "777111",
    identityType: "identity_alias",
    identitySource: "booking_alias",
    aliasOfShopperId: "777111",
    aliasOfProfileId: "shopper#777111",
  });

  const profileReads = new Map([
    ["alias#booking_invitee:https://api.calendly.com/invitees/cancel-1", aliasProfile],
    ["shopper#777111", canonicalProfile],
  ]);
  const upserts = [];

  const result = await bookingSession.upsertBookingSession(
    {
      event: "invitee.canceled",
      payload: {
        invitee: {
          uri: "https://api.calendly.com/invitees/cancel-1",
          email: "cancel@example.com",
          name: "Casey Cancel",
        },
        scheduled_event: {
          uri: "https://api.calendly.com/scheduled_events/cancel-1",
          start_time: "2026-06-18T14:00:00Z",
          end_time: "2026-06-18T14:30:00Z",
        },
      },
    },
    withIdempotencyOptions({
      route: "/booking/calendly-webhook",
      log: function noop() {},
      getProfileById: async (profileId) => clone(profileReads.get(profileId) || null),
      upsertCustomerProfile: async (patch) => {
        upserts.push(clone(patch));
        return {
          ok: true,
          skipped: false,
          profileId: patch.profileId || `shopper#${patch.shopperId}`,
        };
      },
      buildCustomerProfilePatch: customerProfile.buildCustomerProfilePatch,
      syncCustomerProfileToZoho: async (profile) => ({
        ok: true,
        skipped: false,
        operation: "update",
        shopperId: profile.shopperId,
        contactId: "zoho-contact-3",
      }),
    })
  );

  assert.strictEqual(result.identity?.shopperId, "777111");
  assert.strictEqual(result.profilePatch?.bookingStatus, "canceled");
  assert.strictEqual(result.profilePatch?.leadStage, "booked");
  assert.strictEqual(result.profilePatch?.lastIntent, "booking_canceled");
  assert(upserts.length >= 1, "booking cancellation should still issue profile upserts");
}

async function testZohoFailureDoesNotBreakBookingFlow() {
  const assessment = {
    size: "Queen",
    motionMode: "No Motion",
    firmness: "Medium",
    sleepPosition: "Side",
    sleepPartner: "No",
    baseType: "No Base",
  };
  const canonicalRecommendation = await buildCanonicalRecommendation(assessment);
  const existingProfile = buildExistingProfile({
    shopperId: "880022",
    assessmentAnswers: assessment,
    canonicalRecommendation,
  });

  const result = await bookingSession.upsertBookingSession(
    {
      event: "invitee.created",
      payload: {
        invitee: {
          uri: "https://api.calendly.com/invitees/zoho-fail-1",
          email: "zoho-fail@example.com",
          name: "Zoho Fail",
        },
        scheduled_event: {
          uri: "https://api.calendly.com/scheduled_events/zoho-fail-1",
          start_time: "2026-06-20T13:00:00Z",
          end_time: "2026-06-20T13:30:00Z",
        },
        tracking: {
          utm_content: "880022",
        },
      },
    },
    withIdempotencyOptions({
      route: "/booking/calendly-webhook",
      log: function noop() {},
      getProfileById: async (profileId) =>
        clone(profileId === "shopper#880022" ? existingProfile : null),
      upsertCustomerProfile: async (patch) => ({
        ok: true,
        skipped: false,
        profileId: patch.profileId || `shopper#${patch.shopperId}`,
      }),
      buildCustomerProfilePatch: customerProfile.buildCustomerProfilePatch,
      resolveCanonicalIdentity: async () => ({
        shopperId: "880022",
        snoozeCode: "880022",
        accessCode: "880022",
        profileId: "shopper#880022",
        identityType: "snooze_code",
        identitySource: "utm_content",
        isTemporary: false,
      }),
      syncCustomerProfileToZoho: async () => {
        throw new Error("ZOHO_DOWN");
      },
    })
  );

  assert.strictEqual(result.ok, true, "booking flow should still succeed");
  assert.strictEqual(result.zoho?.ok, false, "Zoho result should surface the soft failure");
  assert.strictEqual(result.zoho?.reason, "ZOHO_SYNC_FAILED");
}

async function main() {
  await testInviteeCreatedWithExistingSnoozeCodeUsesCanonicalProfile();
  await testInviteeCreatedWithTemporaryShopperIdIssuesCanonicalCodeAndCarriesAssessment();
  await testInviteeCanceledCanResolveByStoredInviteeAlias();
  await testZohoFailureDoesNotBreakBookingFlow();
  console.log("All booking session service tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
