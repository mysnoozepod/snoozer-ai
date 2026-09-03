import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { checkInSnoozeCode, getAssessment } from "@/lib/api";
import { getAccessCode } from "@/state/sessionStore";
import { useStore } from "@/lib/useStore";
import { useShowroomHud } from "@/lib/snoozer/hud/useShowroomHud";
import {
  BRANDY_AVATAR_SRC,
  requestHumanAssistance,
} from "@/components/HumanAssistanceControl";
import {
  ShowroomBrandMark,
  ShowroomFrame,
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
  const { currentJob, noteUserInteraction, queue, runHudAction, voiceState } = useShowroomHud();

  const resetShopperScopedState = useStore((state) => state.resetShopperScopedState);
  const [digits, setDigits] = useState(() => {
    const storedCode = String(getAccessCode() || "").trim();
    const initialCode = /^\d{4}$/.test(storedCode) ? storedCode : "";
    return Array.from({ length: 4 }, (_, index) => initialCode[index] || "");
  });
  const code = digits.join("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [introJobId, setIntroJobId] = useState("");

  const hasStartedRef = useRef(false);
  const introSeenRef = useRef(false);
  const navigatedRef = useRef(false);
  const digitInputRefs = useRef([]);

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

  const handleDigitChange = (index, rawValue) => {
    const nextDigit = normalizeAccessCode(rawValue).slice(-1);
    const nextDigits = [...digits];
    nextDigits[index] = nextDigit;
    setDigits(nextDigits);
    if (error) setError("");

    if (nextDigit && index < nextDigits.length - 1) {
      digitInputRefs.current[index + 1]?.focus();
    }

    const nextCode = nextDigits.join("");
    if (nextDigits.every(Boolean) && nextCode.length === 4) {
      void handleStart(nextCode);
    }
  };

  const handleDigitKeyDown = (index, event) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      event.preventDefault();
      digitInputRefs.current[index - 1]?.focus();
      digitInputRefs.current[index - 1]?.select();
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      digitInputRefs.current[index - 1]?.focus();
      return;
    }

    if (event.key === "ArrowRight" && index < digits.length - 1) {
      event.preventDefault();
      digitInputRefs.current[index + 1]?.focus();
      return;
    }

    if (event.key === "Enter" && /^\d{4}$/.test(code)) {
      void handleStart(code);
    }
  };

  const handleCodePaste = (index, event) => {
    const pastedDigits = normalizeAccessCode(event.clipboardData?.getData("text"));
    if (!pastedDigits) return;
    event.preventDefault();

    const nextDigits = pastedDigits.length === 4 ? ["", "", "", ""] : [...digits];
    const startIndex = pastedDigits.length === 4 ? 0 : index;
    pastedDigits.split("").forEach((digit, offset) => {
      if (startIndex + offset < 4) nextDigits[startIndex + offset] = digit;
    });

    setDigits(nextDigits);
    if (error) setError("");
    digitInputRefs.current[Math.min(startIndex + pastedDigits.length, 3)]?.focus();

    const nextCode = nextDigits.join("");
    if (nextDigits.every(Boolean) && nextCode.length === 4) {
      void handleStart(nextCode);
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
                <fieldset>
                  <legend className="text-sm font-black text-[#2f57e8] md:text-base">
                    Enter Snooze Code
                  </legend>
                  <div className="mt-3 grid max-w-[460px] grid-cols-4 gap-3 md:gap-4">
                    {digits.map((digit, index) => (
                      <input
                        key={index}
                        ref={(element) => {
                          digitInputRefs.current[index] = element;
                        }}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={1}
                        autoComplete={index === 0 ? "one-time-code" : "off"}
                        aria-label={`Snooze Code digit ${index + 1}`}
                        value={digit}
                        onChange={(event) => handleDigitChange(index, event.target.value)}
                        onKeyDown={(event) => handleDigitKeyDown(index, event)}
                        onPaste={(event) => handleCodePaste(index, event)}
                        onFocus={(event) => event.target.select()}
                        disabled={loading}
                        className="h-[72px] min-w-0 rounded-[20px] border border-[#9db6ff] bg-white text-center text-[2rem] font-black text-slate-900 shadow-sm outline-none transition focus:border-[#2f57e8] focus:ring-4 focus:ring-blue-100 disabled:bg-[#f4f7ff] md:h-[82px] md:text-[2.25rem]"
                      />
                    ))}
                  </div>
                </fieldset>

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

                <button
                  type="button"
                  onClick={() => {
                    noteUserInteraction?.();
                    requestHumanAssistance({ sourcePage: "/welcome" });
                  }}
                  className="flex w-full items-center gap-3 rounded-[22px] border border-white/70 bg-white/92 px-4 py-3 text-left shadow-sm transition hover:border-indigo-100 hover:bg-white focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                >
                  <img
                    src={BRANDY_AVATAR_SRC}
                    alt="Brandy"
                    className="h-12 w-12 shrink-0 rounded-full border-2 border-[#e9efff] object-cover shadow-sm"
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="min-w-0">
                    <span className="block text-[0.94rem] font-black text-slate-900">
                      Need Human Help?
                    </span>
                    <span className="mt-0.5 block text-[0.78rem] leading-5 text-slate-600">
                      Talk to Brandy, your dedicated Human Assistant.
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </motion.div>
        </ShowroomFrame>
      </div>
    </ShowroomPageShell>
  );
}
