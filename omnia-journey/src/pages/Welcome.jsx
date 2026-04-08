import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useSnoozer } from "@/Layout.jsx";

function buildApiBase() {
  let base = import.meta.env.VITE_API_BASE?.replace(/\/$/, "") || "";
  if (base && !/\/(prod|staging|dev)$/i.test(base)) base += "/prod";
  return base;
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

function safeRemove(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeAccessCode(raw) {
  return String(raw || "").trim();
}

function notifyShopperIdChange(shopperId) {
  try {
    window.dispatchEvent(
      new CustomEvent("snooze:shopper-id", {
        detail: { shopperId: shopperId || "" },
      })
    );
  } catch {
    // ignore
  }
}

function buildFallbackWelcomeSpeech(isReturning) {
  if (isReturning) {
    return {
      speech:
        "Hi, welcome back to MySnoozePod. I’m Snoozer, your personal sleep assistant. Let’s get you sleeping better!",
      captions:
        "Hi, welcome back to MySnoozePod. I’m Snoozer, your personal sleep assistant. Let’s get you sleeping better!",
      state: "speaking",
      priority: "normal",
      ttlMs: 5000,
      voiceStyle: "default",
      actions: [],
      scriptKey: "welcome.entry.returning",
    };
  }

  return {
    speech:
      "Hi, welcome to MySnoozePod. I’m Snoozer, your personal sleep assistant. Let’s get you sleeping better!",
    captions:
      "Hi, welcome to MySnoozePod. I’m Snoozer, your personal sleep assistant. Let’s get you sleeping better!",
    state: "speaking",
    priority: "normal",
    ttlMs: 5000,
    voiceStyle: "default",
    actions: [],
    scriptKey: "welcome.entry.new",
  };
}

async function resolveHudScript({ apiBase, shopperId, scriptKey, fallback }) {
  if (!apiBase || !scriptKey) return fallback;

  try {
    const res = await fetch(`${apiBase}/hud/script`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shopperId: shopperId || "guest",
        scriptKey,
        context: {},
      }),
    });

    const payload = await safeReadJson(res);
    if (!res.ok || !payload || typeof payload !== "object") {
      return fallback;
    }

    return {
      speech:
        typeof payload.speech === "string" && payload.speech.trim()
          ? payload.speech.trim()
          : fallback.speech,
      captions:
        typeof payload.captions === "string" && payload.captions.trim()
          ? payload.captions.trim()
          : fallback.captions,
      state: payload.state || fallback.state,
      priority: payload.priority || fallback.priority,
      ttlMs:
        Number.isFinite(Number(payload.ttlMs)) && Number(payload.ttlMs) > 0
          ? Number(payload.ttlMs)
          : fallback.ttlMs,
      voiceStyle: payload.voiceStyle || fallback.voiceStyle,
      actions: Array.isArray(payload.actions) ? payload.actions : fallback.actions,
      scriptKey:
        typeof payload.scriptKey === "string" && payload.scriptKey.trim()
          ? payload.scriptKey.trim()
          : scriptKey,
    };
  } catch {
    return fallback;
  }
}

function estimateSpeechHoldMs(hudPayload) {
  const ttlMs = Number(hudPayload?.ttlMs) || 5000;
  const sourceText =
    String(hudPayload?.speech || "").trim() || String(hudPayload?.captions || "").trim();

  const words = sourceText ? sourceText.split(/\s+/).filter(Boolean).length : 0;
  const estimatedFromWords = words > 0 ? 900 + words * 360 : 3600;

  return Math.max(3200, Math.min(Math.max(ttlMs, estimatedFromWords), 6500));
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function Welcome() {
  const navigate = useNavigate();
  const snoozer = useSnoozer();
  const API_BASE = useMemo(() => buildApiBase(), []);

  const [code, setCode] = useState(() => safeGet("snooze.accessCode") || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const inFlightRef = useRef(false);
  const navigateTimerRef = useRef(null);
  const unmountedRef = useRef(false);
  const snoozerRef = useRef(snoozer);

  useEffect(() => {
    snoozerRef.current = snoozer;
  }, [snoozer]);

  useEffect(() => {
    const saved = safeGet("snooze.accessCode") || "";
    if (saved) setCode(saved);
  }, []);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      if (navigateTimerRef.current) {
        window.clearTimeout(navigateTimerRef.current);
        navigateTimerRef.current = null;
      }
    };
  }, []);

  async function getAssessmentSnapshot(shopperId) {
    if (!API_BASE || !shopperId) return null;

    try {
      const res = await fetch(`${API_BASE}/assessment/${encodeURIComponent(shopperId)}`);
      const payload = await safeReadJson(res);

      if (!res.ok || !payload) return null;
      return payload?.data && typeof payload.data === "object" ? payload.data : payload;
    } catch {
      return null;
    }
  }

  async function getExistingPoints(shopperId) {
    if (!API_BASE || !shopperId) return 0;

    try {
      const res = await fetch(`${API_BASE}/rewards/balance/${encodeURIComponent(shopperId)}`);
      const payload = await safeReadJson(res);
      if (!res.ok || !payload) return 0;

      return Number(
        payload?.points ??
          payload?.balance ??
          payload?.data?.points ??
          payload?.data?.balance ??
          0
      );
    } catch {
      return 0;
    }
  }

  function persistShopper(shopperId, snapshot) {
    safeSet("snooze.accessCode", shopperId);
    safeSet("snooze.shopperId", shopperId);

    if (snapshot && typeof snapshot === "object") {
      safeSet("snooze.snapshot", JSON.stringify(snapshot));
      if (snapshot.shopperState) {
        safeSet("snooze.shopperState", String(snapshot.shopperState));
      }
    }

    notifyShopperIdChange(shopperId);
  }

  async function maybeAwardFirstCheckIn(shopperId, snapshot) {
    const existingPoints = await getExistingPoints(shopperId);
    const alreadyKnown =
      String(snapshot?.shopperState || "").toUpperCase() !== "" &&
      String(snapshot?.shopperState || "").toUpperCase() !== "NEW";

    if (existingPoints > 0 || alreadyKnown) return;

    const current = Number(safeGet("snooze.points") || 0);
    safeSet("snooze.points", String(current + 100));
    safeSet(
      "snooze.points.lastEarned",
      JSON.stringify({
        points: 100,
        reason: "First Check-In",
        ts: Date.now(),
      })
    );
  }

  async function announceWelcome(shopperId, snapshot) {
    const state = String(snapshot?.shopperState || "").toUpperCase().trim();
    const isReturning =
      state === "KNOWN" || state === "PROFILED" || state === "ASSESSED";

    const fallback = buildFallbackWelcomeSpeech(isReturning);
    const scriptKey = isReturning ? "welcome.entry.returning" : "welcome.entry.new";

    const hudPayload = await resolveHudScript({
      apiBase: API_BASE,
      shopperId,
      scriptKey,
      fallback,
    });

    try {
      await snoozerRef.current?.sayHud?.(hudPayload, {
        force: true,
        passive: false,
        shopperId,
      });
    } catch {
      // ignore voice failure and still return payload for timing
    }

    return hudPayload;
  }

  function scheduleNextRoute(delayMs) {
    if (navigateTimerRef.current) {
      window.clearTimeout(navigateTimerRef.current);
      navigateTimerRef.current = null;
    }

    navigateTimerRef.current = window.setTimeout(() => {
      navigate("/what-to-expect");
    }, delayMs);
  }

  async function waitForWelcomePlayback(hudPayload) {
    const minHoldMs = 3200;
    const maxHoldMs = estimateSpeechHoldMs(hudPayload);
    const playbackStartGraceMs = 1200;
    const pollMs = 100;
    const settleMs = 250;

    const startedAt = Date.now();
    let sawPlayback = false;

    while (!unmountedRef.current) {
      const elapsed = Date.now() - startedAt;
      const playing = Boolean(snoozerRef.current?.voiceState?.playing);

      if (playing) {
        sawPlayback = true;
      }

      if (elapsed >= maxHoldMs) {
        return;
      }

      if (!sawPlayback) {
        if (elapsed < playbackStartGraceMs) {
          await sleep(pollMs);
          continue;
        }

        if (elapsed >= minHoldMs) {
          return;
        }

        await sleep(pollMs);
        continue;
      }

      if (elapsed < minHoldMs) {
        await sleep(pollMs);
        continue;
      }

      if (!playing) {
        await sleep(settleMs);
        if (!Boolean(snoozerRef.current?.voiceState?.playing)) {
          return;
        }
      }

      await sleep(pollMs);
    }
  }

  const handleStart = async () => {
    snoozer?.noteUserInteraction?.();

    if (loading || inFlightRef.current) return;

    const trimmed = normalizeAccessCode(code);
    if (!trimmed) {
      setError("Enter a valid access code.");
      return;
    }

    inFlightRef.current = true;
    setLoading(true);
    setError("");

    try {
      safeRemove("snooze.snapshot");
      safeRemove("snooze.shopperState");

      persistShopper(trimmed, null);

      const snapshot = await getAssessmentSnapshot(trimmed);
      if (snapshot) {
        persistShopper(trimmed, snapshot);
      }

      await maybeAwardFirstCheckIn(trimmed, snapshot);

      const hudPayload = await announceWelcome(trimmed, snapshot);

      await waitForWelcomePlayback(hudPayload);

      if (!unmountedRef.current) {
        scheduleNextRoute(120);
      }
    } catch (err) {
      console.error("Welcome start failed:", err);
      if (!unmountedRef.current) {
        setError("Unable to start your snooze session right now.");
        setLoading(false);
      }
      inFlightRef.current = false;
      return;
    }

    if (!unmountedRef.current) {
      setLoading(false);
    }
    inFlightRef.current = false;
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleStart();
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gradient-to-b from-[#D0D6E4] to-white px-4">
      <motion.div
        className="flex w-full max-w-lg flex-col items-center gap-6 rounded-3xl bg-white p-10 text-center shadow-2xl"
        initial={{ opacity: 0, y: 26 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <img
          src="/mysnoozepod-logo.png"
          alt="MySnoozePod logo"
          className="h-auto w-40 md:w-48"
          loading="lazy"
          decoding="async"
        />

        <div className="relative mt-2 flex items-center justify-center">
          <div className="absolute h-32 w-32 rounded-full bg-[#1A66D2] opacity-20 blur-2xl" />
          <img
            src="/snoozer-avatar.png"
            alt="Snoozer"
            className="relative z-10 h-28 w-28 rounded-full object-cover shadow-md"
            loading="lazy"
            decoding="async"
          />
        </div>

        <div className="space-y-3">
          <h1 className="text-3xl font-bold leading-tight text-[#2A2B2A] md:text-4xl">
            Welcome to MySnoozePod
          </h1>

          <p className="text-base font-medium text-[#1A66D2] md:text-lg">
            Your Sleep Health &amp; Wellness Journey Begins Here
          </p>

          <p className="text-base text-gray-600 md:text-lg">
            Enter your access code to begin.
          </p>
        </div>

        <div className="mt-4 flex w-full flex-col gap-4">
          <Input
            id="access-code"
            type="text"
            placeholder="Enter Access Code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={handleKeyDown}
            className="py-4 text-center text-lg"
            autoFocus
            disabled={loading}
            inputMode="text"
            aria-label="Access code"
          />

          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <Button
            onClick={handleStart}
            disabled={loading}
            className="w-full bg-[#1A66D2] py-6 text-lg font-semibold text-white hover:bg-[#1550A0]"
          >
            {loading ? "Snooze Session Loading" : "Start Your Snooze Session"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}