import { useState, useEffect } from "react";

/**
 * useSessionTimer
 * Simple countdown hook (default 60 min).
 * Returns { timeLeft, resetTimer, isExpired }.
 */
export default function useSessionTimer(startMinutes = 60) {
  const [secondsLeft, setSecondsLeft] = useState(startMinutes * 60);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const resetTimer = () => setSecondsLeft(startMinutes * 60);
  const isExpired = secondsLeft <= 0;

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const secs = String(secondsLeft % 60).padStart(2, "0");
  return { timeLeft: `${mins}:${secs}`, resetTimer, isExpired };
}
