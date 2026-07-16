import { cn } from "@/lib/utils";

export function ShowroomPageShell({ className, children, ...props }) {
  return (
    <section
      {...props}
      className={cn(
        "flex min-h-[100dvh] min-w-0 flex-col overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(84,120,255,0.2),_transparent_30%),radial-gradient(circle_at_bottom,_rgba(149,177,255,0.12),_transparent_26%),linear-gradient(180deg,#eef4ff_0%,#f7faff_42%,#f9fbff_100%)] pb-0 pt-2 text-slate-900 md:pt-3",
        className
      )}
    >
      {children}
    </section>
  );
}

export function ShowroomFrame({ className, children }) {
  return (
    <div
      className={cn(
        "rounded-[34px] border border-white/80 bg-white/88 shadow-[0_26px_74px_rgba(40,63,126,0.16)] backdrop-blur-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

export function ShowroomPanel({ className, children, tone = "white" }) {
  const toneClass =
    tone === "soft"
      ? "border-indigo-100/80 bg-[linear-gradient(180deg,rgba(246,249,255,0.98),rgba(255,255,255,0.98))]"
      : tone === "frost"
        ? "border-white/75 bg-white/90 backdrop-blur-sm"
        : "border-white/75 bg-white/96";

  return (
    <div
      className={cn(
        "rounded-[28px] border shadow-[0_16px_42px_rgba(45,71,136,0.1)]",
        toneClass,
        className
      )}
    >
      {children}
    </div>
  );
}

export function ShowroomEyebrow({ className, children }) {
  return (
    <div
      className={cn(
        "text-sm font-black uppercase tracking-[0.22em] text-[#2f57e8]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function ShowroomModeButton({ active, icon: Icon, label, onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-12 items-center justify-center gap-2 rounded-[18px] border px-4 py-3 text-sm font-extrabold transition md:text-[0.95rem]",
        active
          ? "border-indigo-200 bg-indigo-50 text-[#2340b8] shadow-[0_10px_24px_rgba(47,87,232,0.14)]"
          : "border-slate-200 bg-white text-slate-900 hover:border-indigo-100 hover:bg-slate-50",
        className
      )}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
      <span>{label}</span>
    </button>
  );
}

export function ShowroomFactPill({ icon: Icon, children, className }) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white/88 px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm",
        className
      )}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-[#2f57e8]" /> : null}
      <span>{children}</span>
    </div>
  );
}

export function ShowroomFooterDock({ className, label, sublabel, children, sticky = true }) {
  return (
    <div
      className={cn(
        sticky ? "sticky bottom-3 z-30 mt-4 px-4 md:bottom-4 md:px-6" : "mt-3",
        className
      )}
    >
      <div className="mx-auto max-w-[1160px] rounded-[24px] border border-white/80 bg-white/94 shadow-[0_18px_42px_rgba(45,71,136,0.16)] backdrop-blur-md">
        <div className="flex flex-col gap-2 px-3.5 py-2.5 md:flex-row md:items-center md:justify-between md:px-4">
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[#5d79df]">
              {label}
            </div>
            <div className="mt-0.5 text-sm font-extrabold text-slate-900 md:text-[0.92rem]">
              {sublabel}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function ShowroomFooterAction({ icon: Icon, label, onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-900 shadow-sm transition hover:bg-slate-50 md:min-w-[142px]",
        className
      )}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-[#2f57e8]" /> : null}
      <span>{label}</span>
    </button>
  );
}

export function ShowroomBrandMark({ className, imageClassName }) {
  return (
    <div className={cn("inline-flex items-center", className)}>
      <img
        src="/mysnoozepod-logo.png"
        alt="MySnoozePod"
        className={cn("h-auto w-[138px] md:w-[160px]", imageClassName)}
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}

export function ShowroomTopRail({ className, children }) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-[1380px] items-start justify-between gap-4 px-4 pt-3 md:px-6 md:pt-4",
        className
      )}
    >
      {children}
    </div>
  );
}

export function ShowroomCartBadge({
  className,
  count = 0,
  onClick,
  label = "Cart",
  quiet = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-[20px] border bg-white/96 px-3 py-2 text-left shadow-[0_14px_32px_rgba(47,72,137,0.14)] backdrop-blur transition hover:shadow-[0_18px_40px_rgba(47,72,137,0.18)]",
        quiet ? "border-white/70" : "border-indigo-100/90",
        className
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#eef3ff]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.85"
          className="h-[1.125rem] w-[1.125rem] text-[#2f57e8]"
          aria-hidden="true"
        >
          <circle cx="9" cy="20" r="1.25" />
          <circle cx="18" cy="20" r="1.25" />
          <path d="M3 4h2l2.1 9.4a1 1 0 0 0 .98.78h8.97a1 1 0 0 0 .98-.79L20 7H7.2" />
        </svg>
      </div>

      <div className="leading-tight">
        <div className="text-[11px] font-semibold text-slate-500">{label}</div>
        <div className="mt-0.5 text-[0.95rem] font-black text-slate-900">
          {count} item{count === 1 ? "" : "s"}
        </div>
      </div>
    </button>
  );
}

export function ShowroomImageCard({
  src,
  alt,
  badge,
  className,
  imageClassName,
  imageWrapperClassName,
  children,
}) {
  return (
    <ShowroomPanel tone="soft" className={cn("relative overflow-hidden p-4 md:p-5", className)}>
      <div
        className={cn(
          "overflow-hidden rounded-[28px] border border-white/80 bg-white shadow-inner",
          imageWrapperClassName
        )}
      >
        <div className={cn("aspect-[4/3]", imageClassName)}>
          {src ? (
            <img
              src={src}
              alt={alt}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-slate-100 text-sm font-semibold text-slate-400">
              Image unavailable
            </div>
          )}
        </div>
      </div>

      {badge ? (
        <div className="pointer-events-none absolute bottom-7 right-7 inline-flex items-center gap-2 rounded-full border border-white/85 bg-white/94 px-4 py-2 text-sm font-extrabold text-[#2848c7] shadow-lg">
          {badge}
        </div>
      ) : null}

      {children}
    </ShowroomPanel>
  );
}

export function ShowroomTopicTile({
  icon: Icon,
  title,
  body,
  onClick,
  actionLabel = "Explore",
  className,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex h-full flex-col rounded-[28px] border border-white/75 bg-white/92 p-5 text-left shadow-[0_16px_40px_rgba(45,71,136,0.08)] transition hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-[0_20px_46px_rgba(45,71,136,0.12)]",
        className
      )}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#eef3ff] text-[#2f57e8]">
        {Icon ? <Icon className="h-6 w-6" /> : null}
      </div>

      <div className="mt-5 text-xl font-black tracking-tight text-slate-900">{title}</div>
      <div className="mt-2 text-sm leading-6 text-slate-600">{body}</div>

      <div className="mt-auto pt-4 text-sm font-bold text-[#2f57e8]">{actionLabel}</div>
    </button>
  );
}

export function ShowroomInlineAction({
  icon: Icon,
  label,
  description,
  onClick,
  className,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-[20px] border border-white/70 bg-white/90 px-4 py-3 text-left shadow-sm transition hover:border-indigo-100 hover:bg-white",
        className
      )}
    >
      {Icon ? (
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#eef3ff] text-[#2f57e8]">
          <Icon className="h-5 w-5" />
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="text-sm font-extrabold text-slate-900">{label}</div>
        {description ? (
          <div className="mt-1 text-xs leading-5 text-slate-500">{description}</div>
        ) : null}
      </div>

      <div className="text-lg font-black text-[#2f57e8]">{">"}</div>
    </button>
  );
}

export function ShowroomMetricTile({ label, value, className }) {
  return (
    <div
      className={cn(
        "rounded-[22px] border border-white/80 bg-white/92 px-4 py-3 shadow-sm",
        className
      )}
    >
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-lg font-black text-slate-900 md:text-xl">{value}</div>
    </div>
  );
}
