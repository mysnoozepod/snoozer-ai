import { BookOpen, MessageSquare, SlidersHorizontal, Timer } from "lucide-react";

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
        "inline-flex h-full min-h-[48px] min-w-0 items-center justify-center gap-[7px] rounded-[14px] border px-[8px] text-center text-[clamp(0.95rem,1.05vw,1.12rem)] font-black leading-none transition hover:bg-slate-50",
        active
          ? "border-[#d6e4ff] bg-[#eef3ff] text-[#2340b8] shadow-[0_8px_18px_rgba(47,87,232,0.13)]"
          : "border-white/80 bg-white/92 text-slate-900 shadow-[0_8px_18px_rgba(45,71,136,0.08)]",
      ].join(" ")}
    >
      {Icon ? <Icon className={["h-[clamp(1.1rem,1.22vw,1.28rem)] w-[clamp(1.1rem,1.22vw,1.28rem)] shrink-0", accentClass].join(" ")} /> : null}
      <span className="min-w-0 whitespace-nowrap leading-[1.18]">{label}</span>
    </button>
  );
}

export function PodFooterNav({
  openStage,
  activeKey,
  onGoRest,
  onGoLearn,
  onGoBuild,
  onAskSnoozer,
}) {
  const resolvedActiveKey =
    activeKey ||
    (openStage === "details" ? "learn" : openStage === "build" ? "customize" : openStage === "ask" ? "ask" : "rest");

  return (
    <div
      data-pod-footer-nav="true"
      className="grid h-full min-h-[56px] grid-cols-4 items-stretch gap-[8px] rounded-[18px] border border-white/85 bg-white/96 p-[4px] shadow-[0_14px_34px_rgba(40,63,126,0.1)]"
    >
      <ExperienceFooterButton icon={Timer} label="Rest Test" accent="blue" active={resolvedActiveKey === "rest"} onClick={onGoRest} />
      <ExperienceFooterButton icon={BookOpen} label="Learn" accent="blue" active={resolvedActiveKey === "learn"} onClick={onGoLearn} />
      <ExperienceFooterButton icon={SlidersHorizontal} label="Customize" accent="blue" active={resolvedActiveKey === "customize"} onClick={onGoBuild} />
      <ExperienceFooterButton icon={MessageSquare} label="Ask Snoozer" active={resolvedActiveKey === "ask"} onClick={onAskSnoozer} />
    </div>
  );
}
