"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const experiences = require("../services/rewards/experiences");
const rewardService = require("../services/rewards/service");
const shopperCart = require("../services/shopperCart");
const shopify = require("../services/shopify");
const catalog = require("../services/sleepEssentialsCatalog");

const root = path.resolve(__dirname, "..");
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

class MemoryRepository {
  constructor() {
    this.items = new Map();
    this.lastQueryOptions = null;
  }

  key(item) {
    return `${item.PK}|${item.SK}`;
  }

  async putEntity(item, options = {}) {
    const key = this.key(item);
    if (options.createOnly && this.items.has(key)) {
      const error = new Error("duplicate");
      error.name = "ConditionalCheckFailedException";
      throw error;
    }
    this.items.set(key, structuredClone(item));
    return item;
  }

  async getEntity(profileId, sortKey) {
    return this.items.get(`PROFILE#${profileId}|${sortKey}`) || null;
  }

  async queryByPrefix(profileId, prefix, options = {}) {
    this.lastQueryOptions = options;
    const pk = `PROFILE#${profileId}`;
    return [...this.items.values()].filter(
      (item) => item.PK === pk && item.SK.startsWith(prefix)
    );
  }
}

const identity = Object.freeze({
  profileId: "shopper#sleep-essentials-test",
  shopperId: "sleep-essentials-test",
  sessionId: "session-sleep-essentials-test",
  snoozeCode: "847261",
  profile: {},
});

function categoryInput(categoryId, action = "reviewed_no_selection") {
  return {
    journeyId: "sleep-essentials-sleep-essentials-test",
    categoryId,
    action,
    sourceSurface: "sleep_essentials",
  };
}

function cart(id = "gid://shopify/Cart/sleep-essentials-test") {
  return { id, checkoutUrl: "https://example.myshopify.com/cart/c/test", lines: { edges: [] } };
}

async function run() {
  await test("catalog manifest contains the three required categories and keeps Shopify authoritative", async () => {
    const manifest = catalog.validateManifest();
    assert.deepEqual(manifest.categories.map((item) => item.id), [
      "pillows",
      "sheets_bedding",
      "protectors",
    ]);
    const handles = manifest.categories.flatMap((item) => item.handles);
    const response = await catalog.getSleepEssentialsCatalog({}, {
      shopify: {
        async fetchProductsByHandles(input) {
          assert.deepEqual(new Set(input.handles), new Set(handles));
          return {
            items: handles.map((handle) => ({ handle, title: handle, variants: [] })),
            meta: { source: "shopify-test" },
          };
        },
      },
    });
    assert.equal(response.source, "shopify");
    assert.equal(response.categories.every((item) => item.missingHandles.length === 0), true);
  });

  await test("category progress is authoritative, strongly consistent, and idempotent", async () => {
    const repository = new MemoryRepository();
    const first = await experiences.recordAccessoriesProgress(
      identity,
      categoryInput("pillows", "saved_selection"),
      { repository }
    );
    const duplicate = await experiences.recordAccessoriesProgress(
      identity,
      categoryInput("pillows", "saved_selection"),
      { repository }
    );
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual(first.reviewedCategoryIds, ["pillows"]);
    assert.equal(repository.lastQueryOptions.consistentRead, true);
    assert.equal(repository.items.size, 1);
  });

  await test("completion rejects incomplete category evidence without requiring a cart", async () => {
    const repository = new MemoryRepository();
    await experiences.recordAccessoriesProgress(identity, categoryInput("pillows"), { repository });
    await assert.rejects(
      experiences.completeAccessoriesExperience(
        identity,
        { journeyId: categoryInput("pillows").journeyId },
        { repository }
      ),
      (error) => {
        assert.equal(error.code, "REWARD_SLEEP_ESSENTIALS_INCOMPLETE");
        assert.deepEqual(error.details.remainingCategories, ["sheets_bedding", "protectors"]);
        return true;
      }
    );
  });

  await test("all category evidence awards the existing milestone exactly once", async () => {
    const repository = new MemoryRepository();
    for (const categoryId of experiences.REQUIRED_SLEEP_ESSENTIAL_CATEGORY_IDS) {
      await experiences.recordAccessoriesProgress(identity, categoryInput(categoryId), { repository });
    }

    const original = rewardService.recordRewardMilestone;
    let calls = 0;
    rewardService.recordRewardMilestone = async (input) => {
      calls += 1;
      assert.equal(input.eventType, "milestone.accessories.completed");
      assert.equal(input.subjectId, categoryInput("pillows").journeyId);
      return { duplicate: calls > 1, summary: { availablePoints: 100 } };
    };
    try {
      const first = await experiences.completeAccessoriesExperience(
        identity,
        { journeyId: categoryInput("pillows").journeyId },
        { repository }
      );
      const second = await experiences.completeAccessoriesExperience(
        identity,
        { journeyId: categoryInput("pillows").journeyId },
        { repository }
      );
      assert.equal(first.result.duplicate, false);
      assert.equal(second.result.duplicate, true);
      assert.equal(
        [...repository.items.values()].filter((item) => item.entityType === "ACCESSORIES_EXPERIENCE").length,
        1
      );
    } finally {
      rewardService.recordRewardMilestone = original;
    }
  });

  await test("profile-owned cart restores across devices and never creates on read", async () => {
    const existing = cart("gid://shopify/Cart/sleep-essentials-test?key=shopify-cart-secret");
    let creates = 0;
    const options = {
      resolveIdentity: async () => ({ ...identity, profile: { shopifyCartId: existing.id } }),
      shopify: {
        async getCart({ cartId }) {
          assert.equal(cartId, existing.id);
          return existing;
        },
        async createCart() {
          creates += 1;
          return existing;
        },
      },
      customerProfileService: { async upsertCustomerProfile() {} },
    };
    const podDevice = await shopperCart.resolveShopperCart({ headers: { "x-device-id": "pod-4" } }, options);
    const kiosk = await shopperCart.resolveShopperCart({ headers: { "x-device-id": "sleep-essentials" } }, options);
    assert.equal(podDevice.cartId, existing.id);
    assert.equal(kiosk.cartId, existing.id);
    assert.equal(creates, 0);
    assert.equal(shopperCart.validCartId(existing.id), true);
    assert.equal(shopify.isValidCartGid(existing.id), true);
  });

  await test("missing and expired owned carts recover without masking transient Shopify failures", async () => {
    const noCart = await shopperCart.resolveShopperCart({}, {
      resolveIdentity: async () => ({ ...identity, profile: {} }),
    });
    assert.equal(noCart.reason, "NO_OWNED_CART");

    const profileWrites = [];
    const expired = await shopperCart.resolveShopperCart({}, {
      resolveIdentity: async () => ({ ...identity, profile: { shopifyCartId: cart().id } }),
      shopify: {
        async getCart() {
          const error = new Error("Cart not found");
          error.statusCode = 404;
          throw error;
        },
      },
      customerProfileService: {
        async upsertCustomerProfile(patch) {
          profileWrites.push(patch);
        },
      },
    });
    assert.equal(expired.reason, "OWNED_CART_EXPIRED");
    assert.equal(profileWrites.at(-1).shopifyCartStatus, "expired");

    await assert.rejects(
      shopperCart.resolveShopperCart({}, {
        resolveIdentity: async () => ({ ...identity, profile: { shopifyCartId: cart().id } }),
        shopify: { async getCart() { throw new Error("Shopify timeout"); } },
      }),
      /Shopify timeout/
    );
  });

  await test("frontend route, safe return path, and kiosk capability boundaries are present", async () => {
    const main = fs.readFileSync(path.join(root, "omnia-journey/src/main.jsx"), "utf8");
    const deviceManifest = fs.readFileSync(
      path.join(root, "omnia-journey/src/device/deviceRegistry.manifest.js"),
      "utf8"
    );
    const helperSource = fs.readFileSync(
      path.join(root, "omnia-journey/src/lib/sleepEssentials.js"),
      "utf8"
    );
    assert.match(main, /path="sleep-essentials"/);
    assert.match(deviceManifest, /"sleep-essentials-01"/);
    assert.match(deviceManifest, /checkoutAuthority:\s*false/);
    const helper = await import(
      `data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`
    );
    assert.equal(helper.getSafeSleepEssentialsReturnPath("/pod/pod-4?stage=build&buildStep=pillows"), "/pod/pod-4?stage=build&buildStep=pillows");
    assert.equal(helper.getSafeSleepEssentialsReturnPath("https://evil.example"), "/results");
    assert.equal(helper.getSafeSleepEssentialsReturnPath("/checkout"), "/results");
  });

  if (process.exitCode) throw new Error("Sleep Essentials validation failed.");
  process.stdout.write(`\n${passed} Sleep Essentials tests passed.\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
