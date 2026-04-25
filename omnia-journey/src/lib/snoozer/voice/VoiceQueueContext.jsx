import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { VoiceQueueController } from "./voiceQueue";

const VoiceQueueContext = createContext(null);

function buildDefaultVoiceState() {
  return {
    blocked: false,
    error: "",
    loading: false,
    playing: false,
    lastText: "",
  };
}

function readInitialMutedState() {
  try {
    return sessionStorage.getItem("snooze.hudMuted") === "1";
  } catch {
    return false;
  }
}

export function VoiceQueueProvider({
  children,
  fetchAudioForJob,
  onHudStateChange,
  onCaptionsChange,
  fadeOutMs = 250,
  maxCarryoverMs = 3000,
  captionGraceMs = 350,
}) {
  const controllerRef = useRef(null);
  const audioRef = useRef(null);
  const currentAudioCleanupRef = useRef(null);
  const captionTimerRef = useRef(null);
  const currentJobRef = useRef(null);
  const activeRunTokenRef = useRef(0);

  const [muted, setMutedState] = useState(readInitialMutedState);
  const [voiceState, setVoiceState] = useState(buildDefaultVoiceState);

  const [snapshot, setSnapshot] = useState({
    queue: [],
    currentJob: null,
    isBusy: false,
    pendingCount: 0,
    fadeOutMs,
    maxCarryoverMs,
    captionGraceMs,
  });

  if (!controllerRef.current) {
    controllerRef.current = new VoiceQueueController({
      fadeOutMs,
      maxCarryoverMs,
      captionGraceMs,
    });
  }

  const controller = controllerRef.current;

  useEffect(() => {
    return controller.subscribe((next) => {
      currentJobRef.current = next?.currentJob || null;
      setSnapshot(next);
    });
  }, [controller]);

  const setVoiceStatePartial = useCallback((patch) => {
    setVoiceState((prev) => ({
      ...prev,
      ...(typeof patch === "function" ? patch(prev) : patch),
    }));
  }, []);

  const resetVoiceState = useCallback(() => {
    setVoiceState(buildDefaultVoiceState());
  }, []);

  const clearCaptionTimer = useCallback(() => {
    if (captionTimerRef.current) {
      window.clearTimeout(captionTimerRef.current);
      captionTimerRef.current = null;
    }
  }, []);

  const persistMutedState = useCallback((value) => {
    try {
      sessionStorage.setItem("snooze.hudMuted", value ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  const detachAudioEvents = useCallback((audio) => {
    if (!audio) return;
    audio.onplay = null;
    audio.onpause = null;
    audio.onended = null;
    audio.onerror = null;
  }, []);

  const releaseCurrentAudioSource = useCallback(() => {
    const cleanup = currentAudioCleanupRef.current;
    currentAudioCleanupRef.current = null;

    if (typeof cleanup === "function") {
      try {
        cleanup();
      } catch {
        // ignore
      }
    }
  }, []);

  const releaseAudioElement = useCallback(
    (audio, { resetPlayback = false } = {}) => {
      const target = audio || audioRef.current;
      if (!target) {
        releaseCurrentAudioSource();
        return;
      }

      detachAudioEvents(target);

      if (resetPlayback) {
        try {
          target.pause();
          target.currentTime = 0;
        } catch {
          // ignore
        }
      }

      try {
        target.volume = 1;
      } catch {
        // ignore
      }

      try {
        target.removeAttribute?.("src");
        target.load?.();
      } catch {
        // ignore
      }

      if (audioRef.current === target) {
        audioRef.current = null;
      }

      releaseCurrentAudioSource();
    },
    [detachAudioEvents, releaseCurrentAudioSource]
  );

  const invalidateRunToken = useCallback(() => {
    activeRunTokenRef.current += 1;
    return activeRunTokenRef.current;
  }, []);

  const stopAudioElement = useCallback(
    async (fadeDurationMs = 0) => {
      const audio = audioRef.current;
      if (!audio) {
        releaseCurrentAudioSource();
        return;
      }

      audioRef.current = null;
      detachAudioEvents(audio);

      if (fadeDurationMs > 0) {
        const startVolume = Number.isFinite(audio.volume) ? audio.volume : 1;
        const stepMs = 25;
        const steps = Math.max(Math.floor(fadeDurationMs / stepMs), 1);
        let currentStep = 0;

        await new Promise((resolve) => {
          const intervalId = window.setInterval(() => {
            currentStep += 1;
            const nextVolume = Math.max(startVolume * (1 - currentStep / steps), 0);
            audio.volume = nextVolume;

            if (currentStep >= steps) {
              window.clearInterval(intervalId);
              resolve();
            }
          }, stepMs);
        });
      }

      releaseAudioElement(audio, { resetPlayback: true });
    },
    [detachAudioEvents, releaseAudioElement, releaseCurrentAudioSource]
  );

  const syncHudFromJob = useCallback(
    (job, phase = "speaking") => {
      if (!job) {
        onHudStateChange?.("idle");
        onCaptionsChange?.("");
        return;
      }

      onHudStateChange?.(phase);
      onCaptionsChange?.(job.captions || job.speech || "");
    },
    [onCaptionsChange, onHudStateChange]
  );

  const maybeRunNextRef = useRef(null);

  const completeCurrentAndContinue = useCallback(
    (jobId) => {
      const live = controller.getSnapshot().currentJob;
      if (!live || (jobId && live.id !== jobId)) return;

      clearCaptionTimer();
      controller.completeCurrent("done");
      currentJobRef.current = null;
      releaseAudioElement(audioRef.current, { resetPlayback: false });
      syncHudFromJob(null);
      setVoiceStatePartial({
        loading: false,
        playing: false,
        error: "",
      });
      maybeRunNextRef.current?.();
    },
    [controller, clearCaptionTimer, releaseAudioElement, syncHudFromJob, setVoiceStatePartial]
  );

  const failCurrentAndContinue = useCallback(
    (jobId, message = "Audio playback failed.") => {
      const live = controller.getSnapshot().currentJob;
      if (!live || (jobId && live.id !== jobId)) return;

      clearCaptionTimer();
      controller.failCurrent("failed");
      currentJobRef.current = null;
      releaseAudioElement(audioRef.current, { resetPlayback: true });
      syncHudFromJob(null);
      setVoiceStatePartial({
        loading: false,
        playing: false,
        error: message,
      });
      maybeRunNextRef.current?.();
    },
    [controller, clearCaptionTimer, releaseAudioElement, syncHudFromJob, setVoiceStatePartial]
  );

  const scheduleCaptionsOnlyCompletion = useCallback(
    (job) => {
      if (!job) return;

      clearCaptionTimer();
      const startedAt = Number(job.startedAt || job.createdAt || Date.now());
      const elapsedMs = Math.max(Date.now() - startedAt, 0);
      const totalMs = Math.max(
        Number(job.durationMs || job.ttlMs || 5000) || 5000,
        1200
      );
      const remainingMs = Math.max(totalMs - elapsedMs + controller.captionGraceMs, 1200);
      captionTimerRef.current = window.setTimeout(() => {
        const live = controller.getSnapshot().currentJob;
        if (!live || live.id !== job.id) return;
        completeCurrentAndContinue(job.id);
      }, remainingMs);
    },
    [clearCaptionTimer, controller, completeCurrentAndContinue]
  );

  const degradeCurrentToCaptions = useCallback(
    (jobId, { blocked = false, errorMessage = "" } = {}) => {
      const live = controller.getSnapshot().currentJob;
      if (!live || (jobId && live.id !== jobId)) return false;

      clearCaptionTimer();
      releaseAudioElement(audioRef.current, { resetPlayback: false });
      controller.markCaptionsOnly(live.id);

      const fresh = controller.getSnapshot().currentJob;
      if (!fresh || fresh.id !== live.id) return false;

      syncHudFromJob(fresh, "speaking");

      if (!fresh.startedAt) {
        controller.markStarted(fresh.id);
      }

      setVoiceStatePartial({
        loading: false,
        playing: false,
        blocked: Boolean(blocked),
        error: errorMessage ? String(errorMessage) : "",
      });

      scheduleCaptionsOnlyCompletion(
        controller.getSnapshot().currentJob || fresh
      );

      return true;
    },
    [
      clearCaptionTimer,
      controller,
      releaseAudioElement,
      scheduleCaptionsOnlyCompletion,
      setVoiceStatePartial,
      syncHudFromJob,
    ]
  );

  const maybeRunNext = useCallback(async () => {
    const liveSnapshot = controller.getSnapshot();
    if (liveSnapshot.currentJob) return;

    const job = controller.promoteNext();
    if (!job) {
      currentJobRef.current = null;
      syncHudFromJob(null);
      setVoiceStatePartial({
        loading: false,
        playing: false,
      });
      return;
    }

    const runToken = invalidateRunToken();
    const isActiveRun = () => {
      const live = controller.getSnapshot().currentJob;
      return activeRunTokenRef.current === runToken && live?.id === job.id;
    };

    currentJobRef.current = job;

    syncHudFromJob(job, "thinking");
    setVoiceStatePartial({
      blocked: false,
      error: "",
      loading: true,
      playing: false,
      lastText: String(job.captions || job.speech || ""),
    });

    controller.startPreparing(job.id);

    if (muted) {
      if (!isActiveRun()) return;

      controller.markCaptionsOnly(job.id);
      const freshMutedJob = controller.getSnapshot().currentJob;
      if (!freshMutedJob || freshMutedJob.id !== job.id || !isActiveRun()) return;

      syncHudFromJob(freshMutedJob, "speaking");
      controller.markStarted(freshMutedJob.id);
      setVoiceStatePartial({
        loading: false,
        playing: false,
        error: "",
      });
      scheduleCaptionsOnlyCompletion(freshMutedJob);
      return;
    }

    let audioPayload = null;
    try {
      audioPayload = await fetchAudioForJob?.(job);
    } catch (error) {
      if (isActiveRun()) {
        console.warn("[VoiceQueue] fetchAudioForJob failed:", error);
      }
    }

    if (!isActiveRun()) {
      try {
        audioPayload?.cleanup?.();
      } catch {
        // ignore
      }
      return;
    }

    if (audioPayload?.audioUrl) {
      controller.attachAudio(job.id, audioPayload.audioUrl, audioPayload.durationMs ?? null);
    } else {
      controller.markCaptionsOnly(job.id);
    }

    const fresh = controller.getSnapshot().currentJob;
    if (!fresh || fresh.id !== job.id || !isActiveRun()) {
      try {
        audioPayload?.cleanup?.();
      } catch {
        // ignore
      }
      return;
    }

    if (!fresh.audioUrl) {
      degradeCurrentToCaptions(fresh.id);
      return;
    }

    try {
      const audio = new Audio(fresh.audioUrl);
      audioRef.current = audio;
      currentAudioCleanupRef.current =
        typeof audioPayload?.cleanup === "function" ? audioPayload.cleanup : null;

      audio.onended = () => {
        if (!isActiveRun()) return;
        completeCurrentAndContinue(job.id);
      };

      audio.onerror = () => {
        if (!isActiveRun()) return;
        console.warn("[VoiceQueue] audio playback degraded to captions-only");
        degradeCurrentToCaptions(job.id);
      };

      syncHudFromJob(fresh, "speaking");
      controller.markStarted(fresh.id);
      controller.markPlaying(fresh.id);

      setVoiceStatePartial({
        loading: false,
        playing: true,
        error: "",
      });

      await audio.play();
    } catch (error) {
      if (!isActiveRun()) {
        try {
          audioPayload?.cleanup?.();
        } catch {
          // ignore
        }
        return;
      }

      console.error("[VoiceQueue] audio.play() failed:", error);
      releaseAudioElement(audioRef.current, { resetPlayback: false });
      controller.markCaptionsOnly(fresh.id);
      syncHudFromJob(fresh, "speaking");

      const isAutoplayBlock =
        /play\(\) failed|user didn't interact|notallowederror|gesture/i.test(
          String(error?.message || "")
        );

      degradeCurrentToCaptions(fresh.id, {
        blocked: isAutoplayBlock,
        errorMessage: "",
      });
    }
  }, [
    controller,
    degradeCurrentToCaptions,
    fetchAudioForJob,
    muted,
    scheduleCaptionsOnlyCompletion,
    setVoiceStatePartial,
    syncHudFromJob,
    invalidateRunToken,
    completeCurrentAndContinue,
    releaseAudioElement,
  ]);

  maybeRunNextRef.current = maybeRunNext;

  useEffect(() => {
    const live = controller.getSnapshot();
    if (!live.currentJob && live.queue.length > 0) {
      maybeRunNext();
    }
  }, [snapshot.queue.length, snapshot.currentJob, controller, maybeRunNext]);

  const enqueueHudResponse = useCallback(
    async (response) => {
      if (!response || typeof response !== "object") return null;

      const speech = String(response.speech || "").trim();
      const captions = String(response.captions || response.speech || "").trim();
      const incomingPriority =
        response.priority === "high"
          ? "high"
          : response.priority === "low"
            ? "low"
            : "normal";

      if (!speech && !captions) return null;

      const liveCurrentJob = controller.getSnapshot().currentJob;
      const activeCritical = liveCurrentJob?.priority === "high";
      const forceRequested =
        response.replaceCurrent === true ||
        response.force === true ||
        incomingPriority === "high";
      const canInterruptCritical =
        response.allowInterruptActiveHigh === true || incomingPriority === "high";
      const shouldReplace =
        forceRequested && (!activeCritical || canInterruptCritical);

      if (shouldReplace) {
        clearCaptionTimer();
        invalidateRunToken();
        await stopAudioElement(fadeOutMs);
        controller.interruptCurrent({ preserveQueue: false, reason: "replaced" });
        controller.clearQueue();
        currentJobRef.current = null;
        syncHudFromJob(null);
        setVoiceStatePartial({
          loading: false,
          playing: false,
          blocked: false,
          error: "",
          lastText: "",
        });
      }

      const job = controller.enqueue({
        speech,
        captions,
        state: response.state || "speaking",
        priority: incomingPriority,
        ttlMs: response.ttlMs || 5000,
        actions: Array.isArray(response.actions) ? response.actions : [],
        voiceStyle: response.voiceStyle || "default",
        allowContinuation: response.allowContinuation === true,
        interruptible: response.interruptible !== false,
        metadata: response.metadata || {},
      });

      setVoiceStatePartial({
        blocked: false,
        error: "",
        lastText: captions || speech,
      });

      maybeRunNextRef.current?.();
      return job;
    },
    [
      controller,
      clearCaptionTimer,
      invalidateRunToken,
      stopAudioElement,
      syncHudFromJob,
      setVoiceStatePartial,
      fadeOutMs,
    ]
  );

  const interruptCurrent = useCallback(
    async ({ preserveQueue = true, reason = "cancelled", fadeMs } = {}) => {
      clearCaptionTimer();
      invalidateRunToken();
      await stopAudioElement(
        Number.isFinite(fadeMs) ? fadeMs : controller.fadeOutMs
      );
      controller.interruptCurrent({ preserveQueue, reason });
      currentJobRef.current = null;
      syncHudFromJob(null);
      setVoiceStatePartial({
        loading: false,
        playing: false,
        blocked: false,
        error: "",
        lastText: "",
      });

      if (preserveQueue) {
        maybeRunNextRef.current?.();
      }
    },
    [clearCaptionTimer, controller, invalidateRunToken, stopAudioElement, syncHudFromJob, setVoiceStatePartial]
  );

  const handleRouteChange = useCallback(
    async ({ stop = true, clearQueue = true, fadeMs } = {}) => {
      if (!stop) return;

      clearCaptionTimer();
      invalidateRunToken();
      await stopAudioElement(Number.isFinite(fadeMs) ? fadeMs : controller.fadeOutMs);
      controller.interruptCurrent({
        preserveQueue: !clearQueue,
        reason: "route-change",
      });

      if (clearQueue) {
        controller.clearQueue();
      }

      currentJobRef.current = null;
      syncHudFromJob(null);
      setVoiceStatePartial({
        loading: false,
        playing: false,
        blocked: false,
        error: "",
        lastText: "",
      });
    },
    [clearCaptionTimer, controller, invalidateRunToken, stopAudioElement, syncHudFromJob, setVoiceStatePartial]
  );

  const clearAll = useCallback(async () => {
    clearCaptionTimer();
    invalidateRunToken();
    await stopAudioElement(0);
    controller.interruptCurrent({ preserveQueue: false, reason: "cancelled" });
    controller.clearQueue();
    currentJobRef.current = null;
    syncHudFromJob(null);
    resetVoiceState();
  }, [clearCaptionTimer, controller, invalidateRunToken, stopAudioElement, syncHudFromJob, resetVoiceState]);

  const replayCurrent = useCallback(async () => {
    const current = currentJobRef.current || snapshot.currentJob;
    if (!current) return null;

    await clearAll();

    return enqueueHudResponse({
      speech: current.speech || "",
      captions: current.captions || current.speech || "",
      state: current.state || "speaking",
      priority: "normal",
      ttlMs: current.ttlMs || 5000,
      actions: Array.isArray(current.actions) ? current.actions : [],
      voiceStyle: current.voiceStyle || "default",
      interruptible: true,
      metadata: current.metadata || {},
      replaceCurrent: true,
    });
  }, [snapshot.currentJob, clearAll, enqueueHudResponse]);

  const replay = replayCurrent;

  const setMuted = useCallback(
    (nextMuted) => {
      const value = Boolean(nextMuted);
      persistMutedState(value);
      setMutedState(value);

      if (!value) {
        maybeRunNextRef.current?.();
        return;
      }

      clearCaptionTimer();
      invalidateRunToken();

      stopAudioElement(0).catch(() => {});

      const live = controller.getSnapshot().currentJob;
      if (live) {
        controller.markCaptionsOnly(live.id);
        const fresh = controller.getSnapshot().currentJob;
        if (fresh) {
          syncHudFromJob(fresh, "speaking");
          controller.markStarted(fresh.id);
          scheduleCaptionsOnlyCompletion(fresh);
        }
      }

      setVoiceStatePartial({
        loading: false,
        playing: false,
        blocked: false,
        error: "",
      });
    },
    [
      persistMutedState,
      clearCaptionTimer,
      invalidateRunToken,
      stopAudioElement,
      controller,
      syncHudFromJob,
      scheduleCaptionsOnlyCompletion,
      setVoiceStatePartial,
    ]
  );

  const noteUserInteraction = useCallback(() => {
    setVoiceStatePartial({
      blocked: false,
    });
  }, [setVoiceStatePartial]);

  useEffect(() => {
    return () => {
      clearCaptionTimer();
      invalidateRunToken();
      stopAudioElement(0).catch(() => {});
    };
  }, [clearCaptionTimer, invalidateRunToken, stopAudioElement]);

  const value = useMemo(
    () => ({
      ...snapshot,
      muted,
      voiceState,
      enqueueHudResponse,
      enqueue: enqueueHudResponse,
      replayCurrent,
      replay,
      interruptCurrent,
      setMuted,
      handleRouteChange,
      clearAll,
      noteUserInteraction,
      onUserInteraction: noteUserInteraction,
    }),
    [
      snapshot,
      muted,
      voiceState,
      enqueueHudResponse,
      replayCurrent,
      replay,
      interruptCurrent,
      setMuted,
      handleRouteChange,
      clearAll,
      noteUserInteraction,
    ]
  );

  return <VoiceQueueContext.Provider value={value}>{children}</VoiceQueueContext.Provider>;
}

export function useVoiceQueue() {
  const context = useContext(VoiceQueueContext);

  if (!context) {
    throw new Error("useVoiceQueue must be used inside VoiceQueueProvider");
  }

  return context;
}
