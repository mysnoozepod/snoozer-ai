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
      data-pod-badge="true"
      className={[
        "inline-flex min-h-[24px] items-center whitespace-nowrap rounded-full border px-[7px] py-[3px] text-[clamp(0.58rem,0.78vw,0.68rem)] font-extrabold uppercase tracking-[0.09em] shadow-[0_8px_18px_rgba(40,63,126,0.08)]",
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
    <div className="mt-2 flex max-w-[236px] items-start gap-2 rounded-[16px] border border-white/85 bg-white/96 px-[8px] py-[7px] shadow-[0_12px_24px_rgba(40,63,126,0.12)] md:mt-0 md:max-w-[252px]">
      <img
        src="/snoozer-avatar.png"
        alt="Snoozer"
        className="h-7 w-7 shrink-0 rounded-full object-cover ring-2 ring-[#eef3ff] md:h-8 md:w-8"
        loading="eager"
        decoding="async"
      />
      <div className="min-w-0">
        <div className="text-[0.78rem] font-black leading-none text-slate-900 md:text-[0.84rem]">
          I&apos;m Snoozer.
        </div>
        <div className="mt-[3px] text-[0.64rem] font-medium leading-[1.18] text-slate-700 md:text-[0.68rem]">
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
  layout = "default",
}) {
  const hasCoachBubble = Boolean(coachBubble);
  const isBuildLayout = layout === "build";

  return (
    <div
      data-pod-route-header="true"
      className={[
        "grid h-full min-h-0 items-stretch gap-0 overflow-hidden",
        hasCoachBubble
          ? "md:grid-cols-[minmax(0,0.78fr)_minmax(224px,0.42fr)_minmax(0,1.02fr)] lg:grid-cols-[minmax(0,0.76fr)_minmax(236px,0.44fr)_minmax(0,1.08fr)]"
          : isBuildLayout
            ? "md:grid-cols-[minmax(0,0.6fr)_minmax(0,0.4fr)]"
            : "md:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)] lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]",
      ].join(" ")}
    >
      <div className="relative flex min-h-[112px] flex-col justify-center px-[16px] py-[10px] md:h-full md:min-h-0 md:px-[18px] md:py-[10px]">
        {eyebrow ? (
          <ShowroomEyebrow className="text-[0.78rem] tracking-[0.24em]">{eyebrow}</ShowroomEyebrow>
        ) : null}

        <div
          className={[
            eyebrow ? "mt-1" : "mt-0",
            "text-[clamp(0.96rem,1.4vw,1.1rem)] font-black tracking-tight text-[#2f57e8]",
          ].join(" ")}
        >
          {podTitle}
        </div>

        <h1 className="mt-[2px] max-w-[18ch] text-[clamp(1.72rem,2.55vw,2.25rem)] font-black leading-[0.9] tracking-tight text-slate-900">
          {mattressTitle}
        </h1>

        {badges.length ? (
          <div className="mt-[5px] flex max-w-full flex-wrap items-center gap-[4px] pb-[1px]">
            {badges.map((badge) => (
              <HeaderBadge
                key={`${badge.label}-${badge.tone || "soft"}`}
                label={badge.label}
                tone={badge.tone}
              />
            ))}
          </div>
        ) : isRecommended ? (
          <div className="mt-[7px]">
            <HeaderBadge label="Best First Match" tone="primary" />
          </div>
        ) : null}

        {helperText ? (
          <div className="mt-[6px] line-clamp-2 text-[clamp(0.8rem,1.1vw,0.9rem)] font-medium leading-[1.25] text-slate-600">
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

      <div className="relative min-h-[112px] overflow-hidden border-t border-white/70 md:h-full md:min-h-0 md:border-l md:border-t-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_left_center,_rgba(232,239,255,0.92),_rgba(232,239,255,0.55)_26%,_transparent_58%)]" />
        <ResponsiveHeroImage
          src={mattressImage}
          alt={mattressTitle}
          className={[
            "flex h-full min-h-[112px] w-full items-center px-0 py-0 md:min-h-0",
            isBuildLayout ? "justify-center" : "justify-end",
          ].join(" ")}
          imgClassName={
            isBuildLayout
              ? "h-[84%] w-[90%] max-h-full max-w-full object-contain object-center"
              : "h-full w-full max-h-full object-contain object-center"
          }
        />
      </div>
    </div>
  );
}
