import React from "react";
import { Navigate, useLocation } from "react-router-dom";

import {
  CHECKOUT_LOUNGE_MESSAGE,
  canInitiateCheckout,
  canViewCart,
  getCartRouteFallback,
  getCheckoutRouteFallback,
} from "./deviceActionGuards.js";
import DeviceUnavailable from "./DeviceUnavailable.jsx";
import { getDeviceRouteDecision } from "./deviceRouteOwnership.js";
import { useDeviceMode } from "./useDeviceMode.js";

export default function DeviceRouteGuard({
  children,
  requireCart = false,
  requireCheckout = false,
}) {
  const device = useDeviceMode();
  const location = useLocation();
  const attemptedPath = `${location.pathname || ""}${location.search || ""}${location.hash || ""}`;

  const decision = getDeviceRouteDecision(device, attemptedPath);

  if (!decision.allow) {
    if (decision.redirectTo && decision.redirectTo !== location.pathname) {
      return <Navigate to={decision.redirectTo} replace state={decision.state || {}} />;
    }

    return (
      <DeviceUnavailable
        kind={decision.unavailableKind}
        message={decision.message}
        details={device?.isAdminDev ? device?.validationErrors : []}
      />
    );
  }

  if (requireCheckout) {
    if (canInitiateCheckout(device)) return children;

    const fallback = getCheckoutRouteFallback(device, attemptedPath);
    if (fallback.to && fallback.to !== location.pathname) {
      return <Navigate to={fallback.to} replace state={fallback.state} />;
    }

    return (
      <DeviceUnavailable
        kind="checkout_unavailable"
        message={fallback.state?.message || CHECKOUT_LOUNGE_MESSAGE}
      />
    );
  }

  if (requireCart) {
    if (canViewCart(device)) return children;

    const fallback = getCartRouteFallback(device, attemptedPath);
    if (fallback.to && fallback.to !== location.pathname) {
      return <Navigate to={fallback.to} replace state={fallback.state} />;
    }

    return (
      <DeviceUnavailable
        kind="route_unavailable"
        message="Your showroom path is still saved. Continue from this station's main screen."
      />
    );
  }

  return children;
}
