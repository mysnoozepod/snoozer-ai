import { CART_AUTHORITY, DEVICE_MODES } from "./deviceModes.js";

const STORE_ID = "severn-pilot";
const MANIFEST_ENV = "dev";
const CONFIG_VERSION = 1;

const commonCustomerBlockedRoutes = [
  "/checkout/*",
  "/explore-dev",
];

function makePodDevice(index) {
  const podId = `pod-${index}`;

  return {
    deviceId: `${podId}-ipad-01`,
    deviceMode: DEVICE_MODES.POD_IPAD,
    env: MANIFEST_ENV,
    storeId: STORE_ID,
    zoneId: podId,
    podId,
    defaultRoute: `/pod/${podId}`,
    allowedRoutePatterns: [`/pod/${podId}`, "/ask-snoozer", "/cart"],
    blockedRoutePatterns: [
      "/welcome",
      "/what-to-expect",
      "/assessment",
      "/results",
      "/checkout/*",
      "/explore-dev",
    ],
    enabled: true,
    configVersion: CONFIG_VERSION,
    checkoutAuthority: false,
    cartAuthority: CART_AUTHORITY.PREVIEW,
    resetPolicy: {
      timeoutMs: 900000,
      requiresNoTouch: true,
      requiresNoOccupancy: true,
      requiresNoActiveRestTest: true,
      requiresNoActiveTts: true,
      requiresNoCartMutation: true,
    },
  };
}

export const DEVICE_REGISTRY_MANIFEST = Object.freeze({
  "welcome-01": {
    deviceId: "welcome-01",
    deviceMode: DEVICE_MODES.WELCOME_KIOSK,
    env: MANIFEST_ENV,
    storeId: STORE_ID,
    zoneId: "welcome-zone",
    podId: null,
    defaultRoute: "/welcome",
    allowedRoutePatterns: ["/welcome", "/what-to-expect", "/assessment", "/results"],
    blockedRoutePatterns: [
      "/pod/*",
      "/ask-snoozer",
      "/cart",
      "/checkout/*",
      "/snoozepod",
      "/products/*",
      "/explore-dev",
    ],
    enabled: true,
    configVersion: CONFIG_VERSION,
    checkoutAuthority: false,
    cartAuthority: CART_AUTHORITY.NONE,
    resetPolicy: {
      timeoutMs: 300000,
      blocksDuringActiveAssessmentSubmission: true,
      blocksDuringActiveQrWorkflow: true,
    },
  },

  "pod-1-ipad-01": makePodDevice(1),
  "pod-2-ipad-01": makePodDevice(2),
  "pod-3-ipad-01": makePodDevice(3),
  "pod-4-ipad-01": makePodDevice(4),
  "pod-5-ipad-01": makePodDevice(5),

  "ask-snoozer-01": {
    deviceId: "ask-snoozer-01",
    deviceMode: DEVICE_MODES.ASK_SNOOZER_KIOSK,
    env: MANIFEST_ENV,
    storeId: STORE_ID,
    zoneId: "ask-snoozer-zone",
    podId: null,
    defaultRoute: "/ask-snoozer",
    allowedRoutePatterns: ["/ask-snoozer"],
    blockedRoutePatterns: [
      "/welcome",
      "/what-to-expect",
      "/assessment",
      "/results",
      "/pod/*",
      "/cart",
      "/checkout/*",
      "/snoozepod",
      "/products/*",
      "/explore-dev",
    ],
    enabled: true,
    configVersion: CONFIG_VERSION,
    checkoutAuthority: false,
    cartAuthority: CART_AUTHORITY.NONE,
    resetPolicy: {
      timeoutMs: 300000,
      blocksDuringActiveResponse: true,
      blocksDuringActiveTts: true,
      blocksDuringHelpRequested: true,
    },
  },

  "sleep-essentials-01": {
    deviceId: "sleep-essentials-01",
    deviceMode: DEVICE_MODES.SLEEP_ESSENTIALS_KIOSK,
    env: MANIFEST_ENV,
    storeId: STORE_ID,
    zoneId: "sleep-essentials-zone",
    podId: null,
    defaultRoute: "/sleep-essentials",
    allowedRoutePatterns: ["/sleep-essentials", "/cart"],
    blockedRoutePatterns: [
      "/welcome",
      "/what-to-expect",
      "/assessment",
      "/results",
      "/pod/*",
      "/checkout/*",
      "/explore-dev",
    ],
    enabled: true,
    configVersion: CONFIG_VERSION,
    checkoutAuthority: false,
    cartAuthority: CART_AUTHORITY.PREVIEW,
    resetPolicy: {
      timeoutMs: 480000,
      blocksDuringProductInteraction: true,
      blocksDuringCartMutation: true,
    },
  },

  "checkout-01": {
    deviceId: "checkout-01",
    deviceMode: DEVICE_MODES.CHECKOUT_KIOSK,
    env: MANIFEST_ENV,
    storeId: STORE_ID,
    zoneId: "checkout-zone",
    podId: null,
    defaultRoute: "/cart",
    allowedRoutePatterns: ["/cart", "/checkout/:id", "/checkout/guest", "/financing"],
    blockedRoutePatterns: [
      "/welcome",
      "/what-to-expect",
      "/assessment",
      "/results",
      "/pod/*",
      "/explore-dev",
    ],
    enabled: true,
    configVersion: CONFIG_VERSION,
    checkoutAuthority: true,
    cartAuthority: CART_AUTHORITY.FULL,
    resetPolicy: {
      timeoutMs: null,
      usesAbandonmentWarning: true,
      supportsSessionRecovery: true,
      supportsQrContinuation: true,
      preserveShopifyCart: true,
    },
  },
});

export const LOCKED_DEVICE_IDS = Object.freeze(Object.keys(DEVICE_REGISTRY_MANIFEST));
export const COMMON_CUSTOMER_BLOCKED_ROUTES = Object.freeze(commonCustomerBlockedRoutes);
