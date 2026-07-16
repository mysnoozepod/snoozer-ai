import {
  ArrowRight,
  BedDouble,
  CheckCircle2,
  Heart,
  Pause,
  SlidersHorizontal,
  Timer,
  X,
} from "lucide-react";

import { ShowroomPanel } from "@/components/showroom/ShowroomPrimitives";

const REST_COMPLETION_STAGES = {
  reflection: "reflection",
  actions: "actions",
};

const REST_REFLECTION_OPTIONS = [
  { id: "love_it", label: "I love the way this feels", icon: Heart, tone: "blue" },
  { id: "compare_it", label: "I might like it, but need to compare it", icon: CheckCircle2, tone: "orange" },
  { id: "not_for_me", label: "Not for me", icon: X, tone: "red" },
];

function lowerText(value) {
  return String(value || "").trim().toLowerCase();
}

function formatDuration(totalSeconds) {
  const total = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.max(1, Math.round(total / 60));
  return `${minutes} min`;
}

function formatRestCountdown(totalSeconds) {
  const total = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function RestCountdownRing({ remainingSeconds, totalSeconds }) {
  const safeTotal = Math.max(1, Number(totalSeconds) || 1);
  const safeRemaining = Math.max(0, Number(remainingSeconds) || 0);
  const progress = safeRemaining / safeTotal;
  const radius = 108;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - progress);

  return (
    <div className="relative flex h-[124px] w-[124px] items-center justify-center md:h-[136px] md:w-[136px]">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 248 248" aria-hidden="true">
        <circle cx="124" cy="124" r={radius} fill="none" stroke="rgba(219,229,255,0.92)" strokeWidth="10" />
        <circle
          cx="124"
          cy="124"
          r={radius}
          fill="none"
          stroke="#355ff1"
          strokeLinecap="round"
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={strokeOffset}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[clamp(1.9rem,3vw,2.18rem)] font-black leading-none tracking-tight text-slate-900">
          {formatRestCountdown(safeRemaining)}
        </div>
        <div className="mt-1 text-[0.76rem] font-medium text-slate-500">remaining</div>
      </div>
    </div>
  );
}

function RestLengthCard({
  title,
  subtitle,
  durationLabel,
  accent = "orange",
  buttonLabel = "Start Test",
  onClick,
}) {
  const iconTone = accent === "blue" ? "text-[#355ff1]" : "text-[#ff8f1f]";
  const durationTone = accent === "blue" ? "bg-[#edf2ff] text-[#355ff1]" : "bg-[#fff1e2] text-[#ff8f1f]";
  const buttonTone =
    accent === "blue"
      ? "bg-[linear-gradient(90deg,#2f57e8_0%,#1f7cff_100%)] shadow-[0_18px_36px_rgba(47,87,232,0.24)]"
      : "bg-[linear-gradient(90deg,#ff9f1c_0%,#ff7a1a_100%)] shadow-[0_18px_36px_rgba(255,143,31,0.26)]";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full cursor-pointer flex-col rounded-[22px] border border-white/85 bg-white/96 p-[14px] text-left shadow-[0_18px_46px_rgba(45,71,136,0.1)] transition duration-200 hover:-translate-y-0.5 hover:border-[#d8e2ff] hover:shadow-[0_24px_54px_rgba(45,71,136,0.14)] md:min-h-[132px] md:p-[16px]"
    >
      <div className="flex items-start gap-3">
          <div className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-full border border-white/90 bg-[#f7faff] shadow-[0_12px_28px_rgba(45,71,136,0.08)]">
          <Timer className={["h-6 w-6", iconTone].join(" ")} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[clamp(1.05rem,1.6vw,1.25rem)] font-black leading-none tracking-tight text-slate-900">
                {title}
              </div>
              <div className="mt-[6px] text-[clamp(0.86rem,1.2vw,0.95rem)] leading-[1.25] text-slate-600">
                {subtitle}
              </div>
            </div>
            <div className={["shrink-0 rounded-full px-3 py-1 text-[0.76rem] font-black", durationTone].join(" ")}>
              {durationLabel}
            </div>
          </div>
        </div>
      </div>

      <div
        className={[
          "mt-[14px] flex h-[44px] items-center justify-center rounded-full text-[clamp(0.9rem,1.25vw,1rem)] font-black text-white transition group-hover:scale-[1.01]",
          buttonTone,
        ].join(" ")}
      >
        {buttonLabel} <ArrowRight className="ml-2 inline h-5 w-5" />
      </div>
    </button>
  );
}

export function PodRestStartSection({ podLabel, flowOptions = [], onChooseMode }) {
  const cards = flowOptions.length
    ? flowOptions.slice(0, 2).map((flow) => ({
        id: flow.id,
        title: lowerText(flow.id).includes("deep") ? "15-Minute Test" : "7-Minute Test",
        subtitle: lowerText(flow.id).includes("deep") ? "More time to settle in" : "Quick feel check",
        durationLabel: lowerText(flow.id).includes("deep") ? "15 min" : "7 min",
        buttonLabel: lowerText(flow.id).includes("deep") ? "Start 15-Minute Test" : "Start 7-Minute Test",
        accent: lowerText(flow.id).includes("deep") ? "blue" : "orange",
      }))
    : [
        {
          id: "quick",
          title: "7-Minute Test",
          subtitle: "Quick feel check",
          durationLabel: "7 min",
          buttonLabel: "Start 7-Minute Test",
          accent: "orange",
        },
        {
          id: "deep",
          title: "15-Minute Test",
          subtitle: "More time to settle in",
          durationLabel: "15 min",
          buttonLabel: "Start 15-Minute Test",
          accent: "blue",
        },
      ];

  return (
    <ShowroomPanel className="overflow-hidden p-[16px]" tone="frost">
      <div className="max-w-[780px]">
        <div className="text-[clamp(1.75rem,2.6vw,2.12rem)] font-black leading-[0.98] tracking-tight text-slate-900">
          Start Your Rest Test
        </div>
        <div className="mt-[6px] text-[clamp(1rem,1.35vw,1.08rem)] leading-[1.35] text-slate-600">
          Try {podLabel} your way. Start with 7 minutes for a quick feel check, or choose 15 minutes if you want more time to settle in.
        </div>
      </div>

      <div className="mt-[14px] grid gap-[14px] md:grid-cols-2">
        {cards.map((card) => (
          <RestLengthCard key={card.id} {...card} onClick={() => onChooseMode?.(card.id)} />
        ))}
      </div>

      <div className="mt-[10px] flex items-center justify-center gap-2 text-[0.82rem] font-medium text-slate-500">
        <CheckCircle2 className="h-4 w-4 text-slate-400" />
        <span>You can end or pause your test at any time.</span>
      </div>
    </ShowroomPanel>
  );
}

function RestRatingCard({ option, selected = false, onClick }) {
  const Icon = option.icon;
  const toneClasses =
    option.tone === "orange"
      ? selected
        ? "border-[#ffbe85] bg-[#fff5eb] text-[#d76a09] shadow-[0_18px_34px_rgba(255,143,31,0.18)]"
        : "border-[#ffdcb9] bg-white text-slate-900 hover:bg-[#fff9f2]"
      : option.tone === "red"
        ? selected
          ? "border-[#ffc8c8] bg-[#fff3f3] text-[#d84545] shadow-[0_18px_34px_rgba(220,80,80,0.12)]"
          : "border-[#ffd7d7] bg-white text-slate-900 hover:bg-[#fff8f8]"
        : selected
          ? "border-[#b8cbff] bg-[#eef3ff] text-[#2f57e8] shadow-[0_18px_34px_rgba(47,87,232,0.16)]"
          : "border-[#d6e4ff] bg-white text-slate-900 hover:bg-[#f7faff]";
  const iconTone = option.tone === "orange" ? "text-[#ff8f1f]" : option.tone === "red" ? "text-[#ef5b5b]" : "text-[#355ff1]";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={[
        "flex min-h-[134px] cursor-pointer flex-col rounded-[22px] border px-3.5 py-3.5 text-center transition duration-200 hover:-translate-y-0.5 md:min-h-[146px] md:px-4 md:py-4",
        toneClasses,
      ].join(" ")}
    >
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/82 shadow-[0_10px_24px_rgba(45,71,136,0.08)] md:h-16 md:w-16">
        {Icon ? <Icon className={["h-7 w-7 md:h-8 md:w-8", iconTone].join(" ")} /> : null}
      </div>

      <div className="mt-3 text-[0.94rem] font-black leading-tight text-slate-900 md:mt-4 md:text-[1.04rem]">
        {option.label}
      </div>

      {selected ? (
        <div className="mt-3 text-[0.8rem] font-extrabold uppercase tracking-[0.18em] text-[#2f57e8] md:mt-4">
          Selected
        </div>
      ) : null}
    </button>
  );
}

function RestInstructionCard({
  id,
  title,
  body,
  icon: Icon = CheckCircle2,
  accent = "blue",
  selected = false,
  onClick,
}) {
  const accentClass =
    accent === "orange"
      ? "border-[#ffe0bf] bg-[#fff7ef] text-[#ff8f1f]"
      : "border-[#dbe5ff] bg-white text-[#355ff1]";

  return (
    <button
      type="button"
      onClick={() => onClick?.(id)}
      aria-pressed={selected}
      className={[
        "rounded-[18px] border bg-white/96 p-2.5 text-left shadow-[0_14px_30px_rgba(45,71,136,0.08)] transition hover:-translate-y-0.5",
        selected
          ? "border-[#b8cbff] bg-[#f7faff] shadow-[0_20px_40px_rgba(47,87,232,0.16)]"
          : "border-white/80 hover:border-[#d6e4ff]",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <div className={["flex h-8 w-8 shrink-0 items-center justify-center rounded-full border", accentClass].join(" ")}>
          {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        </div>
        <div className="min-w-0">
          <div className="text-[0.86rem] font-black leading-tight text-slate-900">{title}</div>
          <div className="mt-0.5 text-[0.74rem] leading-[1.05rem] text-slate-600">{body}</div>
        </div>
      </div>
    </button>
  );
}

export function buildActiveRestInstructionCards({ hasAdjustableBase }) {
  return [
    {
      id: "back",
      title: "Try Your Back",
      body: "Lie flat and notice lower-back support.",
      focusTitle: "Try your back",
      focusBody: "Lie flat and notice lower-back support through the middle of the mattress.",
      icon: BedDouble,
      accent: "blue",
    },
    {
      id: "side",
      title: "Try Your Side",
      body: "Check shoulder and hip pressure.",
      focusTitle: "Try your side",
      focusBody: "Pay attention to shoulder and hip pressure relief while you settle in.",
      icon: CheckCircle2,
      accent: "blue",
    },
    hasAdjustableBase
      ? {
          id: "motion",
          title: "Try Motion",
          body: "Try Zero Gravity, Snore, or Head Up.",
          focusTitle: "Try motion",
          focusBody: "Use the adjustable positions and notice whether support or pressure relief changes.",
          icon: SlidersHorizontal,
          accent: "orange",
        }
      : {
          id: "relax",
          title: "Relax & Notice",
          body: "Let your body settle and notice pressure points.",
          focusTitle: "Relax and notice",
          focusBody: "Stay still for a moment and notice comfort, pressure points, and overall support.",
          icon: Heart,
          accent: "orange",
        },
  ];
}

export function GuidedRestTest({
  podLabel = "this pod",
  flowOptions,
  activeMode,
  activeStep,
  activeStepIndex,
  timerRemaining,
  timerRunning,
  onChooseMode,
  onPauseTimer,
  onResetTest,
  onSelectReflection,
  onViewDetails,
  onBuildPod,
  onCompareAnotherPod,
  onSwitchToLongerMode,
  completionStage,
  reflectionChoice,
  hasAdjustableBase,
  selectedInstructionId,
  onSelectInstruction,
  onEndAndRate,
}) {
  if (!activeMode) {
    return (
      <PodRestStartSection
        podLabel={podLabel}
        flowOptions={Object.values(flowOptions || {})}
        onChooseMode={onChooseMode}
      />
    );
  }

  if (completionStage === REST_COMPLETION_STAGES.actions) {
    return (
      <ShowroomPanel className="overflow-hidden p-[16px]" tone="frost">
        <div className="text-[1.82rem] font-black leading-tight tracking-tight text-slate-900 md:text-[2rem]">
          Rest Test saved
        </div>

        {reflectionChoice ? (
          <div className="mt-3 rounded-[18px] border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-900">
            Saved rating: {reflectionChoice}
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-3">
          <button
            type="button"
            onClick={onCompareAnotherPod}
            className="rounded-[18px] bg-indigo-600 px-4 py-2.5 text-[0.9rem] font-extrabold text-white transition hover:bg-indigo-700"
          >
            Compare Another Pod
          </button>
          <button
            type="button"
            onClick={onViewDetails}
            className="rounded-[18px] border bg-white px-4 py-2.5 text-[0.9rem] font-extrabold text-gray-900 transition hover:bg-gray-50"
          >
            Learn About This Pod
          </button>
          <button
            type="button"
            onClick={onBuildPod}
            className="rounded-[18px] border bg-white px-4 py-2.5 text-[0.9rem] font-extrabold text-gray-900 transition hover:bg-gray-50"
          >
            Build This Setup
          </button>
        </div>

        <button
          type="button"
          onClick={onResetTest}
          className="mt-3 inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 transition hover:text-slate-900"
        >
          Back to Rest Test Options
        </button>
      </ShowroomPanel>
    );
  }

  const stepTotalSeconds = Math.max(1, Number(activeStep?.seconds) || 1);
  const activeTitle = activeMode?.id === "deep" ? "15-Minute Test in Progress" : "7-Minute Test in Progress";
  const pauseLabel = timerRunning ? "Pause Test" : "Resume Test";
  const showLongerModeSwitch = activeMode?.id === "quick";
  const instructionCards = buildActiveRestInstructionCards({ hasAdjustableBase });
  const selectedInstruction = instructionCards.find((card) => card.id === selectedInstructionId) || null;
  const currentFocusTitle = selectedInstruction?.focusTitle || activeStep?.cue || "Keep settling in";
  const currentFocusBody =
    selectedInstruction?.focusBody ||
    activeStep?.body ||
    "Stay in the position and notice comfort, support, and pressure relief.";

  if (completionStage === REST_COMPLETION_STAGES.reflection) {
    return (
      <ShowroomPanel className="overflow-hidden p-[16px]" tone="frost">
        <div className="text-[clamp(1.75rem,2.4vw,2.05rem)] font-black leading-tight tracking-tight text-slate-900">
          How did this pod feel?
        </div>

        <div className="mt-3 grid gap-2.5 md:grid-cols-3">
          {REST_REFLECTION_OPTIONS.map((option) => (
            <RestRatingCard
              key={option.id}
              option={option}
              selected={false}
              onClick={() => onSelectReflection(option.id)}
            />
          ))}
        </div>
      </ShowroomPanel>
    );
  }

  return (
    <ShowroomPanel className="overflow-hidden p-[16px]" tone="frost">
      <div className="text-[clamp(1.7rem,2.3vw,2rem)] font-black leading-[0.98] tracking-tight text-slate-900">
        {activeTitle}
      </div>

      <div className="mt-[12px] grid gap-[14px] xl:grid-cols-[140px_minmax(0,1fr)] xl:items-start">
        <div className="flex justify-center xl:justify-start">
          <RestCountdownRing remainingSeconds={timerRemaining} totalSeconds={stepTotalSeconds} />
        </div>

        <div className="space-y-[10px]">
          <div className="rounded-[16px] border border-[#dbe5ff] bg-white/96 px-[14px] py-[10px] shadow-sm">
            <div className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">
              Current Focus
            </div>
            <div className="mt-[5px] text-[clamp(1rem,1.4vw,1.12rem)] font-black text-slate-900">{currentFocusTitle}</div>
            <div className="mt-[3px] text-[clamp(0.86rem,1.15vw,0.96rem)] leading-[1.3] text-slate-600">{currentFocusBody}</div>
          </div>

          <div className="grid gap-[10px] md:grid-cols-3">
            {instructionCards.map((card) => (
              <RestInstructionCard
                key={card.id}
                {...card}
                selected={card.id === selectedInstructionId}
                onClick={onSelectInstruction}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-[12px] flex flex-wrap items-center gap-[10px]">
        <button
          type="button"
          onClick={onPauseTimer}
          className="inline-flex min-h-[36px] min-w-[144px] items-center justify-center gap-2 rounded-[14px] border border-[#dbe5ff] bg-white px-3.5 text-[0.8rem] font-black text-[#355ff1] shadow-sm transition hover:bg-slate-50"
        >
          <Pause className="h-4 w-4" />
          {pauseLabel}
        </button>

        <button
          type="button"
          onClick={onEndAndRate}
          className="inline-flex min-h-[36px] min-w-[144px] items-center justify-center gap-2 rounded-[14px] border border-[#ffd7d7] bg-white px-3.5 text-[0.8rem] font-black text-[#ef5b5b] shadow-sm transition hover:bg-[#fff8f8]"
        >
          <X className="h-4 w-4" />
          End & Rate
        </button>

        {showLongerModeSwitch ? (
          <button
            type="button"
            onClick={onSwitchToLongerMode}
            className="inline-flex min-h-[36px] flex-1 items-center justify-center gap-2 rounded-[14px] border border-[#dbe5ff] bg-[#f8faff] px-3.5 text-[0.76rem] font-extrabold text-[#355ff1] shadow-sm transition hover:bg-white xl:min-w-[206px] xl:flex-none"
          >
            Need more time? Switch to 15 min
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </ShowroomPanel>
  );
}
