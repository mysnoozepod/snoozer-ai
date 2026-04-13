import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useShowroomHud } from "@/lib/snoozer/hud/useShowroomHud";

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

function normalizeAccessCode(raw) {
  return String(raw || "").trim();
}

export default function Welcome() {
  const navigate = useNavigate();
  const { noteUserInteraction, sayScript } = useShowroomHud();

  const API_BASE = useMemo(() => buildApiBase(), []);

  const [code, setCode] = useState(() => safeGet("snooze.accessCode") || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const hasStartedRef = useRef(false);
  const transitionTimerRef = useRef(null);

  const clearTransitionTimer = () => {
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearTransitionTimer();
    };
  }, []);

  const handleStart = async () => {
    if (loading || hasStartedRef.current) return;

    const trimmed = normalizeAccessCode(code);

    if (!trimmed) {
      setError("Enter a valid access code.");
      return;
    }

    hasStartedRef.current = true;
    setLoading(true);
    setError("");
    noteUserInteraction?.();

    try {
      safeRemove("snooze.snapshot");
      safeRemove("snooze.shopperState");

      safeSet("snooze.accessCode", trimmed);
      safeSet("snooze.shopperId", trimmed);

      if (API_BASE) {
        fetch(`${API_BASE}/assessment/${encodeURIComponent(trimmed)}`).catch(() => {
          // ignore background hydrate miss
        });
      }

      const introJob = await sayScript({
        scriptKey: "welcome.entry.new",
        shopperId: trimmed,
        fallback: {
          speech:
            "Hi, welcome to MySnoozePod. I'm Snoozer, your personal sleep assistant. Let's get you sleeping better.",
          captions:
            "Hi, welcome to MySnoozePod. I'm Snoozer, your personal sleep assistant. Let's get you sleeping better.",
          state: "speaking",
          priority: "normal",
          ttlMs: 5000,
          voiceStyle: "default",
          actions: [],
        },
        overrides: {
          state: "speaking",
          priority: "high",
          ttlMs: 5200,
          actions: [],
          interruptible: true,
          replaceCurrent: true,
          force: true,
        },
      }).catch((err) => {
        console.warn("Welcome voice failed:", err);
        return null;
      });

      clearTransitionTimer();
      const transitionMs = Math.max(
        2200,
        Math.min(Number(introJob?.ttlMs) || 4200, 5200)
      );

      transitionTimerRef.current = window.setTimeout(() => {
        navigate("/what-to-expect");
      }, transitionMs);
    } catch (err) {
      console.error("Welcome start failed:", err);
      clearTransitionTimer();
      setError("Unable to start your snooze session right now.");
      hasStartedRef.current = false;
      setLoading(false);
    }
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
        />

        <div className="relative mt-2 flex items-center justify-center">
          <div className="absolute h-32 w-32 rounded-full bg-[#1A66D2] opacity-20 blur-2xl" />
          <img
            src="/snoozer-avatar.png"
            alt="Snoozer"
            className="relative z-10 h-28 w-28 rounded-full object-cover shadow-md"
          />
        </div>

        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-[#2A2B2A] md:text-4xl">
            Welcome to MySnoozePod
          </h1>

          <p className="text-base font-medium text-[#1A66D2] md:text-lg">
            Your Sleep Health & Wellness Journey Begins Here
          </p>

          <p className="text-base text-gray-600 md:text-lg">
            Enter your access code to begin.
          </p>
        </div>

        <div className="mt-4 flex w-full flex-col gap-4">
          <Input
            type="text"
            placeholder="Enter Access Code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={handleKeyDown}
            className="py-4 text-center text-lg"
            disabled={loading}
          />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button
            onClick={handleStart}
            disabled={loading}
            className="w-full bg-[#1A66D2] py-6 text-lg font-semibold text-white"
          >
            {loading ? "Snooze Session Loading" : "Start Your Snooze Session"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
