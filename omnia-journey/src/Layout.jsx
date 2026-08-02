// src/Layout.jsx
import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
} from "react";
import { Outlet, useLocation } from "react-router-dom";

import RewardsDrawer from "./components/RewardsDrawer.jsx";
import RewardsPill from "./components/RewardsPill.jsx";
import HeaderContextBar from "./components/HeaderContextBar.jsx";
import FooterControlBar from "./components/FooterControlBar.jsx";
import SnoozerHUD from "./components/SnoozerHUD.jsx";

import { useHudRouteVoiceGuard } from "@/hooks/useHudRouteVoiceGuard";
import {
  VoiceQueueProvider,
  useVoiceQueue,
} from "@/lib/snoozer/voice/VoiceQueueContext";
import { fetchHudAudio } from "@/lib/snoozer/voice/fetchHudAudio";
import { useSessionStore } from "@/state/sessionStore";
import { useStore } from "@/lib/useStore";
import {
  refreshRewardsState,
  useRewardsState,
} from "@/state/rewardsStore";

/** ---- Brand tokens ---- */
const COLOR = {
  primary: "#1A66D2",
  accent: "#FF9F1C",
  text: "#2A2B2A",
  headerBg: "#F7F7F8",
  border: "#E5E7EB",
};

const SnoozerContext = createContext(null);

export function useSnoozer() {
  return useContext(SnoozerContext);
}

function LayoutShell() {
  const location = useLocation();
  const pathname = location.pathname || "/";

  const shopperId = useSessionStore((state) => state?.shopperId || "");
  const syncCartFromShopify = useStore((state) => state.syncCartFromShopify);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hudOpen, setHudOpen] = useState(true);
  const [hudMuted, setHudMutedState] = useState(() => {
    try {
      return sessionStorage.getItem("snooze.hudMuted") === "1";
    } catch {
      return false;
    }
  });

  const rewardState = useRewardsState();
  const rewards = useMemo(
    () => ({
      balance: Number(rewardState.summary?.availableSleepPoints || 0),
      level: rewardState.summary?.currentBadge?.label || "Explorer",
      title: rewardState.summary?.currentBadge?.label || "Explorer",
      summary: rewardState.summary,
      status: rewardState.status,
    }),
    [rewardState]
  );

  const voiceQueue = useVoiceQueue() || {};

  const {
    currentJob = null,
    replayCurrent = null,
    replay = null,
    enqueue = null,
    push = null,
    say = null,
    speak = null,
    play = null,
    setMuted = null,
    muted: queueMuted = undefined,
    voiceState = {},
    onUserInteraction = null,
    noteUserInteraction: queueNoteUserInteraction = null,
  } = voiceQueue;

  useHudRouteVoiceGuard({
    allowContinuation: true,
    maxCarryoverMs: 3000,
  });

  const isCenteredRoute = false;

  const showBars = pathname.startsWith("/explore-dev");

  const pageOwnsSnoozerVisual =
    pathname.startsWith("/welcome") ||
    pathname.startsWith("/what-to-expect") ||
    pathname.startsWith("/assessment") ||
    pathname.startsWith("/results") ||
    pathname.startsWith("/pod/") ||
    pathname.startsWith("/sleep-essentials") ||
    pathname.startsWith("/ask-snoozer");
  const pageUsesPodViewportShell =
    pathname.startsWith("/pod/") || pathname.startsWith("/dev/pod-lab");

  const showPersistentHudOverlay =
    hudOpen &&
    !pageOwnsSnoozerVisual &&
    Boolean(currentJob?.captions || currentJob?.speech);

  useEffect(() => {
    if (!shopperId) return;
    void refreshRewardsState();
    void syncCartFromShopify({ sourcePage: `identity:${pathname}` }).catch((error) => {
      console.warn("[cart] Canonical shopper cart restore failed", {
        code: error?.code || "SHOPPER_CART_RESTORE_FAILED",
      });
    });
  }, [shopperId, pathname, syncCartFromShopify]);

  useEffect(() => {
    try {
      sessionStorage.setItem("snooze.hudMuted", hudMuted ? "1" : "0");
    } catch {
      // ignore
    }
  }, [hudMuted]);

  useEffect(() => {
    if (typeof queueMuted === "boolean" && queueMuted !== hudMuted) {
      setHudMutedState(queueMuted);
    }
  }, [queueMuted, hudMuted]);

  const setHudMuted = useCallback(
    (nextMuted) => {
      const value = Boolean(nextMuted);
      setHudMutedState(value);

      if (typeof setMuted === "function") {
        setMuted(value);
      }
    },
    [setMuted]
  );

  const sayHud = useCallback(
    async (payload) => {
      const normalized =
        typeof payload === "string"
          ? {
              speech: payload,
              captions: payload,
              state: "speaking",
              priority: "normal",
              ttlMs: 5000,
              actions: [],
            }
          : {
              speech: String(payload?.speech || payload?.captions || "").trim(),
              captions: String(payload?.captions || payload?.speech || "").trim(),
              state: payload?.state || "speaking",
              priority: payload?.priority || "normal",
              ttlMs: Number(payload?.ttlMs) || 5000,
              voiceStyle: payload?.voiceStyle || "default",
              actions: Array.isArray(payload?.actions) ? payload.actions : [],
            };

      if (!normalized.speech && !normalized.captions) return null;

      const runner = enqueue || push || say || speak || play;
      if (typeof runner === "function") {
        return runner(normalized);
      }

      return null;
    },
    [enqueue, push, say, speak, play]
  );

  const replayHud = useCallback(async () => {
    if (typeof replayCurrent === "function") {
      return replayCurrent();
    }

    if (typeof replay === "function") {
      return replay();
    }

    if (currentJob?.speech || currentJob?.captions) {
      return sayHud({
        speech: currentJob?.speech || currentJob?.captions || "",
        captions: currentJob?.captions || currentJob?.speech || "",
        state: currentJob?.state || "speaking",
        priority: currentJob?.priority || "normal",
        ttlMs: Number(currentJob?.ttlMs) || 5000,
        voiceStyle: currentJob?.voiceStyle || "default",
        actions: Array.isArray(currentJob?.actions) ? currentJob.actions : [],
      });
    }

    return null;
  }, [replayCurrent, replay, currentJob, sayHud]);

  const noteUserInteraction = useCallback(() => {
    if (typeof queueNoteUserInteraction === "function") {
      queueNoteUserInteraction();
      return;
    }

    if (typeof onUserInteraction === "function") {
      onUserInteraction();
    }
  }, [queueNoteUserInteraction, onUserInteraction]);

  const normalizedVoiceState = useMemo(
    () => ({
      blocked: Boolean(voiceState?.blocked),
      error: String(voiceState?.error || ""),
      loading: Boolean(voiceState?.loading),
      playing: Boolean(voiceState?.playing),
      lastText: String(
        voiceState?.lastText ||
          currentJob?.speech ||
          currentJob?.captions ||
          ""
      ),
    }),
    [voiceState, currentJob]
  );

  const snoozerCtx = useMemo(
    () => ({
      shopperId,
      rewards,
      currentJob,
      voiceState: normalizedVoiceState,
      hud: {
        open: hudOpen,
        muted: hudMuted,
      },
      refreshRewards: () => refreshRewardsState({ force: true }),
      openSnoozer: () => setHudOpen(true),
      closeSnoozer: () => setHudOpen(false),
      toggleSnoozer: () => setHudOpen((prev) => !prev),
      sayHud,
      replayHud,
      setHudMuted,
      noteUserInteraction,
    }),
    [
      shopperId,
      rewards,
      currentJob,
      normalizedVoiceState,
      hudOpen,
      hudMuted,
      sayHud,
      replayHud,
      setHudMuted,
      noteUserInteraction,
    ]
  );

  return (
    <SnoozerContext.Provider value={snoozerCtx}>
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#FFFFFF",
          color: COLOR.text,
          position: "relative",
        }}
      >
        {showBars && <HeaderContextBar color={COLOR} />}

        <RewardsDrawer
          shopperId={shopperId}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onHud={sayHud}
        />
        {shopperId && pathname !== "/checkout" && (
          <RewardsPill shopperId={shopperId} onClick={() => setDrawerOpen(true)} />
        )}

        <main
          style={{
            flex: 1,
            display: isCenteredRoute ? "grid" : "block",
            placeItems: isCenteredRoute ? "center" : "initial",
            padding: pageOwnsSnoozerVisual || isCenteredRoute ? 0 : "16px",
            height: pageUsesPodViewportShell ? "100dvh" : undefined,
            maxHeight: pageUsesPodViewportShell ? "100dvh" : undefined,
            overflow: pageUsesPodViewportShell ? "hidden" : undefined,
          }}
        >
          <Outlet />
        </main>

        {showPersistentHudOverlay && (
          <div
            style={{
              position: "fixed",
              right: 20,
              bottom: showBars ? 92 : 20,
              zIndex: 50,
              width: "min(360px, calc(100vw - 24px))",
            }}
          >
            <SnoozerHUD
              shopperId={shopperId || "guest"}
              mode="showroom"
              chrome="card"
              size="md"
              title="Snoozer"
              subtitle="Ready"
              speech={currentJob?.speech || currentJob?.captions || ""}
              captions={currentJob?.captions || currentJob?.speech || ""}
              state={currentJob?.state || (voiceState?.playing ? "speaking" : "idle")}
              actions={Array.isArray(currentJob?.actions) ? currentJob.actions : []}
              busy={Boolean(voiceState?.loading)}
              error={String(voiceState?.error || "")}
              showHeader={true}
              showTranscriptToggle={true}
              showInput={false}
            />
          </div>
        )}

        {showBars && (
          <FooterControlBar
            color={COLOR}
            onRewardsClick={() => setDrawerOpen(true)}
          />
        )}
      </div>
    </SnoozerContext.Provider>
  );
}

export default function Layout() {
  return (
    <VoiceQueueProvider
      fetchAudioForJob={fetchHudAudio}
      fadeOutMs={250}
      maxCarryoverMs={3000}
      captionGraceMs={350}
    >
      <LayoutShell />
    </VoiceQueueProvider>
  );
}
