// src/Layout.jsx
import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
} from "react";
import { Outlet, useLocation } from "react-router-dom";
import RewardsDrawer from "./components/RewardsDrawer.jsx";
import HeaderContextBar from "./components/HeaderContextBar.jsx";
import FooterControlBar from "./components/FooterControlBar.jsx";
import SnoozerHUD from "./components/SnoozerHUD.jsx";
import {
  cleanupVoice,
  getVoiceState,
  speakText,
  stopVoice,
  subscribeVoice,
} from "./lib/voice.js";

/** ---- Brand tokens ---- */
const COLOR = {
  primary: "#1A66D2",
  accent: "#FF9F1C",
  text: "#2A2B2A",
  headerBg: "#F7F7F8",
  border: "#E5E7EB",
};

/** ---- Context for rewards + layout controls ---- */
const SnoozerContext = createContext(null);

const HUD_DEFAULT = {
  speech: "",
  captions: "",
  state: "idle",
  priority: "normal",
  ttlMs: 5000,
  voiceStyle: "default",
  actions: [],
  shopperId: "",
  scriptKey: "",
};

const RECENT_PAGE_SPEAK_MS = 2500;

function lower(v) {
  return String(v || "").toLowerCase().trim();
}

function safeGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function normalizeHudState(v) {
  const s = lower(v);
  if (s === "listening") return "listening";
  if (s === "thinking") return "thinking";
  if (s === "speaking") return "speaking";
  if (s === "celebrate") return "celebrate";
  if (s === "warning") return "warning";
  return "idle";
}

function normalizePriority(v) {
  const s = lower(v);
  if (s === "low") return "low";
  if (s === "high") return "high";
  return "normal";
}

function normalizeVoiceStyle(v) {
  const s = lower(v);
  return s === "calm" ? "calm" : "default";
}

function normalizeHudPayload(payload = {}) {
  const speech =
    typeof payload?.speech === "string"
      ? payload.speech.trim()
      : typeof payload?.text === "string"
      ? payload.text.trim()
      : "";

  const captions =
    typeof payload?.captions === "string"
      ? payload.captions.trim()
      : speech;

  const ttlNum = Number(payload?.ttlMs);
  const ttlMs =
    Number.isFinite(ttlNum) && ttlNum > 0
      ? Math.max(500, Math.min(ttlNum, 60000))
      : 5000;

  const actions = Array.isArray(payload?.actions)
    ? payload.actions.slice(0, 12)
    : [];

  return {
    speech,
    captions,
    state: normalizeHudState(payload?.state),
    priority: normalizePriority(payload?.priority),
    ttlMs,
    voiceStyle: normalizeVoiceStyle(payload?.voiceStyle),
    actions,
    shopperId:
      typeof payload?.shopperId === "string" ? payload.shopperId.trim() : "",
    scriptKey:
      typeof payload?.scriptKey === "string" ? payload.scriptKey.trim() : "",
  };
}

export function useSnoozer() {
  return useContext(SnoozerContext);
}

function useShopperId() {
  const readCurrent = useCallback(() => {
    try {
      return (
        sessionStorage.getItem("snooze.accessCode") ||
        sessionStorage.getItem("snooze.shopperId") ||
        ""
      );
    } catch {
      return "";
    }
  }, []);

  const [id, setId] = useState(readCurrent);

  useEffect(() => {
    const sync = (nextValue) => {
      if (typeof nextValue === "string") {
        setId(nextValue || "");
        return;
      }
      setId(readCurrent());
    };

    const onStorage = (e) => {
      if (e.key === "snooze.accessCode" || e.key === "snooze.shopperId") {
        sync(e.newValue || "");
      }
    };

    const onShopperEvent = (e) => {
      const nextValue = e?.detail?.shopperId;
      sync(typeof nextValue === "string" ? nextValue : undefined);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("snooze:shopper-id", onShopperEvent);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("snooze:shopper-id", onShopperEvent);
    };
  }, [readCurrent]);

  return id;
}

/** ---- Persistent Layout ---- */
export default function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [rewards, setRewards] = useState({
    balance: 0,
    level: 1,
    title: "Dream Seeker",
  });

  const [voiceState, setVoiceState] = useState(() => getVoiceState());
  const [hudOpen, setHudOpen] = useState(true);
  const [hudMuted, setHudMuted] = useState(() => safeGet("snooze.hud.muted") === "1");
  const [hudMessageSeq, setHudMessageSeq] = useState(0);
  const [hudMessage, setHudMessage] = useState(HUD_DEFAULT);
  const [hudMessages, setHudMessages] = useState(() => {
    const lastCaption = safeGet("snooze.snoozer.lastCaption") || "";
    if (!lastCaption) return [];
    return [{ role: "assistant", text: String(lastCaption) }];
  });

  const shopperId = useShopperId();
  const location = useLocation();
  const pathname = location.pathname || "/";

  const hudQueueRef = useRef([]);
  const hudBusyRef = useRef(false);
  const lastHudRef = useRef(HUD_DEFAULT);
  const lastRouteSpeakAtRef = useRef(0);
  const currentRouteRef = useRef(pathname);

  // “Centered” minimal routes
  const isCenteredRoute =
    pathname.startsWith("/welcome") ||
    pathname.startsWith("/what-to-expect") ||
    pathname.startsWith("/results");

  // Header/Footer bars only on these flows
  const showBars =
    pathname.startsWith("/explore") || pathname.startsWith("/checkout");

  const pageOwnsSnoozerVisual =
    pathname.startsWith("/welcome") ||
    pathname.startsWith("/what-to-expect") ||
    pathname.startsWith("/assessment") ||
    pathname.startsWith("/results") ||
    pathname.startsWith("/pod/");

  const showPersistentHudOverlay =
    hudOpen &&
    !pageOwnsSnoozerVisual &&
    Boolean(
      hudMessage.captions ||
        hudMessage.speech ||
        voiceState.loading ||
        voiceState.playing
    );

  /** Rewards tier calculation */
  useEffect(() => {
    const pts = Number(sessionStorage.getItem("snooze.points") || 0);
    let level = 1;
    let title = "Dream Seeker";

    if (pts >= 200 && pts < 500) {
      level = 2;
      title = "Snooze Explorer";
    } else if (pts >= 500 && pts < 1000) {
      level = 3;
      title = "Sleep Specialist";
    } else if (pts >= 1000) {
      level = 4;
      title = "Master of Rest";
    }

    setRewards({ balance: pts, level, title });
  }, [shopperId]);

  useEffect(() => {
    const unsub = subscribeVoice(setVoiceState);
    return () => unsub();
  }, []);

  useEffect(() => {
    safeSet("snooze.hud.muted", hudMuted ? "1" : "0");
  }, [hudMuted]);

  const pushHudAssistantMessage = useCallback((text) => {
    const phrase = String(text || "").trim();
    if (!phrase) return;

    try {
      sessionStorage.setItem("snooze.snoozer.lastCaption", phrase);
    } catch {
      // ignore
    }

    setHudMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && last?.text === phrase) {
        return prev;
      }
      return [...prev, { role: "assistant", text: phrase }].slice(-24);
    });
  }, []);

  const clearHudQueue = useCallback(() => {
    hudQueueRef.current = [];
    hudBusyRef.current = false;
  }, []);

  const stopHud = useCallback(
    ({ keepCaption = true } = {}) => {
      clearHudQueue();
      stopVoice();

      setHudMessage((prev) => ({
        ...prev,
        state: "idle",
        captions: keepCaption ? prev.captions : "",
        speech: keepCaption ? prev.speech : "",
      }));
    },
    [clearHudQueue]
  );

  const interruptHud = useCallback(() => {
    clearHudQueue();
    stopVoice();
    hudBusyRef.current = false;
  }, [clearHudQueue]);

  useEffect(() => {
    if (currentRouteRef.current === pathname) return;

    currentRouteRef.current = pathname;
    lastRouteSpeakAtRef.current = 0;

    // Do not stop active voice on route change.
    // Let the current page speech finish unless something explicitly interrupts it.
    hudBusyRef.current = hudBusyRef.current;

    if (pathname.startsWith("/checkout")) {
      setHudMessage((prev) => ({
        ...prev,
        state: voiceState.playing ? prev.state : "idle",
      }));
    }
  }, [pathname, voiceState.playing]);

  const noteUserInteraction = useCallback(() => {
    // retained for callers, but no longer used to silence speech globally
  }, []);

  const processHudQueue = useCallback(async () => {
    if (hudBusyRef.current) return;

    const next = hudQueueRef.current.shift();
    if (!next) return;

    hudBusyRef.current = true;

    try {
      const suppressForPageRecency =
        !next.force &&
        next.passive === true &&
        Date.now() - lastRouteSpeakAtRef.current <= RECENT_PAGE_SPEAK_MS;

      const shouldSpeak =
        !hudMuted &&
        !suppressForPageRecency &&
        !!next.speech;

      if (shouldSpeak) {
        lastRouteSpeakAtRef.current = Date.now();

        await speakText(next.speech, {
          shopperId: next.shopperId || shopperId || "guest",
          muted: hudMuted,
          force: false,
        });
      }
    } catch {
      // captions already rendered; voice failures stay non-fatal
    } finally {
      hudBusyRef.current = false;

      if (hudQueueRef.current.length) {
        processHudQueue();
      }
    }
  }, [hudMuted, shopperId]);

  const sayHud = useCallback(
    async (payload = {}, opts = {}) => {
      const next = normalizeHudPayload(payload);

      if (!next.speech && !next.captions) return null;

      const resolvedShopperId =
        String(
          opts?.shopperId ||
            next.shopperId ||
            shopperId ||
            safeGet("snooze.accessCode") ||
            safeGet("snooze.shopperId") ||
            "guest"
        ).trim() || "guest";

      const finalMessage = {
        ...next,
        shopperId: resolvedShopperId,
        state: next.state === "idle" ? "speaking" : next.state,
        force: Boolean(opts?.force) || next.priority === "high",
        passive: Boolean(opts?.passive),
        interrupt: Boolean(opts?.interrupt),
      };

      lastHudRef.current = finalMessage;

      setHudMessage(finalMessage);
      setHudMessageSeq((v) => v + 1);
      setHudOpen(true);
      pushHudAssistantMessage(finalMessage.captions || finalMessage.speech || "");

      const voiceSuppressed =
        Boolean(opts?.captionsOnly) || !finalMessage.speech || hudMuted;

      if (voiceSuppressed) {
        return finalMessage;
      }

      if (finalMessage.priority === "low" && (voiceState.playing || voiceState.loading)) {
        return finalMessage;
      }

      // Only explicitly interrupt when the caller asks for it.
      if ((voiceState.playing || voiceState.loading) && finalMessage.interrupt) {
        interruptHud();
      }

      hudQueueRef.current.push(finalMessage);
      processHudQueue();

      return finalMessage;
    },
    [
      hudMuted,
      interruptHud,
      processHudQueue,
      pushHudAssistantMessage,
      shopperId,
      voiceState.loading,
      voiceState.playing,
    ]
  );

  const replayHud = useCallback(async () => {
    const last = lastHudRef.current;
    if (!last?.speech && !last?.captions) return;

    interruptHud();

    const replayPayload = {
      ...last,
      priority: "high",
      force: true,
      passive: false,
      interrupt: true,
      shopperId:
        last.shopperId ||
        shopperId ||
        safeGet("snooze.accessCode") ||
        safeGet("snooze.shopperId") ||
        "guest",
    };

    hudQueueRef.current.push(replayPayload);
    processHudQueue();
  }, [interruptHud, processHudQueue, shopperId]);

  const openSnoozer = useCallback(() => {
    setHudOpen(true);
  }, []);

  const closeSnoozer = useCallback(() => {
    setHudOpen(false);
  }, []);

  const toggleSnoozer = useCallback(() => {
    setHudOpen((prev) => !prev);
  }, []);

  /** Context value */
  const snoozerCtx = useMemo(
    () => ({
      shopperId,
      rewards,
      voiceState,
      hud: {
        ...hudMessage,
        open: hudOpen,
        muted: hudMuted,
        seq: hudMessageSeq,
        messages: hudMessages,
      },
      earnPoints: (points, reason = "Milestone") => {
        setRewards((prev) => {
          const total = prev.balance + points;
          sessionStorage.setItem("snooze.points", total);
          return { ...prev, balance: total };
        });
        console.log(`🏆 Earned ${points} pts for ${reason}`);
      },
      sayHud,
      stopHud,
      replayHud,
      setHudMuted,
      noteUserInteraction,
      clearHudQueue,
      toggleSnoozer,
      openSnoozer,
      closeSnoozer,
      interruptHud,
      pushHudAssistantMessage,
    }),
    [
      shopperId,
      rewards,
      voiceState,
      hudMessage,
      hudOpen,
      hudMuted,
      hudMessageSeq,
      hudMessages,
      sayHud,
      stopHud,
      replayHud,
      noteUserInteraction,
      clearHudQueue,
      toggleSnoozer,
      openSnoozer,
      closeSnoozer,
      interruptHud,
      pushHudAssistantMessage,
    ]
  );

  useEffect(() => {
    return () => {
      cleanupVoice();
      clearHudQueue();
    };
  }, [clearHudQueue]);

  return (
    <SnoozerContext.Provider value={snoozerCtx}>
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#FFFFFF",
          color: COLOR.text,
          overflowX: "hidden",
          position: "relative",
        }}
      >
        {showBars && <HeaderContextBar color={COLOR} />}

        <RewardsDrawer
          shopperId={shopperId}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />

        <main
          id="main"
          style={{
            flex: 1,
            display: isCenteredRoute ? "grid" : "block",
            placeItems: isCenteredRoute ? "center" : "initial",
            padding: isCenteredRoute ? 0 : "16px",
            transition: "all 0.4s ease",
          }}
        >
          <Outlet />
        </main>

        {showPersistentHudOverlay ? (
          <div
            style={{
              position: "fixed",
              right: 20,
              bottom: showBars ? 92 : 20,
              zIndex: 50,
              width: "min(360px, calc(100vw - 24px))",
              pointerEvents: "auto",
            }}
          >
            <SnoozerHUD
              shopperId={hudMessage.shopperId || shopperId || "guest"}
              mode="showroom"
              chrome="card"
              size="md"
              title="Snoozer"
              subtitle={
                voiceState.playing
                  ? "Speaking"
                  : voiceState.loading
                  ? "Thinking"
                  : "Ready"
              }
              showHeader={true}
              showStateLabel={false}
              showTranscriptToggle={true}
              showInput={false}
              showInputProp={false}
              speech={hudMessage.speech}
              captions={hudMessage.captions}
              state={hudMessage.state}
              actions={hudMessage.actions}
              messages={hudMessages}
              busy={voiceState.loading}
              error={voiceState.error || ""}
              openCartUrl={
                safeGet("snooze.shopify.checkoutUrl") ||
                safeGet("snooze.checkoutUrl") ||
                ""
              }
            />
          </div>
        ) : null}

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