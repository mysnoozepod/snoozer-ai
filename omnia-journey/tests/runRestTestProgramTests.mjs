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
  getRestTestTrackForStage,
  getRestTestTransitionSeconds,
  getTotalActiveSeconds,
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

function finishAutomaticTransition(state) {
  let next = reduce(state, "SET_OPENING_SPEECH_ACTIVE", { active: true });
  next = reduce(next, "OPENING_SPEECH_COMPLETE");
  while (next.phase === REST_TEST_PHASES.POSITIONING) {
    next = reduce(next, "TRANSITION_TICK");
  }
  return next;
}

function runActiveStage(state) {
  let next = state;
  const seconds = next.stageRemainingSeconds;
  for (let index = 0; index < seconds; index += 1) {
    next = reduce(next, "TICK", { completedAt: "2026-07-22T00:15:00.000Z" });
  }
  return next;
}

function testProgramContract() {
  assert.equal(getTotalActiveSeconds("quick"), 420, "quick program must total exactly seven minutes");
  assert.equal(getTotalActiveSeconds("deep"), 900, "extended program must total exactly fifteen minutes");
  assert.deepEqual(REST_TEST_DURATIONS.quick.stageSeconds, [60, 60, 90, 90, 60, 60]);
  assert.deepEqual(REST_TEST_DURATIONS.deep.stageSeconds, [135, 135, 195, 195, 120, 120]);
  assert.deepEqual(REST_TEST_STAGES.map((stage) => stage.id), EXPECTED_STAGE_IDS);
  assert.deepEqual(REST_TEST_STAGES.map((stage) => stage.baseTarget), EXPECTED_BASE_TARGETS);
  assert.deepEqual(REST_TEST_STAGES.map((stage) => stage.visual.split("/").pop()), EXPECTED_VISUALS);
  assert.deepEqual(REST_TEST_STAGES.map((_, index) => getRestTestTransitionSeconds(index)), [0, 10, 10, 20, 20, 20]);
  assert.deepEqual(REST_TEST_STAGES.map((_, index) => getRestTestTrackForStage(index).id), ["jazz", "jazz", "jazz", "jazz", "jazz", "jazz"]);
  assert.equal(REST_TEST_AUDIO_CONFIG.volume, 0.38);
  assert.equal(createInitialRestTestState().durationId, null, "duration must not be preselected");
  REST_TEST_STAGES.forEach((stage) => {
    assert.ok(stage.speech.length > 30, `${stage.id} must own deterministic speech`);
    assert.ok(stage.quietPrompt.length > 20, `${stage.id} must own a quiet-period prompt`);
    assert.ok(stage.interjection.length > 70, `${stage.id} must retain its 30-second interjection`);
  });
  assert.equal(REST_TEST_STAGES[4].speech.includes("treat"), false, "Snore guidance must not make a treatment claim");
}

function testDirectStartAndAutomaticTransitions() {
  let state = createInitialRestTestState();
  state = reduce(state, "BEGIN", { startedAt: "2026-07-22T00:00:00.000Z" });
  assert.equal(state.phase, REST_TEST_PHASES.READY, "a duration is required to start");

  state = reduce(state, "BEGIN", {
    durationId: "quick",
    startedAt: "2026-07-22T00:00:00.000Z",
    audioSnapshot: { trackId: "jazz", currentTime: 0, paused: false },
  });
  assert.equal(state.phase, REST_TEST_PHASES.POSITIONING);
  assert.equal(state.durationId, "quick");
  assert.equal(state.activeTrackId, "jazz");
  assert.equal(state.transitionRemainingSeconds, 0);

  const before = state.stageRemainingSeconds;
  state = reduce(state, "TICK");
  assert.equal(state.stageRemainingSeconds, before, "positioning time must not consume active time");
  state = finishAutomaticTransition(state);
  assert.equal(state.phase, REST_TEST_PHASES.ACTIVE, "the first stage begins after its announcement");

  state = runActiveStage(state);
  assert.equal(state.stageIndex, 1);
  assert.equal(state.phase, REST_TEST_PHASES.POSITIONING);
  assert.equal(state.transitionRemainingSeconds, 10);
  const sideRemaining = state.stageRemainingSeconds;
  state = reduce(state, "TICK");
  assert.equal(state.stageRemainingSeconds, sideRemaining, "transition time must stay outside active timing");

  state = reduce(state, "SET_OPENING_SPEECH_ACTIVE", { active: true });
  state = reduce(state, "OPENING_SPEECH_COMPLETE");
  assert.equal(state.phase, REST_TEST_PHASES.POSITIONING);
  for (let index = 0; index < 9; index += 1) state = reduce(state, "TRANSITION_TICK");
  assert.equal(state.transitionRemainingSeconds, 1);
  state = reduce(state, "TRANSITION_TICK");
  assert.equal(state.phase, REST_TEST_PHASES.ACTIVE, "body transition must advance automatically after ten seconds");
}

function testPauseResumeRestartAndEarlyExit() {
  let state = createInitialRestTestState();
  state = reduce(state, "BEGIN", { durationId: "deep", startedAt: "2026-07-22T00:00:00.000Z" });
  state = finishAutomaticTransition(state);
  state = reduce(state, "TICK");
  const remaining = state.stageRemainingSeconds;
  state = reduce(state, "PAUSE");
  assert.equal(state.phase, REST_TEST_PHASES.PAUSED);
  assert.equal(state.pauseCount, 1);
  state = reduce(state, "TICK");
  assert.equal(state.stageRemainingSeconds, remaining);
  state = reduce(state, "RESUME");
  assert.equal(state.phase, REST_TEST_PHASES.ACTIVE);

  const partial = reduce(state, "END_EARLY", { completedAt: "2026-07-22T00:04:00.000Z" });
  const record = buildRestTestRecord(partial, { shopperId: "589424", podId: "pod-4" });
  assert.equal(record.eventType, "rest_test.incomplete");
  assert.equal(record.ambientSound, "jazz");

  const restarted = reduce(state, "RESTART");
  assert.equal(restarted.phase, REST_TEST_PHASES.READY);
  assert.equal(restarted.durationId, null);
  assert.equal(restarted.ambienceId, "jazz");
  assert.equal(restarted.startedAt, null);
}

function testInterjectionAndCompletion() {
  let state = createInitialRestTestState();
  state = reduce(state, "BEGIN", { durationId: "quick", startedAt: "2026-07-22T00:00:00.000Z" });
  state = finishAutomaticTransition(state);
  for (let index = 0; index < 30; index += 1) state = reduce(state, "TICK");
  assert.equal(state.stageActiveElapsedSeconds, 30);
  state = reduce(state, "MARK_INTERJECTION_FIRED", { stageId: "back_flat" });
  state = reduce(state, "MARK_INTERJECTION_FIRED", { stageId: "back_flat" });
  assert.deepEqual(state.interjectionFiredStageIds, ["back_flat"]);

  while (state.phase !== REST_TEST_PHASES.COMPLETED) {
    if (state.phase === REST_TEST_PHASES.POSITIONING) state = finishAutomaticTransition(state);
    else state = reduce(state, "TICK", { completedAt: "2026-07-22T00:07:00.000Z" });
  }
  assert.equal(state.overallActiveElapsedSeconds, 420);
  assert.deepEqual(state.completedStageIds, EXPECTED_STAGE_IDS);
}

function testFailuresAndSafeRestore() {
  let state = createInitialRestTestState();
  state = reduce(state, "BEGIN", { durationId: "quick" });
  state = reduce(state, "BASE_FAILURE");
  assert.equal(state.phase, REST_TEST_PHASES.BASE_FAILURE);
  assert.ok(REST_TEST_BASE_FAILURE_SPEECH.includes("continue evaluating"));
  state = reduce(state, "CONTINUE_FLAT");
  assert.equal(state.phase, REST_TEST_PHASES.POSITIONING);

  const restored = restoreRestTestState({
    ...createInitialRestTestState({ durationId: "quick" }),
    phase: REST_TEST_PHASES.ACTIVE,
    startedAt: "2026-07-22T00:00:00.000Z",
    stageRemainingSeconds: 41,
  });
  assert.equal(restored.phase, REST_TEST_PHASES.PAUSED);
  assert.equal(restored.resumePhase, REST_TEST_PHASES.ACTIVE);
  assert.equal(restored.stageRemainingSeconds, 41);
}

async function loadAudioController() {
  const source = await readFile(new URL("../src/iot/ambientAudioController.js", import.meta.url), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

async function testPersistentJazzController() {
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
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  globalThis.Audio = FakeAudio;
  globalThis.window = globalThis;
  const { createAmbientAudioController } = await loadAudioController();
  const controller = createAmbientAudioController({ track: REST_TEST_AMBIENCE.jazz.src, volume: 0.38 });

  controller.start(undefined, { fadeMs: 0 });
  const jazz = instances.at(-1);
  assert.equal(jazz.loop, true);
  assert.equal(jazz.volume, 0.38);
  assert.equal(controller.getSnapshot().trackId, "jazz");
  jazz.currentTime = 12.5;
  controller.pause({ fadeMs: 0 });
  assert.equal(jazz.paused, true, "speech pause must fully pause jazz");
  assert.equal(jazz.currentTime, 12.5, "speech pause must preserve playback position");
  controller.resume();
  assert.equal(instances.length, 1, "resume must reuse the persistent audio instance");
  assert.equal(jazz.currentTime, 12.5);
  controller.stop();
  assert.equal(controller.getSnapshot().hasAudio, false);
  delete globalThis.Audio;
}

async function testAssetsAndCustomerSurface() {
  for (const source of [REST_TEST_AMBIENCE.jazz.src, ...new Set(REST_TEST_STAGES.map((stage) => stage.visual))]) {
    await access(new URL(source));
  }
  const panelSource = await readFile(new URL("../src/components/pod/PodRestPanels.jsx", import.meta.url), "utf8");
  const hookSource = await readFile(new URL("../src/hooks/useGuidedRestTest.js", import.meta.url), "utf8");
  for (const removedText of ["Begin Rest Test", "Position Ready", "rest-begin-test", "rest-position-ready"]) {
    assert.equal(panelSource.includes(removedText), false, `${removedText} must be removed`);
  }
  assert.equal(panelSource.includes("controller.start(duration.id)"), true, "duration buttons must start directly");
  assert.equal(hookSource.includes(".duck()"), false, "jazz must pause rather than duck for TTS");
  assert.equal(hookSource.includes("REST_TEST_AMBIENCE.jazz.src"), true);
}

testProgramContract();
testDirectStartAndAutomaticTransitions();
testPauseResumeRestartAndEarlyExit();
testInterjectionAndCompletion();
testFailuresAndSafeRestore();
await testPersistentJazzController();
await testAssetsAndCustomerSurface();

console.log("Rest Test program tests passed: automatic flow, exact timing, persistent jazz, pause/resume, and assets.");
