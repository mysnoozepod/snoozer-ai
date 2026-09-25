import assert from "node:assert/strict";

import {
  confirmedCartItemCount,
  createCartAuthorityCoordinator,
  findConfirmedCartItem,
} from "../src/lib/cart/cartAuthority.mjs";
import {
  extractShopifyCartGid,
  isShopifyCartGid,
  redactShopifyCartGid,
} from "../src/lib/cart/cartId.mjs";
import { synchronizeCoreCartLines } from "../src/lib/cart/podCoreCartSync.mjs";
import {
  normalizeCoreBuildStepCandidate,
  resolveCoreBuildStepKeys,
} from "../src/lib/podBuilderFlow.mjs";

const variant = (id) => `gid://shopify/ProductVariant/${id}`;
const line = (lineId, variantId, quantity = 1, attributes = []) => ({
  lineId: `gid://shopify/CartLine/${lineId}`,
  merchandiseId: variant(variantId),
  quantity,
  attributes,
});

function testPodQuickAddCountUsesConfirmedQuantity() {
  const confirmed = [line("mattress", "101"), line("base", "102"), line("pillow", "103")];
  assert.equal(confirmedCartItemCount(confirmed), 3);
}

function testConfirmedLineRebindSupportsRemove() {
  const cached = line("stale-line-id", "201", 1, [{ key: "Pillow Size", value: "King" }]);
  const confirmed = [
    line("mattress", "200"),
    line("current-line-id", "201", 1, [{ value: "King", key: "Pillow Size" }]),
    line("protector", "202"),
  ];

  const rebound = findConfirmedCartItem(confirmed, cached);
  assert.equal(rebound?.lineId, "gid://shopify/CartLine/current-line-id");
  assert.equal(confirmedCartItemCount(confirmed.filter((item) => item.lineId !== rebound.lineId)), 2);
}

function testLineRebindNeverGuessesDifferentConfiguration() {
  const cached = line("old", "301", 1, [{ key: "Pillow Size", value: "King" }]);
  const confirmed = [line("new", "301", 1, [{ key: "Pillow Size", value: "Queen" }])];
  assert.equal(findConfirmedCartItem(confirmed, cached), null);
}

function testQuantityPersistsFromLatestConfirmedCart() {
  const before = [line("mattress", "401", 1), line("base", "402", 1)];
  const afterMutation = [line("mattress", "401", 2), line("base", "402", 1)];
  const afterRefresh = afterMutation.map((item) => ({ ...item }));

  assert.equal(confirmedCartItemCount(before), 2);
  assert.equal(confirmedCartItemCount(afterMutation), 3);
  assert.deepEqual(afterRefresh, afterMutation);
}

function testMutationInvalidatesOverlappingPodAndCartReads() {
  const coordinator = createCartAuthorityCoordinator();
  const podRead = coordinator.beginSync();
  coordinator.beginMutation();
  assert.equal(coordinator.shouldApplySync(podRead), false);

  const cartReadDuringMutation = coordinator.beginSync();
  coordinator.endMutation();
  assert.equal(coordinator.shouldApplySync(cartReadDuringMutation), false);

  const confirmedRead = coordinator.beginSync();
  assert.equal(coordinator.shouldApplySync(confirmedRead), true);

  const laterPodRead = coordinator.beginSync();
  assert.equal(coordinator.shouldApplySync(confirmedRead), false);
  assert.equal(coordinator.shouldApplySync(laterPodRead), true);
}

function testShopifyCartCredentialSurvivesNormalization() {
  const keyedCartId = "gid://shopify/Cart/cart-token?key=cart-secret";
  assert.equal(isShopifyCartGid(keyedCartId), true);
  assert.equal(extractShopifyCartGid({ cart: { id: keyedCartId } }), keyedCartId);
  assert.equal(extractShopifyCartGid(`Shopify returned ${keyedCartId}`), keyedCartId);
  assert.equal(
    redactShopifyCartGid(keyedCartId),
    "gid://shopify/Cart/cart-token?key=[redacted]"
  );
}

function testCoreBuilderFlowVariantsAndOldSessionMigration() {
  assert.deepEqual(resolveCoreBuildStepKeys(), ["size", "base", "review", "success"]);
  assert.deepEqual(resolveCoreBuildStepKeys({ showMotion: true }), ["size", "base", "motion", "review", "success"]);
  assert.deepEqual(resolveCoreBuildStepKeys({ isDualComfort: true }), ["size", "base", "comfort", "review", "success"]);
  assert.deepEqual(resolveCoreBuildStepKeys({ showMotion: true, isDualComfort: true }), ["size", "base", "motion", "comfort", "review", "success"]);
  assert.equal(normalizeCoreBuildStepCandidate("essentials"), "review");
  assert.equal(normalizeCoreBuildStepCandidate("pillows"), "review");
}

async function testCoreSyncPreservesDedicatedAccessoryLines() {
  const attributes = [{ key: "_Setup Size", value: "Queen" }];
  const cartItems = [
    line("old-mattress", "501", 1, attributes),
    line("base", "502", 1, attributes),
    {
      ...line("dedicated-pillow", "599", 2, [{ key: "_Sleep Essential", value: "Pillow" }]),
      handle: "carboncool-pillow",
    },
  ];
  cartItems[0].handle = "core-mattress";
  cartItems[1].handle = "core-base";
  const specs = [
    { handle: "core-mattress", line: { merchandiseId: variant("511"), quantity: 1, attributes } },
    { handle: "core-base", line: { merchandiseId: variant("502"), quantity: 1, attributes } },
  ];
  const removed = [];
  const added = [];

  await synchronizeCoreCartLines({
    cartItems,
    specs,
    removeLine: async (lineId) => removed.push(lineId),
    updateLine: async () => {},
    addLines: async (lines) => added.push(...lines),
  });

  assert.deepEqual(removed, ["gid://shopify/CartLine/old-mattress"]);
  assert.equal(removed.includes("gid://shopify/CartLine/dedicated-pillow"), false);
  assert.deepEqual(added.map((item) => item.merchandiseId), [variant("511")]);
}

const tests = [
  ["Pod quick-add updates header count from confirmed quantities", testPodQuickAddCountUsesConfirmedQuantity],
  ["three confirmed items rebind stale line and remove to two", testConfirmedLineRebindSupportsRemove],
  ["confirmed-line lookup does not guess a different variant configuration", testLineRebindNeverGuessesDifferentConfiguration],
  ["quantity change persists in refreshed confirmed state", testQuantityPersistsFromLatestConfirmedCart],
  ["Pod and Cart reads cannot overwrite a concurrent confirmed mutation", testMutationInvalidatesOverlappingPodAndCartReads],
  ["Shopify cart credential survives mutation-path normalization", testShopifyCartCredentialSurvivesNormalization],
  ["core Pod step variants and old Essentials sessions resolve safely", testCoreBuilderFlowVariantsAndOldSessionMigration],
  ["core Pod synchronization preserves dedicated Sleep Essentials cart lines", testCoreSyncPreservesDedicatedAccessoryLines],
];

let failures = 0;
for (const [name, test] of tests) {
  try {
    await test();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

if (failures) process.exitCode = 1;
else console.log(`PASS ${tests.length}/${tests.length} cart authority sync tests`);
