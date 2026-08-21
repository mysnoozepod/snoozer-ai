"use strict";

const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const processor = require("../services/rewards/processor");
const redemption = require("../services/rewards/redemption");
const rewardService = require("../services/rewards/service");
const rewardRoutes = require("../routes/rewardsRoutes");
const shopifyWebhook = require("../services/rewards/shopifyWebhook");
const rewardsOutbox = require("../services/rewards/outbox");
const { validateRewardsRules } = require("../services/rewardsDomain/rules");

const root = path.resolve(__dirname, "..");
const rules = JSON.parse(
  fs.readFileSync(path.join(root, "data/rewards-rules.staging.v1.json"), "utf8")
);
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

class MemoryRewardRepository {
  constructor() {
    this.items = new Map();
  }

  key(item) {
    return `${item.PK}|${item.SK}`;
  }

  async getSummary(profileId) {
    return this.items.get(`PROFILE#${profileId}|SUMMARY`) || null;
  }

  async getEntity(profileId, sortKey) {
    return this.items.get(`PROFILE#${profileId}|${sortKey}`) || null;
  }

  async getItem(key) {
    return this.items.get(`${key.PK}|${key.SK}`) || null;
  }

  async commitMilestone(items, expectedVersion) {
    await new Promise((resolve) => setImmediate(resolve));
    const claim = items.find((item) => item.entityType === "CLAIM");
    const summary = items.find((item) => item.entityType === "SUMMARY");
    if (this.items.has(this.key(claim))) {
      const error = new Error("duplicate");
      error.name = "TransactionCanceledException";
      throw error;
    }
    const current = this.items.get(this.key(summary));
    if (
      (expectedVersion === 0 && current) ||
      (expectedVersion !== 0 &&
        Number(current?.summaryVersion) !== Number(expectedVersion))
    ) {
      const error = new Error("version conflict");
      error.name = "TransactionCanceledException";
      throw error;
    }
    for (const item of items) this.items.set(this.key(item), structuredClone(item));
    return summary;
  }
}

const identity = {
  profileId: "shopper#production-test",
  shopperId: "production-test",
  snoozeCode: "589424",
};

function rewardsQueueRecord(messageId = "message-1") {
  return {
    messageId,
    body: JSON.stringify({
      schemaVersion: 1,
      profileId: identity.profileId,
      outboxKey: "OUTBOX#reward-event-1",
      eventType: "points_awarded",
      payload: { shopperId: identity.shopperId, summaryVersion: 1 },
    }),
  };
}

function milestoneInput(eventType, overrides = {}) {
  const common = {
    identity,
    rules,
    eventId: crypto.randomUUID(),
    eventType,
    sessionId: "session-production-test",
    subjectType: "customer_profile",
    subjectId: identity.profileId,
    sourceSurface: "welcome",
    metadata: { profileEstablished: true },
  };
  const byType = {
    "milestone.assessment.completed": {
      subjectType: "assessment",
      subjectId: "assessment-1",
      sourceSurface: "assessment",
      metadata: {
        assessmentVersion: "v1",
        assessmentSaved: true,
        recommendationResolved: true,
      },
    },
    "milestone.accessories.completed": {
      subjectType: "accessory_journey",
      subjectId: "journey-1",
      sourceSurface: "sleep_essentials",
      metadata: {
        journeyId: "journey-1",
        persisted: true,
        completed: true,
      },
    },
    "milestone.ratings.completed": {
      subjectType: "preference_set",
      subjectId: "preferences-1",
      sourceSurface: "pod_rest_test",
      metadata: {
        journeyId: "journey-1",
        persisted: true,
        completed: true,
        ratingCount: 1,
        favoriteCount: 1,
      },
    },
    "milestone.rest_test.completed": {
      subjectType: "rest_test",
      subjectId: "rest-test-1",
      sourceSurface: "pod_rest_test",
      metadata: {
        journeyId: "journey-1",
        podId: "pod-1",
        persisted: true,
        requiredStagesCompleted: true,
        durationSeconds: 420,
      },
    },
  };
  return {
    ...common,
    ...(byType[eventType] || {}),
    ...overrides,
    metadata: {
      ...(byType[eventType]?.metadata || common.metadata),
      ...(overrides.metadata || {}),
    },
  };
}

function podInput(podId, overrides = {}) {
  return milestoneInput("milestone.pod.completed", {
    subjectType: "pod",
    subjectId: podId,
    sourceSurface: "pod_rest_test",
    metadata: {
      podId,
      persisted: true,
      experienceCompleted: true,
      ...(overrides.metadata || {}),
    },
    ...overrides,
  });
}

function cartLine(handle, amount, quantity = 1) {
  return {
    node: {
      id: `line-${handle}`,
      quantity,
      merchandise: {
        id: `variant-${handle}`,
        price: { amount: String(amount), currencyCode: "USD" },
        product: {
          id: `product-${handle}`,
          handle,
          title: handle,
        },
      },
    },
  };
}

function cart(lines, discountCodes = []) {
  return {
    id: "gid://shopify/Cart/rewards-production-test",
    lines: { edges: lines },
    discountCodes,
  };
}

const classifications = {
  products: [
    {
      handle: "standard-pillow-a",
      canonicalProductId: "pillow.standard.a",
      classificationVersion: "test.v1",
      source: "catalog",
      categories: ["pillow"],
    },
    {
      handle: "standard-pillow-b",
      canonicalProductId: "pillow.standard.b",
      classificationVersion: "test.v1",
      source: "catalog",
      categories: ["pillow"],
    },
    {
      handle: "14-hybrid",
      canonicalProductId: "mattress.14_hybrid",
      classificationVersion: "test.v1",
      source: "manifest",
      categories: ["mattress"],
    },
    {
      handle: "premium-motion-adjustable-base",
      canonicalProductId: "base.premium_motion",
      classificationVersion: "test.v1",
      source: "manifest",
      categories: ["adjustable_base"],
    },
  ],
};

function offer(id) {
  return rules.offers.find((candidate) => candidate.id === id);
}

function loadRewardsStoreForTest({ api, sessionStore }) {
  const source = fs.readFileSync(
    path.join(root, "omnia-journey/src/state/rewardsStore.js"),
    "utf8"
  );
  const transformed = source
    .replace(
      /import\s+\{\s*useSyncExternalStore\s*\}\s+from\s+"react";/,
      'const { useSyncExternalStore } = require("react");'
    )
    .replace(
      /import\s+\{\s*([\s\S]*?)\s*\}\s+from\s+"@\/lib\/api";/,
      'const {$1} = require("@/lib/api");'
    )
    .replace(
      /import\s+\{\s*([\s\S]*?)\s*\}\s+from\s+"@\/state\/sessionStore";/,
      'const {$1} = require("@/state/sessionStore");'
    )
    .replace(/export\s+async\s+function\s+/g, "async function ")
    .replace(/export\s+function\s+/g, "function ");

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require(id) {
      if (id === "react") {
        return { useSyncExternalStore() { throw new Error("hook path not used in test"); } };
      }
      if (id === "@/lib/api") return api;
      if (id === "@/state/sessionStore") return sessionStore;
      throw new Error(`Unexpected require: ${id}`);
    },
    console,
    structuredClone,
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(
    `${transformed}
module.exports = {
  getRewardsState,
  subscribeRewardsState,
  refreshRewardsState,
  useRewardsState,
};`,
    sandbox,
    { filename: "rewardsStore.test.js" }
  );

  return module.exports;
}

async function main() {
  await test("active staging rules validate and total exactly 500 points", () => {
    assert.equal(validateRewardsRules(rules).ok, true);
    const configuredTotal =
      100 + 100 + 3 * 50 + 100 + 25 + 25;
    assert.equal(configuredTotal, 500);
    assert.equal(rules.metadata.maximumLifetimePoints, 500);
  });

  await test("authoritative showroom journey reaches 500, top badge, and gift", async () => {
    const repository = new MemoryRewardRepository();
    const events = [
      milestoneInput("milestone.profile.established"),
      milestoneInput("milestone.assessment.completed"),
      podInput("pod-1"),
      podInput("pod-2"),
      podInput("pod-3"),
      milestoneInput("milestone.accessories.completed"),
      milestoneInput("milestone.ratings.completed"),
      milestoneInput("milestone.rest_test.completed"),
    ];
    let result;
    for (const input of events) {
      result = await processor.processRewardMilestone(input, { repository });
    }
    assert.equal(result.summary.lifetimeSleepPoints, 500);
    assert.equal(
      result.summary.currentShowroomBadgeId,
      "badge.showroom.snooze_specialist"
    );
    assert.equal(result.summary.sleepMaskGiftStatus, "unlocked");
    assert.equal(result.gift.status, "unlocked");
  });

  await test("fourth distinct Pod records completion but cannot exceed 500", async () => {
    const repository = new MemoryRewardRepository();
    for (const input of [
      milestoneInput("milestone.profile.established"),
      milestoneInput("milestone.assessment.completed"),
      podInput("pod-1"),
      podInput("pod-2"),
      podInput("pod-3"),
      podInput("pod-4"),
    ]) {
      await processor.processRewardMilestone(input, { repository });
    }
    const summary = await repository.getSummary(identity.profileId);
    assert.equal(summary.lifetimeSleepPoints, 350);
    assert.deepEqual(summary.completedPodIds, ["pod-1", "pod-2", "pod-3", "pod-4"]);
  });

  await test("simultaneous duplicate lifetime events award exactly once", async () => {
    const repository = new MemoryRewardRepository();
    const [first, second] = await Promise.all([
      processor.processRewardMilestone(
        milestoneInput("milestone.profile.established"),
        { repository }
      ),
      processor.processRewardMilestone(
        milestoneInput("milestone.profile.established"),
        { repository }
      ),
    ]);
    assert.equal([first, second].filter((result) => result.duplicate).length, 1);
    assert.equal((await repository.getSummary(identity.profileId)).lifetimeSleepPoints, 100);
  });

  await test("verified legacy canonical profile and assessment reconcile exactly once", async () => {
    const repository = new MemoryRewardRepository();
    const legacyIdentity = {
      profileId: "shopper#589424",
      shopperId: "589424",
      snoozeCode: "589424",
      sessionId: "legacy-session-one",
      identityType: "snooze_code",
      isTemporary: false,
      profile: {
        profileId: "shopper#589424",
        shopperId: "589424",
        snoozeCode: "589424",
        identityType: "snooze_code",
        isTemporary: false,
        assessmentAnswers: {
          size: "Queen",
          firmness: "Soft",
          sleepPosition: "Side",
        },
        topPodId: "pod-4",
      },
    };
    const first = await rewardService.reconcileExistingCanonicalRewards(
      legacyIdentity,
      { enabled: true, repository, rules }
    );
    const second = await rewardService.reconcileExistingCanonicalRewards(
      { ...legacyIdentity, sessionId: "legacy-session-two" },
      { enabled: true, repository, rules }
    );
    const summary = await repository.getSummary(legacyIdentity.profileId);
    const ledger = [...repository.items.values()].filter(
      (item) => item.entityType === "LEDGER" && item.entryType === "earn"
    );
    const outbox = [...repository.items.values()].filter(
      (item) => item.entityType === "OUTBOX"
    );

    assert.deepEqual(first.awardedMilestoneIds, [
      "milestone.profile.established",
      "milestone.assessment.completed",
    ]);
    assert.deepEqual(second.awardedMilestoneIds, []);
    assert.equal(summary.lifetimeSleepPoints, 200);
    assert.equal(
      summary.currentShowroomBadgeId,
      "badge.showroom.rest_tester"
    );
    assert.deepEqual(summary.completedMilestoneIds, [
      "milestone.profile.established",
      "milestone.assessment.completed",
    ]);
    assert.equal(ledger.length, 2);
    assert.equal(outbox.length, 2);
  });

  await test("verified legacy canonical profile receives profile points without assessment evidence", async () => {
    const repository = new MemoryRewardRepository();
    const legacyIdentity = {
      profileId: "shopper#123456",
      shopperId: "123456",
      snoozeCode: "123456",
      sessionId: "legacy-profile-only",
      identityType: "snooze_code",
      isTemporary: false,
      profile: {
        profileId: "shopper#123456",
        shopperId: "123456",
        accessCode: "123456",
        identityType: "snooze_code",
        isTemporary: false,
      },
    };
    const result = await rewardService.reconcileExistingCanonicalRewards(
      legacyIdentity,
      { enabled: true, repository, rules }
    );

    assert.deepEqual(result.awardedMilestoneIds, [
      "milestone.profile.established",
    ]);
    assert.equal(result.summary.lifetimeSleepPoints, 100);
    assert.equal(result.summary.currentBadge.id, "badge.showroom.rest_tester");
    assert.equal(
      result.summary.milestones.find(
        (item) => item.id === "milestone.assessment.completed"
      ).completed,
      false
    );
  });

  await test("assessment table evidence backfills a saved legacy assessment", async () => {
    const repository = new MemoryRewardRepository();
    const legacyIdentity = {
      profileId: "shopper#654321",
      shopperId: "654321",
      snoozeCode: "654321",
      sessionId: "legacy-assessment-table",
      identityType: "snooze_code",
      isTemporary: false,
      profile: {
        profileId: "shopper#654321",
        shopperId: "654321",
        snoozeCode: "654321",
        identityType: "snooze_code",
        isTemporary: false,
      },
    };
    const result = await rewardService.reconcileExistingCanonicalRewards(
      legacyIdentity,
      {
        enabled: true,
        repository,
        rules,
        async getAssessmentResult(shopperId) {
          assert.equal(shopperId, "654321");
          return {
            shopperId,
            answers: { size: "Queen", sleepPosition: "Side" },
            updatedAt: "2026-07-01T12:00:00.000Z",
          };
        },
      }
    );

    assert.equal(result.summary.lifetimeSleepPoints, 200);
    assert.equal(
      result.summary.milestones.find(
        (item) => item.id === "milestone.assessment.completed"
      ).completed,
      true
    );
  });

  await test("temporary aliases and unverified browser identities cannot reconcile rewards", async () => {
    const repository = new MemoryRewardRepository();
    const cases = [
      {
        profileId: "session#browser-id",
        shopperId: "589424",
        snoozeCode: "589424",
        identityType: "temporary",
        isTemporary: true,
        profile: {
          profileId: "session#browser-id",
          shopperId: "589424",
          isTemporary: true,
        },
      },
      {
        profileId: "shopper#589424",
        shopperId: "589424",
        snoozeCode: "589424",
        identityType: "identity_alias",
        isTemporary: false,
        profile: {
          profileId: "shopper#589424",
          shopperId: "589424",
          identityType: "identity_alias",
          aliasOfProfileId: "shopper#111111",
        },
      },
      {
        profileId: "shopper#222222",
        shopperId: "222222",
        snoozeCode: "222222",
        identityType: "snooze_code",
        isTemporary: false,
        profile: null,
      },
    ];

    for (const candidate of cases) {
      const result = await rewardService.reconcileExistingCanonicalRewards(
        candidate,
        { enabled: true, repository, rules }
      );
      assert.equal(result.skipped, true);
    }
    assert.equal(repository.items.size, 0);
  });

  await test("incomplete Rest Test is rejected", async () => {
    await assert.rejects(
      processor.processRewardMilestone(
        milestoneInput("milestone.rest_test.completed", {
          metadata: { durationSeconds: 419 },
        }),
        { repository: new MemoryRewardRepository() }
      ),
      (error) => error.code === "REWARD_COMPLETION_NOT_CONFIRMED"
    );
  });

  await test("second-pillow offer discounts lower-priced pillow by exact 10 percent", () => {
    const preview = redemption.previewOffer({
      offer: offer("offer.pillow.second_item_ten_percent"),
      cart: cart([
        cartLine("standard-pillow-a", "100.00"),
        cartLine("standard-pillow-b", "70.00"),
      ]),
      classifications,
    });
    assert.equal(preview.target.handle, "standard-pillow-b");
    assert.equal(preview.discountMinor, 700);
  });

  await test("standard-pillow benefit requires and targets a standard pillow", () => {
    const preview = redemption.previewOffer({
      offer: offer("offer.pillow.qualifying_standard"),
      cart: cart([
        cartLine("14-hybrid", "2499.00"),
        cartLine("standard-pillow-a", "99.00"),
      ]),
      classifications,
    });
    assert.equal(preview.target.handle, "standard-pillow-a");
    assert.equal(preview.discountMinor, 9900);
  });

  await test("sleep-system offer targets highest-value qualifying item", () => {
    const preview = redemption.previewOffer({
      offer: offer("offer.sleep_system.ten_percent"),
      cart: cart([
        cartLine("14-hybrid", "2499.00"),
        cartLine("premium-motion-adjustable-base", "1999.00"),
      ]),
      classifications,
    });
    assert.equal(preview.target.handle, "14-hybrid");
    assert.equal(preview.discountMinor, 24990);
  });

  await test("unclassified cart products fail reward calculation closed", () => {
    assert.throws(
      () =>
        redemption.previewOffer({
          offer: offer("offer.sleep_system.ten_percent"),
          cart: cart([cartLine("unknown-product", "99.00")]),
          classifications,
        }),
      (error) => error.code === "REWARD_PRODUCT_UNCLASSIFIED"
    );
  });

  await test("conflicting Shopify promotion rejects exclusive reward", () => {
    assert.throws(
      () =>
        redemption.previewOffer({
          offer: offer("offer.sleep_system.ten_percent"),
          cart: cart(
            [cartLine("14-hybrid", "2499.00")],
            [{ code: "EXISTING", applicable: true }]
          ),
          classifications,
        }),
      (error) => error.code === "REWARD_DISCOUNT_CONFLICT"
    );
  });

  await test("signed cancellation webhook reverses once and suppresses replay", async () => {
    const secret = "rewards-webhook-test-secret";
    const payload = JSON.stringify({
      id: 123,
      discount_codes: [{ code: "SNOOZE-TEST" }],
    });
    const headers = {
      "x-shopify-topic": "orders/cancelled",
      "x-shopify-webhook-id": "webhook-production-test",
      "x-shopify-hmac-sha256": crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("base64"),
    };
    const store = new Map([
      [
        "SHOPIFY#DISCOUNT#SNOOZE-TEST|REWARD_BINDING",
        {
          PK: "SHOPIFY#DISCOUNT#SNOOZE-TEST",
          SK: "REWARD_BINDING",
          profileId: identity.profileId,
          redemptionId: "redemption-1",
          offerId: "offer.sleep_system.ten_percent",
        },
      ],
    ]);
    const repository = {
      async getItem(key) {
        return store.get(`${key.PK}|${key.SK}`) || null;
      },
      async transactItems(items) {
        for (const operation of items) {
          if (operation.Put) {
            const key = `${operation.Put.Item.PK}|${operation.Put.Item.SK}`;
            if (store.has(key) && operation.Put.ConditionExpression) {
              const error = new Error("conditional");
              error.name = "TransactionCanceledException";
              throw error;
            }
            store.set(key, structuredClone(operation.Put.Item));
          }
          if (operation.Update) {
            const key = `${operation.Update.Key.PK}|${operation.Update.Key.SK}`;
            const current = store.get(key);
            if (!current) throw new Error("missing update target");
            const expected =
              operation.Update.ExpressionAttributeValues?.[":processing"] ||
              operation.Update.ExpressionAttributeValues?.[":failed"];
            if (
              operation.Update.ConditionExpression &&
              expected &&
              current.status !== expected
            ) {
              const error = new Error("conditional");
              error.name = "TransactionCanceledException";
              throw error;
            }
            store.set(key, {
              ...current,
              status: operation.Update.ExpressionAttributeValues[":status"],
              updatedAt: operation.Update.ExpressionAttributeValues[":now"],
            });
          }
        }
      },
    };
    const reversed = [];
    const options = {
      webhookSecret: secret,
      repository,
      redemptionService: {
        async reverseRedemption(input) {
          reversed.push(input);
          return { status: "reversed" };
        },
      },
    };
    const event = { body: payload, headers };
    const first = await shopifyWebhook.processShopifyRewardsWebhook(event, options);
    const second = await shopifyWebhook.processShopifyRewardsWebhook(event, options);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(reversed.length, 1);
    assert.equal(reversed[0].commerceEventType, "return");
  });

  await test("invalid Shopify webhook signature is rejected", async () => {
    await assert.rejects(
      shopifyWebhook.processShopifyRewardsWebhook(
        {
          body: "{}",
          headers: {
            "x-shopify-topic": "orders/cancelled",
            "x-shopify-hmac-sha256": "invalid",
          },
        },
        { webhookSecret: "secret" }
      ),
      (error) => error.code === "SHOPIFY_WEBHOOK_SIGNATURE_INVALID"
    );
  });

  await test("expired offer status, ledger, summary, and outbox commit together", async () => {
    const transactions = [];
    const unlock = {
      PK: `PROFILE#${identity.profileId}`,
      SK: "UNLOCK#offer.pillow.second_item_ten_percent",
      offerId: "offer.pillow.second_item_ten_percent",
      status: "unlocked",
      expiresAt: "2026-01-01T00:00:00.000Z",
    };
    const repository = {
      async transactItems(items) {
        transactions.push(items);
      },
    };
    const result = await rewardService.transitionExpiredOffer(identity, unlock, {
      repository,
      now: "2026-02-01T00:00:00.000Z",
    });
    assert.equal(result.status, "expired");
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].length, 4);
    assert.equal(
      transactions[0].some(
        (operation) => operation.Put?.Item?.entryType === "offer_expired"
      ),
      true
    );
    assert.equal(
      transactions[0].some(
        (operation) =>
          operation.Put?.Item?.eventType === "rewards.offer.expired"
      ),
      true
    );
  });

  await test("refund reversal writes immutable commerce evidence atomically", async () => {
    const transactions = [];
    const repository = {
      async getEntity() {
        return {
          PK: `PROFILE#${identity.profileId}`,
          SK: "REDEMPTION#redemption-refund-test",
          redemptionId: "redemption-refund-test",
          offerId: "offer.sleep_system.ten_percent",
          status: "cart_bound",
        };
      },
      async transactItems(items) {
        transactions.push(items);
      },
    };
    const result = await redemption.reverseRedemption(
      {
        identity,
        redemptionId: "redemption-refund-test",
        reason: "shopify_refund",
        commerceEventType: "refund",
        shopifyWebhookId: "webhook-refund-test",
        shopifyOrderId: "gid://shopify/Order/123",
      },
      { repository }
    );
    assert.equal(result.status, "reversed");
    assert.equal(transactions.length, 1);
    assert.equal(
      transactions[0].some(
        (operation) =>
          operation.Put?.Item?.entryType === "redemption_reversed"
      ),
      true
    );
    const refundLedger = transactions[0].find(
      (operation) => operation.Put?.Item?.entryType === "refund"
    )?.Put?.Item;
    assert.equal(refundLedger.shopifyWebhookId, "webhook-refund-test");
    assert.equal(refundLedger.shopifyOrderId, "gid://shopify/Order/123");
  });

  await test("frontend reward state has no client award or polling authority", () => {
    const rewardStateFiles = [
      "omnia-journey/src/lib/useRewards.js",
      "omnia-journey/src/components/RewardsPill.jsx",
      "omnia-journey/src/state/rewardsStore.js",
    ];
    const pageFiles = [
      "omnia-journey/src/pages/Assessment.jsx",
      "omnia-journey/src/pages/Results.jsx",
      "omnia-journey/src/pages/Explore.jsx",
    ];
    const rewardStateSource = rewardStateFiles
      .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
      .join("\n");
    const pageSource = pageFiles
      .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
      .join("\n");
    assert.equal(/\bawardPoints\b/.test(`${rewardStateSource}\n${pageSource}`), false);
    assert.equal(/\bsetInterval\s*\(/.test(rewardStateSource), false);
  });

  await test("public summary route reconciles an established assessed profile", async () => {
    const repository = new MemoryRewardRepository();
    const profile = {
      profileId: "shopper#589424",
      shopperId: "589424",
      snoozeCode: "589424",
      identityType: "snooze_code",
      sessionId: "session-route-test",
      assessmentAnswers: {
        size: "Queen",
        sleepPosition: "Side",
      },
      canonicalRecommendation: {
        topPodId: "4",
        primaryMattressHandle: "12-all-foam-mattress",
      },
    };
    const response = await rewardRoutes.handleRewardsRoutes(
      {
        requestContext: {
          http: { method: "GET" },
          requestId: "rewards-route-test",
        },
        rawPath: "/rewards/summary",
        headers: {
          "x-snooze-code": "589424",
          "x-session-id": "session-route-test",
        },
      },
      {
        enabled: true,
        rules,
        repository,
        customerProfileService: {
          async getCustomerProfile({ profileId }) {
            return profileId === profile.profileId
              ? { ok: true, profile }
              : { ok: true, profile: null };
          },
        },
        snoozeIdentity: {
          async resolveCanonicalIdentity() {
            return {
              profileId: profile.profileId,
              shopperId: profile.shopperId,
              snoozeCode: profile.snoozeCode,
              identityType: profile.identityType,
            };
          },
        },
      }
    );
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.summary.availableSleepPoints, 200);
    assert.equal(body.summary.lifetimeSleepPoints, 200);
    assert.deepEqual(
      body.summary.milestones
        .filter((milestone) => milestone.completed)
        .map((milestone) => milestone.id)
        .sort(),
      ["milestone.assessment.completed", "milestone.profile.established"]
    );
  });

  await test("public rewards routes accept API Gateway v1 stage-prefixed paths", async () => {
    const repository = new MemoryRewardRepository();
    const profile = {
      profileId: "shopper#7283",
      shopperId: "7283",
      snoozeCode: "7283",
      identityType: "snooze_code",
      sessionId: "session-stage-prefix-test",
      assessmentAnswers: {
        size: "Queen",
        sleepPosition: "Side",
      },
    };
    const response = await rewardRoutes.handleRewardsRoutes(
      {
        requestContext: {
          stage: "prod",
          requestId: "rewards-stage-prefix-test",
        },
        httpMethod: "GET",
        path: "/prod/rewards/summary",
        headers: {
          "x-snooze-code": "7283",
          "x-session-id": "session-stage-prefix-test",
        },
      },
      {
        enabled: true,
        rules,
        repository,
        customerProfileService: {
          async getCustomerProfile({ profileId }) {
            return profileId === profile.profileId
              ? { ok: true, profile }
              : { ok: true, profile: null };
          },
        },
        snoozeIdentity: {
          async resolveCanonicalIdentity() {
            return {
              profileId: profile.profileId,
              shopperId: profile.shopperId,
              snoozeCode: profile.snoozeCode,
              identityType: profile.identityType,
            };
          },
        },
      }
    );
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.summary.availableSleepPoints, 200);
  });

  await test("terminal Zoho configuration failures are acknowledged", async () => {
    const updates = [];
    const result = await rewardsOutbox.processRewardsZohoQueue(
      { Records: [rewardsQueueRecord("terminal-message")] },
      {
        repository: {
          async getEntity() {
            return {
              entityType: "OUTBOX",
              status: "pending",
              payload: { shopperId: identity.shopperId },
            };
          },
          async updateEntity(profileId, outboxKey, values) {
            updates.push({ profileId, outboxKey, values });
            return values;
          },
        },
      }
    );
    assert.deepEqual(result.batchItemFailures, []);
    assert.equal(updates.at(-1).values.status, "configuration_failed");
  });

  await test("retryable Zoho failures remain eligible for SQS retry", async () => {
    const result = await rewardsOutbox.processRewardsZohoQueue(
      { Records: [rewardsQueueRecord("retryable-message")] },
      {
        fieldMappings: {
          availableSleepPoints: "Available_Sleep_Points",
          lifetimeSleepPoints: "Lifetime_Sleep_Points",
          currentShowroomBadgeId: "Current_Showroom_Badge",
          activeRulesVersion: "Active_Rewards_Rules",
          summaryVersion: "Rewards_Summary_Version",
          lastRewardActivityAt: "Last_Reward_Activity",
        },
        repository: {
          async getEntity() {
            return {
              entityType: "OUTBOX",
              status: "pending",
              payload: { shopperId: identity.shopperId },
            };
          },
          async getSummary() {
            return null;
          },
          async updateEntity() {
            return {};
          },
        },
      }
    );
    assert.deepEqual(result.batchItemFailures, [
      { itemIdentifier: "retryable-message" },
    ]);
  });

  await test("frontend securely links code and session before reward reads", () => {
    const apiSource = fs.readFileSync(
      path.join(root, "omnia-journey/src/lib/api.js"),
      "utf8"
    );
    const welcomeSource = fs.readFileSync(
      path.join(root, "omnia-journey/src/pages/Welcome.jsx"),
      "utf8"
    );
    const pillSource = fs.readFileSync(
      path.join(root, "omnia-journey/src/components/RewardsPill.jsx"),
      "utf8"
    );
    assert.match(apiSource, /"x-session-id": sessionId/);
    assert.match(apiSource, /await ensureRewardIdentityLink\(\)/);
    assert.match(welcomeSource, /await checkInSnoozeCode\(/);
    assert.doesNotMatch(
      pillSource,
      /Number\(summary\?\.availableSleepPoints \|\| 0\)/
    );
  });

  await test("rewards store keeps authoritative summary when optional endpoints fail", async () => {
    const store = loadRewardsStoreForTest({
      api: {
        async getRewardSummary() {
          return {
            availableSleepPoints: 200,
            currentBadge: { label: "Rest Tester" },
          };
        },
        async getRewardOffers() {
          throw new Error("offers down");
        },
        async getRewardGift() {
          return { status: "unlocked" };
        },
        async getRewardHistory() {
          throw new Error("history down");
        },
      },
      sessionStore: {
        getSessionState() {
          return { shopperId: "7283", sessionId: "session-7283" };
        },
        subscribeSessionState() {
          return () => {};
        },
      },
    });

    await store.refreshRewardsState({ force: true });
    const snapshot = store.getRewardsState();

    assert.equal(snapshot.status, "ready");
    assert.equal(snapshot.summary.availableSleepPoints, 200);
    assert.equal(
      snapshot.error,
      "Some reward details are temporarily unavailable."
    );
    assert.deepEqual(Array.from(snapshot.offers), []);
    assert.deepEqual(Array.from(snapshot.history), []);
    assert.deepEqual(
      JSON.parse(JSON.stringify(snapshot.gift)),
      { status: "unlocked" }
    );
  });

  await test("rewards store still hard-fails when the summary endpoint fails", async () => {
    const store = loadRewardsStoreForTest({
      api: {
        async getRewardSummary() {
          throw new Error("summary down");
        },
        async getRewardOffers() {
          return [];
        },
        async getRewardGift() {
          return null;
        },
        async getRewardHistory() {
          return [];
        },
      },
      sessionStore: {
        getSessionState() {
          return { shopperId: "7283", sessionId: "session-7283" };
        },
        subscribeSessionState() {
          return () => {};
        },
      },
    });

    await store.refreshRewardsState({ force: true });
    const snapshot = store.getRewardsState();

    assert.equal(snapshot.status, "error");
    assert.equal(snapshot.summary, null);
    assert.equal(snapshot.error, "summary down");
  });

  await test("rewards browser headers are allowed through CORS preflight", () => {
    const backendSource = fs.readFileSync(path.join(root, "index.js"), "utf8");
    assert.match(
      backendSource,
      /https:\/\/staging\.d1yszajjlde5t5\.amplifyapp\.com/
    );
    assert.match(backendSource, /x-snooze-code/);
    assert.match(backendSource, /x-access-code/);
    assert.match(backendSource, /idempotency-key/);
  });

  await test("Lambda requires and routes rewards without an optional fallback", () => {
    const backendSource = fs.readFileSync(path.join(root, "index.js"), "utf8");
    assert.match(
      backendSource,
      /const\s+\{\s*handleRewardsRoutes\s*\}\s*=\s*require\("\.\/routes\/rewardsRoutes"\)/
    );
    assert.doesNotMatch(backendSource, /rewardsRoutes not found/);
    assert.match(backendSource, /await handleRewardsRoutes\(event/);
  });

  if (process.exitCode) process.exit(process.exitCode);
  process.stdout.write(`\nRewards production tests passed: ${passed}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
