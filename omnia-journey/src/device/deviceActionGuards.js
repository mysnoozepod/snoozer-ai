import { CART_AUTHORITY, DEVICE_MODES, DEVICE_STATUSES } from "./deviceModes.js";
import { DEPLOYMENT_ROLES, isDevelopmentEnvironment } from "./deviceRegistry.js";
import { matchesAnyRoutePattern } from "./deviceRoutePatterns.js";
import { isPodRoute, routeMatchesBoundPod } from "./podRouteUtils.js";

export const CHECKOUT_LOUNGE_MESSAGE =
  "Your selections are saved. Continue at the Checkout Lounge when you are ready to complete your investment.";

function isReadyDevice(device) {
  return device?.status === DEVICE_STATUSES.READY;
}

function pathOnly(pathname) {
  const raw = String(pathname || "/").split(/[?#]/)[0] || "/";
  if (!raw.startsWith("/")) return raw;
  return raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
}

export function isAdminDevCheckoutAllowed(device) {
  return Boolean(
      device?.isAdminDev &&
      device?.deviceMode === DEVICE_MODES.ADMIN_DEV &&
      (isDevelopmentEnvironment(device?.environment, false) ||
        device?.deploymentRole === DEPLOYMENT_ROLES.REVIEW)
  );
}

export function canViewCart(device) {
  if (isAdminDevCheckoutAllowed(device)) return true;
  if (!isReadyDevice(device)) return false;
  return (
    device?.cartAuthority === CART_AUTHORITY.PREVIEW ||
    device?.cartAuthority === CART_AUTHORITY.FULL
  );
}

export function canMutateCart(device) {
  if (isAdminDevCheckoutAllowed(device)) return true;
  if (!isReadyDevice(device)) return false;
  return (
    device?.cartAuthority === CART_AUTHORITY.PREVIEW ||
    device?.cartAuthority === CART_AUTHORITY.FULL
  );
}

export function canInitiateCheckout(device) {
  if (isAdminDevCheckoutAllowed(device)) return true;
  if (!isReadyDevice(device)) return false;
  return Boolean(
    device?.checkoutAuthority === true && device?.cartAuthority === CART_AUTHORITY.FULL
  );
}

export function canOpenCheckoutUrl(device) {
  return canInitiateCheckout(device);
}

export function canViewFinancing(device) {
  if (isAdminDevCheckoutAllowed(device)) return true;
  if (!isReadyDevice(device)) return false;
  return device?.deviceMode === DEVICE_MODES.CHECKOUT_KIOSK;
}

export function canViewPodNavigation(device, route = "") {
  if (isAdminDevCheckoutAllowed(device)) return true;
  if (!isReadyDevice(device)) return false;
  if (device?.deviceMode !== DEVICE_MODES.POD_IPAD) return false;

  const path = pathOnly(route);
  if (!path || path === "/") return true;
  if (!isPodRoute(path)) return true;
  return routeMatchesBoundPod(path, device?.podId);
}

export function canViewProductDetail(device, route = "/products/:slug") {
  if (isAdminDevCheckoutAllowed(device)) return true;
  if (!isReadyDevice(device)) return false;
  const path = pathOnly(route);
  return matchesAnyRoutePattern(path, device?.allowedRoutePatterns || []);
}

export function canNavigateTo(device, route) {
  const path = pathOnly(route);

  if (isAdminDevCheckoutAllowed(device)) return true;
  if (!isReadyDevice(device)) return false;
  if (!path) return false;

  if (path === "/cart") return canViewCart(device);
  if (path === "/financing") return canViewFinancing(device);
  if (path === "/checkout/guest" || path.startsWith("/checkout/")) {
    return canInitiateCheckout(device);
  }
  if (isPodRoute(path)) return canViewPodNavigation(device, path);
  if (path.startsWith("/products/")) return canViewProductDetail(device, path);
  if (matchesAnyRoutePattern(path, device?.blockedRoutePatterns || [])) return false;

  if (Array.isArray(device?.allowedRoutePatterns) && device.allowedRoutePatterns.length) {
    return matchesAnyRoutePattern(path, device.allowedRoutePatterns);
  }

  return true;
}

export function canUseAskSnoozer(device) {
  return canNavigateTo(device, "/ask-snoozer");
}

export function canViewAdminDiagnostics(device) {
  return isAdminDevCheckoutAllowed(device);
}

function textFromAction(action) {
  if (typeof action === "string") return action;
  return [
    action?.type,
    action?.action,
    action?.value,
    action?.label,
    action?.title,
    action?.text,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function routeFromAction(action) {
  const direct = action?.target || action?.href || action?.url;
  if (typeof direct === "string" && direct.trim().startsWith("/")) {
    return direct.trim();
  }
  return "";
}

export function isDeviceActionAllowed(device, action) {
  if (!action) return false;

  const route = routeFromAction(action);
  if (route) return canNavigateTo(device, route);

  const text = textFromAction(action);
  if (!text.trim()) return true;

  if (text.includes("human") || text.includes("support") || text.includes("specialist")) {
    return true;
  }
  if (text.includes("redeem") || text.includes("reward redemption") || text.includes("apply reward")) {
    return canInitiateCheckout(device);
  }
  if (text.includes("checkout")) return canInitiateCheckout(device);
  if (text.includes("cart") || text.includes("add to cart")) {
    return text.includes("add to cart") ? canMutateCart(device) : canViewCart(device);
  }
  if (text.includes("financ")) return canViewFinancing(device);
  if (text.includes("assessment") || text.includes("snooze assessment")) {
    return canNavigateTo(device, "/assessment");
  }
  if (text.includes("results") || text.includes("recommend")) {
    return canNavigateTo(device, "/results");
  }
  if (text.includes("pod") || text.includes("rest test") || text.includes("build")) {
    return canViewPodNavigation(device);
  }

  return true;
}

export function filterDeviceActions(device, actions = []) {
  if (!Array.isArray(actions)) return [];
  return actions.filter((action) => isDeviceActionAllowed(device, action));
}

export function shouldShowCheckoutLoungeHandoff(device) {
  return canViewCart(device) && !canInitiateCheckout(device);
}

export function getCheckoutHandoffState(device, attemptedPath = "") {
  return {
    checkoutBlocked: true,
    checkoutHandoff: true,
    attemptedPath: attemptedPath || "",
    deviceId: device?.deviceId || null,
    deviceMode: device?.deviceMode || null,
    message: CHECKOUT_LOUNGE_MESSAGE,
  };
}

export function getCheckoutRouteFallback(device, attemptedPath = "") {
  if (isAdminDevCheckoutAllowed(device) || canInitiateCheckout(device)) {
    return {
      to: attemptedPath || "/cart",
      state: {},
      allow: true,
    };
  }

  if (
    device?.deviceMode === DEVICE_MODES.POD_IPAD ||
    device?.deviceMode === DEVICE_MODES.SLEEP_ESSENTIALS_KIOSK
  ) {
    return {
      to: "/cart",
      state: getCheckoutHandoffState(device, attemptedPath),
      allow: false,
    };
  }

  return {
    to: device?.defaultRoute || "/welcome",
    state: {
      checkoutBlocked: true,
      attemptedPath: attemptedPath || "",
      deviceId: device?.deviceId || null,
      deviceMode: device?.deviceMode || null,
      message: CHECKOUT_LOUNGE_MESSAGE,
    },
    allow: false,
  };
}

export function getCartRouteFallback(device, attemptedPath = "") {
  return {
    to: device?.defaultRoute || "/welcome",
    state: {
      cartBlocked: true,
      attemptedPath: attemptedPath || "",
      deviceId: device?.deviceId || null,
      deviceMode: device?.deviceMode || null,
    },
  };
}
