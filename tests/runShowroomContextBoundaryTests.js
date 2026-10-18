#!/usr/bin/env node

const assert = require("node:assert/strict");
const {
  buildModelShowroomContext,
  normalizeShowroomDeviceContext,
} = require("../utils/showroomDeviceContext");
const { buildModelPlannerInput } = require("../services/askSnoozerModelPlanner");
const { buildConversationEnvelope } = require("../services/askSnoozerModelCore");

const raw = {
  deviceId: "pod-1-ipad-01",
  deviceMode: "pod-ipad",
  podId: "pod-1",
  zoneId: "pod-1",
  proximity: {
    zoneId: "pod-1",
    isPresent: true,
    isOccupied: true,
    isStale: false,
    lastPresenceEventAt: "2026-10-17T14:00:00.000Z",
    lastOccupancyEventAt: "2026-10-17T14:00:02.000Z",
    lightingState: "rest-test",
    cartId: "must-not-cross-boundary",
    snoozeCode: "must-not-cross-boundary",
  },
  checkoutUrl: "must-not-cross-boundary",
};

const normalized = normalizeShowroomDeviceContext(raw);
assert.deepEqual(Object.keys(normalized).sort(), ["deviceId", "deviceMode", "podId", "proximity", "zoneId"]);
assert.deepEqual(Object.keys(normalized.proximity).sort(), [
  "isOccupied",
  "isPresent",
  "isStale",
  "lastOccupancyEventAt",
  "lastPresenceEventAt",
  "lightingState",
  "zoneId",
]);
assert.equal(normalized.proximity.isOccupied, true);
assert.equal(JSON.stringify(normalized).includes("must-not-cross-boundary"), false);

const showroom = buildModelShowroomContext({ device: raw });
assert.equal(showroom.zoneId, "pod-1");
assert.equal(showroom.presence.present, true);
assert.equal(showroom.presence.occupied, true);
assert.equal(showroom.presence.stale, false);

const context = { device: raw, recentConversation: [] };
const planner = buildModelPlannerInput({ query: "What should I do next?", context });
assert.deepEqual(planner.showroom, showroom);

const envelope = buildConversationEnvelope({
  message: "What should I notice while I am on this mattress?",
  context,
  manifest: { products: [] },
});
assert.deepEqual(envelope.showroom, showroom);

const stale = buildModelShowroomContext({
  device: { ...raw, proximity: { ...raw.proximity, isStale: true } },
});
assert.equal(stale.presence.stale, true);

console.log("Showroom sensor context boundary tests passed.");
