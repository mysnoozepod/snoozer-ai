import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  BedDouble,
  Check,
  ClipboardList,
  Layers3,
  PackageCheck,
} from "lucide-react";

import welcomeBrandMarkSrc from "@/assets/mysnoozepod-logo-welcome.png";
import { getAssessment } from "@/lib/api";
import { useShowroomHud } from "@/lib/snoozer/hud/useShowroomHud";
import { getWhatToExpectFallback } from "@/lib/snoozer/hud/whatToExpectFallbacks";
import { getShopperId } from "@/state/sessionStore";
import {
  ShowroomBrandMark,
  ShowroomFrame,
  ShowroomPageShell,
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

const STEP_STATE_LABELS = Object.freeze({
  completed: "Completed",
  current: "You’re here",
  upcoming: "Coming up",
});

function StepCard({ step, title, body, icon: Icon, state = "upcoming", stateLabel }) {
  const isCurrent = state === "current";
  const isCompleted = state === "completed";
  const resolvedStateLabel = stateLabel || STEP_STATE_LABELS[state] || STEP_STATE_LABELS.upcoming;

  return (
    <div
      data-testid={`what-step-${step}`}
      data-journey-state={state}
      aria-current={isCurrent ? "step" : undefined}
      className={[
        "grid min-h-[176px] grid-cols-[88px_minmax(0,1fr)] items-center gap-4 rounded-[var(--showroom-radius-card)] border p-4 text-left",
        isCurrent
          ? "border-[var(--showroom-color-brand-primary)] bg-[linear-gradient(135deg,#eef3ff_0%,#ffffff_72%)] shadow-[var(--showroom-shadow-active)] ring-2 ring-[var(--showroom-color-brand-border)]"
          : isCompleted
            ? "border-[var(--showroom-color-brand-border)] bg-[var(--showroom-color-brand-soft)] shadow-[var(--showroom-shadow-subtle)]"
            : "border-white/80 bg-[var(--showroom-color-surface)] shadow-[var(--showroom-shadow-card)]",
      ].join(" ")}
    >
      <div
        className={[
          "flex h-[88px] w-[88px] items-center justify-center rounded-[24px]",
          isCurrent
            ? "bg-[var(--showroom-color-brand-primary)] text-white shadow-[var(--showroom-shadow-active)]"
            : "bg-[var(--showroom-color-brand-soft)] text-[var(--showroom-color-brand-primary)] shadow-inner",
        ].join(" ")}
        data-journey-icon="true"
      >
        <Icon className="h-14 w-14" strokeWidth={1.7} aria-hidden="true" />
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="showroom-type-eyebrow">Step {step}</span>
          <span
            className={[
              "inline-flex min-h-7 items-center gap-1 rounded-[var(--showroom-radius-pill)] px-2.5 text-[0.68rem] font-black uppercase tracking-[0.1em]",
              isCurrent
                ? "bg-[var(--showroom-color-brand-primary)] text-white"
                : isCompleted
                  ? "bg-[var(--showroom-color-surface)] text-[var(--showroom-color-brand-strong)]"
                  : "bg-slate-100 text-slate-500",
            ].join(" ")}
            data-journey-state-label="true"
          >
            {isCompleted ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> : null}
            {resolvedStateLabel}
          </span>
        </div>
        <div className="mt-2 text-[1.08rem] font-black leading-[1.12] text-[var(--showroom-color-text-primary)] md:text-[1.16rem]">
          {title}
        </div>
        <div className="showroom-type-supporting mt-2 text-[0.86rem]">{body}</div>
      </div>
    </div>
  );
}

export default function WhatToExpect() {
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();
  const { currentJob, queue, say, voiceState } = useShowroomHud();

  const shopperId = getShopperId() || "";

  const [snapshot, setSnapshot] = useState(() => {
    const raw = safeGet("snooze.snapshot");
    const parsed = raw ? safeParseJson(raw) : null;
    return isValidSnapshot(parsed) ? parsed : null;
  });
  const [checking, setChecking] = useState(() => Boolean(shopperId && !snapshot));
  const [orientationJobId, setOrientationJobId] = useState("");

  const announcedKeyRef = useRef("");
  const orientationSeenRef = useRef(false);
  const navigatedRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
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
    return getWhatToExpectFallback(assessmentComplete);
  }, [assessmentComplete]);

  useEffect(() => {
    if (checking) return;
    if (!say) return;

    const announcementKey = `${shopperId || "guest"}::${assessmentComplete ? "complete" : "default"}`;

    if (announcedKeyRef.current === announcementKey) return;

    announcedKeyRef.current = announcementKey;
    orientationSeenRef.current = false;
    navigatedRef.current = false;

    void (async () => {
      const scriptKey = assessmentComplete ? "whattoexpect.assessment_complete" : "whattoexpect.default";

      try {
        const job = await say({
          ...voiceScript,
          actionType: assessmentComplete ? "view_results" : "start_assessment",
          interruptible: true,
          replaceCurrent: true,
          force: true,
          metadata: { scriptKey, presentationSource: "what-to-expect" },
        });
        if (!isMountedRef.current) return;
        const jobId = String(job?.id || "");
        if (jobId) {
          orientationSeenRef.current = true;
          setOrientationJobId(jobId);
          return;
        }

        navigatedRef.current = true;
        navigate(assessmentComplete ? "/results" : "/assessment", { replace: true });
      } catch (err) {
        console.warn("What To Expect HUD intro failed.", err);
        if (!isMountedRef.current || navigatedRef.current) return;
        navigatedRef.current = true;
        navigate(assessmentComplete ? "/results" : "/assessment", { replace: true });
      }
    })();
  }, [assessmentComplete, checking, navigate, shopperId, say, voiceScript]);

  useEffect(() => {
    if (!orientationJobId || navigatedRef.current) return;

    const isActive = String(currentJob?.id || "") === orientationJobId;
    const isQueued = Array.isArray(queue)
      ? queue.some((job) => String(job?.id || "") === orientationJobId)
      : false;

    if (isActive || isQueued) {
      orientationSeenRef.current = true;
      return;
    }

    if (!orientationSeenRef.current) return;
    if (voiceState?.loading || voiceState?.playing) return;

    navigatedRef.current = true;
    navigate(assessmentComplete ? "/results" : "/assessment", { replace: true });
  }, [assessmentComplete, currentJob, navigate, orientationJobId, queue, voiceState?.loading, voiceState?.playing]);

  const currentPageVoiceState = useMemo(() => {
    const expectedText = String(voiceScript.speech || "").trim();
    const lastText = String(voiceState?.lastText || "").trim();

    const isCurrentAttempt = expectedText && lastText && expectedText === lastText;

    return {
      blocked: isCurrentAttempt ? Boolean(voiceState?.blocked) : false,
      error: isCurrentAttempt ? String(voiceState?.error || "") : "",
    };
  }, [voiceScript.speech, voiceState]);

  const journeySteps = useMemo(
    () => [
      {
        step: "1",
        title: "Build Your Sleep Profile",
        body: "Tell us how you sleep.",
        icon: ClipboardList,
        state: checking ? "upcoming" : assessmentComplete ? "completed" : "current",
      },
      {
        step: "2",
        title: "Visit Your Recommended Pods",
        body: "Try your best matches.",
        icon: BedDouble,
        state: checking ? "upcoming" : assessmentComplete ? "current" : "upcoming",
        stateLabel: assessmentComplete ? "Next up" : undefined,
      },
      {
        step: "3",
        title: "Explore Sleep Essentials",
        body: "Pillows, bedding & protection.",
        icon: PackageCheck,
        state: "upcoming",
      },
      {
        step: "4",
        title: "Build Your Sleep Setup",
        body: "Choose what feels right.",
        icon: Layers3,
        state: "upcoming",
      },
    ],
    [assessmentComplete, checking]
  );

  const visibleGuidance = checking
    ? "I’m getting your showroom path ready."
    : voiceScript.captions || voiceScript.speech;

  return (
    <ShowroomPageShell
      className="flex h-[100dvh] min-h-[100dvh] max-h-[100dvh] flex-col overflow-hidden pb-0 pt-0"
      data-what-to-expect-shell="true"
    >
      <ShowroomTopRail className="shrink-0 justify-center pt-3 md:pt-4">
        <ShowroomBrandMark
          imageSrc={welcomeBrandMarkSrc}
          imageClassName="w-[180px] md:w-[208px]"
        />
      </ShowroomTopRail>

      <div className="mx-auto flex min-h-0 w-full max-w-[1380px] flex-1 flex-col px-4 pb-3 pt-2 md:px-6 md:pb-4">
        <ShowroomFrame className="min-h-0 flex-1 p-3.5 md:p-4" data-what-to-expect-frame="true">
          <motion.div
            className="grid h-full min-h-0 gap-3.5 lg:grid-cols-[minmax(248px,0.72fr)_minmax(0,2fr)] lg:items-center"
            data-what-to-expect-entry="true"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.3, ease: "easeOut" }}
          >
            <div
              className="relative mx-auto flex min-h-[430px] w-full max-w-[320px] flex-col overflow-hidden rounded-[var(--showroom-radius-panel)] border border-[var(--showroom-color-brand-border)] bg-[linear-gradient(180deg,#f6f9ff_0%,#ffffff_100%)] p-4 shadow-[var(--showroom-shadow-panel)]"
              data-what-to-expect-guide="true"
              data-guidance-branch={checking ? "checking" : assessmentComplete ? "complete" : "incomplete"}
            >
              <div
                className="relative z-10 rounded-[var(--showroom-radius-card)] bg-[var(--showroom-color-surface)] p-4 shadow-[var(--showroom-shadow-card)]"
                aria-live="polite"
                data-what-to-expect-guidance="true"
              >
                <div className="showroom-type-eyebrow">Snoozer’s guide</div>
                <p className="mt-2 text-[0.94rem] font-semibold leading-6 text-[var(--showroom-color-text-secondary)]">
                  {visibleGuidance}
                </p>
                {currentPageVoiceState.blocked ? (
                  <span className="mt-3 inline-flex rounded-[var(--showroom-radius-pill)] border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                    Tap to enable Snoozer voice
                  </span>
                ) : null}
                {currentPageVoiceState.error ? (
                  <span className="mt-3 inline-flex rounded-[var(--showroom-radius-pill)] border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                    Snoozer voice unavailable
                  </span>
                ) : null}
              </div>

              <div className="absolute inset-x-10 bottom-4 h-10 rounded-[var(--showroom-radius-pill)] bg-[var(--showroom-color-brand-border)] opacity-50 blur-2xl" />
              <img
                src="/snoozer-avatar.png"
                alt="Snoozer"
                className="relative z-10 mx-auto mt-auto h-auto w-[210px] max-w-full object-contain drop-shadow-[0_18px_38px_rgba(47,87,232,0.18)]"
                data-what-to-expect-snoozer="true"
                loading="eager"
                decoding="async"
              />
            </div>

            <div className="min-w-0" data-what-to-expect-map="true">
              <div className="min-w-0 text-left">
                <h1 className="showroom-type-display text-[2.35rem] md:text-[2.7rem] xl:text-[3rem]">
                  Your guided showroom path.
                </h1>
                <p className="showroom-type-body-large mt-2 max-w-2xl">
                  Four simple steps. I’ll guide you along the way.
                </p>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2" data-what-to-expect-steps="true">
                  {journeySteps.map((step) => (
                    <StepCard key={step.step} {...step} />
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </ShowroomFrame>
      </div>
    </ShowroomPageShell>
  );
}
