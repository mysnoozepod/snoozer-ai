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
        "inline-flex min-h-[28px] items-center whitespace-nowrap rounded-full border px-[10px] py-[3px] text-[clamp(0.72rem,0.9vw,0.86rem)] font-extrabold uppercase leading-none tracking-[0.1em] shadow-[0_8px_18px_rgba(40,63,126,0.08)]",
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
  restStatus,
}) {
  return (
    <div
      data-pod-route-header="true"
      data-pod-text-card="product-hero"
      className="flex h-full min-h-0 items-center gap-4 overflow-visible px-[22px] py-[6px]"
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
          <div className="mt-[2px] flex max-w-full flex-wrap items-center gap-[7px] pb-[1px]">
            {badges.map((badge) => (
              <HeaderBadge
                key={`${badge.label}-${badge.tone || "soft"}`}
                label={badge.label}
                tone={badge.tone}
              />
            ))}
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

      {restStatus ? (
        <div
          className="flex min-w-[220px] max-w-[290px] shrink-0 items-center justify-between gap-3 rounded-[18px] border border-[#d6e4ff] bg-white/95 px-4 py-3 text-left shadow-[0_12px_28px_rgba(47,87,232,0.12)]"
          data-pod-rest-status="true"
        >
          <button
            type="button"
            onClick={restStatus.onReturn}
            className="min-h-[44px] min-w-0 flex-1 text-left"
            aria-label="Return to active Rest Test"
          >
            <span className="block text-[0.66rem] font-black uppercase tracking-[0.18em] text-[#315cf6]">
              {restStatus.paused ? "Rest Test Paused" : "Rest Test"}
            </span>
            <span className="mt-1 block truncate text-[0.82rem] font-black uppercase text-slate-700">
              {restStatus.label}
            </span>
            <span className="mt-0.5 block text-[1.6rem] font-black tabular-nums leading-none text-slate-950">
              {restStatus.time}
            </span>
          </button>
          <button
            type="button"
            onClick={restStatus.onToggle}
            className="inline-flex min-h-[44px] min-w-[76px] items-center justify-center rounded-[12px] bg-[#315cf6] px-3 text-[0.76rem] font-black text-white"
            aria-label={restStatus.paused ? "Resume Rest Test" : "Pause Rest Test"}
          >
            {restStatus.paused ? "Resume" : "Pause"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
