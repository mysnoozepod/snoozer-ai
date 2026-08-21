const assert = require("assert/strict");
const {
  resolveRewardsIdentity,
} = require("../services/rewards/identity");

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}\n${error.stack || error}\n`);
    process.exitCode = 1;
  }
}

function eventFor(sessionId, snoozeCode = "7283") {
  return {
    headers: {
      "x-snooze-code": snoozeCode,
      "x-session-id": sessionId,
    },
  };
}

function customerProfileService(profiles = {}) {
  return {
    async getCustomerProfile({ profileId }) {
      return { ok: true, profile: profiles[profileId] || null };
    },
  };
}

function identityFor(profileId = "shopper#7283", shopperId = "7283") {
  return {
    async resolveCanonicalIdentity() {
      return {
        profileId,
        shopperId,
        snoozeCode: shopperId,
        accessCode: shopperId,
        identityType: "snooze_code",
        identitySource: "shopperId",
        isTemporary: false,
      };
    },
  };
}

async function run() {
  await test("canonical sessionIds array satisfies rewards ownership", async () => {
    const profile = {
      profileId: "shopper#7283",
      shopperId: "7283",
      snoozeCode: "7283",
      sessionIds: ["debug-rewards-session-7283"],
    };
    const result = await resolveRewardsIdentity(eventFor("debug-rewards-session-7283"), {
      customerProfileService: customerProfileService({
        "shopper#7283": profile,
      }),
      snoozeIdentity: identityFor(),
    });
    assert.equal(result.profileId, "shopper#7283");
    assert.equal(result.sessionId, "debug-rewards-session-7283");
  });

  await test("matching canonical session alias satisfies rewards ownership", async () => {
    const canonicalProfile = {
      profileId: "shopper#7283",
      shopperId: "7283",
      snoozeCode: "7283",
      sessionId: "older-session",
    };
    const aliasProfile = {
      profileId: "alias#session:debug-rewards-session-7283",
      shopperId: "7283",
      snoozeCode: "7283",
      aliasOfProfileId: "shopper#7283",
      aliasOfShopperId: "7283",
    };
    const result = await resolveRewardsIdentity(eventFor("debug-rewards-session-7283"), {
      customerProfileService: customerProfileService({
        "shopper#7283": canonicalProfile,
        "alias#session:debug-rewards-session-7283": aliasProfile,
      }),
      snoozeIdentity: identityFor(),
    });
    assert.equal(result.profileId, "shopper#7283");
    assert.equal(result.sessionId, "debug-rewards-session-7283");
  });

  await test("unrelated alias session is still rejected", async () => {
    const canonicalProfile = {
      profileId: "shopper#7283",
      shopperId: "7283",
      snoozeCode: "7283",
      sessionId: "older-session",
    };
    const unrelatedAlias = {
      profileId: "alias#session:debug-rewards-session-7283",
      shopperId: "9999",
      snoozeCode: "9999",
      aliasOfProfileId: "shopper#9999",
      aliasOfShopperId: "9999",
    };
    await assert.rejects(
      () =>
        resolveRewardsIdentity(eventFor("debug-rewards-session-7283"), {
          customerProfileService: customerProfileService({
            "shopper#7283": canonicalProfile,
            "alias#session:debug-rewards-session-7283": unrelatedAlias,
          }),
          snoozeIdentity: identityFor(),
        }),
      (error) => {
        assert.equal(error.code, "REWARD_SESSION_MISMATCH");
        return true;
      }
    );
  });

  process.stdout.write(`\nPassed ${passed} rewards identity tests.\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
