import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { createAmbientAudioController } from "@/iot/ambientAudioController";
import {
  REST_TEST_AMBIENCE,
  REST_TEST_AUDIO_CONFIG,
  REST_TEST_BASE_FAILURE_SPEECH,
  REST_TEST_COMPLETION_SPEECH,
  REST_TEST_PHASES,
  REST_TEST_RESUME_SPEECH,
  buildRestTestRecord,
  createInitialRestTestState,
  getRestTestDuration,
  getRestTestStage,
  getRestTestTrackForStage,
  getStageDuration,
  isRestTestUnfinished,
  preloadRestTestVisuals,
  restTestReducer,
  restoreRestTestState,
} from "@/lib/restTestProgram.mjs";

const EVENT_STORAGE_KEY = "snooze.restTestEvents.v1";

function readJson(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Rest Test remains available when storage is blocked.
  }
}

function upsertRestTestRecord(record) {
  if (!record?.startedAt) return;
  const records = readJson(EVENT_STORAGE_KEY);
  const list = Array.isArray(records) ? records : [];
  const eventId = `${record.podId || "pod"}::${record.startedAt}`;
  const nextRecord = { ...record, eventId };
  const index = list.findIndex((item) => item?.eventId === eventId);
  const next = index >= 0
    ? list.map((item, itemIndex) => (itemIndex === index ? nextRecord : item))
    : [...list, nextRecord];
  writeJson(EVENT_STORAGE_KEY, next.slice(-20));
}

function loadInitialState(storageKey) {
  const persisted = readJson(storageKey);
  return persisted ? restoreRestTestState(persisted) : createInitialRestTestState();
}

function hudPayload(speech, { state = "speaking", priority = "normal", ttlMs = 6500 } = {}) {
  return {
    speech,
    captions: speech,
    state,
    priority,
    ttlMs,
    actions: [],
  };
}

export function useGuidedRestTest({
  storageKey,
  identity,
  speakPod,
  cancelPodVoice,
  voiceState,
  onEarlyExit,
} = {}) {
  const [state, dispatch] = useReducer(restTestReducer, storageKey, loadInitialState);
  const [visualsReady, setVisualsReady] = useState(false);
  const [visualAvailability, setVisualAvailability] = useState({});
  const audioRef = useRef(null);
  const spokenStageKeyRef = useRef("");
  const completionSpokenRef = useRef(false);
  const earlyExitHandledRef = useRef(false);
  const interjectionSpokenRef = useRef(new Set());

  if (!audioRef.current) {
    audioRef.current = createAmbientAudioController({
      track: REST_TEST_AMBIENCE.waves.src,
      volume: REST_TEST_AUDIO_CONFIG.volume,
      duckMultiplier: REST_TEST_AUDIO_CONFIG.duckMultiplier,
    });
  }

  const stage = useMemo(() => getRestTestStage(state.stageIndex), [state.stageIndex]);
  const duration = useMemo(() => getRestTestDuration(state.durationId), [state.durationId]);
  const unfinished = isRestTestUnfinished(state);
  const isActive = [
    REST_TEST_PHASES.STARTING,
    REST_TEST_PHASES.POSITIONING,
    REST_TEST_PHASES.ACTIVE,
    REST_TEST_PHASES.PAUSED,
    REST_TEST_PHASES.DEGRADED,
    REST_TEST_PHASES.BASE_FAILURE,
  ].includes(state.phase);

  useEffect(() => {
    let mounted = true;
    preloadRestTestVisuals().then((result) => {
      if (!mounted) return;
      setVisualsReady(true);
      setVisualAvailability(
        Object.fromEntries((result.results || []).map((item) => [item.src, Boolean(item.ok)]))
      );
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    writeJson(storageKey, state);
    if ([REST_TEST_PHASES.COMPLETED, REST_TEST_PHASES.ENDED_EARLY].includes(state.phase)) {
      const record = buildRestTestRecord(state, identity);
      upsertRestTestRecord(record);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("mysnoozepod:rest-test-recorded", { detail: record })
        );
      }
    }
  }, [identity, state, storageKey]);

  useEffect(() => {
    const speaking = Boolean(voiceState?.playing || voiceState?.loading);
    if (speaking) {
      audioRef.current?.duck();
    } else {
      audioRef.current?.restore();
    }
    if (state.musicDucked !== speaking) {
      dispatch({ type: "SET_MUSIC_DUCKED", ducked: speaking });
    }
  }, [state.musicDucked, voiceState?.loading, voiceState?.playing]);

  useEffect(() => {
    if (state.phase !== REST_TEST_PHASES.ACTIVE) return undefined;
    const timerId = window.setInterval(() => {
      dispatch({ type: "TICK", audioSnapshot: audioRef.current?.getSnapshot() });
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [state.phase]);

  useEffect(() => {
    if (![REST_TEST_PHASES.POSITIONING, REST_TEST_PHASES.ACTIVE, REST_TEST_PHASES.DEGRADED, REST_TEST_PHASES.BASE_FAILURE].includes(state.phase)) return;
    const track = getRestTestTrackForStage(state.stageIndex);
    const snapshot = audioRef.current?.getSnapshot();
    if (snapshot?.track !== track.src) {
      audioRef.current?.start(track.src, {
        fadeMs: state.stageIndex === 3 ? REST_TEST_AUDIO_CONFIG.crossfadeMs : REST_TEST_AUDIO_CONFIG.startFadeMs,
      });
      dispatch({ type: "SYNC_AUDIO", snapshot: audioRef.current?.getSnapshot() });
    }
  }, [state.phase, state.stageIndex]);

  useEffect(() => {
    if (state.phase !== REST_TEST_PHASES.POSITIONING) return;
    const key = `${state.startedAt || "new"}::${stage.id}`;
    if (spokenStageKeyRef.current === key) return;
    spokenStageKeyRef.current = key;
    let cancelled = false;
    dispatch({ type: "SET_OPENING_SPEECH_ACTIVE", active: true });
    void (async () => {
      await cancelPodVoice?.({ resetKeys: true });
      await speakPod?.(stage.speech, {
        ...hudPayload(stage.speech, { priority: state.stageIndex === 0 ? "high" : "normal" }),
        actionType: "start_rest_test",
        force: true,
        calm: true,
        preservePriority: true,
        key: `guided-rest-stage::${key}`,
      });
    })()
      .catch(() => null)
      .finally(() => {
        if (!cancelled) dispatch({ type: "SET_OPENING_SPEECH_ACTIVE", active: false });
      });
    return () => {
      cancelled = true;
    };
  }, [cancelPodVoice, speakPod, stage, state.phase, state.stageIndex, state.startedAt]);

  useEffect(() => {
    if (state.phase !== REST_TEST_PHASES.ACTIVE || state.stageActiveElapsedSeconds < 30) return;
    if (state.openingSpeechActive || voiceState?.playing || voiceState?.loading) return;
    if (state.interjectionFiredStageIds.includes(stage.id) || interjectionSpokenRef.current.has(stage.id)) return;
    interjectionSpokenRef.current.add(stage.id);
    dispatch({ type: "MARK_INTERJECTION_FIRED", stageId: stage.id });
    void speakPod?.(stage.interjection, {
      ...hudPayload(stage.interjection, { state: "speaking", priority: "normal", ttlMs: 6500 }),
      actionType: "rest_test_interjection",
      force: true,
      calm: true,
      preservePriority: true,
      key: `guided-rest-interjection::${state.startedAt}::${stage.id}`,
    });
  }, [speakPod, stage, state.interjectionFiredStageIds, state.openingSpeechActive, state.phase, state.stageActiveElapsedSeconds, state.startedAt, voiceState?.loading, voiceState?.playing]);

  useEffect(() => {
    if (state.phase === REST_TEST_PHASES.PAUSED) {
      audioRef.current?.pause({ fadeMs: 280 });
      void cancelPodVoice?.({ resetKeys: false });
    }
    if (state.phase === REST_TEST_PHASES.COMPLETED) {
      audioRef.current?.stop({ fadeMs: 1000 });
      if (!completionSpokenRef.current) {
        completionSpokenRef.current = true;
        void (async () => {
          await cancelPodVoice?.({ resetKeys: true });
          await speakPod?.(REST_TEST_COMPLETION_SPEECH, {
            ...hudPayload(REST_TEST_COMPLETION_SPEECH, { state: "celebrate", priority: "high" }),
            force: true,
            calm: true,
            preservePriority: true,
            key: `guided-rest-complete::${state.startedAt}`,
          });
        })().catch(() => null);
      }
    }
    if (state.phase === REST_TEST_PHASES.ENDED_EARLY) {
      audioRef.current?.stop({ fadeMs: 650 });
      void cancelPodVoice?.({ resetKeys: true });
      if (!earlyExitHandledRef.current) {
        earlyExitHandledRef.current = true;
        window.setTimeout(() => onEarlyExit?.(), 100);
      }
    }
    if (state.phase === REST_TEST_PHASES.READY) {
      completionSpokenRef.current = false;
      earlyExitHandledRef.current = false;
      spokenStageKeyRef.current = "";
      interjectionSpokenRef.current.clear();
      audioRef.current?.stop({ fadeMs: 350 });
    }
  }, [cancelPodVoice, onEarlyExit, speakPod, state.phase, state.startedAt]);

  useEffect(() => () => audioRef.current?.stop(), []);

  const selectDuration = useCallback((durationId) => dispatch({ type: "SET_DURATION", durationId }), []);
  const begin = useCallback(() => {
    // Keep play() in the direct click call stack so browser autoplay policy is satisfied.
    audioRef.current?.start(REST_TEST_AMBIENCE.waves.src, { fadeMs: REST_TEST_AUDIO_CONFIG.startFadeMs });
    dispatch({
      type: "BEGIN",
      startedAt: new Date().toISOString(),
      audioSnapshot: audioRef.current?.getSnapshot(),
    });
  }, []);
  const positionReady = useCallback(() => dispatch({ type: "POSITION_READY" }), []);
  const pause = useCallback(() => {
    audioRef.current?.pause({ fadeMs: 280 });
    dispatch({ type: "PAUSE" });
  }, []);
  const resume = useCallback(() => {
    audioRef.current?.resume();
    dispatch({ type: "RESUME" });
    void speakPod?.(REST_TEST_RESUME_SPEECH, {
      ...hudPayload(REST_TEST_RESUME_SPEECH, { priority: "low", ttlMs: 4200 }),
      calm: true,
      key: `guided-rest-resume::${state.startedAt}::${state.pauseCount}`,
    });
  }, [speakPod, state.pauseCount, state.startedAt]);
  const restart = useCallback(() => {
    void cancelPodVoice?.({ resetKeys: true });
    audioRef.current?.stop({ fadeMs: 350 });
    spokenStageKeyRef.current = "";
    interjectionSpokenRef.current.clear();
    completionSpokenRef.current = false;
    dispatch({ type: "RESTART" });
  }, [cancelPodVoice]);
  const endEarly = useCallback(() => {
    audioRef.current?.stop({ fadeMs: 650 });
    dispatch({ type: "END_EARLY", completedAt: new Date().toISOString() });
  }, []);
  const reportBaseFailure = useCallback(() => {
    dispatch({ type: "BASE_FAILURE" });
    void speakPod?.(REST_TEST_BASE_FAILURE_SPEECH, {
      ...hudPayload(REST_TEST_BASE_FAILURE_SPEECH, { state: "warning", priority: "high" }),
      force: true,
      key: `guided-rest-base-failure::${state.startedAt}::${state.stageIndex}`,
    });
  }, [speakPod, state.stageIndex, state.startedAt]);
  const continueFlat = useCallback(() => dispatch({ type: "CONTINUE_FLAT" }), []);
  const tryBaseAgain = useCallback(() => dispatch({ type: "TRY_BASE_AGAIN" }), []);
  const rate = useCallback((field, value) => dispatch({ type: "RATE", field, value }), []);
  const setPreferredPosition = useCallback((value) => dispatch({ type: "SET_PREFERRED_POSITION", value }), []);
  const setTestAgain = useCallback((value) => dispatch({ type: "SET_TEST_AGAIN", value }), []);
  const setLabState = useCallback((labState) => dispatch({ type: "LOAD_LAB_STATE", state: labState }), []);
  const saveFavorite = useCallback(() => {
    const record = { ...buildRestTestRecord(state, identity), favorite: true };
    writeJson(`snooze.restTestFavorite.${identity?.mattressId || identity?.podId || "current"}`, record);
    upsertRestTestRecord(record);
    return record;
  }, [identity, state]);

  return {
    state,
    stage,
    duration,
    unfinished,
    isActive,
    visualsReady,
    visualAvailability,
    audioSnapshot: audioRef.current?.getSnapshot(),
    selectDuration,
    begin,
    positionReady,
    pause,
    resume,
    restart,
    endEarly,
    reportBaseFailure,
    continueFlat,
    tryBaseAgain,
    rate,
    setPreferredPosition,
    setTestAgain,
    saveFavorite,
    setLabState,
    stageTotalSeconds: getStageDuration(state.durationId, state.stageIndex),
    overallRemainingSeconds: Math.max(0, duration.totalSeconds - state.overallActiveElapsedSeconds),
  };
}

export default useGuidedRestTest;
