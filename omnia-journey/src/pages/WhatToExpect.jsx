import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
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

function StepCard({ step, title, body, detail, icon: Icon }) {
  return (
    <div className="flex h-full flex-col rounded-[26px] border border-white/80 bg-white px-5 py-5 text-center shadow-[0_18px_42px_rgba(45,71,136,0.09)] md:px-6 md:py-6">
      <div className="text-[0.82rem] font-black uppercase tracking-[0.24em] text-[#1A66D2]">
        Step {step}
      </div>

      <div className="mt-4 flex justify-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-[24px] bg-[linear-gradient(180deg,#F4F8FF_0%,#EFF4FF_100%)] text-[#2f57e8] shadow-inner">
          <Icon className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-5 text-[1.04rem] font-black leading-tight text-slate-900 md:text-[1.16rem]">
        {title}
      </div>

      <div className="mt-4 text-[0.94rem] leading-7 text-slate-600">
        {body}
      </div>

      {detail ? (
        <div
          className={[
            "mt-3 text-[0.94rem] leading-7",
            detail === "You’re here"
              ? "font-semibold text-[#2f57e8]"
              : "text-slate-600",
          ].join(" ")}
        >
          {detail}
        </div>
      ) : null}

      <div className="mt-auto pt-5">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#EEF4FF] text-[1.2rem] font-black text-[#2f57e8]">
          {step}
        </div>
      </div>
    </div>
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
            className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <div className="min-w-0">
              <div className="min-w-0">
                <h1 className="text-[2.45rem] font-black tracking-tight text-slate-900 md:text-[3rem] xl:text-[3.4rem]">
                  Your guided showroom path.
                </h1>
                <p className="mt-2.5 max-w-3xl text-[0.96rem] leading-6 text-slate-700 md:text-[1rem]">
                  Start with your match, test your top pods, then build the setup that feels right.
                </p>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
                <StepCard
                  step="1"
                  title="Assessment"
                  body="Answer a few sleep questions to create your personalized sleep profile."
                  detail={assessmentComplete ? "" : "You’re here"}
                  icon={ClipboardList}
                />
                <StepCard
                  step="2"
                  title="Test Recommended Pods"
                  body="Start with your best match, then compare."
                  detail="Test one pod at a time while the feel stays fresh."
                  icon={BedDouble}
                />
                <StepCard
                  step="3"
                  title="Build Your Sleep Setup"
                  body="Choose your mattress, base, and comfort options."
                  detail="Once you know your feel, the final setup gets easier."
                  icon={Layers3}
                />
              </div>
            </div>

            <div className="space-y-2.5 xl:self-start">
              <ShowroomPanel className="p-4 shadow-[0_20px_52px_rgba(47,72,137,0.10)] md:p-4.5">
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
