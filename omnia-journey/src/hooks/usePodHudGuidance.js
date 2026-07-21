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
        captions = "",
        ttlMs = null,
        voiceStyle = "",
        actions = [],
        preservePriority = false,
      } = {}
    ) => {
      const phrase = String(text || "").trim();
      if (!phrase) return null;

      const dedupeKey = String(key || phrase).trim();
      if (!force && dedupeKey && lastPodVoiceKeyRef.current === dedupeKey) {
        return null;
      }

      if (dedupeKey) {
        lastPodVoiceKeyRef.current = dedupeKey;
      }

      const payload = {
        speech: phrase,
        captions: String(captions || phrase),
        state,
        priority: force && !preservePriority ? "high" : priority,
        ttlMs: Number(ttlMs) > 0 ? Number(ttlMs) : calm ? 6500 : 5000,
        voiceStyle: voiceStyle || (calm ? "calm" : "default"),
        actions: Array.isArray(actions) ? actions : [],
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
    [say, sayScript, shopperId]
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
