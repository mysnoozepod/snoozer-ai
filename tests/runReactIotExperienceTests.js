#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REPO_ROOT = path.resolve(__dirname, "..");
const SRC_ROOT = path.join(REPO_ROOT, "omnia-journey", "src");
const TEST_MODULE_DIR = path.join(REPO_ROOT, "_out", "react-iot-experience-test-modules");

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

function makeZoneState({ zoneId = "pod-4", eventType, isPresent, isOccupied, stale = false }) {
  const now = "2026-07-16T12:00:00.000Z";
  return {
    connectionStatus: "connected",
    subscribedZoneIds: [zoneId],
    latestEventByZone: {
      [zoneId]: { zoneId, eventType, eventId: `${eventType}-1` },
    },
    zoneStateByZone: {
      [zoneId]: {
        zoneId,
        eventType,
        isPresent,
        isOccupied,
        stale,
        lastPresenceEventAt: typeof isPresent === "boolean" ? now : null,
        lastOccupancyEventAt: typeof isOccupied === "boolean" ? now : null,
      },
    },
    lastReceivedAt: now,
    isStale: stale,
  };
}

async function run() {
  copyModulesForEsmImport();

  const config = await importModule("iot/iotExperienceConfig.js");
  const experience = await importModule("iot/showroomExperienceState.js");
  const audioModule = await importModule("iot/ambientAudioController.js");
  const resetPolicies = await importModule("device/resetPolicies.js");
  const reducer = await importModule("iot/zoneStateReducer.js");

  const defaults = config.getIotExperienceConfig({});
  assert.equal(defaults.restTestDurationMs, 420000);
  assert.equal(defaults.restTestVacancyGraceMs, 30000);
  assert.equal(defaults.enableIotExperiences, true);

  const welcome = experience.deriveZoneExperienceSnapshot(
    makeZoneState({
      zoneId: "welcome-kiosk",
      eventType: "presence_detected",
      isPresent: true,
    }),
    "welcome-kiosk"
  );
  assert.equal(welcome.isPresent, true);
  assert.equal(welcome.proximityContext.zoneId, "welcome-kiosk");

  const podPresence = experience.deriveZoneExperienceSnapshot(
    makeZoneState({
      zoneId: "pod-4",
      eventType: "presence_detected",
      isPresent: true,
    }),
    "pod-4"
  );
  assert.equal(podPresence.lightingState, experience.LIGHTING_STATES.ACTIVE);
  assert.equal(podPresence.restTestEligible, false);

  const podOccupied = experience.deriveZoneExperienceSnapshot(
    makeZoneState({
      zoneId: "pod-4",
      eventType: "pod_occupied",
      isPresent: true,
      isOccupied: true,
    }),
    "pod-4"
  );
  assert.equal(podOccupied.isOccupied, true);
  assert.equal(podOccupied.restTestEligible, true);

  assert.equal(
    resetPolicies.hasBlockingResetReason(resetPolicies.DEVICE_RESET_POLICIES["pod-ipad"], [
      "pod-occupied",
    ]),
    true
  );
  assert.equal(
    resetPolicies.hasBlockingResetReason(resetPolicies.DEVICE_RESET_POLICIES["pod-ipad"], [
      "zone-presence",
    ]),
    false
  );
  assert.equal(
    resetPolicies.hasBlockingResetReason(resetPolicies.DEVICE_RESET_POLICIES["pod-ipad"], [
      "rest-test-active",
    ]),
    true
  );

  assert.equal(
    experience.deriveLightingState({ isPresent: true, restTestActive: true }),
    experience.LIGHTING_STATES.REST_TEST
  );
  assert.equal(
    experience.deriveLightingState({ restTestComplete: true }),
    experience.LIGHTING_STATES.COMPLETE
  );
  assert.equal(
    experience.deriveLightingState({ hasFault: true }),
    experience.LIGHTING_STATES.FAULT
  );

  const baseVacancy = {
    restTestActive: true,
    isOccupied: false,
    hasFreshOccupancySignal: true,
    isStale: false,
    vacatedAt: 1000,
    graceMs: 30000,
  };
  assert.equal(
    experience.shouldCompleteRestTestForVacancy({ ...baseVacancy, nowMs: 30999 }),
    false
  );
  assert.equal(
    experience.shouldCompleteRestTestForVacancy({ ...baseVacancy, nowMs: 31000 }),
    true
  );
  assert.equal(
    experience.shouldCompleteRestTestForVacancy({ ...baseVacancy, isStale: true, nowMs: 61000 }),
    false
  );

  const audio = audioModule.createAmbientAudioController();
  const startAudio = audio.start();
  assert.equal(startAudio.ok, true);
  assert.equal(startAudio.skipped, true);
  assert.equal(startAudio.reason, "NO_AUDIO_TRACK_CONFIGURED");
  assert.equal(audio.stop().ok, true);

  assert.equal(
    config.REST_TEST_OPENING_HUD_PAYLOAD.speech,
    "Your seven-minute Rest Test is beginning. Relax and take your time. I\u2019ll be here if you need me."
  );
  assert.equal(config.REST_TEST_OPENING_HUD_PAYLOAD.ttlMs, 7000);

  const occupiedEvent = reducer.normalizeZoneEventMessage(
    {
      type: "zone_event",
      eventId: "occ-1",
      zoneId: "pod-4",
      eventType: "pod_occupied",
      sequence: 1,
    },
    ["pod-4"]
  );
  const vacatedEvent = reducer.normalizeZoneEventMessage(
    {
      type: "zone_event",
      eventId: "vac-1",
      zoneId: "pod-4",
      eventType: "pod_vacated",
      sequence: 2,
    },
    ["pod-4"]
  );
  let state = reducer.createInitialZoneState({ subscribedZoneIds: ["pod-4"] });
  state = reducer.applyZoneEventToState(state, occupiedEvent.event).state;
  assert.equal(state.zoneStateByZone["pod-4"].isOccupied, true);
  state = reducer.applyZoneEventToState(state, vacatedEvent.event).state;
  assert.equal(state.zoneStateByZone["pod-4"].isOccupied, false);

  const checkout = experience.deriveZoneExperienceSnapshot(
    makeZoneState({
      zoneId: "checkout-zone",
      eventType: "presence_detected",
      isPresent: true,
    }),
    "checkout-zone"
  );
  assert.equal(checkout.proximityContext.zoneId, "checkout-zone");
  assert.equal(Object.hasOwn(checkout.proximityContext, "cartId"), false);
  assert.equal(Object.hasOwn(checkout.proximityContext, "checkoutUrl"), false);

  console.log(
    JSON.stringify(
      {
        ok: true,
        assertions: "react-iot-experience",
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
