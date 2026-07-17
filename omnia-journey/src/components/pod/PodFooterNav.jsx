import { BookOpen, Headphones, House, MessageSquare, SlidersHorizontal, Timer } from "lucide-react";

function ExperienceFooterButton({ icon: Icon, label, onClick, active = false, accent = "default" }) {
  const accentClass =
    active
      ? "text-[#2f57e8]"
      : accent === "orange"
      ? "text-[#ff8f1f]"
      : accent === "blue"
        ? "text-[#2f57e8]"
        : "text-slate-900";

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex h-full min-h-[var(--pod-touch-target,44px)] min-w-0 items-center justify-center gap-[6px] rounded-[12px] border px-[8px] text-center text-[clamp(0.72rem,0.9vw,0.84rem)] font-extrabold leading-none transition hover:bg-slate-50",
        active
          ? "border-[#d6e4ff] bg-[#eef3ff] text-[#2340b8] shadow-[0_8px_18px_rgba(47,87,232,0.13)]"
          : "border-white/80 bg-white/92 text-slate-900 shadow-[0_8px_18px_rgba(45,71,136,0.08)]",
      ].join(" ")}
    >
      {Icon ? <Icon className={["h-[0.9rem] w-[0.9rem] shrink-0", accentClass].join(" ")} /> : null}
      <span className="truncate">{label}</span>
    </button>
  );
}

export function PodFooterNav({
  openStage,
  activeKey,
  onGoHome,
  onGoRest,
  onGoLearn,
  onGoBuild,
  onAskSnoozer,
  onTalkToHuman,
}) {
  const resolvedActiveKey =
    activeKey ||
    (openStage === "details" ? "learn" : openStage === "build" ? "build" : openStage === "rest" ? "rest" : "home");

  return (
    <div
      data-pod-footer-nav="true"
      className="grid h-full min-h-[var(--pod-nav-height,56px)] grid-cols-6 items-stretch gap-[6px] overflow-hidden rounded-[16px] border border-white/85 bg-white/96 p-[6px] shadow-[0_14px_34px_rgba(40,63,126,0.1)]"
    >
      <ExperienceFooterButton icon={House} label="Pod Home" accent="blue" active={resolvedActiveKey === "home"} onClick={onGoHome} />
      <ExperienceFooterButton icon={Timer} label="Rest Test" accent="blue" active={resolvedActiveKey === "rest"} onClick={onGoRest} />
      <ExperienceFooterButton icon={BookOpen} label="Learn" accent="blue" active={resolvedActiveKey === "learn"} onClick={onGoLearn} />
      <ExperienceFooterButton icon={SlidersHorizontal} label="Build" accent="blue" active={resolvedActiveKey === "build"} onClick={onGoBuild} />
      <ExperienceFooterButton icon={MessageSquare} label="Ask Snoozer" onClick={onAskSnoozer} />
      <ExperienceFooterButton icon={Headphones} label="Talk to Human" onClick={onTalkToHuman} />
    </div>
  );
}
