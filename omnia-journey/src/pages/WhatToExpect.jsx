import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  BedDouble,
  ClipboardList,
  Layers3,
  PackageCheck,
} from "lucide-react";

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

function StepCard({ step, title, body, detail, icon: Icon }) {
  return (
    <div
      data-testid={`what-step-${step}`}
      className="flex h-full min-h-[248px] flex-col rounded-[26px] border border-white/80 bg-white px-5 py-5 text-center shadow-[0_18px_40px_rgba(45,71,136,0.09)]"
    >
      <div className="text-[0.78rem] font-black uppercase tracking-[0.22em] text-[#1A66D2]">
        Step {step}
      </div>

      <div className="mt-2.5 flex justify-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-[linear-gradient(180deg,#F4F8FF_0%,#EFF4FF_100%)] text-[#2f57e8] shadow-inner">
          <Icon className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-3 text-[0.95rem] font-black leading-tight text-slate-900 md:text-[1.04rem]">
        {title}
      </div>

      <div className="mt-2.5 text-[0.84rem] leading-5 text-slate-600">
        {body}
      </div>

      {detail ? (
        <div
          className={[
            "mt-2 text-[0.84rem] leading-5",
            detail === "You’re here" ? "font-semibold text-[#2f57e8]" : "text-slate-600",
          ].join(" ")}
        >
          {detail}
        </div>
      ) : null}
    </div>
  );
}

export default function WhatToExpect() {
  const navigate = useNavigate();
  const { currentJob, queue, runHudAction, voiceState } = useShowroomHud();

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
    if (!runHudAction) return;

    const announcementKey = `${shopperId || "guest"}::${assessmentComplete ? "complete" : "default"}`;

    if (announcedKeyRef.current === announcementKey) return;

    announcedKeyRef.current = announcementKey;
    orientationSeenRef.current = false;
    navigatedRef.current = false;

    void (async () => {
      const scriptKey = assessmentComplete ? "whattoexpect.assessment_complete" : "whattoexpect.default";

      try {
        const job = await runHudAction(assessmentComplete ? "view_results" : "start_assessment", {
          scriptKey,
          shopperId: shopperId || "guest",
          fallback: voiceScript,
          overrides: {
            interruptible: true,
            replaceCurrent: true,
            force: true,
          },
        });
        if (!isMountedRef.current) return;
        setOrientationJobId(String(job?.id || ""));
      } catch (err) {
        console.warn("What To Expect HUD intro failed.", err);
      }
    })();
  }, [assessmentComplete, checking, shopperId, runHudAction, voiceScript]);

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

  return (
    <ShowroomPageShell className="flex min-h-0 flex-col overflow-hidden pb-0">
      <ShowroomTopRail className="justify-center pt-4 md:pt-5">
        <ShowroomBrandMark imageClassName="w-[190px] md:w-[220px]" />
      </ShowroomTopRail>

      <div className="mx-auto flex min-h-0 w-full max-w-[1380px] flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-4 pt-2 md:px-6">
        <ShowroomFrame className="shrink-0 p-3.5 md:p-4">
          <motion.div
            className="min-w-0"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <div className="min-w-0 text-center">
              <h1 className="text-[2.2rem] font-black tracking-tight text-slate-900 md:text-[2.75rem] xl:text-[3.15rem]">
                Your guided showroom path.
              </h1>
              <p className="mx-auto mt-2 max-w-3xl text-[0.92rem] leading-6 text-slate-700 md:text-[0.96rem]">
                Four simple steps take you from your sleep profile to the setup that feels right.
              </p>

              <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
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
                  title="Sleep Essentials"
                  body="Compare pillows, bedding, and protectors as part of the sleep experience."
                  detail="Use the head towels before you test pillows or mattresses."
                  icon={PackageCheck}
                />
                <StepCard
                  step="4"
                  title="Build Your Sleep Setup"
                  body="Choose your mattress, base, and comfort options."
                  detail="Once you know your feel, the final setup gets easier."
                  icon={Layers3}
                />
              </div>
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
