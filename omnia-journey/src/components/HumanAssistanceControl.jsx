import React, { useCallback, useEffect, useRef, useState } from "react";

import { emitDeviceHumanHelp } from "@/device/deviceActivityTracker";
import brandyAvatarSrc from "@/assets/brandy-avatar-c1.png";

export const BRANDY_AVATAR_SRC = brandyAvatarSrc;

export const HUMAN_ASSISTANCE_REQUEST_EVENT =
  "mysnoozepod:request-human-assistance";

export function requestHumanAssistance(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(HUMAN_ASSISTANCE_REQUEST_EVENT, { detail })
  );
}

export default function HumanAssistanceControl({
  hideTrigger = false,
  sourcePage = "showroom",
  compact = false,
  showNoticeMessage = true,
}) {
  const [showNotice, setShowNotice] = useState(false);
  const noticeTimerRef = useRef(null);
  const helpTimerRef = useRef(null);
  const helpActiveRef = useRef(false);

  const clearHelpRequest = useCallback(() => {
    if (helpTimerRef.current) {
      window.clearTimeout(helpTimerRef.current);
      helpTimerRef.current = null;
    }
    if (helpActiveRef.current) {
      emitDeviceHumanHelp(false, { sourcePage });
      helpActiveRef.current = false;
    }
  }, [sourcePage]);

  const requestHelp = useCallback(
    (detail = {}) => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      clearHelpRequest();

      const requestSource = String(detail?.sourcePage || sourcePage || "showroom");
      emitDeviceHumanHelp(true, { sourcePage: requestSource });
      helpActiveRef.current = true;
      setShowNotice(true);

      noticeTimerRef.current = window.setTimeout(() => setShowNotice(false), 8000);
      helpTimerRef.current = window.setTimeout(() => {
        emitDeviceHumanHelp(false, { sourcePage: requestSource });
        helpActiveRef.current = false;
        helpTimerRef.current = null;
      }, 90000);
    },
    [clearHelpRequest, sourcePage]
  );

  useEffect(() => {
    const handleRequest = (event) => requestHelp(event?.detail || {});
    window.addEventListener(HUMAN_ASSISTANCE_REQUEST_EVENT, handleRequest);
    return () => {
      window.removeEventListener(HUMAN_ASSISTANCE_REQUEST_EVENT, handleRequest);
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      clearHelpRequest();
    };
  }, [clearHelpRequest, requestHelp]);

  return (
    <>
      {!hideTrigger ? (
        <button
          type="button"
          onClick={() => requestHelp({ sourcePage })}
          className={[
            "group flex items-center rounded-full border border-white/90 bg-white/95 text-left backdrop-blur-md transition hover:border-indigo-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200",
            compact
              ? "min-h-11 gap-2 py-1 pl-1 pr-3 shadow-[0_8px_20px_rgba(34,57,112,0.14)]"
              : "min-h-12 gap-2.5 py-1.5 pl-1.5 pr-4 shadow-[0_12px_30px_rgba(34,57,112,0.2)] hover:shadow-[0_16px_36px_rgba(34,57,112,0.24)]",
          ].join(" ")}
          aria-label="Human Assistance — Talk to Brandy"
        >
          <img
            src={BRANDY_AVATAR_SRC}
            alt=""
            className={[
              "shrink-0 rounded-full border-2 border-white object-cover shadow-sm",
              compact ? "h-9 w-9" : "h-10 w-10",
            ].join(" ")}
            loading="lazy"
            decoding="async"
          />
          <span className="leading-tight">
            <span className={[
              "block font-black uppercase tracking-[0.12em] text-[#2f57e8]",
              compact ? "text-[0.66rem]" : "text-[0.72rem]",
            ].join(" ")}>
              {compact ? "Human Help" : "Human Assistance"}
            </span>
            <span className={[
              "mt-0.5 block font-bold text-slate-700",
              compact ? "text-[0.7rem]" : "text-xs",
            ].join(" ")}>
              Talk to Brandy
            </span>
          </span>
        </button>
      ) : null}

      {showNotice && showNoticeMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-2 flex w-[min(320px,calc(100vw-32px))] items-center gap-3 rounded-[20px] border border-indigo-100 bg-white/98 p-3 text-left shadow-[0_16px_40px_rgba(34,57,112,0.22)]"
        >
          <img
            src={BRANDY_AVATAR_SRC}
            alt="Brandy"
            className="h-12 w-12 shrink-0 rounded-full border-2 border-[#e9efff] object-cover"
          />
          <div className="min-w-0">
            <div className="text-sm font-black text-slate-900">Need Human Help?</div>
            <p className="mt-0.5 text-xs leading-5 text-slate-600">
              Please ask Brandy or a showroom sleep specialist. Your Snooze Session will stay right here.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
