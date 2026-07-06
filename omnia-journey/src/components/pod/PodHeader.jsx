import { useState } from "react";
import { ImageOff } from "lucide-react";

import { ShowroomEyebrow } from "@/components/showroom/ShowroomPrimitives";

function HeaderBadge({ label, tone = "soft" }) {
  const toneClass =
    tone === "primary"
      ? "border-[#d6e4ff] bg-[#eef3ff] text-[#2f57e8]"
      : tone === "accent"
        ? "border-[#ffe0bf] bg-[#fff5ea] text-[#ff8f1f]"
        : "border-white/85 bg-white/96 text-slate-700";

  return (
    <div
      className={[
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[0.7rem] font-extrabold uppercase tracking-[0.1em] shadow-[0_10px_24px_rgba(40,63,126,0.08)] md:px-3",
        toneClass,
      ].join(" ")}
    >
      {label}
    </div>
  );
}

function SnoozerCoachBubble({ copy }) {
  if (!copy) return null;

  return (
    <div className="mt-2 flex max-w-[188px] items-start gap-2 rounded-[18px] border border-white/85 bg-white/96 px-2.25 py-2 shadow-[0_14px_28px_rgba(40,63,126,0.12)] md:mt-0 md:max-w-[198px] md:px-2.5 md:py-2.25">
      <img
        src="/snoozer-avatar.png"
        alt="Snoozer"
        className="h-8 w-8 shrink-0 rounded-full object-cover ring-2 ring-[#eef3ff] md:h-9 md:w-9"
        loading="eager"
        decoding="async"
      />
      <div className="min-w-0">
        <div className="text-[0.84rem] font-black leading-none text-slate-900 md:text-[0.9rem]">
          I&apos;m Snoozer.
        </div>
        <div className="mt-0.75 text-[0.76rem] font-medium leading-[1.3] text-slate-700 md:text-[0.82rem]">
          {copy}
        </div>
      </div>
    </div>
  );
}

function ResponsiveHeroImage({ src, alt, className, imgClassName }) {
  const [broken, setBroken] = useState(false);
  const activeSrc = !broken ? String(src || "").trim() : "";

  if (!activeSrc) {
    return (
      <div className={className}>
        <div className="flex h-full w-full items-center justify-center rounded-[24px] bg-[radial-gradient(circle_at_top,_rgba(84,120,255,0.18),_transparent_55%),linear-gradient(180deg,#f6f9ff_0%,#eef3ff_100%)] text-[#2f57e8]">
          <ImageOff className="h-8 w-8 opacity-80" aria-hidden="true" />
          <span className="sr-only">{alt || "Product preview"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <img
        src={activeSrc}
        alt={alt}
        className={imgClassName}
        onError={() => setBroken(true)}
        loading="eager"
        fetchPriority="high"
        decoding="async"
      />
    </div>
  );
}

export function PodRouteHeroHeader({
  eyebrow,
  podTitle,
  mattressTitle,
  helperText,
  isRecommended = false,
  mattressImage,
  voiceState,
  badges = [],
  coachBubble = "",
}) {
  const hasCoachBubble = Boolean(coachBubble);

  return (
    <div
      data-pod-route-header="true"
      className={[
        "grid items-stretch gap-0 overflow-hidden md:h-[182px] lg:h-[190px]",
        hasCoachBubble
          ? "md:grid-cols-[minmax(0,0.86fr)_minmax(172px,0.32fr)_minmax(0,1.16fr)] lg:grid-cols-[minmax(0,0.84fr)_minmax(188px,0.34fr)_minmax(0,1.18fr)]"
          : "md:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]",
      ].join(" ")}
    >
      <div className="relative flex min-h-[114px] flex-col justify-center px-5 py-3 md:h-full md:min-h-0 md:px-5 md:py-3">
        {eyebrow ? (
          <ShowroomEyebrow className="text-[0.78rem] tracking-[0.24em]">{eyebrow}</ShowroomEyebrow>
        ) : null}

        <div
          className={[
            eyebrow ? "mt-1" : "mt-0",
            "text-[1.08rem] font-black tracking-tight text-[#2f57e8] md:text-[1.18rem]",
          ].join(" ")}
        >
          {podTitle}
        </div>

        <h1 className="mt-0.5 max-w-[10.2ch] text-[1.92rem] font-black leading-[0.9] tracking-tight text-slate-900 md:text-[2.12rem] lg:text-[2.28rem]">
          {mattressTitle}
        </h1>

        {badges.length ? (
          <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {badges.map((badge) => (
              <HeaderBadge
                key={`${badge.label}-${badge.tone || "soft"}`}
                label={badge.label}
                tone={badge.tone}
              />
            ))}
          </div>
        ) : isRecommended ? (
          <div className="mt-2.5">
            <HeaderBadge label="Best First Match" tone="primary" />
          </div>
        ) : null}

        {helperText ? (
          <div className="mt-1.5 text-[0.84rem] font-medium text-slate-600 md:text-[0.88rem]">
            {helperText}
          </div>
        ) : null}

        {voiceState?.blocked || voiceState?.error ? (
          <div className="mt-3 flex flex-wrap gap-2.5">
            {voiceState?.blocked ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-800">
                Audio may require a tap
              </span>
            ) : null}
            {voiceState?.error ? (
              <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-700">
                Audio unavailable
              </span>
            ) : null}
          </div>
        ) : null}

        {coachBubble ? (
          <div className="mt-2 md:hidden">
            <SnoozerCoachBubble copy={coachBubble} />
          </div>
        ) : null}
      </div>

      {hasCoachBubble ? (
        <div className="hidden border-l border-white/70 bg-[radial-gradient(circle_at_left_center,_rgba(236,242,255,0.95),_rgba(236,242,255,0.72)_32%,_transparent_82%)] px-2 py-2 md:flex md:h-full md:items-center md:justify-center">
          <div className="w-full max-w-[236px]">
            <SnoozerCoachBubble copy={coachBubble} />
          </div>
        </div>
      ) : null}

      <div className="relative min-h-[114px] overflow-hidden border-t border-white/70 md:h-full md:min-h-0 md:border-l md:border-t-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_left_center,_rgba(232,239,255,0.92),_rgba(232,239,255,0.55)_26%,_transparent_58%)]" />
        <ResponsiveHeroImage
          src={mattressImage}
          alt={mattressTitle}
          className="flex h-full min-h-[114px] w-full items-center justify-end px-0 py-0 md:min-h-0"
          imgClassName="h-full w-full max-h-full scale-[1.08] object-contain object-center md:scale-[1.2] lg:scale-[1.24]"
        />
      </div>
    </div>
  );
}
