import { BookOpen, Headphones, House, MessageSquare, SlidersHorizontal, Timer } from "lucide-react";

function ExperienceFooterButton({ icon: Icon, label, onClick, accent = "default" }) {
  const accentClass =
    accent === "orange"
      ? "text-[#ff8f1f]"
      : accent === "blue"
        ? "text-[#2f57e8]"
        : "text-slate-900";

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[38px] items-center justify-center gap-[7px] rounded-[14px] border border-white/85 bg-white/96 px-[14px] text-[clamp(0.78rem,1vw,0.9rem)] font-extrabold text-slate-900 shadow-[0_10px_24px_rgba(45,71,136,0.1)] transition hover:-translate-y-0.5 hover:bg-slate-50 md:min-w-[116px]"
    >
      {Icon ? <Icon className={["h-[0.85rem] w-[0.85rem] shrink-0", accentClass].join(" ")} /> : null}
      <span>{label}</span>
    </button>
  );
}

export function PodFooterNav({
  openStage,
  onGoHome,
  onGoRest,
  onGoLearn,
  onGoBuild,
  onAskSnoozer,
  onTalkToHuman,
}) {
  return (
    <div
      data-pod-footer-nav="true"
      className="flex min-h-[60px] flex-wrap items-center justify-between gap-[8px] rounded-[18px] border border-white/85 bg-white/96 px-[12px] py-[8px] shadow-[0_18px_40px_rgba(40,63,126,0.12)]"
    >
      <div className="flex flex-wrap items-center gap-[8px]">
        <ExperienceFooterButton icon={House} label="Pod Home" accent="blue" onClick={onGoHome} />

        {openStage !== "rest" ? (
          <ExperienceFooterButton icon={Timer} label="Rest Test" accent="blue" onClick={onGoRest} />
        ) : null}

        {openStage !== "details" ? (
          <ExperienceFooterButton icon={BookOpen} label="Learn" accent="blue" onClick={onGoLearn} />
        ) : null}

        {openStage !== "build" ? (
          <ExperienceFooterButton
            icon={SlidersHorizontal}
            label="Build"
            accent="blue"
            onClick={onGoBuild}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-[8px]">
        <ExperienceFooterButton icon={MessageSquare} label="Ask Snoozer" onClick={onAskSnoozer} />
        <ExperienceFooterButton icon={Headphones} label="Talk to Human" onClick={onTalkToHuman} />
      </div>
    </div>
  );
}
