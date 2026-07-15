import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import {
  ClipboardList,
  LockKeyhole,
  Sparkles,
  Timer,
} from "lucide-react";
import { getAssessmentQuestions, saveAssessment } from "@/lib/api";
import { canViewCart } from "@/device/deviceActionGuards";
import { emitDeviceAssessmentSubmission } from "@/device/deviceActivityTracker";
import { useDeviceMode } from "@/device/useDeviceMode";
import useRewards from "@/lib/useRewards";
import { useStore } from "@/lib/useStore";
import { useShowroomHud } from "@/lib/snoozer/hud/useShowroomHud";
import { getShopperId } from "@/state/sessionStore";
import {
  ShowroomBrandMark,
  ShowroomCartBadge,
  ShowroomEyebrow,
  ShowroomFrame,
  ShowroomPageShell,
  ShowroomTopRail,
} from "@/components/showroom/ShowroomPrimitives";

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
  return s.replace(/\s*(?:\u2013|-)\s*3\s*simple\s*decisions\s*$/i, "").trim();
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
        "rounded-2xl border px-4 py-3.5 text-left transition",
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
      <div className="aspect-[16/7] w-full overflow-hidden bg-gray-50">
        <img
          src={option.image}
          alt={option.label}
          className="h-full w-full object-contain"
          loading="lazy"
          decoding="async"
        />
      </div>

      <div className="p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[0.95rem] font-semibold text-gray-900">{option.label}</span>
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

        <p className="text-xs leading-5 text-gray-600">{option.description}</p>

        {disabled && disabledReason ? (
          <p className="mt-2 text-xs font-medium text-amber-700">{disabledReason}</p>
        ) : null}
      </div>
    </button>
  );
}

function buildQuestionSpeech(question) {
  if (!question) return "";

  if (question.id === "size") return "What size are you shopping for?";
  if (question.id === "baseType") return "What kind of base setup do you want?";
  if (question.id === "motionMode") return "Choose your motion style.";

  return String(question.text || "").trim();
}

function questionSupportText(question) {
  if (!question) return "";

  switch (question.id) {
    case "size":
      return "This keeps your recommended pods and base options grounded in the size you actually want to shop.";
    case "baseType":
      return "Your base choice changes motion options and which setups are worth testing in the showroom.";
    case "motionMode":
      return "Split and standard motion matter most when you want an adjustable setup or share the bed.";
    case "sleepPartner":
      return "Sharing the bed affects motion, comfort flexibility, and how we rank partner-friendly pods.";
    case "sleepPosition":
      return "Your main sleep position helps Snoozer look for pressure relief or support in the right places.";
    case "temperature":
      return "Sleeping hot changes which mattress feels and materials deserve extra attention.";
    case "firmness":
      return "Your comfort preference helps Snoozer choose where to start before you compare the next pods.";
    default:
      return "Answer this so Snoozer can keep narrowing your best first test.";
  }
}

function questionSectionLabel(question) {
  if (!question) return "Snooze Assessment";

  switch (question.id) {
    case "size":
      return "Sleep setup";
    case "baseType":
    case "motionMode":
      return "Base and motion";
    case "sleepPartner":
      return "Sleep profile";
    case "sleepPosition":
      return "Body support";
    case "temperature":
      return "Cooling and comfort";
    case "firmness":
      return "Feel preference";
    default:
      return "Assessment";
  }
}

export default function Assessment() {
  const device = useDeviceMode();
  const [title, setTitle] = useState("Snooze Assessment");
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [skipped, setSkipped] = useState({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [halfwayAwarded, setHalfwayAwarded] = useState(false);
  const [completeAwarded, setCompleteAwarded] = useState(false);

  const [step, setStep] = useState(0);

  const navigate = useNavigate();
  const {
    muted,
    replay,
    noteUserInteraction,
    say,
    sayScript,
    interruptCurrent,
    setMuted,
    voiceState,
  } = useShowroomHud();

  const shopperId = useMemo(() => {
    return getShopperId() || "guest";
  }, []);

  const rewards = useRewards(shopperId);
  const snoozepod = useStore((state) => state.snoozepod || []);
  const { setAssessment, setAssessmentSummary } = useStore();
  const snoozepodCount = useMemo(
    () => snoozepod.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0),
    [snoozepod]
  );
  const showCartBadge = canViewCart(device);

  const introSpokenRef = useRef(false);
  const submitTriggeredRef = useRef(false);
  const mountedRef = useRef(true);
  const questionsLoadedRef = useRef(false);
  const lastQuestionVoiceKeyRef = useRef("");
  const introTimerRef = useRef(null);
  const questionTimerRef = useRef(null);
  const progressTimerRef = useRef(null);
  const submitTimerRef = useRef(null);
  const resultsTransitionTimerRef = useRef(null);
  const introCompletedAtRef = useRef(0);

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

  const clearTimer = (ref) => {
    if (ref.current) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  };

  const cancelAssessmentVoice = useCallback(() => {
    clearTimer(questionTimerRef);
    return interruptCurrent?.({
      preserveQueue: false,
      reason: "assessment-question-change",
      fadeMs: 0,
    });
  }, [interruptCurrent]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      clearTimer(introTimerRef);
      clearTimer(questionTimerRef);
      clearTimer(progressTimerRef);
      clearTimer(submitTimerRef);
      clearTimer(resultsTransitionTimerRef);
    };
  }, []);

  const speak = useCallback(
    async (
      text,
      {
        force = false,
        calm = false,
        ttlMs,
        state = "speaking",
        priority = force ? "high" : "normal",
        scriptKey = "",
      } = {}
    ) => {
      const phrase = String(text || "").trim();
      if (!phrase || muted) return null;

      const payload = {
        speech: phrase,
        captions: phrase,
        state,
        priority,
        ttlMs: ttlMs || (calm ? 6500 : 5000),
        voiceStyle: calm ? "calm" : "default",
        actions: [],
        replaceCurrent: force,
      };

      if (scriptKey) {
        return sayScript({
          scriptKey,
          shopperId,
          fallback: payload,
          overrides: payload,
        });
      }

      return say(payload);
    },
    [muted, say, sayScript, shopperId]
  );

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
      clearTimer(questionTimerRef);
      speak("Half split is only available in Queen or King.", {
        force: true,
        calm: true,
        priority: "normal",
        state: "warning",
        scriptKey: "assessment.motion.half_split_invalid",
      });
    }

    if (m.includes("full split") && !isFullSplitAllowed(size)) {
      setAnswers((prev) => {
        const next = { ...prev };
        delete next.motionMode;
        return next;
      });
      clearTimer(questionTimerRef);
      speak("Full split is only available in King.", {
        force: true,
        calm: true,
        priority: "normal",
        state: "warning",
        scriptKey: "assessment.motion.full_split_invalid",
      });
    }
  }, [answers.size, answers.motionMode, speak]);

  useEffect(() => {
    if (!current?.text) return;
    if (loading) return;
    if (submitting) return;
    if (!questionsLoadedRef.current) return;

    const speechText = buildQuestionSpeech(current);
    const voiceKey = `${current.id}::${step}::${speechText}`;

    if (lastQuestionVoiceKeyRef.current === voiceKey) return;

    const now = Date.now();
    const sinceIntro = introCompletedAtRef.current
      ? now - introCompletedAtRef.current
      : Number.POSITIVE_INFINITY;

    const delayMs =
      step === 0 && introCompletedAtRef.current
        ? Math.max(900, 1400 - sinceIntro)
        : 500;

    clearTimer(questionTimerRef);
    questionTimerRef.current = window.setTimeout(() => {
      lastQuestionVoiceKeyRef.current = voiceKey;
      speak(speechText, {
        force: true,
        calm: current.id === "motionMode",
        ttlMs: current.id === "motionMode" ? 6000 : 5000,
      });
    }, delayMs);

    return () => clearTimer(questionTimerRef);
  }, [current?.id, current?.text, step, loading, submitting, speak]);

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
        setTitle("Snooze Assessment");
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
        questionsLoadedRef.current = true;
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
    lastQuestionVoiceKeyRef.current = "";

    clearTimer(introTimerRef);
    clearTimer(questionTimerRef);

    introTimerRef.current = window.setTimeout(async () => {
      await speak("Let's begin.", {
        force: true,
        calm: true,
        ttlMs: 4000,
        scriptKey: "assessment.intro",
      });
      introCompletedAtRef.current = Date.now();
    }, 900);

    return () => clearTimer(introTimerRef);
  }, [loading, fetchError, speak]);

  useEffect(() => {
    if (!visibleQuestions.length) return;
    if (submitTriggeredRef.current || submitting) return;

    if (!halfwayAwarded && doneCount >= halfwayMark) {
      setHalfwayAwarded(true);
      rewards.earn(100, "Halfway Through Snooze Assessment");
      clearTimer(progressTimerRef);
      progressTimerRef.current = window.setTimeout(() => {
        speak("Nice progress.", {
          calm: true,
          ttlMs: 3500,
          state: "celebrate",
          scriptKey: "assessment.progress.halfway",
        });
      }, 350);
    }

    if (!completeAwarded && doneCount === visibleQuestions.length) {
      setCompleteAwarded(true);
      rewards.earn(250, "Completed Snooze Assessment");
      clearTimer(progressTimerRef);
      progressTimerRef.current = window.setTimeout(() => {
        speak("Assessment complete.", {
          calm: true,
          ttlMs: 3500,
          state: "celebrate",
          scriptKey: "assessment.complete",
        });
      }, 350);
    }
  }, [
    doneCount,
    halfwayMark,
    visibleQuestions.length,
    rewards,
    halfwayAwarded,
    completeAwarded,
    speak,
    submitting,
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
        clearTimer(submitTimerRef);
        submitTimerRef.current = window.setTimeout(() => {
          handleSubmit();
        }, 220);
      }
      return;
    }

    window.setTimeout(() => {
      setStep((s) => clamp(Math.max(s, questionIndex) + 1, 0, lastIndex));
    }, 180);
  };

  const handleSingleSelect = (qid, value) => {
    noteUserInteraction?.();
    cancelAssessmentVoice();

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
    noteUserInteraction?.();
    clearTimer(questionTimerRef);

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
    noteUserInteraction?.();
    cancelAssessmentVoice();

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
    noteUserInteraction?.();
    cancelAssessmentVoice();
    submitTriggeredRef.current = false;
    clearTimer(resultsTransitionTimerRef);
    setStep((s) => clamp(s - 1, 0, Math.max(0, visibleQuestions.length - 1)));
  };

  const currentIsMultiQuestion = isMultiQuestion(current);
  const currentCanAdvance = isDoneOrSkipped(current);
  const showNextButton =
    Boolean(current) && currentIsMultiQuestion && step < visibleQuestions.length - 1;

  const handleAdvanceCurrent = () => {
    noteUserInteraction?.();
    if (!current || !currentCanAdvance || !showNextButton) return;
    cancelAssessmentVoice();
    goToNextOrSubmit(step);
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
    let shouldResetSubmitting = true;

    try {
      emitDeviceAssessmentSubmission(true, { reason: "assessmentSubmission" });
      submitTriggeredRef.current = true;
      setSubmitting(true);
      clearTimer(progressTimerRef);
      clearTimer(resultsTransitionTimerRef);
      await cancelAssessmentVoice();

      const cleaned = buildCleanAnswers();
      const savingJob = await speak("Saving your results.", {
        force: true,
        calm: true,
        state: "thinking",
        priority: "normal",
        ttlMs: 2600,
        scriptKey: "assessment.saving",
      });

      await saveAssessment(shopperId || "guest", cleaned);

      const summary = buildAssessmentSummary(cleaned, visibleQuestions);

      if (typeof setAssessment === "function") setAssessment(cleaned);
      if (typeof setAssessmentSummary === "function") setAssessmentSummary(summary);

      const transitionMs = Math.max(
        2200,
        Math.min((Number(savingJob?.ttlMs) || 2600) + 500, 3800)
      );

      resultsTransitionTimerRef.current = window.setTimeout(() => {
        navigate("/results", {
          state: {
            results: cleaned,
            assessment: cleaned,
            assessmentSummary: summary,
          },
        });
      }, transitionMs);
      shouldResetSubmitting = false;
    } catch (err) {
      console.error("Submit failed:", err);
      submitTriggeredRef.current = false;
      alert("We couldn't save your assessment. Please try again.");
    } finally {
      if (shouldResetSubmitting && mountedRef.current) {
        setSubmitting(false);
      }
      emitDeviceAssessmentSubmission(false, { reason: "assessmentSubmission" });
    }
  };

  const replayCurrentQuestion = async () => {
    noteUserInteraction?.();
    if (!current?.text) return;
    lastQuestionVoiceKeyRef.current = "";
    await cancelAssessmentVoice();
    await replay?.();
    await speak(buildQuestionSpeech(current), { force: true, calm: current.id === "motionMode" });
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
  const currentSection = questionSectionLabel(current);
  const currentSupportText = questionSupportText(current);

  if (loading) {
    return (
      <ShowroomPageShell className="pb-8">
        <ShowroomTopRail>
          <ShowroomBrandMark />
          {showCartBadge ? (
            <ShowroomCartBadge
              count={snoozepodCount}
              quiet
              onClick={() => navigate("/cart")}
            />
          ) : null}
        </ShowroomTopRail>
        <div className="mx-auto max-w-[1380px] px-4 pb-6 pt-3 md:px-6">
          <ShowroomFrame className="p-5 md:p-7">
            <div className="animate-pulse space-y-5">
              <div className="h-5 w-40 rounded-full bg-slate-200" />
              <div className="h-14 w-80 rounded-2xl bg-slate-200" />
              <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                <div className="h-[340px] rounded-[30px] bg-slate-100" />
                <div className="h-[420px] rounded-[30px] bg-slate-100" />
              </div>
            </div>
          </ShowroomFrame>
        </div>
      </ShowroomPageShell>
    );
  }

  if (fetchError) {
    return (
      <ShowroomPageShell className="pb-8">
        <ShowroomTopRail>
          <ShowroomBrandMark />
          {showCartBadge ? (
            <ShowroomCartBadge
              count={snoozepodCount}
              quiet
              onClick={() => navigate("/cart")}
            />
          ) : null}
        </ShowroomTopRail>
        <div className="mx-auto max-w-[1180px] px-4 pb-6 pt-3 md:px-6">
          <ShowroomFrame className="p-6 md:p-8">
            <ShowroomEyebrow>Snooze Assessment</ShowroomEyebrow>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-900">
              We couldn’t load the assessment right now.
            </h1>
            <div className="mt-5 rounded-[24px] border border-red-200 bg-red-50 p-5 text-red-700">
              {fetchError}
            </div>
            <div className="mt-5">
              <Button onClick={() => window.location.reload()}>Try Again</Button>
            </div>
          </ShowroomFrame>
        </div>
      </ShowroomPageShell>
    );
  }

  return (
    <ShowroomPageShell className="h-auto min-h-[100dvh] max-h-none overflow-y-auto pb-4 md:pb-5">
      <ShowroomTopRail className="pt-2 md:pt-3">
        <ShowroomBrandMark />
        {showCartBadge ? (
          <ShowroomCartBadge
            count={snoozepodCount}
            quiet
            onClick={() => {
              noteUserInteraction?.();
              navigate("/cart");
            }}
          />
        ) : null}
      </ShowroomTopRail>

      <div className="mx-auto max-w-[1340px] px-4 pb-4 pt-1 md:px-6 md:pb-5">
        <ShowroomFrame className="p-3.5 md:p-4">
          <div className="grid gap-3 lg:grid-cols-[248px_minmax(0,1fr)] xl:grid-cols-[264px_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="rounded-[28px] border border-white/80 bg-[radial-gradient(circle_at_40%_0%,rgba(87,121,255,0.18),transparent_45%),linear-gradient(180deg,#f7fbff_0%,#eef4ff_100%)] p-4 shadow-[0_18px_44px_rgba(45,71,136,0.08)] md:p-4">
                <ShowroomEyebrow>{displayTitle}</ShowroomEyebrow>
                <h1 className="mt-2 text-[2.35rem] font-black leading-[0.94] tracking-tight text-slate-900 md:text-[2.7rem]">
                  One question at a time.
                </h1>
                <p className="mt-2 text-[0.94rem] leading-5 text-slate-600">
                  Answer what feels closest. Snoozer will build your match order.
                </p>

                <div className="mt-3 flex justify-center">
                  <div className="relative">
                  <div className="absolute inset-0 rounded-full blur-3xl opacity-25" style={{ background: BRAND.primary }} aria-hidden="true" />
                  <motion.img
                      src="/snoozer-avatar.png"
                      alt="Snoozer"
                      className="relative h-28 w-28 rounded-full object-cover shadow-xl md:h-32 md:w-32"
                      animate={{ y: [0, -4, 0] }}
                      transition={{ duration: 3, repeat: Infinity }}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                </div>

                <div className="mt-3 rounded-[20px] border border-white/80 bg-white/92 px-3.5 py-3 shadow-sm">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                    Progress
                  </div>
                  <div className="mt-1 text-base font-black text-slate-900 md:text-lg">
                    {progress}% complete
                  </div>
                  <div className="mt-2.5 h-2 w-full rounded-full bg-[#dfe8fb]">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{ width: `${progress}%`, background: BRAND.primary }}
                    />
                  </div>
                </div>

                {voiceState?.blocked ? (
                  <div className="mt-2.5 text-xs font-semibold text-amber-700">
                    Tap again to enable Snoozer voice.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="min-w-0 rounded-[28px] border border-white/80 bg-white/96 p-4 shadow-[0_18px_44px_rgba(45,71,136,0.08)] md:p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#d9e4ff] bg-[#eef3ff] px-3 py-1.5 text-xs font-black uppercase tracking-[0.18em] text-[#2f57e8]">
                    <ClipboardList className="h-3.5 w-3.5" />
                    {currentSection}
                  </div>
                  <div className="mt-1.5 max-w-3xl text-[0.88rem] leading-5 text-slate-600">
                    {currentSupportText}
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-full border border-[#d9e4ff] bg-[#f7faff] px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  <Timer className="h-3.5 w-3.5 text-[#2f57e8]" />
                  {doneCount} answered
                </div>
              </div>

              <div className="mt-4 h-2 w-full rounded-full bg-[#dfe8fb]">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{ width: `${progress}%`, background: BRAND.primary }}
                />
              </div>

              <div className="mt-4">
                <AnimatePresence mode="wait">
                  {current ? (
                    <motion.div
                      key={current.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.25 }}
                    >
                      <div className="rounded-[26px] border border-[#cfe0ff] bg-[linear-gradient(180deg,#f8fbff_0%,#eef4ff_100%)] p-4 shadow-sm md:p-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="rounded-full bg-white px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.16em] text-slate-500">
                            {isRequired(current) ? "Required" : "Optional"}
                          </span>
                          {!isRequired(current) ? (
                            <button
                              type="button"
                              onClick={handleSkipCurrent}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
                            >
                              Skip this
                            </button>
                          ) : null}
                        </div>

                        <h2 className="mt-2.5 text-[1.7rem] font-black leading-tight text-slate-900 md:text-[1.85rem]">
                          {current.text}
                        </h2>

                        {currentIsMotionQuestion ? (
                          <p className="mt-2 text-sm leading-5 text-slate-600">
                            Pick the adjustable motion setup that feels most realistic for how
                            you want to relax and sleep.
                          </p>
                        ) : null}

                        <div className="mt-4">
                          {currentIsMotionQuestion ? (
                            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
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
                                        onClick={() =>
                                          handleMultiToggle(current.id, normalizedOpt)
                                        }
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
                                        onClick={() =>
                                          handleSingleSelect(current.id, normalizedOpt)
                                        }
                                      />
                                    );
                                  })}
                            </div>
                          ) : (
                            <label className="flex items-center gap-3 rounded-[22px] border border-[#b8cbff] bg-white px-5 py-3.5 shadow-sm">
                              <LockKeyhole className="h-5 w-5 text-slate-400" />
                              <input
                                type="text"
                                name={current.id}
                                value={answers[current.id] || ""}
                                onChange={(e) =>
                                  setAnswers((prev) => ({
                                    ...prev,
                                    [current.id]: e.target.value,
                                  }))
                                }
                                placeholder="Type your answer"
                                className="w-full bg-transparent text-lg font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                              />
                            </label>
                          )}
                        </div>
                      </div>

                      {isRequired(current) &&
                      !isAnswered(current, answers[current.id]) &&
                      !skipped[current.id] ? (
                        <p className="mt-3 text-sm font-medium text-slate-500">
                          Choose an option to continue.
                        </p>
                      ) : null}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="rounded-[28px] border border-slate-200 bg-slate-50 p-6 text-gray-600"
                    >
                      We are getting your Snooze Assessment ready.
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBack}
                  disabled={step === 0 || submitting}
                  className="rounded-[18px] px-5 py-4 text-base font-extrabold"
                >
                  Back
                </Button>

                <div className="inline-flex items-center gap-2 rounded-full bg-[#eef3ff] px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-[#2f57e8]">
                  <Sparkles className="h-3.5 w-3.5" />
                  Done {doneCount}/{visibleQuestions.length || 1}
                </div>

                {step === visibleQuestions.length - 1 ? (
                  <Button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canFinish || submitting}
                    className="rounded-[18px] px-6 py-4 text-base font-extrabold text-white"
                    style={{
                      background: canFinish ? BRAND.primary : "#D1D5DB",
                      cursor: canFinish ? "pointer" : "not-allowed",
                    }}
                  >
                    {submitting ? "Saving your results..." : "Finish & View Results"}
                  </Button>
                ) : showNextButton ? (
                  <Button
                    type="button"
                    onClick={handleAdvanceCurrent}
                    disabled={!currentCanAdvance || submitting}
                    className="rounded-[18px] px-6 py-4 text-base font-extrabold text-white"
                    style={{
                      background: currentCanAdvance ? BRAND.primary : "#D1D5DB",
                      cursor: currentCanAdvance ? "pointer" : "not-allowed",
                    }}
                  >
                    Next
                  </Button>
                ) : (
                  <div className="w-[168px]" aria-hidden="true" />
                )}
              </div>
            </div>
          </div>
        </ShowroomFrame>
      </div>
    </ShowroomPageShell>
  );
}


