import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useStore } from "@/lib/useStore";

export function usePodCart() {
  const cart = useStore((state) => (Array.isArray(state.cart) ? state.cart : []));
  const cartId = useStore((state) => state.cartId || null);
  const syncCartFromShopify = useStore((state) => state.syncCartFromShopify);
  const snoozepodCount = useMemo(
    () => cart.reduce((sum, item) => sum + Math.max(0, Number(item?.quantity) || 0), 0),
    [cart]
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

  useEffect(() => {
    syncCartFromShopify?.({ sourcePage: "pod-header" }).catch((err) => {
      console.warn("[cart] pod header restore failed", {
        operation: "cart_fetch",
        sourcePage: "pod-header",
        cartId,
        errorCode: err?.code || err?.name || err?.status || "CART_FETCH_FAILED",
      });
    });
  }, [cartId, syncCartFromShopify]);

  useEffect(() => clearFeedbackTimer, [clearFeedbackTimer]);

  return {
    snoozepodCount,
    cartNotice,
    cartPulse,
    showCartFeedback,
  };
}
