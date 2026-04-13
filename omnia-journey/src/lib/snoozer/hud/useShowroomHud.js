import { useCallback, useMemo } from "react";
import { useVoiceQueue } from "../voice/VoiceQueueContext";
import { fetchHudScript } from "./fetchHudScript";

function normalizeHudPayload(hudPayload = {}) {
  return {
    speech: String(hudPayload?.speech || "").trim(),
    captions: String(hudPayload?.captions || hudPayload?.speech || "").trim(),
    state: hudPayload?.state || "speaking",
    priority: hudPayload?.priority || "normal",
    ttlMs: Number(hudPayload?.ttlMs) || 5000,
    actions: Array.isArray(hudPayload?.actions) ? hudPayload.actions : [],
    voiceStyle: hudPayload?.voiceStyle || "default",
    allowContinuation: hudPayload?.allowContinuation === true,
    interruptible: hudPayload?.interruptible !== false,
    metadata: hudPayload?.metadata || {},
    replaceCurrent: hudPayload?.replaceCurrent === true,
    force: hudPayload?.force === true,
  };
}

export function useShowroomHud() {
  const voice = useVoiceQueue();

  const enqueueRunner = useMemo(() => {
    return (
      voice?.enqueueHudResponse ||
      voice?.enqueue ||
      voice?.push ||
      voice?.say ||
      voice?.speak ||
      voice?.play ||
      null
    );
  }, [voice]);

  const interrupt = useMemo(() => {
    return (
      voice?.interruptCurrent ||
      voice?.interrupt ||
      voice?.stopCurrent ||
      voice?.stop ||
      null
    );
  }, [voice]);

  const routeChangeRunner = useMemo(() => {
    return voice?.handleRouteChange || null;
  }, [voice]);

  const clearAll = useMemo(() => {
    return voice?.clearAll || voice?.clear || null;
  }, [voice]);

  const setMutedRunner = useMemo(() => {
    return voice?.setMuted || null;
  }, [voice]);

  const noteUserInteraction = useMemo(() => {
    return voice?.noteUserInteraction || voice?.onUserInteraction || null;
  }, [voice]);

  const say = useCallback(
    (hudPayload) => {
      const payload = normalizeHudPayload(hudPayload);

      if (!payload.speech && !payload.captions) {
        return Promise.resolve(null);
      }

      if (typeof enqueueRunner !== "function") {
        console.warn("Showroom HUD voice queue is unavailable.");
        return Promise.resolve(null);
      }

      return enqueueRunner(payload);
    },
    [enqueueRunner]
  );

  const sayScript = useCallback(
    async (scriptKeyOrInput, options = {}) => {
      const input =
        scriptKeyOrInput && typeof scriptKeyOrInput === "object"
          ? scriptKeyOrInput
          : { ...options, scriptKey: scriptKeyOrInput };

      const scriptKey = String(input?.scriptKey || "").trim();
      const fallback = input?.fallback || null;
      const shopperId = input?.shopperId || "guest";
      const context =
        input?.context && typeof input.context === "object" ? input.context : {};

      let scriptedPayload = null;

      if (scriptKey) {
        scriptedPayload = await fetchHudScript({
          scriptKey,
          shopperId,
          context,
        }).catch(() => null);
      }

      const basePayload = scriptedPayload || fallback;
      if (!basePayload) return null;

      const merged = {
        ...(basePayload && typeof basePayload === "object"
          ? basePayload
          : {
              speech: String(basePayload || "").trim(),
              captions: String(basePayload || "").trim(),
            }),
        ...(input?.overrides && typeof input.overrides === "object"
          ? input.overrides
          : {}),
      };

      if (Array.isArray(input?.actions)) {
        merged.actions = input.actions;
      }

      if (input?.metadata && typeof input.metadata === "object") {
        merged.metadata = {
          ...(merged.metadata && typeof merged.metadata === "object"
            ? merged.metadata
            : {}),
          ...input.metadata,
        };
      }

      if (scriptKey) {
        merged.metadata = {
          ...(merged.metadata && typeof merged.metadata === "object"
            ? merged.metadata
            : {}),
          scriptKey,
        };
      }

      return await say(merged);
    },
    [say]
  );

  const interruptCurrent = useCallback(
    (options = {}) => {
      if (typeof interrupt === "function") {
        return interrupt(options);
      }
      return Promise.resolve(null);
    },
    [interrupt]
  );

  const stopForRouteEntry = useCallback(
    (options = {}) => {
      if (typeof routeChangeRunner === "function") {
        return routeChangeRunner({
          stop: true,
          clearQueue: options?.clearQueue !== false,
          fadeMs: options?.fadeMs,
        });
      }

      if (typeof interrupt === "function") {
        return interrupt({
          preserveQueue: options?.clearQueue === false,
          reason: "route-change",
          fadeMs: options?.fadeMs,
        });
      }

      return Promise.resolve(null);
    },
    [routeChangeRunner, interrupt]
  );

  const replay = useCallback(() => {
    if (typeof voice?.replayCurrent === "function") {
      return voice.replayCurrent();
    }

    if (typeof voice?.replay === "function") {
      return voice.replay();
    }

    const currentText =
      String(voice?.currentJob?.speech || "").trim() ||
      String(voice?.currentJob?.captions || "").trim();

    if (!currentText) return Promise.resolve(null);

    return say({
      speech: voice?.currentJob?.speech || currentText,
      captions: voice?.currentJob?.captions || currentText,
      state: voice?.currentJob?.state || "speaking",
      priority: "normal",
      ttlMs: Number(voice?.currentJob?.ttlMs) || 5000,
      actions: Array.isArray(voice?.currentJob?.actions)
        ? voice.currentJob.actions
        : [],
      voiceStyle: voice?.currentJob?.voiceStyle || "default",
      allowContinuation: false,
      interruptible: true,
      metadata: voice?.currentJob?.metadata || {},
      replaceCurrent: true,
      force: true,
    });
  }, [voice, say]);

  const setMuted = useCallback(
    (nextMuted) => {
      if (typeof setMutedRunner === "function") {
        return setMutedRunner(nextMuted);
      }
      return null;
    },
    [setMutedRunner]
  );

  return {
    say,
    sayScript,
    replay,
    interruptCurrent,
    stopForRouteEntry,
    handleRouteChange: routeChangeRunner,
    clearAll,
    muted: Boolean(voice?.muted),
    setMuted,
    noteUserInteraction,
    currentJob: voice?.currentJob || null,
    queue: Array.isArray(voice?.queue) ? voice.queue : [],
    voiceState: voice?.voiceState || {
      blocked: false,
      error: "",
      loading: false,
      playing: false,
      lastText: "",
    },
  };
}

export default useShowroomHud;
