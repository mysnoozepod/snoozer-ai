import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ShieldCheck } from "lucide-react";

import welcomeBrandMarkSrc from "@/assets/mysnoozepod-logo-welcome.png";
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

const SNOOZE_CODE_LENGTH = 6;

function normalizeAccessCode(raw) {
  return String(raw || "")
    .replace(/\D+/g, "")
    .slice(0, SNOOZE_CODE_LENGTH);
}

export default function Welcome() {
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();
  const { currentJob, noteUserInteraction, queue, runHudAction, voiceState } = useShowroomHud();

  const resetShopperScopedState = useStore((state) => state.resetShopperScopedState);
  const [digits, setDigits] = useState(() => {
    const storedCode = String(getAccessCode() || "").trim();
    const initialCode = new RegExp(`^\\d{${SNOOZE_CODE_LENGTH}}$`).test(storedCode)
      ? storedCode
      : "";
    return Array.from(
      { length: SNOOZE_CODE_LENGTH },
      (_, index) => initialCode[index] || ""
    );
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
    if (!new RegExp(`^\\d{${SNOOZE_CODE_LENGTH}}$`).test(trimmed)) {
      setError(`Enter all ${SNOOZE_CODE_LENGTH} digits of your Snooze Code.`);
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
    if (nextDigits.every(Boolean) && nextCode.length === SNOOZE_CODE_LENGTH) {
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

    if (
      event.key === "Enter" &&
      new RegExp(`^\\d{${SNOOZE_CODE_LENGTH}}$`).test(code)
    ) {
      void handleStart(code);
    }
  };

  const handleCodePaste = (index, event) => {
    const pastedDigits = normalizeAccessCode(event.clipboardData?.getData("text"));
    if (!pastedDigits) return;
    event.preventDefault();

    const isCompleteCode = pastedDigits.length === SNOOZE_CODE_LENGTH;
    const nextDigits = isCompleteCode
      ? Array.from({ length: SNOOZE_CODE_LENGTH }, () => "")
      : [...digits];
    const startIndex = isCompleteCode ? 0 : index;
    pastedDigits.split("").forEach((digit, offset) => {
      if (startIndex + offset < SNOOZE_CODE_LENGTH) nextDigits[startIndex + offset] = digit;
    });

    setDigits(nextDigits);
    if (error) setError("");
    digitInputRefs.current[
      Math.min(startIndex + pastedDigits.length, SNOOZE_CODE_LENGTH - 1)
    ]?.focus();

    const nextCode = nextDigits.join("");
    if (nextDigits.every(Boolean) && nextCode.length === SNOOZE_CODE_LENGTH) {
      void handleStart(nextCode);
    }
  };

  return (
    <ShowroomPageShell
      className="flex h-[100dvh] min-h-[100dvh] max-h-[100dvh] flex-col overflow-hidden pb-0 pt-0"
      data-welcome-shell="true"
    >
      <ShowroomTopRail className="shrink-0 justify-center pt-3 md:pt-4">
        <div data-welcome-logo="true">
          <ShowroomBrandMark
            imageSrc={welcomeBrandMarkSrc}
            imageClassName="w-[180px] md:w-[208px]"
          />
        </div>
      </ShowroomTopRail>

      <div className="mx-auto flex min-h-0 w-full max-w-[1380px] flex-1 flex-col px-4 pb-3 pt-2 md:px-6 md:pb-4">
        <ShowroomFrame className="min-h-0 flex-1 p-3.5 md:p-4" data-welcome-frame="true">
          <motion.div
            className="grid h-full min-h-0 gap-3.5 lg:grid-cols-[minmax(300px,0.78fr)_minmax(0,1.22fr)] lg:items-center"
            data-welcome-entry="true"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.36, ease: "easeOut" }}
          >
            <ShowroomPanel
              tone="soft"
              className="relative flex min-h-[286px] items-end justify-end overflow-hidden px-5 pb-2 pt-4 shadow-inner md:min-h-[316px] md:px-6"
              data-welcome-host="true"
            >
              <div
                className="absolute left-4 top-4 max-w-[232px] rounded-[var(--showroom-radius-panel)] bg-[var(--showroom-color-surface)] px-5 py-4 text-[var(--showroom-color-text-secondary)] shadow-[var(--showroom-shadow-panel)] md:left-5 md:top-5"
                data-welcome-greeting="true"
              >
                <div className="text-[1.58rem] font-black leading-tight text-[var(--showroom-color-brand-primary)]">Hi there.</div>
                <p className="mt-2 text-[0.92rem] leading-6">
                  I&apos;m Snoozer. I&apos;ll help you find the mattress that fits how you sleep.
                </p>
              </div>

              <div className="absolute inset-x-8 bottom-3 top-auto rounded-[var(--showroom-radius-pill)] bg-[var(--showroom-color-brand-border)] opacity-40 blur-3xl" />

              <img
                src="/snoozer-avatar.png"
                alt="Snoozer"
                className="relative z-10 h-auto w-[238px] max-w-full translate-x-2 object-contain drop-shadow-[0_18px_38px_rgba(47,87,232,0.18)] md:w-[266px]"
                data-welcome-snoozer="true"
                loading="lazy"
                decoding="async"
              />
            </ShowroomPanel>

            <div className="min-w-0">
              <h1 className="showroom-type-display max-w-[760px]" data-welcome-headline="true">
                <span data-welcome-headline-lead="true">Let&apos;s start your</span>{" "}
                <span className="whitespace-nowrap" data-welcome-headline-phrase="true">
                  Snooze Session.
                </span>
              </h1>

              <p className="showroom-type-body-large mt-2.5 max-w-xl">
                Enter your Snooze Code to continue your showroom visit.
              </p>

              <div
                className="mt-3.5 max-w-[660px] rounded-[var(--showroom-radius-panel)] border border-[var(--showroom-color-brand-border)] bg-[var(--showroom-color-surface-elevated)] p-3 shadow-[var(--showroom-shadow-card)] md:p-3.5"
                data-welcome-code-entry="true"
                aria-busy={loading ? "true" : "false"}
              >
                <fieldset>
                  <legend className="showroom-type-label text-[var(--showroom-color-brand-primary)]">
                    Enter Snooze Code
                  </legend>
                  <div className="mt-2.5 grid max-w-[620px] grid-cols-6 gap-2 md:gap-2.5">
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
                        readOnly={loading}
                        aria-readonly={loading ? "true" : undefined}
                        aria-invalid={error ? "true" : undefined}
                        aria-describedby="welcome-code-feedback"
                        className="welcome-code-input h-[68px] min-w-0 text-center text-[1.85rem] font-black md:h-[76px] md:text-[2.1rem]"
                      />
                    ))}
                  </div>
                </fieldset>

                <div
                  id="welcome-code-feedback"
                  className="mt-2 min-h-8"
                  data-welcome-code-feedback="true"
                >
                  {loading ? (
                    <div
                      className="flex min-h-12 w-full items-center justify-center rounded-[var(--showroom-radius-control)] bg-[var(--showroom-color-brand-soft)] px-6 py-3 text-base font-black text-[var(--showroom-color-brand-primary)]"
                      role="status"
                      aria-live="polite"
                    >
                      Loading your Snooze Session…
                    </div>
                  ) : error ? (
                    <div className="flex min-h-12 flex-wrap items-center justify-between gap-2">
                      <p className="showroom-type-supporting min-w-0 flex-1 text-[var(--showroom-color-error)]" role="alert">
                        {error}
                      </p>
                      {code.length === SNOOZE_CODE_LENGTH ? (
                        <button
                          type="button"
                          onClick={() => void handleStart(code)}
                          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--showroom-radius-control)] bg-[var(--showroom-color-brand-primary)] px-5 text-base font-black text-white shadow-[var(--showroom-shadow-active)] transition-colors duration-[var(--showroom-motion-fast)] hover:bg-[var(--showroom-color-brand-strong)] focus:outline-none focus-visible:shadow-[var(--showroom-shadow-focus)]"
                        >
                          Try Again
                          <ArrowRight className="h-5 w-5" />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-2.5 grid gap-2.5 lg:grid-cols-[minmax(0,1.06fr)_minmax(224px,0.94fr)]">
                <div className="welcome-info-card px-4 py-3" data-welcome-personalization="true">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--showroom-radius-pill)] bg-[var(--showroom-color-surface)] text-[var(--showroom-color-brand-primary)]">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="showroom-type-label text-[var(--showroom-color-text-primary)]">Personalize Your Experience</div>
                      <p className="showroom-type-supporting mt-1">
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
                  className="welcome-help-action flex min-h-[68px] w-full items-center gap-3 px-4 py-2.5 text-left"
                  data-welcome-human-help="true"
                >
                  <img
                    src={BRANDY_AVATAR_SRC}
                    alt="Brandy"
                    className="h-12 w-12 shrink-0 rounded-[var(--showroom-radius-pill)] border-2 border-[var(--showroom-color-brand-soft)] object-cover shadow-[var(--showroom-shadow-subtle)]"
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="showroom-type-label block text-[var(--showroom-color-text-primary)]">
                      Need Human Help?
                    </span>
                    <span className="showroom-type-supporting mt-0.5 block text-[0.78rem]">
                      Talk to Brandy, your dedicated Human Assistant.
                    </span>
                  </span>
                  <ArrowRight className="h-5 w-5 shrink-0 text-[var(--showroom-color-brand-primary)]" aria-hidden="true" />
                </button>
              </div>
            </div>
          </motion.div>
        </ShowroomFrame>
      </div>
    </ShowroomPageShell>
  );
}
