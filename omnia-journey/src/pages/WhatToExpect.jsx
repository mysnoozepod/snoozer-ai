import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  BedDouble,
  ClipboardList,
  Layers3,
  ShieldCheck,
} from "lucide-react";

import { getAssessment } from "@/lib/api";
import { useShowroomHud } from "@/lib/snoozer/hud/useShowroomHud";
import {
  ShowroomBrandMark,
  ShowroomEyebrow,
  ShowroomFrame,
  ShowroomPageShell,
  ShowroomPanel,
  ShowroomTopRail,
} from "@/components/showroom/ShowroomPrimitives";

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
        "relative rounded-[22px] border bg-white p-3 shadow-[0_16px_40px_rgba(45,71,136,0.08)] transition-all duration-300 md:p-3.5",
        active
          ? "border-[#1A66D2] shadow-lg ring-2 ring-[#1A66D2]/10"
          : "border-white/70",
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
          <div className="mt-1.5 text-[1.04rem] font-extrabold leading-tight text-gray-900 md:text-[1.16rem]">
            {title}
          </div>
        </div>

        <div
          className={[
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition-colors duration-300",
            active ? "bg-[#EAF2FF] text-[#1A66D2]" : "bg-gray-100 text-gray-600",
          ].join(" ")}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-2 text-[0.86rem] leading-5 text-gray-700 md:text-[0.9rem]">
        {body}
      </div>

      <div className="mt-1.5 text-[11px] leading-4 text-gray-500 md:text-[0.78rem]">
        {detail}
      </div>
    </motion.div>
  );
}

function buildFallbackWhatToExpectScript(assessmentComplete) {
  if (assessmentComplete) {
    return {
      speech:
        "Here's how this works. Your Snooze Assessment is already done. Next, try your recommended SnoozePods, then complete your sleep setup.",
      captions:
        "Here's how this works. Your Snooze Assessment is already done. Next, try your recommended SnoozePods, then complete your sleep setup.",
      state: "speaking",
      priority: "normal",
      ttlMs: 5200,
      voiceStyle: "default",
      actions: [],
    };
  }

  return {
    speech:
      "Here's how this works. Start with your Snooze Assessment, then try your recommended SnoozePods, then complete your sleep setup.",
    captions:
      "Here's how this works. Start with your Snooze Assessment, then try your recommended SnoozePods, then complete your sleep setup.",
    state: "speaking",
    priority: "normal",
    ttlMs: 5200,
    voiceStyle: "default",
    actions: [],
  };
}

export default function WhatToExpect() {
  const navigate = useNavigate();
  const { noteUserInteraction, runHudAction, voiceState } = useShowroomHud();

  const shopperId = safeGet("snooze.accessCode") || safeGet("snooze.shopperId") || "";

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
          body: "You can move into your Snooze Test now or retake the assessment for a fresh match.",
        },
        {
          step: 1,
          title: "Next comes your Snooze Test.",
          body: "Start with your recommended pods so the feel differences stay obvious.",
        },
        {
          step: 2,
          title: "Then complete your sleep setup.",
          body: "Choose the mattress, base, and comfort options that feel right.",
        },
      ];
    }

    return [
      {
        step: 0,
        title: "Start with your Snooze Assessment.",
        body: "Answer a few quick questions so Snoozer can learn how you sleep.",
      },
      {
        step: 1,
        title: "Then move into your Snooze Test.",
        body: "Start with your recommended pods so the feel differences stay obvious.",
      },
      {
        step: 2,
        title: "Finish by completing your sleep setup.",
        body: "Choose the mattress, base, and comfort options that feel right.",
      },
    ];
  }, [assessmentComplete]);

  const voiceScript = useMemo(() => {
    return buildFallbackWhatToExpectScript(assessmentComplete);
  }, [assessmentComplete]);

  useEffect(() => {
    if (checking) return;
    if (!runHudAction) return;

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

      runHudAction(assessmentComplete ? "view_results" : "start_assessment", {
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
  }, [assessmentComplete, checking, shopperId, runHudAction, voiceScript]);

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

  const ctaReady = assessmentComplete || !checking || Boolean(snapshot) || !shopperId;
  const primaryLabel = assessmentComplete
    ? "Go to My Recommended Pods"
    : "Start Your Snooze Assessment";

  const primaryAction = () => {
    noteUserInteraction?.();

    if (assessmentComplete) {
      navigate("/results");
      return;
    }

    navigate("/assessment");
  };

  const secondaryAction = () => {
    noteUserInteraction?.();
    navigate("/assessment");
  };

  return (
    <ShowroomPageShell className="flex min-h-0 flex-col overflow-hidden pb-0">
      <ShowroomTopRail className="justify-center pt-4 md:pt-5">
        <ShowroomBrandMark imageClassName="w-[190px] md:w-[220px]" />
      </ShowroomTopRail>

      <div className="mx-auto flex min-h-0 w-full max-w-[1380px] flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-4 pt-2 md:px-6">
        <ShowroomFrame className="shrink-0 p-3.5 md:p-4">
          <motion.div
            className="grid gap-3 lg:grid-cols-[minmax(0,1.08fr)_312px]"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <div className="min-w-0">
              <div className="min-w-0">
                <ShowroomEyebrow>What To Expect</ShowroomEyebrow>
                <h1 className="mt-2 text-[2.45rem] font-black tracking-tight text-slate-900 md:text-[3rem] xl:text-[3.4rem]">
                  Your guided showroom path.
                </h1>
                <p className="mt-2.5 max-w-3xl text-[0.96rem] leading-6 text-slate-700 md:text-[1rem]">
                  Start with your match, test your top pods, then build the setup that feels right.
                </p>
              </div>

              <div className="mt-3 rounded-[24px] border border-white/80 bg-[linear-gradient(135deg,rgba(236,243,255,0.92),rgba(255,255,255,0.98))] p-3.5 shadow-sm">
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
                    <div className="mt-1.5 text-[1.3rem] font-extrabold leading-tight text-slate-900 md:text-[1.54rem]">
                      {captionPhases[activeStep]?.title}
                    </div>
                    <div className="mt-1.5 max-w-2xl text-[0.9rem] leading-5 text-slate-600 md:text-[0.94rem]">
                      {captionPhases[activeStep]?.body}
                    </div>
                  </motion.div>
                </AnimatePresence>

                <div className="mt-3 flex items-center gap-2">
                  {captionPhases.map((phase, idx) => (
                    <div
                      key={`${phase.title}-${idx}`}
                      className={[
                        "h-2 rounded-full transition-all duration-300",
                        idx === activeStep ? "w-10 bg-[#1A66D2]" : "w-3 bg-[#B9D0F5]",
                      ].join(" ")}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-3">
                <StepCard
                  step="1"
                  title="Assessment"
                  body="Answer a few sleep questions."
                  detail="This shapes your mattress, base, and motion path."
                  icon={ClipboardList}
                  active={activeStep === 0}
                />
                <StepCard
                  step="2"
                  title="Test Recommended Pods"
                  body="Start with your best match, then compare."
                  detail="Test one pod at a time while the feel stays fresh."
                  icon={BedDouble}
                  active={activeStep === 1}
                />
                <StepCard
                  step="3"
                  title="Build Your Sleep Setup"
                  body="Choose your mattress, base, and comfort options."
                  detail="Once you know your feel, the final setup gets easier."
                  icon={Layers3}
                  active={activeStep === 2}
                />
              </div>
            </div>

            <div className="space-y-2.5">
              <ShowroomPanel className="p-4 shadow-[0_20px_52px_rgba(47,72,137,0.10)]">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#eef3ff] text-[#2f57e8]">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-extrabold uppercase tracking-[0.18em] text-[#1A66D2]">
                      Next Step
                    </div>
                    <div className="mt-1.5 text-[1.25rem] font-black tracking-tight text-slate-900">
                      {assessmentComplete
                        ? "Your assessment is already complete."
                        : "Start with your Snooze Assessment."}
                    </div>
                    <p className="mt-2 text-[0.9rem] leading-5 text-slate-600">
                      {assessmentComplete
                        ? "You can go straight to your recommended pods, or retake the assessment for a fresh match."
                        : "This is the fastest way to turn your showroom visit into clear pod recommendations."}
                    </p>
                  </div>
                </div>

                <div className="mt-3 space-y-2.5">
                  {ctaReady ? (
                    <>
                      <button
                        type="button"
                        onClick={primaryAction}
                        disabled={checking}
                        className="inline-flex w-full items-center justify-center gap-3 rounded-[18px] bg-[#1A66D2] px-6 py-3.5 text-[0.96rem] font-black text-white shadow-[0_22px_46px_rgba(26,102,210,0.24)] transition hover:bg-[#1550A0] disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {primaryLabel}
                        <ArrowRight className="h-5 w-5" />
                      </button>

                      {assessmentComplete ? (
                        <button
                          type="button"
                          onClick={secondaryAction}
                          disabled={checking}
                          className="w-full rounded-[18px] border border-[#B7CBEF] bg-white px-6 py-3 text-sm font-black text-[#335C97] transition hover:bg-[#EEF4FF]"
                        >
                          Retake Snooze Assessment
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <div className="rounded-[18px] bg-[#1A66D2] px-6 py-3.5 text-center text-base font-black text-white">
                      Preparing Your Next Step
                    </div>
                  )}
                </div>
              </ShowroomPanel>
            </div>
          </motion.div>

          {currentPageVoiceState.blocked || currentPageVoiceState.error ? (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-gray-600">
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
          ) : null}
        </ShowroomFrame>
      </div>
    </ShowroomPageShell>
  );
}
