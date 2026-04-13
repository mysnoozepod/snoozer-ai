import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { ClipboardList, BedDouble, Layers3 } from "lucide-react";
import { getAssessment } from "@/lib/api";
import { useShowroomHud } from "@/lib/snoozer/hud/useShowroomHud";

function safeGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, val) {
  try {
    sessionStorage.setItem(key, val);
  } catch {
    // ignore
  }
}

function safeParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function isValidSnapshot(s) {
  return !!(s && typeof s === "object");
}

function normalizeSnapshot(shopperId, data) {
  const exists = !!data?.exists;
  const shopperState = data?.shopperState || (exists ? "KNOWN" : "NEW");

  return {
    shopperId,
    exists,
    shopperState,
    assessment: data?.assessment ?? null,
    profile: data?.profile ?? null,
    meta: data?.meta ?? null,
    actions: data?.actions || {
      canRetakeAssessment: true,
      shouldPromptAssessment: !exists,
    },
  };
}

function hasCompletedAssessment(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;

  const state = String(snapshot?.shopperState || "").toUpperCase().trim();

  if (snapshot?.assessment) return true;
  if (state === "ASSESSED" || state === "PROFILED") return true;

  return false;
}

function StepCard({ step, title, body, detail, icon: Icon, active = false }) {
  return (
    <motion.div
      className={[
        "relative rounded-[28px] border bg-white p-6 shadow-sm transition-all duration-300 md:p-7",
        active
          ? "border-[#1A66D2] shadow-lg ring-2 ring-[#1A66D2]/10"
          : "border-gray-200",
      ].join(" ")}
      animate={{
        y: active ? -4 : 0,
        scale: active ? 1.01 : 1,
      }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-extrabold uppercase tracking-[0.22em] text-[#1A66D2]">
            Step {step}
          </div>
          <div className="mt-3 text-2xl font-extrabold leading-tight text-gray-900 md:text-3xl">
            {title}
          </div>
        </div>

        <div
          className={[
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-colors duration-300",
            active ? "bg-[#EAF2FF] text-[#1A66D2]" : "bg-gray-100 text-gray-600",
          ].join(" ")}
        >
          <Icon className="h-6 w-6" />
        </div>
      </div>

      <div className="mt-4 text-base leading-relaxed text-gray-700 md:text-lg">
        {body}
      </div>

      <div className="mt-3 text-sm leading-relaxed text-gray-500 md:text-base">
        {detail}
      </div>
    </motion.div>
  );
}

function buildFallbackWhatToExpectScript(assessmentComplete) {
  if (assessmentComplete) {
    return {
      speech:
        "Here’s how this works. Your Snooze Assessment is already done. Next, try your recommended SnoozePods, then complete your sleep setup.",
      captions:
        "Here’s how this works. Your Snooze Assessment is already done. Next, try your recommended SnoozePods, then complete your sleep setup.",
      state: "speaking",
      priority: "normal",
      ttlMs: 5200,
      voiceStyle: "default",
      actions: [],
    };
  }

  return {
    speech:
      "Here’s how this works. Start with your Snooze Assessment, then try your recommended SnoozePods, then complete your sleep setup.",
    captions:
      "Here’s how this works. Start with your Snooze Assessment, then try your recommended SnoozePods, then complete your sleep setup.",
    state: "speaking",
    priority: "normal",
    ttlMs: 5200,
    voiceStyle: "default",
    actions: [],
  };
}

export default function WhatToExpect() {
  const navigate = useNavigate();
  const { noteUserInteraction, sayScript, voiceState } = useShowroomHud();

  const shopperId = safeGet("snooze.accessCode") || safeGet("snooze.shopperId") || "";
  const supportPhone = useMemo(() => {
    return (
      safeGet("snooze.supportPhone") ||
      import.meta.env.VITE_SUPPORT_PHONE ||
      "(8517-2541-3787)"
    );
  }, []);

  const [checking, setChecking] = useState(false);
  const [snapshot, setSnapshot] = useState(() => {
    const raw = safeGet("snooze.snapshot");
    const parsed = raw ? safeParseJson(raw) : null;
    return isValidSnapshot(parsed) ? parsed : null;
  });
  const [activeStep, setActiveStep] = useState(0);

  const introTimerRef = useRef(null);
  const announcedKeyRef = useRef("");
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (introTimerRef.current) {
        window.clearTimeout(introTimerRef.current);
        introTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrateSnapshot() {
      if (!shopperId) return;
      if (snapshot && isValidSnapshot(snapshot)) return;

      setChecking(true);

      try {
        const data = await getAssessment(shopperId);
        if (cancelled) return;

        const normalized = normalizeSnapshot(shopperId, data || {});
        setSnapshot(normalized);
        safeSet("snooze.snapshot", JSON.stringify(normalized));
        safeSet("snooze.shopperState", String(normalized.shopperState || "NEW"));
      } catch (err) {
        console.warn("Snapshot hydrate failed:", err);
        if (cancelled) return;

        const fallback = normalizeSnapshot(shopperId, {
          exists: false,
          shopperState: "NEW",
        });

        setSnapshot(fallback);
        safeSet("snooze.snapshot", JSON.stringify(fallback));
        safeSet("snooze.shopperState", "NEW");
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    hydrateSnapshot();

    return () => {
      cancelled = true;
    };
  }, [shopperId, snapshot]);

  const assessmentComplete = useMemo(() => {
    return hasCompletedAssessment(snapshot);
  }, [snapshot]);

  const captionPhases = useMemo(() => {
    if (assessmentComplete) {
      return [
        {
          step: 0,
          title: "Your Snooze Assessment is already on file.",
          body: "You can move into your Snooze Test now, or retake your assessment if you want a fresh match.",
        },
        {
          step: 1,
          title: "Next comes your Snooze Test.",
          body: "Try the recommended pods first, so you can feel the differences for yourself.",
        },
        {
          step: 2,
          title: "Then complete your sleep setup.",
          body: "Choose the mattress, base, and comfort options that feel right when you are ready.",
        },
      ];
    }

    return [
      {
        step: 0,
        title: "Start with your Snooze Assessment.",
        body: "Answer a few quick questions so Snoozer can learn your sleep needs and comfort preferences.",
      },
      {
        step: 1,
        title: "Then move into your Snooze Test.",
        body: "Try the recommended pods first, so you can feel the differences for yourself.",
      },
      {
        step: 2,
        title: "Finish by completing your sleep setup.",
        body: "Choose the mattress, base, and comfort options that feel right when you are ready.",
      },
    ];
  }, [assessmentComplete]);

  const voiceScript = useMemo(() => {
    return buildFallbackWhatToExpectScript(assessmentComplete);
  }, [assessmentComplete]);

  useEffect(() => {
    if (checking) return;
    if (!sayScript) return;

    const announcementKey = `${shopperId || "guest"}::${
      assessmentComplete ? "complete" : "default"
    }`;

    if (announcedKeyRef.current === announcementKey) return;

    if (introTimerRef.current) {
      window.clearTimeout(introTimerRef.current);
      introTimerRef.current = null;
    }

    introTimerRef.current = window.setTimeout(() => {
      if (!isMountedRef.current) return;

      const scriptKey = assessmentComplete
        ? "whattoexpect.assessment_complete"
        : "whattoexpect.default";

      sayScript({
        scriptKey,
        shopperId: shopperId || "guest",
        fallback: voiceScript,
        overrides: {
          interruptible: true,
          replaceCurrent: true,
          force: true,
        },
      }).catch((err) => {
        console.warn("What To Expect HUD intro failed.", err);
      });

      announcedKeyRef.current = announcementKey;
    }, 250);

    return () => {
      if (introTimerRef.current) {
        window.clearTimeout(introTimerRef.current);
        introTimerRef.current = null;
      }
    };
  }, [assessmentComplete, checking, shopperId, sayScript, voiceScript]);

  useEffect(() => {
    setActiveStep(0);

    const timers = [
      setTimeout(() => setActiveStep(0), 400),
      setTimeout(() => setActiveStep(1), 4200),
      setTimeout(() => setActiveStep(2), 8600),
    ];

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [assessmentComplete]);

  const currentPageVoiceState = useMemo(() => {
    const expectedText = String(voiceScript.speech || "").trim();
    const lastText = String(voiceState?.lastText || "").trim();

    const isCurrentAttempt = expectedText && lastText && expectedText === lastText;

    return {
      blocked: isCurrentAttempt ? Boolean(voiceState?.blocked) : false,
      error: isCurrentAttempt ? String(voiceState?.error || "") : "",
    };
  }, [voiceScript.speech, voiceState]);

  const primaryLabel = assessmentComplete
    ? "Continue to Snooze Test"
    : checking
    ? "Checking Your Snooze Session..."
    : "Start Your Snooze Assessment";

  const primaryAction = () => {
    noteUserInteraction?.();

    if (assessmentComplete) {
      navigate("/results");
      return;
    }

    navigate("/assessment");
  };

  const secondaryLabel = assessmentComplete
    ? "Retake Your Snooze Assessment"
    : "Go to Snooze Test";

  const secondaryAction = () => {
    noteUserInteraction?.();

    if (assessmentComplete) {
      navigate("/assessment");
      return;
    }

    navigate("/results");
  };

  return (
    <section className="min-h-screen bg-gradient-to-b from-[#D0D6E4] to-white px-4 py-6 md:py-8">
      <div className="mx-auto max-w-6xl">
        <div className="overflow-hidden rounded-[32px] border border-white/60 bg-white shadow-2xl">
          <div className="p-6 md:p-8">
            <motion.div
              className="rounded-[28px] border border-indigo-100 bg-gradient-to-r from-[#EEF4FF] to-white p-5 shadow-sm md:p-6"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:gap-8">
                <div className="flex min-w-0 items-start gap-4 md:gap-5">
                  <div className="relative shrink-0">
                    <div className="absolute inset-0 rounded-full bg-[#1A66D2] opacity-20 blur-2xl" />
                    <img
                      src="/snoozer-avatar.png"
                      alt="Snoozer"
                      className="relative h-20 w-20 rounded-full object-cover shadow-xl md:h-24 md:w-24"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>

                  <div className="min-w-0">
                    <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-[#2A2B2A] md:text-4xl">
                      What To Expect
                    </h1>

                    <p className="mt-2 max-w-3xl text-base text-gray-700 md:text-lg">
                      Snoozer will guide you through a simple three-step path:
                      Snooze Assessment, Snooze Test, and completing your sleep
                      setup.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-[24px] border border-white/80 bg-white/80 p-4 shadow-sm md:p-5">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeStep}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.28, ease: "easeOut" }}
                  >
                    <div className="text-sm font-extrabold uppercase tracking-[0.18em] text-[#1A66D2]">
                      Guided by Snoozer
                    </div>

                    <div className="mt-2 text-xl font-extrabold leading-tight text-gray-900 md:text-2xl">
                      {captionPhases[activeStep]?.title}
                    </div>

                    <div className="mt-2 text-sm leading-relaxed text-gray-600 md:text-base">
                      {captionPhases[activeStep]?.body}
                    </div>
                  </motion.div>
                </AnimatePresence>

                <div className="mt-4 flex items-center gap-2">
                  {captionPhases.map((phase, idx) => (
                    <div
                      key={`${phase.title}-${idx}`}
                      className={[
                        "h-2 rounded-full transition-all duration-300",
                        idx === activeStep ? "w-8 bg-[#1A66D2]" : "w-2 bg-[#B9D0F5]",
                      ].join(" ")}
                    />
                  ))}
                </div>
              </div>
            </motion.div>

            <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <StepCard
                step="1"
                title="Snooze Assessment"
                body="A few quick questions to learn how you sleep and what feels most comfortable."
                detail="This helps Snoozer understand your sleep needs, comfort preferences, and the type of setup that may fit you best."
                icon={ClipboardList}
                active={activeStep === 0}
              />

              <StepCard
                step="2"
                title="Snooze Test"
                body="Try the recommended pods first, so you can feel the differences for yourself."
                detail="You’ll start with the pod matches Snoozer recommends, so you’re not guessing from a wall of mattresses."
                icon={BedDouble}
                active={activeStep === 1}
              />

              <StepCard
                step="3"
                title="Complete Your Sleep Setup"
                body="Choose the mattress, base, and comfort options that feel right to you."
                detail="Once you know what you like, you can finish a complete sleep setup that fits your comfort and budget."
                icon={Layers3}
                active={activeStep === 2}
              />
            </div>

            <div className="mt-8 rounded-[28px] border border-gray-200 bg-[#F8FBFF] p-5 shadow-sm md:p-6">
              <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div className="max-w-2xl">
                  <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#1A66D2]">
                    Next Step
                  </div>

                  <div className="mt-2 text-2xl font-extrabold tracking-tight text-gray-900">
                    {assessmentComplete
                      ? "Your Snooze Assessment is already complete."
                      : "Start with your Snooze Assessment."}
                  </div>

                  <div className="mt-2 text-base leading-relaxed text-gray-600">
                    {assessmentComplete
                      ? "Snoozer already has enough information to move you into your Snooze Test. You can also retake your Snooze Assessment if you want a fresh recommendation."
                      : "This is the fastest way for Snoozer to guide you toward the sleep setup that fits you best."}
                  </div>
                </div>

                <div className="flex w-full flex-col gap-3 md:w-[340px]">
                  <Button
                    type="button"
                    onClick={primaryAction}
                    disabled={checking}
                    className="w-full rounded-2xl bg-[#1A66D2] py-6 text-base font-semibold text-white hover:bg-[#1550A0]"
                  >
                    {primaryLabel}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={secondaryAction}
                    disabled={checking}
                    className="w-full rounded-2xl border-[#B7CBEF] py-6 text-base font-semibold text-[#335C97] hover:bg-[#EEF4FF]"
                  >
                    {secondaryLabel}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 bg-white px-6 py-4 md:px-8">
            <div className="flex flex-col gap-2 text-sm text-gray-600 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold text-gray-900">Support:</span>
                <span>{supportPhone}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {currentPageVoiceState.blocked ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                    Tap to enable Snoozer voice
                  </span>
                ) : null}

                {currentPageVoiceState.error ? (
                  <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                    Snoozer voice unavailable
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
