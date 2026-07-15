import { CART_AUTHORITY, DEVICE_MODES, DEVICE_STATUSES } from "./deviceModes.js";
import { isDevelopmentEnvironment } from "./deviceRegistry.js";

export const CHECKOUT_LOUNGE_MESSAGE =
  "Your selections are saved. Continue at the Checkout Lounge when you are ready to complete your investment.";

function isReadyDevice(device) {
  return device?.status === DEVICE_STATUSES.READY;
}

export function isAdminDevCheckoutAllowed(device) {
  return Boolean(
    device?.isAdminDev &&
      device?.deviceMode === DEVICE_MODES.ADMIN_DEV &&
      isDevelopmentEnvironment(device?.environment, false)
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

