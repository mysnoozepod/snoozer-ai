export const REST_TEST_PHASES = Object.freeze({
  READY: "ready",
  STARTING: "starting",
  POSITIONING: "positioning",
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
  ENDED_EARLY: "ended_early",
  DEGRADED: "degraded",
  BASE_FAILURE: "base_failure",
});

export const REST_TEST_DURATIONS = Object.freeze({
  quick: Object.freeze({
    id: "quick",
    label: "7-Minute Guided Rest Test",
    shortLabel: "7 min",
    totalSeconds: 420,
    stageSeconds: Object.freeze([60, 60, 90, 90, 60, 60]),
  }),
  deep: Object.freeze({
    id: "deep",
    label: "15-Minute Extended Rest Test",
    shortLabel: "15 min",
    totalSeconds: 900,
    stageSeconds: Object.freeze([135, 135, 195, 195, 120, 120]),
  }),
});

export const REST_TEST_AMBIENCE = Object.freeze({
  waves: Object.freeze({
    id: "waves",
    label: "Crashing Waves",
    src: "/rest-test/audio/rest-test-crashing-waves.mp3",
  }),
  jazz: Object.freeze({
    id: "jazz",
    label: "Soft Jazz Instrumental",
    src: "/rest-test/audio/rest-test-soft-jazz-instrumental.mp3",
  }),
});

export const REST_TEST_STAGES = Object.freeze([
  Object.freeze({
    id: "back_flat",
    name: "Back, Base Flat",
    positionLabel: "Back / Flat",
    machineState: "back_flat",
    transitionState: "starting",
    visual: "/rest-test/visuals/rest-test-back-flat.png",
    baseTarget: "flat",
    manualInstruction: "Use the base remote to return the mattress to flat.",
    speech: "Start on your back. Lie still for a full minute and let the mattress conform to your body.",
    quietPrompt: "Notice how your shoulders, lower back, and hips settle into the mattress.",
    nextStageId: "side_flat",
  }),
  Object.freeze({
    id: "side_flat",
    name: "Side, Base Flat",
    positionLabel: "Side / Flat",
    machineState: "side_flat",
    transitionState: "transition_to_side",
    visual: "/rest-test/visuals/rest-test-side-flat.png",
    baseTarget: "flat",
    manualInstruction: "Keep the base flat, then turn onto your side.",
    speech: "Now, turn onto your side. Pay attention to how your shoulders and hips feel as the mattress supports you.",
    quietPrompt: "Notice whether pressure builds around your shoulder or hip.",
    nextStageId: "back_recalibration",
  }),
  Object.freeze({
    id: "back_recalibration",
    name: "Recalibrate on Back",
    positionLabel: "Back / Flat",
    machineState: "back_recalibration",
    transitionState: "transition_to_recalibration",
    visual: "/rest-test/visuals/rest-test-back-flat.png",
    baseTarget: "flat",
    manualInstruction: "Keep the base flat, then return to your back.",
    speech: "Return to your back. Take a moment to recalibrate and notice the mattress again while it is completely flat.",
    quietPrompt: "Notice your alignment and whether your lower back feels evenly supported.",
    nextStageId: "zero_gravity",
  }),
  Object.freeze({
    id: "zero_gravity",
    name: "Zero Gravity",
    positionLabel: "Back / Zero Gravity",
    machineState: "zero_gravity",
    transitionState: "transition_to_zero_gravity",
    visual: "/rest-test/visuals/rest-test-zero-gravity.png",
    baseTarget: "zero_gravity",
    manualInstruction: "Use the base remote to select Zero Gravity.",
    speech: "Stay on your back. Now, let's experience Zero Gravity. Notice how the position redistributes pressure and supports your body.",
    quietPrompt: "Pay attention to your lower back, legs, and overall sense of relaxation.",
    nextStageId: "snore",
  }),
  Object.freeze({
    id: "snore",
    name: "Snore Preset",
    positionLabel: "Back / Head Raised",
    machineState: "snore_preset",
    transitionState: "transition_to_snore",
    visual: "/rest-test/visuals/rest-test-snore.png",
    baseTarget: "snore",
    manualInstruction: "Use the base remote to raise the head while keeping the foot section flat.",
    speech: "Now, let's try the Snore preset. This gently raises your head while keeping the foot section flat. Notice whether the elevation feels natural.",
    quietPrompt: "Notice your neck, upper body, and breathing comfort in this position.",
    nextStageId: "final_flat",
  }),
  Object.freeze({
    id: "final_flat",
    name: "Final Flat Comparison",
    positionLabel: "Back / Flat",
    machineState: "final_flat_comparison",
    transitionState: "transition_to_flat",
    visual: "/rest-test/visuals/rest-test-back-flat.png",
    baseTarget: "flat",
    manualInstruction: "Use the base remote to return the mattress to flat.",
    speech: "Now, return the base to flat. Spend this final minute comparing the mattress against Zero Gravity and the Snore preset.",
    quietPrompt: "Which position felt most comfortable and supportive to you?",
    nextStageId: null,
  }),
]);

export const REST_TEST_COMPLETION_SPEECH =
  "Your Rest Test is complete. Take a moment to rate how this mattress felt for comfort, pressure relief, and support.";

export const REST_TEST_RESUME_SPEECH = "Take your time. We'll continue when you're ready.";

export const REST_TEST_BASE_FAILURE_SPEECH =
  "The base position is unavailable right now, but you can continue evaluating the mattress while it remains flat.";

export function getRestTestDuration(durationId = "quick") {
  return REST_TEST_DURATIONS[durationId] || REST_TEST_DURATIONS.quick;
}

export function getRestTestStage(stageIndex = 0) {
  return REST_TEST_STAGES[Math.max(0, Math.min(REST_TEST_STAGES.length - 1, Number(stageIndex) || 0))];
}

export function getStageDuration(durationId, stageIndex) {
  const duration = getRestTestDuration(durationId);
  return duration.stageSeconds[Math.max(0, Math.min(duration.stageSeconds.length - 1, Number(stageIndex) || 0))];
}

export function getTotalActiveSeconds(durationId = "quick") {
  return getRestTestDuration(durationId).stageSeconds.reduce((sum, seconds) => sum + seconds, 0);
}

export function createInitialRestTestState(overrides = {}) {
  const durationId = REST_TEST_DURATIONS[overrides.durationId] ? overrides.durationId : "quick";
  const ambienceId = REST_TEST_AMBIENCE[overrides.ambienceId] ? overrides.ambienceId : "waves";
  return {
    version: 1,
    phase: REST_TEST_PHASES.READY,
    resumePhase: null,
    durationId,
    ambienceId,
    volume: 0.45,
    muted: false,
    stageIndex: 0,
    stageRemainingSeconds: getStageDuration(durationId, 0),
    overallActiveElapsedSeconds: 0,
    completedStageIds: [],
    pauseCount: 0,
    degraded: false,
    completionStatus: "not_started",
    earlyExit: false,
    ratings: { comfort: 0, pressureRelief: 0, support: 0 },
    preferredPosition: "",
    testAgain: "",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

export function restoreRestTestState(value) {
  if (!value || value.version !== 1) return createInitialRestTestState();
  const durationId = REST_TEST_DURATIONS[value.durationId] ? value.durationId : "quick";
  const ambienceId = REST_TEST_AMBIENCE[value.ambienceId] ? value.ambienceId : "waves";
  const stageIndex = Math.max(0, Math.min(REST_TEST_STAGES.length - 1, Number(value.stageIndex) || 0));
  const unfinishedPhases = new Set([
    REST_TEST_PHASES.STARTING,
    REST_TEST_PHASES.POSITIONING,
    REST_TEST_PHASES.ACTIVE,
    REST_TEST_PHASES.PAUSED,
    REST_TEST_PHASES.DEGRADED,
    REST_TEST_PHASES.BASE_FAILURE,
  ]);
  const terminalPhases = new Set([
    REST_TEST_PHASES.READY,
    REST_TEST_PHASES.COMPLETED,
    REST_TEST_PHASES.ENDED_EARLY,
  ]);
  const originalPhase = unfinishedPhases.has(value.phase) ? value.phase : null;
  const restoredPhase = originalPhase
    ? REST_TEST_PHASES.PAUSED
    : terminalPhases.has(value.phase)
      ? value.phase
      : REST_TEST_PHASES.PAUSED;
  return createInitialRestTestState({
    ...value,
    durationId,
    ambienceId,
    stageIndex,
    stageRemainingSeconds: Math.max(0, Number(value.stageRemainingSeconds) || getStageDuration(durationId, stageIndex)),
    overallActiveElapsedSeconds: Math.max(0, Number(value.overallActiveElapsedSeconds) || 0),
    completedStageIds: Array.isArray(value.completedStageIds) ? value.completedStageIds.filter(Boolean) : [],
    phase: restoredPhase,
    resumePhase:
      originalPhase === REST_TEST_PHASES.ACTIVE
        ? REST_TEST_PHASES.ACTIVE
        : originalPhase
          ? REST_TEST_PHASES.POSITIONING
          : value.resumePhase || null,
  });
}

export function isRestTestUnfinished(state) {
  return Boolean(
    state?.startedAt &&
      ![REST_TEST_PHASES.READY, REST_TEST_PHASES.COMPLETED, REST_TEST_PHASES.ENDED_EARLY].includes(state.phase)
  );
}

function restartState(state) {
  return createInitialRestTestState({
    durationId: state.durationId,
    ambienceId: state.ambienceId,
    volume: state.volume,
    muted: state.muted,
  });
}

export function restTestReducer(state, action = {}) {
  switch (action.type) {
    case "SET_DURATION": {
      if (!REST_TEST_DURATIONS[action.durationId]) return state;
      if (isRestTestUnfinished(state)) return state;
      return {
        ...state,
        durationId: action.durationId,
        stageRemainingSeconds: getStageDuration(action.durationId, 0),
      };
    }
    case "SET_AMBIENCE":
      return REST_TEST_AMBIENCE[action.ambienceId] ? { ...state, ambienceId: action.ambienceId } : state;
    case "SET_VOLUME":
      return { ...state, volume: Math.max(0, Math.min(1, Number(action.volume) || 0)) };
    case "SET_MUTED":
      return { ...state, muted: Boolean(action.muted) };
    case "BEGIN":
      return {
        ...restartState(state),
        phase: REST_TEST_PHASES.POSITIONING,
        completionStatus: "in_progress",
        startedAt: action.startedAt || new Date().toISOString(),
      };
    case "POSITION_READY":
      if (![REST_TEST_PHASES.POSITIONING, REST_TEST_PHASES.DEGRADED, REST_TEST_PHASES.BASE_FAILURE].includes(state.phase)) return state;
      return { ...state, phase: REST_TEST_PHASES.ACTIVE, resumePhase: null };
    case "TICK": {
      if (state.phase !== REST_TEST_PHASES.ACTIVE) return state;
      const elapsed = state.overallActiveElapsedSeconds + 1;
      if (state.stageRemainingSeconds > 1) {
        return { ...state, stageRemainingSeconds: state.stageRemainingSeconds - 1, overallActiveElapsedSeconds: elapsed };
      }
      const stage = getRestTestStage(state.stageIndex);
      const completedStageIds = Array.from(new Set([...state.completedStageIds, stage.id]));
      if (state.stageIndex >= REST_TEST_STAGES.length - 1) {
        return {
          ...state,
          phase: REST_TEST_PHASES.COMPLETED,
          stageRemainingSeconds: 0,
          overallActiveElapsedSeconds: elapsed,
          completedStageIds,
          completionStatus: "completed",
          completedAt: action.completedAt || new Date().toISOString(),
        };
      }
      const stageIndex = state.stageIndex + 1;
      return {
        ...state,
        phase: REST_TEST_PHASES.POSITIONING,
        stageIndex,
        stageRemainingSeconds: getStageDuration(state.durationId, stageIndex),
        overallActiveElapsedSeconds: elapsed,
        completedStageIds,
      };
    }
    case "PAUSE":
      if (![REST_TEST_PHASES.ACTIVE, REST_TEST_PHASES.POSITIONING, REST_TEST_PHASES.DEGRADED, REST_TEST_PHASES.BASE_FAILURE].includes(state.phase)) return state;
      return {
        ...state,
        phase: REST_TEST_PHASES.PAUSED,
        resumePhase: state.phase === REST_TEST_PHASES.ACTIVE ? REST_TEST_PHASES.ACTIVE : REST_TEST_PHASES.POSITIONING,
        pauseCount: state.pauseCount + 1,
      };
    case "RESUME":
      if (state.phase !== REST_TEST_PHASES.PAUSED) return state;
      return { ...state, phase: state.resumePhase || REST_TEST_PHASES.POSITIONING, resumePhase: null };
    case "RESTART":
      return restartState(state);
    case "END_EARLY":
      return {
        ...state,
        phase: REST_TEST_PHASES.ENDED_EARLY,
        completionStatus: "incomplete",
        earlyExit: true,
        completedAt: action.completedAt || new Date().toISOString(),
      };
    case "BASE_FAILURE":
      return { ...state, phase: REST_TEST_PHASES.BASE_FAILURE, degraded: true };
    case "TRY_BASE_AGAIN":
      if (state.phase !== REST_TEST_PHASES.BASE_FAILURE) return state;
      return { ...state, phase: REST_TEST_PHASES.POSITIONING };
    case "CONTINUE_FLAT":
      return { ...state, phase: REST_TEST_PHASES.ACTIVE, degraded: true };
    case "RATE":
      return {
        ...state,
        ratings: {
          ...state.ratings,
          [action.field]: Math.max(1, Math.min(5, Number(action.value) || 1)),
        },
      };
    case "SET_PREFERRED_POSITION":
      return { ...state, preferredPosition: String(action.value || "") };
    case "SET_TEST_AGAIN":
      return { ...state, testAgain: String(action.value || "") };
    case "LOAD_LAB_STATE": {
      const stageByName = { back: 0, side: 1, zero: 3, snore: 4 };
      if (action.state === "completion") {
        return {
          ...createInitialRestTestState(state),
          phase: REST_TEST_PHASES.COMPLETED,
          completionStatus: "completed",
          completedStageIds: REST_TEST_STAGES.map((stage) => stage.id),
          overallActiveElapsedSeconds: getTotalActiveSeconds(state.durationId),
          stageIndex: REST_TEST_STAGES.length - 1,
          stageRemainingSeconds: 0,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      }
      const stageIndex = stageByName[action.state] ?? 0;
      return {
        ...createInitialRestTestState(state),
        phase: action.state === "paused" ? REST_TEST_PHASES.PAUSED : REST_TEST_PHASES.ACTIVE,
        resumePhase: action.state === "paused" ? REST_TEST_PHASES.ACTIVE : null,
        stageIndex,
        stageRemainingSeconds: Math.max(1, getStageDuration(state.durationId, stageIndex) - 8),
        completionStatus: "in_progress",
        startedAt: new Date().toISOString(),
      };
    }
    default:
      return state;
  }
}

export function buildRestTestRecord(state, identity = {}) {
  const stage = getRestTestStage(state.stageIndex);
  return {
    eventType: state.completionStatus === "completed" ? "rest_test.completed" : "rest_test.incomplete",
    eventVersion: 1,
    shopperId: identity.shopperId || null,
    sessionId: identity.sessionId || null,
    snoozeCode: identity.snoozeCode || identity.accessCode || null,
    podId: identity.podId || null,
    mattressId: identity.mattressId || null,
    durationId: state.durationId,
    durationSeconds: getTotalActiveSeconds(state.durationId),
    completedStageIds: state.completedStageIds,
    currentStageId: stage?.id || null,
    overallActiveElapsedSeconds: state.overallActiveElapsedSeconds,
    completionStatus: state.completionStatus,
    earlyExit: Boolean(state.earlyExit),
    pauseCount: state.pauseCount,
    ambientSound: state.ambienceId,
    preferredPosition: state.preferredPosition || null,
    comfortRating: state.ratings.comfort || null,
    pressureReliefRating: state.ratings.pressureRelief || null,
    supportRating: state.ratings.support || null,
    testAgain: state.testAgain || null,
    degraded: Boolean(state.degraded),
    startedAt: state.startedAt,
    completionTimestamp: state.completedAt || new Date().toISOString(),
  };
}

export function preloadRestTestVisuals(ImageCtor = globalThis.Image) {
  const sources = Array.from(new Set(REST_TEST_STAGES.map((stage) => stage.visual)));
  if (typeof ImageCtor !== "function") return Promise.resolve({ ok: false, skipped: true });
  return Promise.all(
    sources.map(
      (src) =>
        new Promise((resolve) => {
          const image = new ImageCtor();
          image.onload = () => resolve({ src, ok: true });
          image.onerror = () => resolve({ src, ok: false });
          image.src = src;
        })
    )
  ).then((results) => ({ ok: results.every((result) => result.ok), results }));
}
