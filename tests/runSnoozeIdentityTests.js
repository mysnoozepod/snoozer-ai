#!/usr/bin/env node

const assert = require("assert");
const snoozeIdentity = require("../services/snoozeIdentity");

async function testNormalizeSixDigitCode() {
  assert.strictEqual(
    snoozeIdentity.normalizeSnoozeCode(" 483927 "),
    "483927",
    "six-digit code should normalize cleanly"
  );
}

async function testLegacyFourDigitCodeResolvesCanonical() {
  const identity = await snoozeIdentity.resolveCanonicalIdentity({
    shopperId: "8862",
  });

  assert.strictEqual(identity.shopperId, "8862", "legacy 4-digit code should stay canonical");
  assert.strictEqual(identity.snoozeCode, "8862", "legacy 4-digit code should become snoozeCode");
  assert.strictEqual(identity.isTemporary, false, "legacy 4-digit code should not be temporary");
}

async function testGeneratedShopifyAssessmentIdIsTemporary() {
  const identity = await snoozeIdentity.resolveCanonicalIdentity({
    shopperId: "shopify-assessment-template--18443742478397__main-1781081490455-oot4gq",
  });

  assert.strictEqual(identity.isTemporary, true, "generated Shopify assessment ids should stay temporary");
  assert.strictEqual(
    identity.identityType,
    "temporary_shopify_assessment",
    "temporary assessment ids should be tagged"
  );
}

async function testStableSnoozeCodeWinsOverGeneratedShopifyId() {
  const identity = await snoozeIdentity.resolveCanonicalIdentity({
    snoozeCode: "483927",
    shopperId: "shopify-assessment-template--18443742478397__main-1781081490455-oot4gq",
    sourceShopperId: "shopify-assessment-template--18443742478397__main-1781081490455-oot4gq",
    sessionId: "sess_1",
  });

  assert.strictEqual(identity.shopperId, "483927", "explicit Snooze Code should win");
  assert(
    identity.aliases.includes("shopify-assessment-template--18443742478397__main-1781081490455-oot4gq"),
    "temporary Shopify id should be preserved as an alias"
  );
}

async function testStoredSessionAliasResolvesCanonicalIdentity() {
  const identity = await snoozeIdentity.resolveCanonicalIdentity(
    {
      sessionId: "sess_lookup_1",
    },
    {
      getProfileById: async (profileId) => {
        if (profileId === "alias#session:sess_lookup_1") {
          return {
            profileId,
            shopperId: "483927",
            snoozeCode: "483927",
          };
        }
        return null;
      },
    }
  );

  assert.strictEqual(identity.shopperId, "483927", "stored session alias should resolve canonical code");
  assert.strictEqual(identity.identitySource, "stored_alias", "identity source should show alias resolution");
}

async function testIssueSnoozeCodeFromTemporaryShopifyIdentity() {
  const identity = await snoozeIdentity.issueSnoozeCode(
    {
      shopperId: "shopify-assessment-page-1781081490455-oot4gq",
      sourceShopperId: "shopify-assessment-page-1781081490455-oot4gq",
      sessionId: "sess_issue_1",
      reason: "assessment_completed",
    },
    {
      getProfileById: async () => null,
    }
  );

  assert(/^\d{6}$/.test(String(identity.snoozeCode || "")), "issued Snooze Code should be six digits");
  assert.strictEqual(identity.shopperId, identity.snoozeCode, "shopperId should collapse onto Snooze Code");
  assert.strictEqual(identity.isNewCode, true, "temporary assessment identity should issue a new code");
  assert.strictEqual(
    identity.sourceShopperId,
    "shopify-assessment-page-1781081490455-oot4gq",
    "temporary source shopper id should be preserved"
  );
}

async function testDifferentSnoozeCodesNeverBecomeAliases() {
  const identity = await snoozeIdentity.resolveCanonicalIdentity({
    snoozeCode: "654321",
    shopperId: "123456",
    sourceShopperId: "123456",
    sessionId: "session_for_654321",
  });

  assert.strictEqual(identity.shopperId, "654321", "requested code should be canonical");
  assert.strictEqual(identity.sourceShopperId, null, "another Snooze Code is not a source alias");
  assert(
    !identity.aliases.includes("123456"),
    "a different valid Snooze Code must never be linked as an alias"
  );
}

async function main() {
  const tests = [
    ["normalize_six_digit_code", testNormalizeSixDigitCode],
    ["legacy_four_digit_code_resolves_canonical", testLegacyFourDigitCodeResolvesCanonical],
    ["generated_shopify_assessment_id_is_temporary", testGeneratedShopifyAssessmentIdIsTemporary],
    ["stable_snooze_code_wins_over_generated_shopify_id", testStableSnoozeCodeWinsOverGeneratedShopifyId],
    ["stored_session_alias_resolves_canonical_identity", testStoredSessionAliasResolvesCanonicalIdentity],
    ["issue_snooze_code_from_temporary_shopify_identity", testIssueSnoozeCodeFromTemporaryShopifyIdentity],
    ["different_snooze_codes_never_become_aliases", testDifferentSnoozeCodesNeverBecomeAliases],
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

  console.log(`\nAll ${tests.length} Snooze identity tests passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
