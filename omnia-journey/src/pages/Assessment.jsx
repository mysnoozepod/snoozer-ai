// src/pages/Assessment.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { Volume2 } from "lucide-react";
import { getAssessmentQuestions, saveAssessment } from "@/lib/api";
import useRewards from "@/lib/useRewards";
import { useStore } from "@/lib/useStore";
import { getVoiceState, stopVoice, subscribeVoice } from "@/lib/voice";
import { useSnoozer } from "@/Layout.jsx";

const BRAND = {
  primary: "#1A66D2",
  cloudBg: "#DBEAFE",
};

const SIZE_OPTIONS = ["Twin", "Full", "Queen", "King"];
const BASE_OPTIONS = ["Mattress Only", "Platform Base", "Adjustable Base"];

const MOTION_OPTIONS = [
  {
    label: "Standard Motion",
    image: "/standard-motion.png",
    description: "Whole bed moves together",
  },
  {
    label: "Half Split Motion",
    image: "/half-split-motion.png",
    description: "Head moves separately, foot stays together",
  },
  {
    label: "Full Split Motion",
    image: "/full-split-motion.png",
    description: "Each side moves separately",
  },
];

const CANONICAL_SIZE_QUESTION = {
  id: "size",
  text: "What size are you shopping for?",
  options: SIZE_OPTIONS,
  required: true,
};

const CANONICAL_BASE_QUESTION = {
  id: "baseType",
  text: "What kind of base setup do you want?",
  options: BASE_OPTIONS,
  required: true,
};

const CANONICAL_MOTION_QUESTION = {
  id: "motionMode",
  text: "Choose your motion style.",
  options: MOTION_OPTIONS.map((opt) => opt.label),
  required: true,
  dependsOn: { question: "baseType", value: "Adjustable Base" },
};

function buildAssessmentSummary(answers = {}, questions = []) {
  if (!answers || !Object.keys(answers).length) return "";

  const get = (id) => answers[id];
  const parts = [];

  const size = get("size");
  if (size) parts.push(`Size target: ${String(size)}.`);

  const baseType = get("baseType");
  if (baseType) parts.push(`Base preference: ${String(baseType)}.`);

  const motionMode = get("motionMode");
  if (motionMode) parts.push(`Motion preference: ${String(motionMode)}.`);

  const partner = get("sleepPartner");
  if (partner) parts.push(`Shares the bed: ${String(partner)}.`);

  const position = get("sleepPosition") || get("position");
  if (position) parts.push(`Sleeps mostly on their ${String(position).toLowerCase()}.`);

  const feel = get("firmness") || get("comfort") || get("feel");
  if (feel) parts.push(`Prefers a ${String(feel).toLowerCase()} feel.`);

  const temp = get("temperature") || get("heat") || get("sleepTemp");
  if (temp) parts.push(`Sleeps ${String(temp).toLowerCase()}.`);

  const painRaw = get("painPoints") || get("pain") || get("pressurePoints");
  if (Array.isArray(painRaw) && painRaw.length) {
    parts.push(`Pain/pressure points: ${painRaw.join(", ")}.`);
  } else if (typeof painRaw === "string" && painRaw.trim()) {
    parts.push(`Pain/discomfort: ${painRaw.trim()}.`);
  }

  const motionSens = get("motionSensitivity");
  if (motionSens) parts.push(`Motion sensitivity: ${String(motionSens)}.`);

  if (parts.length) return parts.join(" ");

  const answered = questions
    .filter((q) => answers[q.id] != null && answers[q.id] !== "")
    .slice(0, 6)
    .map((q) => {
      const val = answers[q.id];
      const valStr = Array.isArray(val) ? val.join(", ") : String(val);
      return `${q.text}: ${valStr}`;
    });

  if (!answered.length) return "";
  return `Snooze Assessment summary: ${answered.join(" | ")}`;
}

function isMultiQuestion(q) {
  return q?.multi === true || String(q?.zohoType || "").toLowerCase() === "multiselect";
}

function isAnswered(q, value) {
  if (isMultiQuestion(q)) return Array.isArray(value) && value.length > 0;
  return value != null && value !== "";
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(n, max));
}

function isHalfSplitAllowed(size) {
  const s = String(size || "").toLowerCase();
  return s === "queen" || s === "king";
}

function isFullSplitAllowed(size) {
  const s = String(size || "").toLowerCase();
  return s === "king";
}

function normalizeTitle(t) {
  const s = String(t || "Snooze Assessment");
  return s.replace(/\s*[–-]\s*3\s*simple\s*decisions\s*$/i, "").trim();
}

function isBudgetQuestion(q) {
  const id = String(q?.id || "").toLowerCase();
  const text = String(q?.text || "").toLowerCase();
  return (
    id === "budget" ||
    id === "budgetmax" ||
    id === "priceceiling" ||
    text.includes("budget") ||
    text.includes("price range") ||
    text.includes("price ceiling")
  );
}

function isSizeQuestion(q) {
  const id = String(q?.id || "").toLowerCase();
  const text = String(q?.text || "").toLowerCase();
  return id === "size" || text.includes("what size") || text.includes("mattress size");
}

function isBaseQuestion(q) {
  const id = String(q?.id || "").toLowerCase();
  const text = String(q?.text || "").toLowerCase();

  return (
    id === "basetype" ||
    id === "base" ||
    id === "baseselection" ||
    id === "foundation" ||
    text.includes("base setup") ||
    text.includes("platform base") ||
    text.includes("adjustable base") ||
    text.includes("mattress only") ||
    text.includes("no base")
  );
}

function isMotionQuestion(q) {
  const id = String(q?.id || "").toLowerCase();
  const text = String(q?.text || "").toLowerCase();

  return (
    id === "motionmode" ||
    id === "motion" ||
    text.includes("motion style") ||
    text.includes("standard motion") ||
    text.includes("half split motion") ||
    text.includes("full split motion") ||
    text.includes("for motion")
  );
}

function normalizeOptionText(option) {
  return String(option || "")
    .trim()
    .replace(/\s+/g, " ");
}

function canonicalizeQuestion(q) {
  if (!q) return null;

  if (isSizeQuestion(q)) {
    return {
      ...q,
      ...CANONICAL_SIZE_QUESTION,
    };
  }

  if (isBaseQuestion(q)) {
    return {
      ...q,
      ...CANONICAL_BASE_QUESTION,
    };
  }

  if (isMotionQuestion(q)) {
    return {
      ...q,
      ...CANONICAL_MOTION_QUESTION,
    };
  }

  return q;
}

function buildQuestionFlow(list = []) {
  const source = Array.isArray(list) ? list.map(canonicalizeQuestion).filter(Boolean) : [];

  let sizeQuestion = null;
  let baseQuestion = null;
  let motionQuestion = null;
  const rest = [];

  for (const q of source) {
    if (!sizeQuestion && q.id === "size") {
      sizeQuestion = { ...CANONICAL_SIZE_QUESTION, ...q };
      continue;
    }

    if (!baseQuestion && q.id === "baseType") {
      baseQuestion = { ...CANONICAL_BASE_QUESTION, ...q };
      continue;
    }

    if (!motionQuestion && q.id === "motionMode") {
      motionQuestion = { ...CANONICAL_MOTION_QUESTION, ...q };
      continue;
    }

    if (q.id === "size" || q.id === "baseType" || q.id === "motionMode") {
      continue;
    }

    rest.push(q);
  }

  const cleanedRest = rest.filter(
    (q) => !isSizeQuestion(q) && !isBaseQuestion(q) && !isMotionQuestion(q)
  );

  return [
    sizeQuestion || CANONICAL_SIZE_QUESTION,
    baseQuestion || CANONICAL_BASE_QUESTION,
    motionQuestion || CANONICAL_MOTION_QUESTION,
    ...cleanedRest,
  ];
}

function QuestionChoice({ label, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-2xl border px-4 py-4 text-left transition",
        selected
          ? "border-blue-600 bg-blue-50"
          : "border-gray-200 bg-white hover:bg-gray-50",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-gray-900">{label}</span>
        <span
          className={[
            "rounded-full px-2 py-1 text-xs font-extrabold",
            selected ? "text-white" : "bg-gray-100 text-gray-600",
          ].join(" ")}
          style={selected ? { background: BRAND.primary } : undefined}
        >
          {selected ? "Selected" : "Choose"}
        </span>
      </div>
    </button>
  );
}

function MotionOptionCard({ option, selected, disabled, disabledReason, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "overflow-hidden rounded-3xl border text-left transition",
        disabled
          ? "cursor-not-allowed border-gray-200 bg-gray-50 opacity-60"
          : selected
            ? "border-blue-600 bg-blue-50 shadow-sm"
            : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40",
      ].join(" ")}
    >
      <div className="aspect-[16/10] w-full overflow-hidden bg-gray-50">
        <img
          src={option.image}
          alt={option.label}
          className="h-full w-full object-contain"
          loading="lazy"
          decoding="async"
        />
      </div>

      <div className="p-4">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-base font-semibold text-gray-900">{option.label}</span>
          <span
            className={[
              "rounded-full px-2 py-1 text-xs font-extrabold",
              selected ? "text-white" : "bg-gray-100 text-gray-600",
            ].join(" ")}
            style={selected ? { background: BRAND.primary } : undefined}
          >
            {selected ? "Selected" : "Choose"}
          </span>
        </div>

        <p className="text-sm text-gray-600">{option.description}</p>

        {disabled && disabledReason ? (
          <p className="mt-2 text-xs font-medium text-amber-700">{disabledReason}</p>
        ) : null}
      </div>
    </button>
  );
}

export default function Assessment() {
  const [title, setTitle] = useState("Snooze Assessment");
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [skipped, setSkipped] = useState({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [halfwayAwarded, setHalfwayAwarded] = useState(false);
  const [completeAwarded, setCompleteAwarded] = useState(false);

  const [muted, setMuted] = useState(() => false);
  const [step, setStep] = useState(0);
  const [voiceState, setVoiceState] = useState(() => getVoiceState());

  const navigate = useNavigate();
  const snoozer = useSnoozer();

  const shopperId = useMemo(() => {
    try {
      const v = sessionStorage.getItem("snooze.accessCode") || "guest";
      return v || "guest";
    } catch {
      return "guest";
    }
  }, []);

  const rewards = useRewards(shopperId);
  const { setAssessment, setAssessmentSummary } = useStore();

  const lastSpokenRef = useRef("");
  const introSpokenRef = useRef(false);
  const submitTriggeredRef = useRef(false);
  const mountedRef = useRef(true);
  const questionsLoadedRef = useRef(false);

  const REQUIRED_IDS = useMemo(
    () =>
      new Set([
        "size",
        "baseType",
        "motionMode",
        "sleepPartner",
        "sleepPosition",
        "temperature",
        "firmness",
      ]),
    []
  );

  useEffect(() => {
    const unsub = subscribeVoice(setVoiceState);
    return () => unsub();
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      stopVoice();
    };
  }, []);

  useEffect(() => {
    setMuted(Boolean(snoozer?.hud?.muted));
  }, [snoozer?.hud?.muted]);

  const speak = useCallback(
    async (text, { force = false, calm = false } = {}) => {
      const phrase = String(text || "").trim();
      if (!phrase) return;

      return snoozer?.sayHud?.({
        speech: phrase,
        captions: phrase,
        state: "speaking",
        priority: force ? "high" : "normal",
        ttlMs: calm ? 6500 : 5000,
        voiceStyle: calm ? "calm" : "default",
        actions: [],
      });
    },
    [snoozer]
  );

  useEffect(() => {
    if (muted) stopVoice();
    snoozer?.setHudMuted?.(muted);
  }, [muted, snoozer]);

  const isRequired = (q) => {
    if (!q) return false;
    if (q.required === true) return true;
    return REQUIRED_IDS.has(q.id);
  };

  const shouldShowQuestion = (q) => {
    if (!q) return false;

    if (q.id === "motionMode") {
      return answers.baseType === "Adjustable Base";
    }

    if (!q.dependsOn) return true;

    const { question, value } = q.dependsOn;
    return answers[question] === value;
  };

  const visibleQuestions = useMemo(
    () => (Array.isArray(questions) ? questions.filter(shouldShowQuestion) : []),
    [questions, answers]
  );

  useEffect(() => {
    if (!visibleQuestions.length) return;
    setStep((s) => clamp(s, 0, visibleQuestions.length - 1));
  }, [visibleQuestions.length]);

  const current = visibleQuestions[step] || null;

  const isDoneOrSkipped = (q) => {
    if (!q) return true;
    if (skipped[q.id]) return true;
    return isAnswered(q, answers[q.id]);
  };

  const progress = useMemo(() => {
    const vis = visibleQuestions.length || 1;
    const done = visibleQuestions.reduce((n, q) => (isDoneOrSkipped(q) ? n + 1 : n), 0);
    return Math.round((done / vis) * 100);
  }, [visibleQuestions, answers, skipped]);

  const doneCount = useMemo(() => {
    return visibleQuestions.reduce((n, q) => (isDoneOrSkipped(q) ? n + 1 : n), 0);
  }, [visibleQuestions, answers, skipped]);

  const halfwayMark = Math.max(1, Math.floor((visibleQuestions.length || 1) / 2));

  useEffect(() => {
    if (answers.baseType !== "Adjustable Base" && answers.motionMode) {
      setAnswers((prev) => {
        const next = { ...prev };
        delete next.motionMode;
        return next;
      });
    }
  }, [answers.baseType, answers.motionMode]);

  useEffect(() => {
    const size = answers.size;
    const motion = answers.motionMode;

    if (!motion) return;

    const m = String(motion).toLowerCase();

    if (m.includes("half split") && !isHalfSplitAllowed(size)) {
      setAnswers((prev) => {
        const next = { ...prev };
        delete next.motionMode;
        return next;
      });
      speak("Half split is only available in Queen or King.");
    }

    if (m.includes("full split") && !isFullSplitAllowed(size)) {
      setAnswers((prev) => {
        const next = { ...prev };
        delete next.motionMode;
        return next;
      });
      speak("Full split is only available in King.");
    }
  }, [answers.size, answers.motionMode, speak]);

  useEffect(() => {
    if (!current?.text) return;
    if (lastSpokenRef.current === current.text) return;
    lastSpokenRef.current = current.text;
    speak(current.text);
  }, [current?.id, current?.text, speak]);

  useEffect(() => {
    let cancelled = false;

    async function loadQuestions() {
      setLoading(true);
      setFetchError("");

      try {
        const data = await getAssessmentQuestions();
        if (cancelled || !mountedRef.current) return;

        const incomingTitle =
          data && typeof data === "object" && data.title ? String(data.title) : null;

        let list = [];
        if (Array.isArray(data?.questions)) list = data.questions;
        else if (Array.isArray(data)) list = data;

        const filteredList = Array.isArray(list) ? list.filter((q) => !isBudgetQuestion(q)) : [];

        if (incomingTitle) {
          setTitle(incomingTitle || "Snooze Assessment");
        }

        if (!filteredList.length) {
          setQuestions(
            buildQuestionFlow([
              CANONICAL_SIZE_QUESTION,
              CANONICAL_BASE_QUESTION,
              CANONICAL_MOTION_QUESTION,
              {
                id: "sleepPartner",
                text: "Do you share the bed with a partner?",
                options: ["Yes", "No"],
                required: true,
              },
              {
                id: "sleepPosition",
                text: "What position do you sleep in most?",
                options: ["Side", "Back", "Stomach", "Combination"],
                required: true,
              },
              {
                id: "temperature",
                text: "Do you sleep hot, cool, or somewhere in the middle?",
                options: ["Hot", "Neutral", "Cool"],
                required: true,
              },
              {
                id: "firmness",
                text: "What feel sounds best to you?",
                options: ["Soft", "Medium", "Firm"],
                required: true,
              },
            ])
          );
        } else {
          setQuestions(buildQuestionFlow(filteredList));
        }

        questionsLoadedRef.current = true;
      } catch (err) {
        console.error("Failed to load assessment questions:", err);
        if (cancelled || !mountedRef.current) return;
        setFetchError("We couldn't load the Snooze Assessment right now.");
      } finally {
        if (!cancelled && mountedRef.current) {
          setLoading(false);
        }
      }
    }

    loadQuestions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (fetchError) return;
    if (!questionsLoadedRef.current) return;
    if (introSpokenRef.current) return;

    introSpokenRef.current = true;
    speak("Let's begin.");
  }, [loading, fetchError, speak]);

  useEffect(() => {
    if (!visibleQuestions.length) return;

    if (!halfwayAwarded && doneCount >= halfwayMark) {
      setHalfwayAwarded(true);
      rewards.earn(100, "Halfway Through Snooze Assessment");
      speak("Nice progress.");
    }

    if (!completeAwarded && doneCount === visibleQuestions.length) {
      setCompleteAwarded(true);
      rewards.earn(250, "Completed Snooze Assessment");
      speak("Assessment complete.");
    }
  }, [
    doneCount,
    halfwayMark,
    visibleQuestions.length,
    rewards,
    halfwayAwarded,
    completeAwarded,
    speak,
  ]);

  const setSkip = (qid, val) => {
    setSkipped((prev) => {
      const next = { ...prev };
      if (val) next[qid] = true;
      else delete next[qid];
      return next;
    });
  };

  const goToNextOrSubmit = (questionIndex) => {
    const lastIndex = Math.max(0, visibleQuestions.length - 1);

    if (questionIndex >= lastIndex) {
      if (!submitTriggeredRef.current) {
        submitTriggeredRef.current = true;
        window.setTimeout(() => {
          handleSubmit();
        }, 150);
      }
      return;
    }

    window.setTimeout(() => {
      setStep((s) => clamp(Math.max(s, questionIndex) + 1, 0, lastIndex));
    }, 120);
  };

  const handleSingleSelect = (qid, value) => {
    snoozer?.noteUserInteraction?.();
    const questionIndex = visibleQuestions.findIndex((q) => q.id === qid);

    setAnswers((prev) => {
      const next = { ...prev, [qid]: value };

      if (qid === "baseType" && value !== "Adjustable Base") {
        delete next.motionMode;
      }

      return next;
    });

    setSkip(qid, false);
    goToNextOrSubmit(questionIndex);
  };

  const handleMultiToggle = (qid, option) => {
    snoozer?.noteUserInteraction?.();
    setAnswers((prev) => {
      const currentArr = Array.isArray(prev[qid]) ? prev[qid] : [];
      const normalized = normalizeOptionText(option);
      const exists = currentArr.includes(normalized);
      const nextArr = exists
        ? currentArr.filter((x) => x !== normalized)
        : [...currentArr, normalized];
      return { ...prev, [qid]: nextArr };
    });
    setSkip(qid, false);
  };

  const handleSkipCurrent = () => {
    snoozer?.noteUserInteraction?.();
    if (!current) return;
    if (isRequired(current)) return;

    setSkip(current.id, true);
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[current.id];
      return next;
    });

    goToNextOrSubmit(step);
  };

  const handleBack = () => {
    snoozer?.noteUserInteraction?.();
    submitTriggeredRef.current = false;
    setStep((s) => clamp(s - 1, 0, Math.max(0, visibleQuestions.length - 1)));
  };

  const canFinish = useMemo(() => {
    if (!visibleQuestions.length) return false;
    return visibleQuestions.every((q) => isDoneOrSkipped(q));
  }, [visibleQuestions, answers, skipped]);

  const buildCleanAnswers = () => {
    const out = {};
    for (const [k, v] of Object.entries(answers || {})) {
      if (skipped[k]) continue;
      if (v == null) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = v;
    }

    if (out.baseType !== "Adjustable Base") {
      delete out.motionMode;
    }

    return out;
  };

  const handleSubmit = async () => {
    if (submitting) return;

    try {
      setSubmitting(true);

      const cleaned = buildCleanAnswers();
      await speak("Saving your results.");

      await saveAssessment(shopperId || "guest", cleaned);

      const summary = buildAssessmentSummary(cleaned, visibleQuestions);

      if (typeof setAssessment === "function") setAssessment(cleaned);
      if (typeof setAssessmentSummary === "function") setAssessmentSummary(summary);

      try {
        sessionStorage.setItem("snooze.assessment", JSON.stringify(cleaned));
        sessionStorage.setItem("snooze.assessmentSummary", summary || "");
      } catch {
        // ignore
      }

      setTimeout(() => {
        navigate("/results", {
          state: {
            results: cleaned,
            assessment: cleaned,
            assessmentSummary: summary,
          },
        });
      }, 450);
    } catch (err) {
      console.error("Submit failed:", err);
      submitTriggeredRef.current = false;
      alert("Something went wrong saving your assessment. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const replayCurrentQuestion = async () => {
    snoozer?.noteUserInteraction?.();
    if (!current?.text) return;
    await speak(current.text, { force: true });
  };

  const motionCards = useMemo(() => {
    const size = String(answers.size || "").toLowerCase();

    return MOTION_OPTIONS.map((opt) => {
      const labelLower = opt.label.toLowerCase();

      if (labelLower.includes("half split") && !isHalfSplitAllowed(size)) {
        return {
          ...opt,
          disabled: true,
          disabledReason: "Available in Queen or King",
        };
      }

      if (labelLower.includes("full split") && !isFullSplitAllowed(size)) {
        return {
          ...opt,
          disabled: true,
          disabledReason: "Available in King",
        };
      }

      return {
        ...opt,
        disabled: false,
        disabledReason: "",
      };
    });
  }, [answers.size]);

  const displayTitle = normalizeTitle(title);
  const currentIsMotionQuestion = current?.id === "motionMode";

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Snooze Assessment</h1>
          <div className="text-sm text-gray-500">Loading…</div>
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-1/3 rounded bg-gray-200" />
          <div className="h-40 rounded-xl bg-gray-100" />
          <div className="h-12 rounded-xl bg-gray-100" />
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="mb-3 text-2xl font-bold">Snooze Assessment</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {fetchError}
        </div>
        <div className="mt-4">
          <Button onClick={() => window.location.reload()}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold leading-tight">{displayTitle}</h1>
          <p className="text-sm text-gray-500">
            Question {Math.min(step + 1, visibleQuestions.length || 1)} of{" "}
            {visibleQuestions.length || 1}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="text-sm text-gray-500">{progress}% complete</div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                snoozer?.noteUserInteraction?.();
                setMuted((m) => !m);
              }}
              className="text-xs text-gray-600 underline hover:text-gray-900"
              aria-label={muted ? "Unmute Snoozer voice" : "Mute Snoozer voice"}
              title={muted ? "Unmute Snoozer" : "Mute Snoozer"}
            >
              {muted ? "Unmute" : "Mute"}
            </button>

            <button
              type="button"
              onClick={replayCurrentQuestion}
              className="inline-flex items-center gap-1 text-xs text-gray-600 underline hover:text-gray-900"
              aria-label="Replay question voice"
              title="Replay question voice"
            >
              <Volume2 className="h-3.5 w-3.5" />
              Replay
            </button>
          </div>

          {voiceState.loading ? (
            <div className="text-[11px] text-gray-400">Loading voice…</div>
          ) : null}
          {voiceState.blocked ? (
            <div className="text-[11px] font-medium text-amber-700">Tap Replay</div>
          ) : null}
          {voiceState.error ? (
            <div className="max-w-[180px] text-[11px] text-red-600">{voiceState.error}</div>
          ) : null}
        </div>
      </div>

      <div className="mb-6 h-1.5 w-full rounded-full bg-gray-200">
        <div
          className="h-1.5 rounded-full transition-all"
          style={{ width: `${progress}%`, background: BRAND.primary }}
        />
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <AnimatePresence mode="wait">
          {current ? (
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <div className="flex items-start gap-6">
                <div className="shrink-0">
                  <div className="relative">
                    <div
                      className="absolute inset-0 rounded-full blur-3xl opacity-25"
                      style={{ background: BRAND.primary }}
                      aria-hidden="true"
                    />
                    <motion.img
                      src="/snoozer-avatar.png"
                      alt="Snoozer"
                      className="relative h-40 w-40 rounded-full object-cover shadow-xl md:h-48 md:w-48"
                      animate={{ y: [0, -4, 0] }}
                      transition={{ duration: 3, repeat: Infinity }}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                </div>

                <div className="relative flex-1 rounded-3xl border border-blue-200 bg-blue-50 px-7 py-6">
                  <div
                    className="absolute -left-4 top-16 h-0 w-0"
                    style={{
                      borderTop: "16px solid transparent",
                      borderBottom: "16px solid transparent",
                      borderRight: `16px solid ${BRAND.cloudBg}`,
                    }}
                    aria-hidden="true"
                  />

                  <p className="mb-1 text-sm text-gray-600">
                    {isRequired(current) ? "Required" : "Optional"}
                  </p>

                  <h2 className="text-lg font-semibold leading-snug text-[#2A2B2A] md:text-xl">
                    {current.text}
                  </h2>

                  {currentIsMotionQuestion ? (
                    <p className="mt-3 text-sm text-gray-600">
                      Pick the adjustable setup that fits you best.
                    </p>
                  ) : null}

                  {!isRequired(current) ? (
                    <div className="mt-3">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={handleSkipCurrent}
                        className="text-gray-700"
                      >
                        Skip
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-8">
                {currentIsMotionQuestion ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {motionCards.map((opt) => {
                      const selected = answers[current.id] === opt.label;

                      return (
                        <MotionOptionCard
                          key={opt.label}
                          option={opt}
                          selected={selected}
                          disabled={opt.disabled}
                          disabledReason={opt.disabledReason}
                          onClick={() => {
                            if (opt.disabled) return;
                            handleSingleSelect(current.id, opt.label);
                          }}
                        />
                      );
                    })}
                  </div>
                ) : Array.isArray(current.options) && current.options.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {isMultiQuestion(current)
                      ? current.options.map((opt) => {
                          const normalizedOpt = normalizeOptionText(opt);
                          const selected = Array.isArray(answers[current.id])
                            ? answers[current.id].includes(normalizedOpt)
                            : false;

                          return (
                            <QuestionChoice
                              key={normalizedOpt}
                              label={normalizedOpt}
                              selected={selected}
                              onClick={() => handleMultiToggle(current.id, normalizedOpt)}
                            />
                          );
                        })
                      : current.options.map((opt) => {
                          const normalizedOpt = normalizeOptionText(opt);
                          const selected = answers[current.id] === normalizedOpt;

                          return (
                            <QuestionChoice
                              key={normalizedOpt}
                              label={normalizedOpt}
                              selected={selected}
                              onClick={() => handleSingleSelect(current.id, normalizedOpt)}
                            />
                          );
                        })}
                  </div>
                ) : (
                  <input
                    type="text"
                    name={current.id}
                    value={answers[current.id] || ""}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [current.id]: e.target.value }))
                    }
                    placeholder="Type your answer"
                    className="w-full rounded-xl border border-gray-300 p-3 focus:outline-none focus:ring-2 focus:ring-[#1A66D2]"
                  />
                )}
              </div>

              {isRequired(current) &&
              !isAnswered(current, answers[current.id]) &&
              !skipped[current.id] ? (
                <p className="mt-4 text-sm text-gray-500">Choose an option to continue.</p>
              ) : null}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-gray-600"
            >
              No questions available.
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={handleBack}
          disabled={step === 0 || submitting}
        >
          Back
        </Button>

        <div className="text-xs text-gray-500">
          Done {doneCount}/{visibleQuestions.length || 1}
        </div>

        {step === visibleQuestions.length - 1 ? (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canFinish || submitting}
            className="text-white"
            style={{
              background: canFinish ? BRAND.primary : "#D1D5DB",
              cursor: canFinish ? "pointer" : "not-allowed",
            }}
          >
            {submitting ? "Saving…" : "Finish & View Results"}
          </Button>
        ) : (
          <div className="w-[152px]" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}