// src/lib/useRewards.js
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { earnRewardPoints, getRewardBalance } from "@/lib/api";

/**
 * useRewards(shopperId)
 * Stable rewards hook:
 *  - Per-shopper local caching (no more "guest" mixing with real users)
 *  - One-time sync on mount / shopper change (skips guest)
 *  - Optimistic earn, then reconcile with backend balance if returned
 */

const LEVELS = [
  { min: 0, title: "Dream Seeker" },
  { min: 200, title: "Snooze Explorer" },
  { min: 500, title: "Sleep Specialist" },
  { min: 1000, title: "Master of Rest" },
];

function getLevel(points = 0) {
  const lvl = [...LEVELS].reverse().find((l) => points >= l.min);
  return lvl ? lvl.title : LEVELS[0].title;
}

function makePointsKey(shopperId) {
  const id = (shopperId || "guest").trim() || "guest";
  return `snooze.points.${id}`;
}

export default function useRewards(shopperId = "guest") {
  const pointsKey = useMemo(() => makePointsKey(shopperId), [shopperId]);

  const [balance, setBalance] = useState(() => {
    try {
      return Number(sessionStorage.getItem(pointsKey) || 0);
    } catch {
      return 0;
    }
  });

  const [level, setLevel] = useState(getLevel(balance));
  const [recentEarn, setRecentEarn] = useState(null);
  const lastEarnRef = useRef({ time: 0, reason: "" });

  const persist = useCallback(
    (val) => {
      try {
        sessionStorage.setItem(pointsKey, String(val));
        // Back-compat (if any old UI reads this):
        sessionStorage.setItem("snooze.points", String(val));
      } catch {}
    },
    [pointsKey]
  );

  const fireToast = useCallback((points, reason) => {
    const msg = `+${points} Snooze Points — ${reason}`;
    console.log("🎉", msg);
    try {
      const toast = document.createElement("div");
      toast.textContent = msg;
      Object.assign(toast.style, {
        position: "fixed",
        bottom: "24px",
        right: "24px",
        background: "#1A66D2",
        color: "#fff",
        padding: "12px 18px",
        borderRadius: "12px",
        boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
        fontWeight: "600",
        zIndex: 9999,
        animation: "fadeUp 3s ease forwards",
      });
      const style = document.createElement("style");
      style.innerHTML = `
        @keyframes fadeUp {
          0% { opacity: 0; transform: translateY(20px); }
          10% { opacity: 1; transform: translateY(0); }
          90% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-10px); }
        }`;
      document.head.appendChild(style);
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    } catch {}
  }, []);

  // When shopperId changes, pull cached points immediately (no network yet)
  useEffect(() => {
    try {
      const cached = Number(sessionStorage.getItem(pointsKey) || 0);
      setBalance(cached);
      persist(cached);
    } catch {}
  }, [pointsKey, persist]);

  const earn = useCallback(
    async (points = 0, reason = "Milestone") => {
      if (!points || points <= 0) return;

      const now = Date.now();
      const last = lastEarnRef.current;

      // throttle: 3 seconds between identical reasons
      if (reason === last.reason && now - last.time < 3000) return;
      lastEarnRef.current = { time: now, reason };

      // optimistic update (functional, avoids stale closures)
      let optimisticNext = 0;
      setBalance((prev) => {
        optimisticNext = prev + points;
        persist(optimisticNext);
        return optimisticNext;
      });

      setRecentEarn({ points, reason });
      fireToast(points, reason);

      // Don’t sync guest earns to backend unless you really want that behavior.
      const id = (shopperId || "guest").trim();
      if (!id || id === "guest") return;

      try {
        const resp = await earnRewardPoints({ shopperId: id, points, reason });

        if (resp && resp.ok === false) {
          console.warn("⚠️ Reward earn rejected:", resp?.error || resp);
          return;
        }

        const rewardsContext = resp?.context?.rewards;
        if (rewardsContext && typeof rewardsContext.balance === "number") {
          setBalance(rewardsContext.balance);
          persist(rewardsContext.balance);
        }
      } catch (err) {
        console.warn("⚠️ Reward sync skipped:", err?.message || err);
      }
    },
    [shopperId, persist, fireToast]
  );

  // sync once on mount (skips guest)
  useEffect(() => {
    (async () => {
      const id = (shopperId || "guest").trim();
      if (!id || id === "guest") return;

      try {
        const resp = await getRewardBalance(id);

        if (resp && resp.ok === false) {
          console.warn("⚠️ Could not sync rewards (error envelope):", resp?.error || resp);
          return;
        }

        let pts = null;
        if (resp?.context?.rewards && typeof resp.context.rewards.balance === "number") {
          pts = resp.context.rewards.balance;
        } else if (typeof resp?.balance === "number") {
          pts = resp.balance;
        } else if (typeof resp?.points === "number") {
          pts = resp.points;
        }

        if (pts != null) {
          setBalance(pts);
          persist(pts);
        }
      } catch (err) {
        console.warn("⚠️ Could not sync rewards:", err?.message || err);
      }
    })();
  }, [shopperId, persist]);

  useEffect(() => setLevel(getLevel(balance)), [balance]);

  const reset = useCallback(() => {
    setBalance(0);
    persist(0);
    try {
      sessionStorage.removeItem(pointsKey);
      sessionStorage.removeItem("snooze.points");
    } catch {}
  }, [persist, pointsKey]);

  return { balance, level, title: level, earn, reset, recentEarn };
}
