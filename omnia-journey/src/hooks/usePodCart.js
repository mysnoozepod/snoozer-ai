import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useStore } from "@/lib/useStore";

export function usePodCart() {
  const plan = useStore((state) => (Array.isArray(state.snoozepod) ? state.snoozepod : []));
  const snoozepodCount = useMemo(
    () => plan.reduce((sum, item) => sum + Math.max(0, Number(item?.quantity) || 0), 0),
    [plan]
  );

  const [cartNotice, setCartNotice] = useState("");
  const [cartPulse, setCartPulse] = useState(false);
  const timeoutRef = useRef(null);
  const lastCartCountRef = useRef(snoozepodCount);

  const clearFeedbackTimer = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const showCartFeedback = useCallback(
    (message = "Added to cart") => {
      clearFeedbackTimer();
      setCartNotice(message);
      setCartPulse(true);
      timeoutRef.current = window.setTimeout(() => {
        setCartNotice("");
        setCartPulse(false);
        timeoutRef.current = null;
      }, 2200);
    },
    [clearFeedbackTimer]
  );

  useEffect(() => {
    if (snoozepodCount > lastCartCountRef.current) {
      showCartFeedback("Added to cart");
    }

    lastCartCountRef.current = snoozepodCount;
  }, [snoozepodCount, showCartFeedback]);

  useEffect(() => clearFeedbackTimer, [clearFeedbackTimer]);

  return {
    snoozepodCount,
    cartNotice,
    cartPulse,
    showCartFeedback,
  };
}
