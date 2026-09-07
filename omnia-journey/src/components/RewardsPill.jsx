import React, { useEffect } from "react";
import {
  refreshRewardsState,
  useRewardsState,
} from "@/state/rewardsStore";

export default function RewardsPill({
  shopperId,
  onClick,
  ariaLabel = "Open rewards",
  placement = "floating",
}) {
  const summary = useRewardsState((state) => state.summary);
  const status = useRewardsState((state) => state.status);

  useEffect(() => {
    if (shopperId) void refreshRewardsState();
  }, [shopperId]);

  if (!shopperId) return null;
  const rawPoints = summary?.availableSleepPoints;
  const hasConfirmedBalance =
    rawPoints !== null &&
    rawPoints !== undefined &&
    Number.isFinite(Number(rawPoints));
  const label = hasConfirmedBalance
    ? `${Number(rawPoints)} Sleep Points`
    : status === "error"
      ? "Rewards unavailable"
      : "Loading rewards";

  return (
    <button
      type="button"
      onClick={onClick}
      className={placement === "inline"
        ? "inline-flex min-h-11 items-center rounded-full border border-indigo-100 bg-[#f2f6ff] px-4 py-2 text-sm font-black text-[#2447c6] shadow-sm transition hover:border-indigo-200 hover:bg-white"
        : undefined}
      style={placement === "floating" ? {
          position: "fixed",
          top: 12,
          right: 12,
          zIndex: 9999,
          minHeight: 44,
          padding: "8px 14px",
          border: 0,
          borderRadius: 9999,
          background: "linear-gradient(to right,#7e22ce,#4f46e5)",
          color: "#fff",
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
        } : undefined}
      aria-label={ariaLabel}
      data-rewards-placement={placement}
    >
      {label}
    </button>
  );
}
