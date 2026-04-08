import React, { useEffect, useState } from "react";
import { getRewardBalance } from "@/lib/api";

export default function RewardsPill({ shopperId, onClick, ariaLabel = "Open rewards" }) {
  const [points, setPoints] = useState(0);

  useEffect(() => {
    if (!shopperId) return;
    let alive = true;

    const poll = async () => {
      try {
        const data = await getRewardBalance(shopperId);
        const bal =
          typeof data?.balance === "number"
            ? data.balance
            : typeof data?.data?.balance === "number"
            ? data.data.balance
            : 0;
        if (alive) setPoints(bal);
      } catch (e) {
        console.error("RewardsPill balance fetch failed", e);
      }
    };

    poll();
    const id = setInterval(poll, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [shopperId]);

  if (!shopperId) return null;

  return (
    <div
      onClick={onClick}
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 9999,
        padding: "8px 14px",
        borderRadius: 9999,
        background: "linear-gradient(to right,#7e22ce,#4f46e5)",
        color: "#fff",
        fontWeight: 700,
        cursor: "pointer",
        boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
        userSelect: "none",
      }}
      aria-label={ariaLabel}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" ? onClick?.() : null)}
    >
      🎁 {points} pts
    </div>
  );
}
