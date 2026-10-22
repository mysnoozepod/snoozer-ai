"use strict";

const assert = require("node:assert/strict");
const lineup = require("../data/official-showroom-lineup.v1.json");
const {
  getOfficialShowroomLineupReadiness,
  validateOfficialShowroomLineup,
} = require("../services/officialShowroomLineup");

const validation = validateOfficialShowroomLineup(lineup);
assert.deepEqual(validation.errors, []);

assert.deepEqual(
  lineup.displays.map((display) => display.internalModel),
  ["S7", "H6", "M3 Original", "M5 Original", "M5 Naked"]
);
assert.deepEqual(
  lineup.displays.map((display) => display.customerName),
  [
    "Accessible Performance Mattress",
    "Plush Pillowtop Hybrid Mattress",
    "Modular Comfort Mattress",
    "Premium Modular Comfort Mattress",
    "Advanced Premium Modular Mattress",
  ]
);

const byModel = new Map(lineup.displays.map((display) => [display.internalModel, display]));
function price(model, size) {
  return byModel.get(model).priceReference.variants.find((variant) => variant.size === size)?.upp;
}

assert.equal(price("S7", "Queen"), 1599.99);
assert.equal(price("H6", "Queen"), 1999);
assert.equal(price("M3 Original", "Queen"), 2999.99, "go-forward M3 price must supersede the older $2,499 series");
assert.equal(price("M5 Original", "Queen"), 3999.99);
assert.equal(price("M5 Naked", "Queen"), 4799.99);

assert.equal(byModel.get("M5 Naked").availability.status, "planned");
assert.equal(byModel.get("M5 Naked").availability.expectedDate, "2027-01");

const readiness = getOfficialShowroomLineupReadiness(lineup);
assert.equal(readiness.schemaValid, true);
assert.equal(readiness.activationReady, false);
assert.equal(readiness.readyDisplayCount, 0);
assert.equal(readiness.totalDisplayCount, 5);
for (const display of readiness.displays) {
  assert(display.blockers.some((blocker) => /Shopify product handle/i.test(blocker)));
  assert(display.blockers.some((blocker) => /display size/i.test(blocker)));
}

console.log("Official showroom lineup tests passed: five-display floor, descriptive names, go-forward prices, and fail-closed activation gate.");
