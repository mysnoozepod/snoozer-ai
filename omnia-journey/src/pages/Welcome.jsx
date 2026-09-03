import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CircleHelp, LockKeyhole, ShieldCheck } from "lucide-react";

import { canUseAskSnoozer } from "@/device/deviceActionGuards";
import { useDeviceMode } from "@/device/useDeviceMode";
import { checkInSnoozeCode, getAssessment } from "@/lib/api";
import { getAccessCode } from "@/state/sessionStore";
import { useStore } from "@/lib/useStore";
import { useShowroomHud } from "@/lib/snoozer/hud/useShowroomHud";
import {
  ShowroomBrandMark,
  ShowroomFrame,
  ShowroomInlineAction,
  ShowroomPageShell,
  ShowroomPanel,
  ShowroomTopRail,
} from "@/components/showroom/ShowroomPrimitives";

function normalizeAccessCode(raw) {
  return String(raw || "")
    .replace(/\D+/g, "")
    .slice(0, 4);
}

export default function Welcome() {
  const navigate = useNavigate();
  const device = useDeviceMode();
  const { currentJob, noteUserInteraction, queue, runHudAction, voiceState } = useShowroomHud();

  const resetShopperScopedState = useStore((state) => state.resetShopperScopedState);
  const [code, setCode] = useState(() => {
    const storedCode = String(getAccessCode() || "").trim();
    return /^\d{4}$/.test(storedCode) ? storedCode : "";
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [introJobId, setIntroJobId] = useState("");
  const canOpenAskSnoozer = canUseAskSnoozer(device);

  const hasStartedRef = useRef(false);
  const introSeenRef = useRef(false);
  const navigatedRef = useRef(false);

  useEffect(() => {
    if (!introJobId || navigatedRef.current) return;
    const isActive = String(currentJob?.id || "") === introJobId;
    const isQueued = Array.isArray(queue)
      ? queue.some((job) => String(job?.id || "") === introJobId)
      : false;
    if (isActive || isQueued) introSeenRef.current = true;
    if (!introSeenRef.current || voiceState?.loading || voiceState?.playing || isActive || isQueued) return;
    navigatedRef.current = true;
    navigate("/what-to-expect");
  }, [currentJob, introJobId, navigate, queue, voiceState?.loading, voiceState?.playing]);

  const handleStart = async (candidateCode = code) => {
    if (loading || hasStartedRef.current) return;

    const trimmed = normalizeAccessCode(candidateCode);
    if (!/^\d{4}$/.test(trimmed)) {
      setError("Enter all four digits of your Snooze Code.");
      return;
    }

    hasStartedRef.current = true;
    setLoading(true);
    setError("");
    noteUserInteraction?.();

    try {
      const checkIn = await checkInSnoozeCode({
        snoozeCode: trimmed,
        sourceSurface: "showroom_welcome",
      });
      const canonicalCode = checkIn.snoozeCode || checkIn.shopperId || trimmed;
      if (checkIn.shopperChanged) resetShopperScopedState?.();
      getAssessment(canonicalCode).catch(() => {
        // ignore background hydrate miss
      });

      const introJob = await runHudAction("start_assessment", {
        scriptKey: "welcome.entry.new",
        shopperId: canonicalCode,
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

      const jobId = String(introJob?.id || "");
      if (jobId) {
        introSeenRef.current = true;
        setIntroJobId(jobId);
      } else {
        navigatedRef.current = true;
        navigate("/what-to-expect");
      }
    } catch (err) {
      console.error("Welcome start failed:", err);
      setError(
        "We couldn’t start your Snooze Session. Please check your code and try again."
      );
      hasStartedRef.current = false;
      setLoading(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && /^\d{4}$/.test(code)) {
      void handleStart(code);
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
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={4}
                    autoComplete="one-time-code"
                    placeholder="Enter Snooze Code"
                    value={code}
                    onChange={(event) => {
                      const nextCode = normalizeAccessCode(event.target.value);
                      setCode(nextCode);
                      if (error) setError("");
                      if (nextCode.length === 4) {
                        void handleStart(nextCode);
                      }
                    }}
                    onKeyDown={handleKeyDown}
                    disabled={loading}
                    className="w-full bg-transparent text-[1.02rem] font-semibold text-slate-900 outline-none placeholder:text-slate-400 md:text-[1.08rem]"
                  />
                </label>

                {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}

                {loading ? (
                  <div
                    className="mt-3.5 flex w-full items-center justify-center rounded-[18px] bg-[#eef3ff] px-6 py-3.5 text-base font-black text-[#2f57e8] md:text-[1.02rem]"
                    role="status"
                    aria-live="polite"
                  >
                    Loading your Snooze Session…
                  </div>
                ) : error && code.length === 4 ? (
                  <button
                    type="button"
                    onClick={() => void handleStart(code)}
                    className="mt-3.5 inline-flex w-full items-center justify-center gap-3 rounded-[18px] bg-[#2f57e8] px-6 py-3.5 text-base font-black text-white shadow-[0_22px_46px_rgba(47,87,232,0.26)] transition hover:bg-[#2749cb] md:text-[1.02rem]"
                  >
                    Try Again
                    <ArrowRight className="h-5 w-5" />
                  </button>
                ) : null}
              </div>

              <div className="mt-2.5 grid gap-2.5 rounded-[24px] border border-white/70 bg-white/86 p-2.5 shadow-sm lg:grid-cols-[minmax(0,1.06fr)_minmax(224px,0.94fr)]">
                <div className="rounded-[22px] border border-white/70 bg-white/92 px-4 py-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eef3ff] text-[#2f57e8]">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-[0.98rem] font-black text-slate-900">Personalize Your Experience</div>
                      <p className="mt-1 text-[0.84rem] leading-5 text-slate-600">
                        Your Snooze Code unlocks rewards, recommendations, and special discounts!
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
