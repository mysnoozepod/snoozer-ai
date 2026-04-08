// src/components/SnoozerCue.jsx
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Info,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  MessageCircle,
  Loader2,
  Mic,
  Volume2,
  ShoppingCart,
} from "lucide-react";

function lower(v) {
  return String(v || "").toLowerCase().trim();
}

function pickIcon(type, variant, status) {
  const v = lower(variant);
  const s = lower(status);

  if (s === "thinking") return Loader2;
  if (s === "listening") return Mic;
  if (s === "speaking") return Volume2;
  if (s === "cart_ready") return ShoppingCart;

  if (v === "coach") return MessageCircle;

  const t = lower(type || "tip");
  if (t === "warning") return AlertTriangle;
  if (t === "success") return CheckCircle2;
  if (t === "wow") return Sparkles;
  return Info;
}

function pickTone(type, variant, status) {
  const v = lower(variant);
  const s = lower(status);

  // Status-based tones take precedence
  if (s === "cart_ready") return "bg-indigo-600 border-indigo-600 text-white";
  if (s === "thinking") return "bg-white border-gray-200 text-gray-900";
  if (s === "listening") return "bg-white border-gray-200 text-gray-900";
  if (s === "speaking") return "bg-white border-gray-200 text-gray-900";

  if (v === "coach") return "bg-indigo-600 border-indigo-600 text-white";

  const t = lower(type || "tip");
  if (t === "warning") return "bg-amber-50 border-amber-200 text-amber-950";
  if (t === "success") return "bg-emerald-50 border-emerald-200 text-emerald-950";
  if (t === "wow") return "bg-indigo-600 border-indigo-600 text-white";
  return "bg-white border-gray-200 text-gray-900";
}

function pickLabel(type, variant, status) {
  const v = lower(variant);
  const s = lower(status);

  if (s === "cart_ready") return "Cart ready";
  if (s === "thinking") return "Snoozer is thinking";
  if (s === "listening") return "Snoozer is listening";
  if (s === "speaking") return "Snoozer is speaking";

  if (v === "coach") return "Coach mode";

  const t = lower(type || "tip");
  if (t === "warning") return "Quick heads-up";
  if (t === "success") return "Saved";
  if (t === "wow") return "Snoozer says";
  return "Snoozer tip";
}

function pickTailClass({ isWow, isWarning, isSuccess, status } = {}) {
  const s = lower(status);

  if (s === "cart_ready") return "border-indigo-600 bg-indigo-600";
  if (s === "thinking" || s === "listening" || s === "speaking")
    return "border-gray-200 bg-white";

  if (isWow) return "border-indigo-600 bg-indigo-600";
  if (isWarning) return "border-amber-200 bg-amber-50";
  if (isSuccess) return "border-emerald-200 bg-emerald-50";
  return "border-gray-200 bg-white";
}

function pickAvatarBoxClass({ isWow, isWarning, isSuccess, status } = {}) {
  const s = lower(status);

  if (s === "cart_ready") return "border-white/30 bg-white/10";
  if (s === "thinking" || s === "listening" || s === "speaking")
    return "border-gray-200 bg-white";

  if (isWow) return "border-indigo-500 bg-white/10";
  if (isWarning) return "border-amber-200 bg-white";
  if (isSuccess) return "border-emerald-200 bg-white";
  return "border-gray-200 bg-white";
}

function pickIconClass({ isWow, isWarning, isSuccess, status } = {}) {
  const s = lower(status);

  if (s === "cart_ready") return "text-white";
  if (s === "thinking" || s === "listening" || s === "speaking") return "text-indigo-700";

  if (isWow) return "text-white";
  if (isWarning) return "text-amber-700";
  if (isSuccess) return "text-emerald-700";
  return "text-indigo-700";
}

export default function SnoozerCue({
  text,
  type = "tip",
  title,
  variant,
  status = "idle",

  // Optional embedded-actions
  primaryAction,
  secondaryAction,

  // Optional overrides
  footerNote,
  compact = false,
  ariaLabel,
}) {
  const clean = String(text || "").trim();
  if (!clean) return null;

  const t = useMemo(() => lower(type || "tip"), [type]);
  const v = useMemo(() => lower(variant || ""), [variant]);
  const s = useMemo(() => lower(status || "idle"), [status]);

  const label = useMemo(() => title || pickLabel(t, v, s), [title, t, v, s]);
  const Icon = useMemo(() => pickIcon(t, v, s), [t, v, s]);
  const tone = useMemo(() => pickTone(t, v, s), [t, v, s]);

  const isCoach = v === "coach";
  const isWow = t === "wow" || isCoach || s === "cart_ready";
  const isWarning = t === "warning" && !isCoach;
  const isSuccess = t === "success" && !isCoach;
  const isTip = !isWow && !isWarning && !isSuccess && s === "idle";

  const tailClass = useMemo(
    () => pickTailClass({ isWow, isWarning, isSuccess, status: s }),
    [isWow, isWarning, isSuccess, s]
  );

  const avatarBoxClass = useMemo(
    () => pickAvatarBoxClass({ isWow, isWarning, isSuccess, status: s }),
    [isWow, isWarning, isSuccess, s]
  );

  const iconClass = useMemo(
    () => pickIconClass({ isWow, isWarning, isSuccess, status: s }),
    [isWow, isWarning, isSuccess, s]
  );

  const titleClass = useMemo(() => {
    const base = compact ? "text-sm md:text-base" : "text-base md:text-lg";
    return [base, "font-extrabold", isWow ? "text-white" : "text-gray-900"].join(" ");
  }, [isWow, compact]);

  const bodyClass = useMemo(() => {
    const base = compact ? "text-sm md:text-base" : "text-base md:text-lg";
    return ["mt-1 leading-relaxed", base, isWow ? "text-white/95" : "text-gray-800"].join(" ");
  }, [isWow, compact]);

  const containerPad = compact ? "p-4 md:p-5" : "p-5 md:p-6";
  const avatarSize = compact ? "h-11 w-11 md:h-12 md:w-12" : "h-12 w-12 md:h-14 md:w-14";

  const iconSpin = s === "thinking" ? "animate-spin" : "";

  const hasPrimary = primaryAction && typeof primaryAction.onClick === "function";
  const hasSecondary = secondaryAction && typeof secondaryAction.onClick === "function";
  const hasActions = hasPrimary || hasSecondary;

  const primaryLabel = useMemo(() => {
    if (!hasPrimary) return "";
    const raw = String(primaryAction?.label || "").trim();
    return raw || "Continue";
  }, [hasPrimary, primaryAction?.label]);

  const secondaryLabel = useMemo(() => {
    if (!hasSecondary) return "";
    const raw = String(secondaryAction?.label || "").trim();
    return raw || "Back";
  }, [hasSecondary, secondaryAction?.label]);

  const defaultFooter = useMemo(() => {
    if (footerNote) return footerNote;

    if (s === "cart_ready") return "Open your cart to review, or keep shopping.";
    if (s === "thinking") return "Working on it…";
    if (s === "listening") return "Speak naturally. Short phrases are fine.";
    if (s === "speaking") return "If you missed it, it’s written here too.";
    if (isTip) return "If you need help, tap “View SnoozePod” when you’re ready.";

    return null;
  }, [footerNote, s, isTip]);

  return (
    <div className="w-full">
      <div
        className={["relative rounded-3xl border shadow-sm", containerPad, tone].join(" ")}
        role="status"
        aria-live="polite"
        aria-label={ariaLabel || "Snoozer message"}
      >
        <div
          className={["absolute -top-2 left-10 h-4 w-4 rotate-45 border-l border-t", tailClass].join(" ")}
          aria-hidden
        />

        <div className="flex items-start gap-4">
          <div className="shrink-0">
            <div
              className={[
                avatarSize,
                "rounded-2xl border flex items-center justify-center shadow-sm",
                avatarBoxClass,
              ].join(" ")}
              aria-hidden
            >
              <Icon className={["h-6 w-6", iconClass, iconSpin].join(" ")} />
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className={titleClass}>{label}</div>
            <div className={bodyClass}>{clean}</div>

            {hasActions ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {hasSecondary ? (
                  <Button
                    variant="outline"
                    className={["h-10", isWow ? "border-white/30 bg-white/10 text-white hover:bg-white/15" : ""].join(" ")}
                    onClick={secondaryAction.onClick}
                    disabled={!!secondaryAction.disabled}
                  >
                    {secondaryLabel}
                  </Button>
                ) : null}

                {hasPrimary ? (
                  <Button
                    className={["h-10", isWow ? "bg-white text-indigo-700 hover:bg-white/90" : ""].join(" ")}
                    onClick={primaryAction.onClick}
                    disabled={!!primaryAction.disabled}
                  >
                    {primaryLabel}
                  </Button>
                ) : null}
              </div>
            ) : null}

            {defaultFooter ? (
              <div className={["mt-3 text-xs", isWow ? "text-white/80" : "text-gray-500"].join(" ")}>
                {defaultFooter}
              </div>
            ) : null}
          </div>
        </div>

        {/* Subtle bottom-right activity tag (optional) */}
        {s !== "idle" ? (
          <div
            className={[
              "absolute bottom-3 right-4 text-[10px] font-semibold tracking-wide",
              isWow ? "text-white/80" : "text-gray-400",
            ].join(" ")}
          >
            {s === "thinking"
              ? "PROCESSING"
              : s === "listening"
              ? "LISTENING"
              : s === "speaking"
              ? "SPEAKING"
              : s === "cart_ready"
              ? "READY"
              : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}