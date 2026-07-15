import React from "react";
import { Navigate, useLocation } from "react-router-dom";

import { DEVICE_STATUSES } from "./deviceModes.js";
import {
  CHECKOUT_LOUNGE_MESSAGE,
  canInitiateCheckout,
  canViewCart,
  getCartRouteFallback,
  getCheckoutRouteFallback,
} from "./deviceActionGuards.js";
import { useDeviceMode } from "./useDeviceMode.js";

function DeviceBlockedSurface({ title = "Continue in the right showroom area.", message }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center px-6 py-10">
      <div className="rounded-[28px] border border-[#dbe5ff] bg-white/95 p-8 text-center shadow-[0_24px_70px_rgba(31,55,117,0.12)]">
        <div className="text-[0.78rem] font-black uppercase tracking-[0.2em] text-[#2f57e8]">
          MySnoozePod
        </div>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {message || CHECKOUT_LOUNGE_MESSAGE}
        </p>
      </div>
    </div>
  );
}

export default function DeviceRouteGuard({
  children,
  requireCart = false,
  requireCheckout = false,
}) {
  const device = useDeviceMode();
  const location = useLocation();
  const attemptedPath = `${location.pathname || ""}${location.search || ""}${location.hash || ""}`;

  if (device?.status === DEVICE_STATUSES.LOADING) {
    return (
      <DeviceBlockedSurface
        title="Loading showroom device..."
        message="Checking this showroom station before continuing."
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
      <DeviceBlockedSurface
        title="Continue at the Checkout Lounge"
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
      <DeviceBlockedSurface
        title="Cart is handled at another showroom station."
        message="Your showroom path is still saved. Continue from this station's main screen."
      />
    );
  }

  return children;
}

