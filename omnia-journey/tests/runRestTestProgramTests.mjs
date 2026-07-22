import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

import {
  REST_TEST_AMBIENCE,
  REST_TEST_AUDIO_CONFIG,
  REST_TEST_BASE_FAILURE_SPEECH,
  REST_TEST_DURATIONS,
  REST_TEST_PHASES,
  REST_TEST_STAGES,
  buildRestTestRecord,
  createInitialRestTestState,
  getTotalActiveSeconds,
  getRestTestTrackForStage,
  restTestReducer,
  restoreRestTestState,
} from "../src/lib/restTestProgram.mjs";

const EXPECTED_STAGE_IDS = [
  "back_flat",
  "side_flat",
  "back_recalibration",
  "zero_gravity",
  "snore",
  "final_flat",
];
const EXPECTED_VISUALS = [
  "rest-test-back-flat.png",
  "rest-test-side-flat.png",
  "rest-test-back-flat.png",
  "rest-test-zero-gravity.png",
  "rest-test-snore.png",
  "rest-test-back-flat.png",
];
const EXPECTED_BASE_TARGETS = ["flat", "flat", "flat", "zero_gravity", "snore", "flat"];

function reduce(state, type, extra = {}) {
  return restTestReducer(state, { type, ...extra });
}

function testProgramContract() {
  assert.equal(getTotalActiveSeconds("quick"), 420, "quick program must total exactly seven minutes");
  assert.equal(getTotalActiveSeconds("deep"), 900, "extended program must total exactly fifteen minutes");
  assert.deepEqual(REST_TEST_DURATIONS.quick.stageSeconds, [60, 60, 90, 90, 60, 60]);
  assert.deepEqual(REST_TEST_DURATIONS.deep.stageSeconds, [135, 135, 195, 195, 120, 120]);
  assert.deepEqual(REST_TEST_STAGES.map((stage) => stage.id), EXPECTED_STAGE_IDS);
  assert.deepEqual(REST_TEST_STAGES.map((stage) => stage.baseTarget), EXPECTED_BASE_TARGETS);
  assert.deepEqual(
    REST_TEST_STAGES.map((stage) => stage.visual.split("/").pop()),
    EXPECTED_VISUALS
  );
  REST_TEST_STAGES.forEach((stage) => {
    assert.ok(stage.speech.length > 30, `${stage.id} must own deterministic speech`);
    assert.ok(stage.quietPrompt.length > 20, `${stage.id} must own a quiet-period prompt`);
    assert.ok(stage.manualInstruction.length > 15, `${stage.id} must own a manual base instruction`);
    assert.ok(stage.interjection.length > 70, `${stage.id} must own a position-specific interjection`);
    assert.equal(stage.visual.startsWith("/rest-test/visuals/"), true);
  });
  assert.equal(REST_TEST_STAGES[4].speech.includes("treat"), false, "Snore guidance must not make a treatment claim");
  assert.deepEqual(
    REST_TEST_STAGES.map((_, index) => getRestTestTrackForStage(index).id),
    ["waves", "waves", "waves", "sleepTones", "sleepTones", "sleepTones"]
  );
  assert.equal(REST_TEST_AUDIO_CONFIG.volume, 0.38);
}

function testManualAcknowledgementAndTiming() {
  let state = createInitialRestTestState();
  state = reduce(state, "BEGIN", { startedAt: "2026-07-21T00:00:00.000Z" });
  assert.equal(state.phase, REST_TEST_PHASES.POSITIONING);
  const before = state.stageRemainingSeconds;
  state = reduce(state, "TICK");
  state = reduce(state, "TICK");
  assert.equal(state.stageRemainingSeconds, before, "positioning time must not consume active time");
  assert.equal(state.overallActiveElapsedSeconds, 0);

  state = reduce(state, "POSITION_READY");
  assert.equal(state.phase, REST_TEST_PHASES.ACTIVE);
  state = reduce(state, "TICK");
  assert.equal(state.stageRemainingSeconds, before - 1);
  assert.equal(state.overallActiveElapsedSeconds, 1);

  for (let index = 1; index < before; index += 1) state = reduce(state, "TICK");
  assert.equal(state.stageIndex, 1);
  assert.equal(state.phase, REST_TEST_PHASES.POSITIONING, "next stage must wait for Position Ready");
  const sideRemaining = state.stageRemainingSeconds;
  state = reduce(state, "TICK");
  assert.equal(state.stageRemainingSeconds, sideRemaining);
}

function testPauseResumeRestartAndEarlyExit() {
  let state = createInitialRestTestState({ durationId: "deep" });
  state = reduce(state, "BEGIN", { startedAt: "2026-07-21T00:00:00.000Z" });
  state = reduce(state, "POSITION_READY");
  state = reduce(state, "TICK");
  const remaining = state.stageRemainingSeconds;
  state = reduce(state, "PAUSE");
  assert.equal(state.phase, REST_TEST_PHASES.PAUSED);
  assert.equal(state.pauseCount, 1);
  state = reduce(state, "TICK");
  assert.equal(state.stageRemainingSeconds, remaining, "pause must preserve remaining stage time");
  state = reduce(state, "RESUME");
  assert.equal(state.phase, REST_TEST_PHASES.ACTIVE);
  assert.equal(state.stageRemainingSeconds, remaining);

  const partial = reduce(state, "END_EARLY", { completedAt: "2026-07-21T00:04:00.000Z" });
  assert.equal(partial.completionStatus, "incomplete");
  assert.equal(partial.earlyExit, true);
  const record = buildRestTestRecord(partial, {
    shopperId: "589424",
    sessionId: "session-test",
    snoozeCode: "589424",
    podId: "pod-4",
    mattressId: "12-all-foam-mattress",
  });
  assert.equal(record.eventType, "rest_test.incomplete");
  assert.equal(record.shopperId, "589424");
  assert.equal(record.podId, "pod-4");
  assert.equal(record.ambientSound, "waves");

  const restarted = reduce(state, "RESTART");
  assert.equal(restarted.phase, REST_TEST_PHASES.READY);
  assert.equal(restarted.durationId, "deep");
  assert.equal(restarted.ambienceId, "waves");
  assert.equal(restarted.volume, REST_TEST_AUDIO_CONFIG.volume);
  assert.equal(restarted.startedAt, null);
}

function testInterjectionTimingAndDeduplication() {
  let state = createInitialRestTestState();
  state = reduce(state, "BEGIN", { startedAt: "2026-07-21T00:00:00.000Z" });
  state = reduce(state, "POSITION_READY");
  for (let index = 0; index < 29; index += 1) state = reduce(state, "TICK");
  assert.equal(state.stageActiveElapsedSeconds, 29);
  assert.deepEqual(state.interjectionFiredStageIds, []);

  state = reduce(state, "PAUSE");
  state = reduce(state, "TICK");
  assert.equal(state.stageActiveElapsedSeconds, 29, "paused time must not advance the interjection clock");
  state = reduce(state, "RESUME");
  state = reduce(state, "TICK");
  assert.equal(state.stageActiveElapsedSeconds, 30);
  state = reduce(state, "MARK_INTERJECTION_FIRED", { stageId: "back_flat" });
  state = reduce(state, "MARK_INTERJECTION_FIRED", { stageId: "back_flat" });
  assert.deepEqual(state.interjectionFiredStageIds, ["back_flat"], "a stage interjection must be recorded once");

  const restarted = reduce(state, "RESTART");
  assert.equal(restarted.stageActiveElapsedSeconds, 0);
  assert.deepEqual(restarted.interjectionFiredStageIds, []);
}

function testFailuresAndSafeRestore() {
  let state = createInitialRestTestState();
  state = reduce(state, "BEGIN");
  state = reduce(state, "BASE_FAILURE");
  assert.equal(state.phase, REST_TEST_PHASES.BASE_FAILURE);
  assert.equal(state.degraded, true);
  assert.ok(REST_TEST_BASE_FAILURE_SPEECH.includes("continue evaluating"));
  state = reduce(state, "TRY_BASE_AGAIN");
  assert.equal(state.phase, REST_TEST_PHASES.POSITIONING);
  state = reduce(state, "BASE_FAILURE");
  state = reduce(state, "CONTINUE_FLAT");
  assert.equal(state.phase, REST_TEST_PHASES.ACTIVE);

  const restored = restoreRestTestState({
    ...createInitialRestTestState(),
    phase: REST_TEST_PHASES.ACTIVE,
    startedAt: "2026-07-21T00:00:00.000Z",
    stageRemainingSeconds: 41,
  });
  assert.equal(restored.phase, REST_TEST_PHASES.PAUSED);
  assert.equal(restored.resumePhase, REST_TEST_PHASES.ACTIVE);
  assert.equal(restored.stageRemainingSeconds, 41);

  const unexpected = restoreRestTestState({
    ...createInitialRestTestState(),
    phase: "unknown_runtime_state",
    startedAt: "2026-07-21T00:00:00.000Z",
  });
  assert.equal(unexpected.phase, REST_TEST_PHASES.PAUSED, "unexpected persisted state must fail safe to paused");
}

function testCompletionAndRatings() {
  let state = createInitialRestTestState();
  state = reduce(state, "BEGIN", { startedAt: "2026-07-21T00:00:00.000Z" });
  while (state.phase !== REST_TEST_PHASES.COMPLETED) {
    if (state.phase === REST_TEST_PHASES.POSITIONING) state = reduce(state, "POSITION_READY");
    else state = reduce(state, "TICK", { completedAt: "2026-07-21T00:07:00.000Z" });
  }
  assert.equal(state.overallActiveElapsedSeconds, 420);
  assert.deepEqual(state.completedStageIds, EXPECTED_STAGE_IDS);
  state = reduce(state, "RATE", { field: "comfort", value: 5 });
  state = reduce(state, "RATE", { field: "pressureRelief", value: 4 });
  state = reduce(state, "RATE", { field: "support", value: 3 });
  state = reduce(state, "SET_PREFERRED_POSITION", { value: "zero_gravity" });
  state = reduce(state, "SET_TEST_AGAIN", { value: "yes" });
  const record = buildRestTestRecord(state, { podId: "pod-4", mattressId: "12-all-foam-mattress" });
  assert.equal(record.eventType, "rest_test.completed");
  assert.equal(record.comfortRating, 5);
  assert.equal(record.pressureReliefRating, 4);
  assert.equal(record.supportRating, 3);
  assert.equal(record.preferredPosition, "zero_gravity");
  assert.equal(record.testAgain, "yes");
}

async function loadAudioController() {
  const source = await readFile(new URL("../src/iot/ambientAudioController.js", import.meta.url), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

async function testAudioController() {
  const instances = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.loop = false;
      this.preload = "";
      this.volume = 1;
      this.currentTime = 0;
      this.paused = true;
      instances.push(this);
    }
    play() {
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }
  globalThis.Audio = FakeAudio;
  globalThis.window = globalThis;
  const { createAmbientAudioController } = await loadAudioController();
  const controller = createAmbientAudioController({ track: REST_TEST_AMBIENCE.waves.src, volume: 0.4 });

  controller.start(undefined, { fadeMs: 0 });
  assert.equal(instances.at(-1).loop, true, "ambience must loop");
  assert.equal(instances.at(-1).volume, 0.4);
  controller.setVolume(0.7);
  await new Promise((resolve) => setTimeout(resolve, 240));
  assert.equal(instances.at(-1).volume, 0.7);
  const firstTrack = instances.at(-1);
  controller.start(REST_TEST_AMBIENCE.sleepTones.src, { fadeMs: 0 });
  assert.equal(firstTrack.paused, true, "selecting a new track must stop the previous track");
  assert.equal(instances.filter((audio) => !audio.paused).length, 1, "only one ambience source may play");

  const active = instances.at(-1);
  active.currentTime = 2.5;
  assert.equal(controller.getSnapshot().currentTime, 2.5, "the controller must expose advancing playback position");
  const countBeforeReuse = instances.length;
  controller.start(REST_TEST_AMBIENCE.sleepTones.src, { fadeMs: 0 });
  assert.equal(instances.length, countBeforeReuse, "rerenders must reuse the active soundtrack instance");

  controller.duck();
  await new Promise((resolve) => setTimeout(resolve, 240));
  assert.ok(instances.find((audio) => audio.loop)?.volume <= 0.7, "voice ducking must lower or preserve ambience volume");
  controller.restore();
  await new Promise((resolve) => setTimeout(resolve, 380));
  controller.pause({ fadeMs: 0 });
  assert.equal(controller.getSnapshot().status, "paused");
  controller.resume();
  controller.stop();
  assert.equal(controller.getSnapshot().hasAudio, false);
  delete globalThis.Audio;
}

async function testAssetsAndCustomerSurface() {
  for (const source of [
    REST_TEST_AMBIENCE.waves.src,
    REST_TEST_AMBIENCE.sleepTones.src,
    ...new Set(REST_TEST_STAGES.map((stage) => stage.visual)),
  ]) {
    await access(new URL(`../public${source}`, import.meta.url));
  }
  const panelSource = await readFile(new URL("../src/components/pod/PodRestPanels.jsx", import.meta.url), "utf8");
  for (const removedText of ["Ambient Sound", "Soft Jazz Instrumental", "Crashing Waves", "Works offline", "Next:"]) {
    assert.equal(panelSource.includes(removedText), false, `${removedText} must not appear on the shopper surface`);
  }
}

testProgramContract();
testManualAcknowledgementAndTiming();
testPauseResumeRestartAndEarlyExit();
testInterjectionTimingAndDeduplication();
testFailuresAndSafeRestore();
testCompletionAndRatings();
await testAudioController();
await testAssetsAndCustomerSurface();

console.log("Rest Test program tests passed: timing, order, state, persistence, failure, ratings, and audio policy.");
