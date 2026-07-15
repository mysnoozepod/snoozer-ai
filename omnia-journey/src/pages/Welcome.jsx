import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CircleHelp, LockKeyhole, ShieldCheck } from "lucide-react";

import { canUseAskSnoozer } from "@/device/deviceActionGuards";
import { useDeviceMode } from "@/device/useDeviceMode";
import { getAssessment } from "@/lib/api";
import { getAccessCode, setAccessCode } from "@/state/sessionStore";
import { useShowroomHud } from "@/lib/snoozer/hud/useShowroomHud";
import {
  ShowroomBrandMark,
  ShowroomFrame,
  ShowroomInlineAction,
  ShowroomPageShell,
  ShowroomPanel,
  ShowroomTopRail,
} from "@/components/showroom/ShowroomPrimitives";

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
  const device = useDeviceMode();
  const { noteUserInteraction, runHudAction } = useShowroomHud();

  const [code, setCode] = useState(() => getAccessCode() || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const canOpenAskSnoozer = canUseAskSnoozer(device);

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
      setError("Enter a valid Snooze Code.");
      return;
    }

    hasStartedRef.current = true;
    setLoading(true);
    setError("");
    noteUserInteraction?.();

    try {
      safeRemove("snooze.snapshot");
      safeRemove("snooze.shopperState");

      setAccessCode(trimmed);
      getAssessment(trimmed).catch(() => {
        // ignore background hydrate miss
      });

      const introJob = await runHudAction("start_assessment", {
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
      const resolvedIntroMs = Number(introJob?.ttlMs) || 4200;
      const baseTransitionMs = Math.max(3600, Math.min(resolvedIntroMs + 1800, 7600));
      const transitionMs = Math.min(baseTransitionMs + 2000, 9600);

      transitionTimerRef.current = window.setTimeout(() => {
        navigate("/what-to-expect");
      }, transitionMs);
    } catch (err) {
      console.error("Welcome start failed:", err);
      clearTransitionTimer();
      setError("Unable to start your Snooze Session right now.");
      hasStartedRef.current = false;
      setLoading(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter") {
      handleStart();
    }
  };

  return (
    <ShowroomPageShell className="flex min-h-0 flex-col overflow-hidden pb-0">
      <ShowroomTopRail className="justify-center pt-4 md:pt-5">
        <ShowroomBrandMark imageClassName="w-[190px] md:w-[220px]" />
      </ShowroomTopRail>

      <div className="mx-auto flex min-h-0 w-full max-w-[1380px] flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-4 pt-2 md:px-6 md:pb-5">
        <ShowroomFrame className="shrink-0 p-4 md:p-5">
          <motion.div
            className="grid gap-4 lg:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)] lg:items-center"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, ease: "easeOut" }}
          >
            <ShowroomPanel
              tone="soft"
              className="relative flex min-h-[304px] items-end justify-end overflow-hidden px-5 pb-2 pt-4 shadow-inner md:min-h-[332px] md:px-6"
            >
              <div className="absolute left-4 top-4 max-w-[232px] rounded-[28px] bg-white px-5 py-4 text-slate-800 shadow-[0_18px_38px_rgba(61,92,170,0.14)] md:left-6 md:top-6">
                <div className="text-[1.58rem] font-black leading-tight text-[#2f57e8]">Hi there.</div>
                <p className="mt-2 text-[0.92rem] leading-6">
                  I&apos;m Snoozer. I&apos;ll help you find the mattress that fits how you sleep.
                </p>
              </div>

              <div className="absolute inset-x-8 bottom-3 top-auto rounded-full bg-[#9eb5ff]/25 blur-3xl" />

              <img
                src="/snoozer-avatar.png"
                alt="Snoozer"
                className="relative z-10 h-auto w-[226px] max-w-full translate-x-2 object-contain drop-shadow-[0_22px_46px_rgba(59,93,176,0.22)] md:w-[254px]"
                loading="lazy"
                decoding="async"
              />
            </ShowroomPanel>

            <div className="min-w-0">
              <h1 className="max-w-[760px] text-[2.8rem] font-black leading-[0.9] tracking-tight text-slate-900 md:text-[3.75rem] xl:text-[4.45rem]">
                Let's start your Snooze Session.
              </h1>

              <p className="mt-3 max-w-xl text-[1rem] leading-6 text-slate-700 md:text-[1.05rem]">
                Enter your Snooze Code to continue your showroom visit.
              </p>

              <div className="mt-4 max-w-[660px] rounded-[26px] border border-[#d3e0ff] bg-white/92 p-3.5 shadow-[0_22px_52px_rgba(48,86,184,0.08)] md:p-4">
                <label className="flex items-center gap-3 rounded-[18px] border border-[#b8cbff] bg-white px-4 py-3 shadow-sm md:px-5 md:py-3.5">
                  <LockKeyhole className="h-5 w-5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Enter Snooze Code"
                    value={code}
                    onChange={(event) => {
                      setCode(event.target.value);
                      if (error) setError("");
                    }}
                    onKeyDown={handleKeyDown}
                    disabled={loading}
                    className="w-full bg-transparent text-[1.02rem] font-semibold text-slate-900 outline-none placeholder:text-slate-400 md:text-[1.08rem]"
                  />
                </label>

                {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}

                <button
                  type="button"
                  onClick={handleStart}
                  disabled={loading}
                  className="mt-3.5 inline-flex w-full items-center justify-center gap-3 rounded-[18px] bg-[#2f57e8] px-6 py-3.5 text-base font-black text-white shadow-[0_22px_46px_rgba(47,87,232,0.26)] transition hover:bg-[#2749cb] disabled:cursor-not-allowed disabled:opacity-70 md:text-[1.02rem]"
                >
                  {loading ? "Starting Your Snooze Session" : "Start Your Snooze Session"}
                  <ArrowRight className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-2.5 grid gap-2.5 rounded-[24px] border border-white/70 bg-white/86 p-2.5 shadow-sm lg:grid-cols-[minmax(0,1.06fr)_minmax(224px,0.94fr)]">
                <div className="rounded-[22px] border border-white/70 bg-white/92 px-4 py-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eef3ff] text-[#2f57e8]">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-[0.98rem] font-black text-slate-900">Your privacy matters.</div>
                      <p className="mt-1 text-[0.84rem] leading-5 text-slate-600">
                        Your Snooze Code unlocks your recommendations, rewards, and session prep.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <ShowroomInlineAction
                    icon={CircleHelp}
                    label="Forgot your Snooze Code?"
                    description={
                      canOpenAskSnoozer
                        ? "Open Ask Snoozer for help."
                        : "A sleep specialist can help you recover it."
                    }
                    onClick={() => {
                      noteUserInteraction?.();
                      if (canOpenAskSnoozer) {
                        navigate("/ask-snoozer", { state: { from: "/welcome" } });
                        return;
                      }
                      setError("A sleep specialist can help you recover your Snooze Code.");
                    }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        </ShowroomFrame>
      </div>
    </ShowroomPageShell>
  );
}
