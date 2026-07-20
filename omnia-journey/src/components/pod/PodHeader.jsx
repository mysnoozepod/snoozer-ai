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
        "inline-flex min-h-[28px] items-center whitespace-nowrap rounded-full border px-[10px] py-[5px] text-[clamp(0.72rem,0.9vw,0.86rem)] font-extrabold uppercase tracking-[0.1em] shadow-[0_8px_18px_rgba(40,63,126,0.08)]",
        toneClass,
      ].join(" ")}
    >
      {label}
    </div>
  );
}

export function PodRouteHeroHeader({
  podTitle,
  mattressTitle,
  helperText,
  isRecommended = false,
  voiceState,
  badges = [],
}) {
  return (
    <div
      data-pod-route-header="true"
      className="flex h-full min-h-0 items-center overflow-visible px-[22px] py-[6px]"
    >
      <div className="min-w-0 flex-1">
        <div
          className="text-[clamp(1.05rem,1.35vw,1.28rem)] font-black tracking-tight text-[#2f57e8]"
        >
          {podTitle}
        </div>

        <h1 className="mt-[1px] whitespace-nowrap text-[clamp(2rem,2.75vw,2.55rem)] font-black leading-none tracking-tight text-slate-900">
          {mattressTitle}
        </h1>

        {badges.length ? (
          <div className="mt-[6px] flex max-w-full flex-wrap items-center gap-[7px] pb-[1px]">
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
      </div>
    </div>
  );
}
