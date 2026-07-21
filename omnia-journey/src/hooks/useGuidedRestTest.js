import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { createAmbientAudioController } from "@/iot/ambientAudioController";
import {
  REST_TEST_AMBIENCE,
  REST_TEST_BASE_FAILURE_SPEECH,
  REST_TEST_COMPLETION_SPEECH,
  REST_TEST_PHASES,
  REST_TEST_RESUME_SPEECH,
  buildRestTestRecord,
  createInitialRestTestState,
  getRestTestDuration,
  getRestTestStage,
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
  const [visualsAvailable, setVisualsAvailable] = useState(true);
  const audioRef = useRef(null);
  const spokenStageKeyRef = useRef("");
  const completionSpokenRef = useRef(false);
  const earlyExitHandledRef = useRef(false);

  if (!audioRef.current) {
    audioRef.current = createAmbientAudioController({
      track: REST_TEST_AMBIENCE[state.ambienceId].src,
      volume: state.volume,
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
      setVisualsAvailable(result.ok !== false);
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
    audioRef.current?.setTrack(REST_TEST_AMBIENCE[state.ambienceId].src);
    audioRef.current?.setVolume(state.volume);
    audioRef.current?.setMuted(state.muted);
  }, [state.ambienceId, state.muted, state.volume]);

  useEffect(() => {
    if (voiceState?.playing || voiceState?.loading) {
      audioRef.current?.duck();
    } else {
      audioRef.current?.restore();
    }
  }, [voiceState?.loading, voiceState?.playing]);

  useEffect(() => {
    if (state.phase !== REST_TEST_PHASES.ACTIVE) return undefined;
    const timerId = window.setInterval(() => dispatch({ type: "TICK" }), 1000);
    return () => window.clearInterval(timerId);
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== REST_TEST_PHASES.POSITIONING) return;
    const key = `${state.startedAt || "new"}::${stage.id}`;
    if (spokenStageKeyRef.current === key) return;
    spokenStageKeyRef.current = key;
    audioRef.current?.start(REST_TEST_AMBIENCE[state.ambienceId].src, { fadeMs: 700 });
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
    })().catch(() => null);
  }, [cancelPodVoice, speakPod, stage, state.ambienceId, state.phase, state.stageIndex, state.startedAt]);

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
      audioRef.current?.stop({ fadeMs: 350 });
    }
  }, [cancelPodVoice, onEarlyExit, speakPod, state.phase, state.startedAt]);

  useEffect(() => () => audioRef.current?.stop(), []);

  const selectDuration = useCallback((durationId) => dispatch({ type: "SET_DURATION", durationId }), []);
  const selectAmbience = useCallback((ambienceId) => dispatch({ type: "SET_AMBIENCE", ambienceId }), []);
  const setVolume = useCallback((volume) => dispatch({ type: "SET_VOLUME", volume }), []);
  const setMuted = useCallback((muted) => dispatch({ type: "SET_MUTED", muted }), []);
  const begin = useCallback(() => dispatch({ type: "BEGIN", startedAt: new Date().toISOString() }), []);
  const positionReady = useCallback(() => dispatch({ type: "POSITION_READY" }), []);
  const pause = useCallback(() => dispatch({ type: "PAUSE" }), []);
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
    completionSpokenRef.current = false;
    dispatch({ type: "RESTART" });
  }, [cancelPodVoice]);
  const endEarly = useCallback(() => dispatch({ type: "END_EARLY", completedAt: new Date().toISOString() }), []);
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
  const previewAmbience = useCallback((ambienceId = state.ambienceId) => {
    const track = REST_TEST_AMBIENCE[ambienceId] || REST_TEST_AMBIENCE.waves;
    return audioRef.current?.preview(track.src);
  }, [state.ambienceId]);
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
    visualsAvailable,
    audioSnapshot: audioRef.current?.getSnapshot(),
    selectDuration,
    selectAmbience,
    setVolume,
    setMuted,
    previewAmbience,
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
