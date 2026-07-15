export const DEVICE_MODES = Object.freeze({
  WELCOME_KIOSK: "welcome-kiosk",
  POD_IPAD: "pod-ipad",
  ASK_SNOOZER_KIOSK: "ask-snoozer-kiosk",
  SLEEP_ESSENTIALS_KIOSK: "sleep-essentials-kiosk",
  CHECKOUT_KIOSK: "checkout-kiosk",
  ADMIN_DEV: "admin-dev",
});

export const DEVICE_MODE_VALUES = Object.freeze(Object.values(DEVICE_MODES));

export const CART_AUTHORITY = Object.freeze({
  NONE: "none",
  PREVIEW: "preview",
  FULL: "full",
});

export const CART_AUTHORITY_VALUES = Object.freeze(Object.values(CART_AUTHORITY));

export const DEVICE_STATUSES = Object.freeze({
  LOADING: "loading",
  READY: "ready",
  INVALID: "invalid",
  UNKNOWN: "unknown",
  DISABLED: "disabled",
});

export const CONFIG_SOURCES = Object.freeze({
  MANIFEST: "manifest",
  CACHE: "cache",
  DEVELOPMENT_FALLBACK: "development-fallback",
  FAILED_RESOLUTION: "failed-resolution",
});

export function isApprovedDeviceMode(value) {
  return DEVICE_MODE_VALUES.includes(value);
}

export function isCustomerDeviceMode(value) {
  return Boolean(value && value !== DEVICE_MODES.ADMIN_DEV);
}

export function isCheckoutDeviceMode(value) {
  return value === DEVICE_MODES.CHECKOUT_KIOSK;
}

