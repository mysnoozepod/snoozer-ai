#!/usr/bin/env node

const assert = require("assert");

const bookingSession = require("../services/bookingSession");
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
    source: "phase3_booking_test",
  });

  return {
    manifestVersion: resolved.manifestVersion,
    normalizedAssessment: resolved.normalizedAssessment,
    ...resolved.recommendation,
  };
}

function createProfileHarness(initialProfiles = []) {
  const store = new Map(
    initialProfiles.map((profile) => [String(profile.profileId), clone(profile)])
  );

  return {
    store,
    getProfileById(profileId) {
      return clone(store.get(String(profileId || "")) || null);
    },
    upsertCustomerProfile(patch) {
      const normalizedPatch = customerProfile.buildCustomerProfilePatch(patch);
      const profileId =
        normalizedPatch.profileId || `shopper#${normalizedPatch.shopperId || ""}`;
      const previous = clone(store.get(profileId) || {});
      const next = customerProfile.mergeCustomerProfile(previous, normalizedPatch);
      store.set(profileId, next);
      return {
        ok: true,
        skipped: false,
        profileId,
        profile: clone(next),
      };
    },
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

async function testExistingCodeBookingUsesCanonicalProfile1234() {
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
  const harness = createProfileHarness([
    buildExistingProfile({
      shopperId: "1234",
      assessmentAnswers: assessment,
      canonicalRecommendation,
    }),
  ]);
  const zohoCalls = [];

  const result = await bookingSession.upsertBookingSession(
    {
      event: "invitee.created",
      payload: {
        invitee: {
          uri: "https://api.calendly.com/invitees/phase3-existing-1",
          email: "phase3-existing@example.com",
          name: "Phase Three Existing",
          timezone: "America/New_York",
        },
        scheduled_event: {
          uri: "https://api.calendly.com/scheduled_events/phase3-existing-1",
          start_time: "2026-06-24T15:00:00Z",
          end_time: "2026-06-24T15:30:00Z",
        },
        tracking: {
          utm_content: "1234",
        },
      },
    },
    {
      route: "/booking/calendly-webhook",
      log: function noop() {},
      getProfileById: async (profileId) => harness.getProfileById(profileId),
      upsertCustomerProfile: async (patch) => harness.upsertCustomerProfile(patch),
      buildCustomerProfilePatch: customerProfile.buildCustomerProfilePatch,
      syncCustomerProfileToZoho: async (profile) => {
        zohoCalls.push(clone(profile));
        return {
          ok: true,
          skipped: false,
          operation: "update",
          shopperId: profile.shopperId,
          contactId: "zoho-phase3-existing",
        };
      },
    }
  );

  assert.strictEqual(result.ok, true, "existing-code booking should succeed");
  assert.strictEqual(result.identity?.shopperId, "1234", "existing code should stay canonical");
  assert.strictEqual(result.profilePatch?.bookingStatus, "scheduled");
  assert.strictEqual(result.sessionPrep?.status, "ready", "existing booking should generate ready session prep");
  assert.strictEqual(result.sessionPrep?.shopperId, "1234", "session prep should include canonical shopper id");
  assert.strictEqual(result.sessionPrep?.profileId, "shopper#1234", "session prep should include canonical profile id");
  assert.strictEqual(result.sessionPrep?.bookingStartTime, "2026-06-24T15:00:00Z");
  assert.strictEqual(zohoCalls.length, 1, "Zoho sync should run once");
}

async function testNoCodeBookingIssuesNewCodeWhenPayloadIsLegitimate() {
  const harness = createProfileHarness();

  const result = await bookingSession.upsertBookingSession(
    {
      event: "invitee.created",
      payload: {
        invitee: {
          uri: "https://api.calendly.com/invitees/phase3-no-code-1",
          email: "phase3-no-code@example.com",
          name: "Phase Three No Code",
        },
        scheduled_event: {
          uri: "https://api.calendly.com/scheduled_events/phase3-no-code-1",
          start_time: "2026-06-24T17:00:00Z",
          end_time: "2026-06-24T17:30:00Z",
        },
      },
    },
    {
      route: "/booking/calendly-webhook",
      log: function noop() {},
      getProfileById: async (profileId) => harness.getProfileById(profileId),
      upsertCustomerProfile: async (patch) => harness.upsertCustomerProfile(patch),
      buildCustomerProfilePatch: customerProfile.buildCustomerProfilePatch,
      issueSnoozeCode: async () => ({
        shopperId: "631245",
        snoozeCode: "631245",
        accessCode: "631245",
        profileId: "shopper#631245",
        identityType: "snooze_code",
        identitySource: "booking_started",
        isTemporary: false,
        isNewCode: true,
      }),
      syncCustomerProfileToZoho: async (profile) => ({
        ok: true,
        skipped: false,
        operation: "create",
        shopperId: profile.shopperId,
        contactId: "zoho-phase3-no-code",
      }),
    }
  );

  assert.strictEqual(result.ok, true, "no-code booking should still succeed");
  assert.strictEqual(result.identity?.shopperId, "631245", "legitimate no-code booking should issue a new code");
  assert.strictEqual(result.profilePatch?.shopperId, "631245");
  assert.strictEqual(result.sessionPrep?.status, "needs_assessment", "no-code booking without assessment should request assessment");
}

async function testMalformedInviteeCreatedDoesNotIssueCode() {
  const harness = createProfileHarness();
  let issueCalls = 0;

  const result = await bookingSession.upsertBookingSession(
    {
      event: "invitee.created",
      payload: {},
    },
    {
      route: "/booking/calendly-webhook",
      log: function noop() {},
      getProfileById: async (profileId) => harness.getProfileById(profileId),
      upsertCustomerProfile: async (patch) => harness.upsertCustomerProfile(patch),
      buildCustomerProfilePatch: customerProfile.buildCustomerProfilePatch,
      issueSnoozeCode: async () => {
        issueCalls += 1;
        return {
          shopperId: "999999",
          snoozeCode: "999999",
          accessCode: "999999",
          profileId: "shopper#999999",
          identityType: "snooze_code",
          identitySource: "booking_started",
          isTemporary: false,
          isNewCode: true,
        };
      },
    }
  );

  assert.strictEqual(result.ok, true, "malformed payload should return a safe response");
  assert.strictEqual(result.skipped, true, "malformed payload should skip rather than create a new profile");
  assert.strictEqual(result.reason, "BOOKING_IDENTITY_UNRESOLVED");
  assert.strictEqual(issueCalls, 0, "malformed payload should not issue a new Snooze Code");
  assert.deepStrictEqual(
    [...harness.store.keys()].filter((key) => key.startsWith("shopper#")),
    [],
    "malformed payload should not create a canonical shopper profile"
  );
}

async function testCanceledBookingMarksSessionPrepCanceled() {
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
  const existingProfile = buildExistingProfile({
    shopperId: "777111",
    assessmentAnswers: assessment,
    canonicalRecommendation,
  });
  const aliasProfile = customerProfile.buildCustomerProfilePatch({
    profileId: "alias#booking_invitee:https://api.calendly.com/invitees/phase3-cancel-1",
    shopperId: "777111",
    snoozeCode: "777111",
    accessCode: "777111",
    identityType: "identity_alias",
    identitySource: "booking_alias",
    aliasOfShopperId: "777111",
    aliasOfProfileId: "shopper#777111",
  });
  const harness = createProfileHarness([existingProfile, aliasProfile]);

  const result = await bookingSession.upsertBookingSession(
    {
      event: "invitee.canceled",
      payload: {
        invitee: {
          uri: "https://api.calendly.com/invitees/phase3-cancel-1",
          email: "phase3-cancel@example.com",
          name: "Phase Three Cancel",
        },
        scheduled_event: {
          uri: "https://api.calendly.com/scheduled_events/phase3-cancel-1",
          start_time: "2026-06-25T12:00:00Z",
          end_time: "2026-06-25T12:30:00Z",
        },
      },
    },
    {
      route: "/booking/calendly-webhook",
      log: function noop() {},
      getProfileById: async (profileId) => harness.getProfileById(profileId),
      upsertCustomerProfile: async (patch) => harness.upsertCustomerProfile(patch),
      buildCustomerProfilePatch: customerProfile.buildCustomerProfilePatch,
      syncCustomerProfileToZoho: async (profile) => ({
        ok: true,
        skipped: false,
        operation: "update",
        shopperId: profile.shopperId,
        contactId: "zoho-phase3-cancel",
      }),
    }
  );

  assert.strictEqual(result.ok, true, "canceled booking should still succeed");
  assert.strictEqual(result.profilePatch?.bookingStatus, "canceled");
  assert.strictEqual(result.sessionPrep?.status, "canceled", "canceled booking should no longer look active");
  assert.match(
    String(result.sessionPrep?.sessionInstructions?.[0] || ""),
    /canceled/i,
    "canceled session prep should explain the booking is no longer active"
  );

  const storedProfile = harness.store.get("shopper#777111");
  assert.strictEqual(storedProfile.bookingStatus, "canceled");
  assert.strictEqual(storedProfile.sessionPrepStatus, "canceled");
}

async function testDuplicateWebhookDeliveryDoesNotCreateCompetingProfiles() {
  const assessment = {
    size: "Queen",
    motionMode: "Standard Motion",
    firmness: "Firm",
    sleepPosition: "Back",
    sleepPartner: "No",
    baseType: "Adjustable Base",
  };
  const canonicalRecommendation = await buildCanonicalRecommendation(assessment);
  const harness = createProfileHarness([
    buildExistingProfile({
      shopperId: "1234",
      assessmentAnswers: assessment,
      canonicalRecommendation,
    }),
  ]);

  const payload = {
    event: "invitee.created",
    payload: {
      invitee: {
        uri: "https://api.calendly.com/invitees/phase3-dup-1",
        email: "phase3-dup@example.com",
        name: "Phase Three Duplicate",
      },
      scheduled_event: {
        uri: "https://api.calendly.com/scheduled_events/phase3-dup-1",
        start_time: "2026-06-25T15:00:00Z",
        end_time: "2026-06-25T15:30:00Z",
      },
      tracking: {
        utm_content: "1234",
      },
    },
  };

  const options = {
    route: "/booking/calendly-webhook",
    log: function noop() {},
    getProfileById: async (profileId) => harness.getProfileById(profileId),
    upsertCustomerProfile: async (patch) => harness.upsertCustomerProfile(patch),
    buildCustomerProfilePatch: customerProfile.buildCustomerProfilePatch,
    syncCustomerProfileToZoho: async (profile) => ({
      ok: true,
      skipped: false,
      operation: "update",
      shopperId: profile.shopperId,
      contactId: "zoho-phase3-dup",
    }),
  };

  const first = await bookingSession.upsertBookingSession(payload, options);
  const profileCountAfterFirst = harness.store.size;
  const second = await bookingSession.upsertBookingSession(payload, options);
  const canonicalShopperKeys = [...harness.store.keys()].filter((key) => key.startsWith("shopper#"));

  assert.strictEqual(first.ok, true);
  assert.strictEqual(second.ok, true);
  assert.strictEqual(
    harness.store.size,
    profileCountAfterFirst,
    "duplicate webhook delivery should update the same records instead of creating new profile keys"
  );
  assert.deepStrictEqual(
    canonicalShopperKeys,
    ["shopper#1234"],
    "duplicate deliveries should keep one canonical shopper record"
  );
}

async function main() {
  const tests = [
    ["existing_code_booking_uses_canonical_profile_1234", testExistingCodeBookingUsesCanonicalProfile1234],
    ["no_code_booking_issues_new_code_when_payload_is_legitimate", testNoCodeBookingIssuesNewCodeWhenPayloadIsLegitimate],
    ["malformed_invitee_created_does_not_issue_code", testMalformedInviteeCreatedDoesNotIssueCode],
    ["canceled_booking_marks_session_prep_canceled", testCanceledBookingMarksSessionPrepCanceled],
    ["duplicate_webhook_delivery_does_not_create_competing_profiles", testDuplicateWebhookDeliveryDoesNotCreateCompetingProfiles],
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

  console.log(`\nAll ${tests.length} Phase 3 Calendly webhook tests passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
