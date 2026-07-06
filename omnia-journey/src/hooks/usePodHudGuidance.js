import { useCallback, useRef } from "react";

import { useShowroomHud } from "@/lib/snoozer/hud/useShowroomHud";

export function usePodHudGuidance({ shopperId }) {
  const { muted, noteUserInteraction, say, sayScript, interruptCurrent, voiceState } =
    useShowroomHud();

  const lastPodVoiceKeyRef = useRef("");
  const lastRestVoiceKeyRef = useRef("");

  const speakPod = useCallback(
    async (
      text,
      {
        force = false,
        calm = false,
        priority = "normal",
        key = "",
        scriptKey = "",
        actionType = "",
        state = "speaking",
      } = {}
    ) => {
      const phrase = String(text || "").trim();
      if (!phrase || muted) return null;

      const dedupeKey = String(key || phrase).trim();
      if (!force && dedupeKey && lastPodVoiceKeyRef.current === dedupeKey) {
        return null;
      }

      if (dedupeKey) {
        lastPodVoiceKeyRef.current = dedupeKey;
      }

      const payload = {
        speech: phrase,
        captions: phrase,
        state,
        priority: force ? "high" : priority,
        ttlMs: calm ? 6500 : 5000,
        voiceStyle: calm ? "calm" : "default",
        actions: [],
        replaceCurrent: force,
      };

      if (scriptKey) {
        return sayScript({
          scriptKey,
          actionType,
          shopperId,
          fallback: payload,
          overrides: payload,
        });
      }

      return say({
        ...payload,
        actionType,
      });
    },
    [muted, say, sayScript, shopperId]
  );

  const resetPodVoiceKeys = useCallback(() => {
    lastPodVoiceKeyRef.current = "";
    lastRestVoiceKeyRef.current = "";
  }, []);

  const cancelPodVoice = useCallback(
    async ({ resetKeys = true } = {}) => {
      if (resetKeys) {
        resetPodVoiceKeys();
      }

      if (typeof interruptCurrent === "function") {
        await interruptCurrent({
          preserveQueue: false,
          reason: "pod-action-change",
          fadeMs: 0,
        });
      }
    },
    [interruptCurrent, resetPodVoiceKeys]
  );

  return {
    muted,
    noteUserInteraction,
    voiceState,
    speakPod,
    cancelPodVoice,
    resetPodVoiceKeys,
  };
}
