#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REPO_ROOT = path.resolve(__dirname, "..");
const SRC_ROOT = path.join(REPO_ROOT, "omnia-journey", "src");
const TEST_MODULE_DIR = path.join(REPO_ROOT, "_out", "react-iot-test-modules");

function copyDir(sourceDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir)) {
    const source = path.join(sourceDir, entry);
    const dest = path.join(destDir, entry);
    const stat = fs.statSync(source);
    if (stat.isDirectory()) copyDir(source, dest);
    if (stat.isFile()) fs.copyFileSync(source, dest);
  }
}

function copyModulesForEsmImport() {
  fs.rmSync(TEST_MODULE_DIR, { recursive: true, force: true });
  copyDir(path.join(SRC_ROOT, "device"), path.join(TEST_MODULE_DIR, "device"));
  copyDir(path.join(SRC_ROOT, "iot"), path.join(TEST_MODULE_DIR, "iot"));
  fs.writeFileSync(
    path.join(TEST_MODULE_DIR, "package.json"),
    JSON.stringify({ type: "module" }, null, 2)
  );
}

async function importModule(relativePath) {
  const url = pathToFileURL(path.join(TEST_MODULE_DIR, relativePath)).href;
  return import(`${url}?t=${Date.now()}`);
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

class MockWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.({ type: "open" });
  }

  send(value) {
    this.sent.push(value);
  }

  close() {
    this.readyState = 3;
    this.onclose?.({ type: "close" });
  }
}

async function run() {
  copyModulesForEsmImport();

  const registry = await importModule("device/deviceRegistry.js");
  const policy = await importModule("iot/zoneSubscriptionPolicy.js");
  const reducer = await importModule("iot/zoneStateReducer.js");
  const cache = await importModule("iot/zoneStateCache.js");
  const clientModule = await importModule("iot/showroomIotClient.js");

  const pod3 = registry.resolveDeviceConfig({
    deviceId: "pod-3-ipad-01",
    environment: "production",
    storage: createMemoryStorage(),
  });
  assert.deepEqual(policy.resolveAuthorizedZoneIds(pod3), ["pod-3"]);
  assert.equal(policy.canSubscribeToZone(pod3, "pod-3"), true);
  assert.equal(policy.canSubscribeToZone(pod3, "pod-4"), false);

  const admin = registry.resolveDeviceConfig({
    deploymentRole: "review",
    environment: "production",
    storage: createMemoryStorage(),
  });
  assert(policy.resolveAuthorizedZoneIds(admin).includes("pod-1"));
  assert(policy.resolveAuthorizedZoneIds(admin).includes("checkout-zone"));
  assert.equal(policy.shouldShowIotDiagnostics(admin), true);
  assert.equal(policy.shouldShowIotDiagnostics(pod3), false);

  const welcome = registry.resolveDeviceConfig({
    deviceId: "welcome-01",
    environment: "production",
    storage: createMemoryStorage(),
  });
  const ask = registry.resolveDeviceConfig({
    deviceId: "ask-snoozer-01",
    environment: "production",
    storage: createMemoryStorage(),
  });
  assert.deepEqual(policy.resolveAuthorizedZoneIds(welcome), ["welcome-kiosk"]);
  assert.deepEqual(policy.resolveAuthorizedZoneIds(ask), ["ask-snoozer"]);
  assert.equal(policy.shouldEnableZoneSocket({ endpoint: "", device: pod3 }), false);
  assert.equal(policy.shouldEnableZoneSocket({ endpoint: "wss://example/dev", device: pod3 }), true);

  const client = clientModule.createShowroomIotClient({
    endpoint: "wss://example.execute-api.us-east-1.amazonaws.com/dev",
    deviceId: "pod-3-ipad-01",
    zoneIds: ["pod-3"],
    WebSocketImpl: MockWebSocket,
  });
  client.connect();
  const socket = MockWebSocket.instances[0];
  assert.equal(socket.url, "wss://example.execute-api.us-east-1.amazonaws.com/dev?deviceId=pod-3-ipad-01");
  socket.open();
  assert.deepEqual(JSON.parse(socket.sent[0]), { action: "subscribe", zoneIds: ["pod-3"] });
  assert.equal(clientModule.getReconnectDelay(0), 500);
  assert.equal(clientModule.getReconnectDelay(20), 10000);

  const rawEvent = JSON.stringify({
    type: "zone_event",
    eventId: "evt-1",
    storeId: "severn-pilot",
    zoneId: "pod-3",
    sensorType: "mmwave-presence",
    eventType: "presence_detected",
    state: "active",
    value: true,
    sequence: 10,
    timestamp: "2026-07-16T12:00:00.000Z",
    snoozeCode: "589424",
    sessionId: "secret-session",
  });
  const normalized = reducer.normalizeZoneEventMessage(rawEvent, ["pod-3"]);
  assert.equal(normalized.ok, true);
  assert.equal(normalized.event.snoozeCode, undefined);
  assert.equal(normalized.event.sessionId, undefined);

  let state = reducer.createInitialZoneState({ subscribedZoneIds: ["pod-3"] });
  let applied = reducer.applyZoneEventToState(state, normalized.event);
  assert.equal(applied.accepted, true);
  state = applied.state;
  assert.equal(state.zoneStateByZone["pod-3"].isPresent, true);
  assert.equal(state.latestEventByZone["pod-3"].eventId, "evt-1");

  applied = reducer.applyZoneEventToState(state, normalized.event);
  assert.equal(applied.accepted, false);
  assert.equal(applied.reason, "DUPLICATE_EVENT");

  const stale = reducer.normalizeZoneEventMessage(
    {
      type: "zone_event",
      eventId: "evt-2",
      zoneId: "pod-3",
      eventType: "presence_detected",
      state: "active",
      sequence: 9,
    },
    ["pod-3"]
  );
  applied = reducer.applyZoneEventToState(state, stale.event);
  assert.equal(applied.accepted, false);
  assert.equal(applied.reason, "STALE_SEQUENCE");

  const physical = reducer.normalizePhysicalControlMessage(
    {
      type: "physical_control",
      commandId: "cmd-1",
      storeId: "severn-pilot",
      zoneId: "pod-3",
      deviceId: "pod-3-edge-01",
      commandType: "set_lighting_state",
      status: "applied",
      desiredState: { lightingState: "rest-test" },
      appliedState: { lightingState: "rest-test" },
      reportedState: { lightingState: "rest-test" },
      updatedAt: "2026-07-16T12:00:05.000Z",
    },
    ["pod-3"]
  );
  assert.equal(physical.ok, true);
  const physicalApplied = reducer.applyPhysicalControlToState(state, physical.event);
  assert.equal(physicalApplied.accepted, true);
  assert.equal(
    physicalApplied.state.zoneStateByZone["pod-3"].physicalControl.appliedState.lightingState,
    "rest-test"
  );
  assert.equal(
    reducer.normalizePhysicalControlMessage({ type: "physical_control", zoneId: "pod-4" }, ["pod-3"]).reason,
    "ZONE_NOT_AUTHORIZED"
  );

  assert.equal(reducer.normalizeZoneEventMessage("{not json", ["pod-3"]).ok, false);
  assert.equal(
    reducer.normalizeZoneEventMessage({ type: "zone_event", eventId: "evt-3", zoneId: "pod-4" }, ["pod-3"]).reason,
    "ZONE_NOT_AUTHORIZED"
  );

  const staleState = reducer.markZoneStateStale(state, "WEBSOCKET_CLOSED");
  assert.equal(staleState.isStale, true);
  assert.equal(staleState.zoneStateByZone["pod-3"].stale, true);

  const storage = createMemoryStorage();
  const write = cache.writeLastKnownZoneState(
    {
      ...state,
      shopperId: "should-not-store",
      cartId: "should-not-store",
      checkoutUrl: "should-not-store",
      snoozeCode: "should-not-store",
    },
    { storage, deviceId: "pod-3-ipad-01", savedAt: "2026-07-16T12:01:00.000Z" }
  );
  assert.equal(write.ok, true);
  const cachedRaw = storage.getItem(cache.getZoneStateCacheKey("pod-3-ipad-01"));
  assert(!/shopper|cart|checkout|snoozeCode|589424|secret-session/i.test(cachedRaw));
  const read = cache.readLastKnownZoneState({ storage, deviceId: "pod-3-ipad-01" });
  assert.equal(read.ok, true);
  assert.equal(read.snapshot.isStale, true);

  console.log(
    JSON.stringify(
      {
        ok: true,
        assertions: "react-iot-zone-state",
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
