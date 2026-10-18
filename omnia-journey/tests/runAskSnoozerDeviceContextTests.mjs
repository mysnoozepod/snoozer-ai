import assert from "node:assert/strict";
import {
  normalizeAskSnoozerDeviceContext,
  normalizeAskSnoozerProximityContext,
} from "../src/lib/snoozer/askSnoozerDeviceContext.mjs";

const proximity = normalizeAskSnoozerProximityContext({
  zoneId: "pod-2",
  isPresent: true,
  isOccupied: false,
  isStale: false,
  lastPresenceEventAt: "2026-10-17T14:00:00Z",
  lightingState: "active",
  shopperId: "do-not-send",
  cartId: "do-not-send",
});
assert.equal(proximity.zoneId, "pod-2");
assert.equal(proximity.isPresent, true);
assert.equal(proximity.isStale, false);
assert.equal(JSON.stringify(proximity).includes("do-not-send"), false);

const device = normalizeAskSnoozerDeviceContext({
  deviceId: "pod-2-ipad-01",
  deviceMode: "pod-ipad",
  podId: "pod-2",
  zoneId: "pod-2",
  proximity,
  checkoutUrl: "do-not-send",
});
assert.equal(device.proximity.zoneId, "pod-2");
assert.equal(JSON.stringify(device).includes("checkoutUrl"), false);
assert.equal(normalizeAskSnoozerProximityContext({ isPresent: true }), null);

console.log("Ask Snoozer device context tests passed.");
