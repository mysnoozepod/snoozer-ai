import { DEVICE_MODES, DEVICE_STATUSES } from "./deviceModes.js";
import { isDevelopmentEnvironment } from "./deviceRegistry.js";
import { matchesAnyRoutePattern } from "./deviceRoutePatterns.js";
import {
  CHECKOUT_LOUNGE_MESSAGE,
  canInitiateCheckout,
  canViewCart,
  canViewFinancing,
  getCartRouteFallback,
  getCheckoutRouteFallback,
} from "./deviceActionGuards.js";
import {
  getCanonicalPodRouteForPath,
  isCanonicalPodRoute,
  isPodRoute,
  makePodRoute,
  normalizePodId,
  routeMatchesBoundPod,
} from "./podRouteUtils.js";

function pathOnly(pathname) {
  return String(pathname || "/").split(/[?#]/)[0] || "/";
}

function unavailable(kind, message, extra = {}) {
  return {
    allow: false,
    redirectTo: null,
    state: null,
    unavailable: true,
    unavailableKind: kind,
    message,
    ...extra,
  };
}

function redirect(to, state = {}, extra = {}) {
  return {
    allow: false,
    redirectTo: to,
    state,
    unavailable: false,
    unavailableKind: "",
    message: "",
    ...extra,
  };
}

function allow(extra = {}) {
  return {
    allow: true,
    redirectTo: null,
    state: null,
    unavailable: false,
    unavailableKind: "",
    message: "",
    ...extra,
  };
}

export function isAdminDevRouteAllowed(device) {
  return Boolean(
    device?.isAdminDev &&
      device?.deviceMode === DEVICE_MODES.ADMIN_DEV &&
      isDevelopmentEnvironment(device?.environment, false)
  );
}

export function getDeviceRouteDecision(device, pathname) {
  const route = pathOnly(pathname);

  if (device?.status === DEVICE_STATUSES.LOADING) {
    return unavailable("loading", "Checking this showroom station before continuing.");
  }

  if (isAdminDevRouteAllowed(device)) {
    const canonicalPodRoute = getCanonicalPodRouteForPath(route);
    if (canonicalPodRoute && !isCanonicalPodRoute(route)) {
      return redirect(canonicalPodRoute, { normalizedFrom: route }, { reason: "legacy_pod_route" });
    }
    return allow({ reason: "admin_dev" });
  }

  if (device?.status === DEVICE_STATUSES.UNKNOWN) {
    return unavailable(
      "unknown_device",
      "This showroom station is not set up yet. Please ask a team member for help."
    );
  }

  if (device?.status === DEVICE_STATUSES.DISABLED) {
    return unavailable(
      "disabled_device",
      "This showroom station is temporarily unavailable. Please ask a team member for help."
    );
  }

  if (device?.status === DEVICE_STATUSES.INVALID) {
    return unavailable(
      "invalid_configuration",
      "This showroom station needs a quick setup check before it can continue."
    );
  }

  if (device?.status !== DEVICE_STATUSES.READY) {
    return unavailable(
      "route_unavailable",
      "This showroom station is not ready yet. Please ask a team member for help."
    );
  }

  if (route === "/checkout/guest" || route.startsWith("/checkout/")) {
    if (canInitiateCheckout(device)) return allow({ reason: "checkout_authority" });
    const fallback = getCheckoutRouteFallback(device, route);
    return redirect(fallback.to, fallback.state, { reason: "checkout_blocked" });
  }

  if (route === "/cart") {
    if (canViewCart(device)) return allow({ reason: "cart_authority" });
    const fallback = getCartRouteFallback(device, route);
    return redirect(fallback.to, fallback.state, { reason: "cart_blocked" });
  }

  if (route === "/financing") {
    if (canViewFinancing(device)) return allow({ reason: "financing_authority" });
    return redirect(device.defaultRoute || "/welcome", {
      routeUnavailable: true,
      attemptedPath: route,
      deviceId: device.deviceId || null,
      deviceMode: device.deviceMode || null,
    }, { reason: "financing_blocked" });
  }

  if (device.deviceMode === DEVICE_MODES.POD_IPAD) {
    const boundPodRoute = makePodRoute(device.podId);
    if (!boundPodRoute || !device.zoneId) {
      return unavailable(
        "missing_pod_binding",
        "This pod iPad needs its assigned SnoozePod before it can continue."
      );
    }

    if (isPodRoute(route)) {
      if (!routeMatchesBoundPod(route, device.podId)) {
        return redirect(
          boundPodRoute,
          {
            podBindingRedirect: true,
            attemptedPath: route,
            deviceId: device.deviceId || null,
            boundPodId: normalizePodId(device.podId),
          },
          { reason: "pod_binding_redirect" }
        );
      }

      if (!isCanonicalPodRoute(route)) {
        return redirect(
          boundPodRoute,
          {
            normalizedFrom: route,
            deviceId: device.deviceId || null,
            boundPodId: normalizePodId(device.podId),
          },
          { reason: "legacy_pod_route" }
        );
      }

      return allow({ reason: "bound_pod_route" });
    }
  }

  if (device.deviceMode === DEVICE_MODES.SLEEP_ESSENTIALS_KIOSK && route === "/sleep-essentials") {
    return unavailable(
      "future_route_not_implemented",
      "This Sleep Essentials station is not installed in the app yet."
    );
  }

  if (matchesAnyRoutePattern(route, device.blockedRoutePatterns || [])) {
    return redirect(device.defaultRoute || "/welcome", {
      routeBlocked: true,
      attemptedPath: route,
      deviceId: device.deviceId || null,
      deviceMode: device.deviceMode || null,
    }, { reason: "blocked_route" });
  }

  if (Array.isArray(device.allowedRoutePatterns) && device.allowedRoutePatterns.length) {
    if (!matchesAnyRoutePattern(route, device.allowedRoutePatterns)) {
      return redirect(device.defaultRoute || "/welcome", {
        routeUnavailable: true,
        attemptedPath: route,
        deviceId: device.deviceId || null,
        deviceMode: device.deviceMode || null,
      }, { reason: "not_allowed_route" });
    }
  }

  if (route === "/checkout/guest" || route.startsWith("/checkout/")) {
    return unavailable("checkout_unavailable", CHECKOUT_LOUNGE_MESSAGE);
  }

  return allow({ reason: "allowed_route" });
}
