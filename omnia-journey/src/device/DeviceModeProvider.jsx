import React, { createContext, useEffect, useMemo, useState } from "react";
import DeviceDiagnostics from "./DeviceDiagnostics.jsx";
import { DEVICE_STATUSES } from "./deviceModes.js";
import {
  getBrowserDeviceBootstrap,
  resolveDeviceConfig,
} from "./deviceRegistry.js";

export const DeviceModeContext = createContext({
  status: DEVICE_STATUSES.LOADING,
  device: null,
  deviceId: null,
  deviceMode: null,
  environment: "production",
  storeId: null,
  zoneId: null,
  podId: null,
  defaultRoute: "/welcome",
  allowedRoutePatterns: [],
  blockedRoutePatterns: [],
  checkoutAuthority: false,
  cartAuthority: "none",
  resetPolicy: {},
  configVersion: null,
  configSource: null,
  validationErrors: [],
  isAdminDev: false,
  isKnownDevice: false,
});

function createLoadingState() {
  return {
    status: DEVICE_STATUSES.LOADING,
    device: null,
    deviceId: null,
    deviceMode: null,
    environment: "production",
    storeId: null,
    zoneId: null,
    podId: null,
    defaultRoute: "/welcome",
    allowedRoutePatterns: [],
    blockedRoutePatterns: [],
    checkoutAuthority: false,
    cartAuthority: "none",
    resetPolicy: {},
    configVersion: null,
    configSource: null,
    validationErrors: [],
    isAdminDev: false,
    isKnownDevice: false,
  };
}

export function DeviceModeProvider({ children }) {
  const [state, setState] = useState(createLoadingState);

  useEffect(() => {
    const bootstrap = getBrowserDeviceBootstrap(import.meta.env || {});
    const resolved = resolveDeviceConfig({
      ...bootstrap,
      storage: typeof window !== "undefined" ? window.localStorage : null,
      allowCacheFallback: false,
    });

    setState(resolved);
  }, []);

  const value = useMemo(() => state, [state]);

  return (
    <DeviceModeContext.Provider value={value}>
      {children}
      <DeviceDiagnostics />
    </DeviceModeContext.Provider>
  );
}

export default DeviceModeProvider;

