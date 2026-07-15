import React, {
  createContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { createDeviceActivityTracker } from "./deviceActivityTracker.js";
import { DEVICE_RESET_STATUSES } from "./resetPolicies.js";
import {
  CHECKOUT_ABANDONMENT_MESSAGE,
  executeDeviceReset,
  getDeviceResetPolicy,
  getDeviceResetSchedule,
} from "./resetPolicies.js";
import { useDeviceMode } from "./useDeviceMode.js";

export const DeviceResetContext = createContext({
  status: DEVICE_RESET_STATUSES.DISABLED,
  isResetPending: false,
  remainingMs: null,
  lastActivityAt: null,
  activeReason: "idle",
  activeReasons: [],
  policy: null,
  canReset: false,
});

function getSessionStorage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function makeInitialTrackerSnapshot() {
  const now = Date.now();
  return {
    lastActivityAt: now,
    isActive: false,
    activeReason: "initial",
    activeReasons: [],
    lastReason: "initial",
  };
}

function useDeviceActivitySnapshot() {
  const trackerRef = useRef(null);
  const [snapshot, setSnapshot] = useState(makeInitialTrackerSnapshot);

  if (!trackerRef.current) {
    trackerRef.current = createDeviceActivityTracker();
  }

  useEffect(() => {
    const tracker = trackerRef.current;
    const unsubscribe = tracker.subscribe(setSnapshot);
    const detach = tracker.attach();

    return () => {
      unsubscribe();
      detach();
    };
  }, []);

  return [snapshot, trackerRef.current];
}

function DeviceCheckoutWarning({ visible }) {
  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[80] w-[min(92vw,560px)] -translate-x-1/2 rounded-[22px] border border-[#d7e3ff] bg-white/95 px-5 py-4 text-center shadow-[0_22px_60px_rgba(31,55,117,0.22)] backdrop-blur">
      <div className="text-sm font-black text-[#16315F]">
        {CHECKOUT_ABANDONMENT_MESSAGE}
      </div>
    </div>
  );
}

export function DeviceResetProvider({ children }) {
  const device = useDeviceMode();
  const navigate = useNavigate();
  const location = useLocation();
  const [activity, tracker] = useDeviceActivitySnapshot();
  const [status, setStatus] = useState(DEVICE_RESET_STATUSES.ACTIVE);
  const [remainingMs, setRemainingMs] = useState(null);
  const [isResetting, setIsResetting] = useState(false);
  const resetTimerRef = useRef(null);
  const warningTimerRef = useRef(null);

  const policy = useMemo(() => getDeviceResetPolicy(device), [device]);
  const schedule = useMemo(
    () =>
      getDeviceResetSchedule({
        policy,
        lastActivityAt: activity.lastActivityAt,
        activeReasons: activity.activeReasons,
      }),
    [activity.activeReasons, activity.lastActivityAt, policy]
  );

  useEffect(() => {
    tracker?.record("navigation");
  }, [location.pathname, location.search, tracker]);

  useEffect(() => {
    setStatus(schedule.status);
    setRemainingMs(schedule.remainingMs);
  }, [schedule.remainingMs, schedule.status]);

  useEffect(() => {
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    if (warningTimerRef.current) {
      window.clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }

    if (!policy || policy.disabled || !schedule.resetAt) return undefined;

    if (policy.policyId === "checkout" && schedule.warningAt) {
      const warningDelay = Math.max(schedule.warningAt - Date.now(), 0);
      warningTimerRef.current = window.setTimeout(() => {
        setStatus(DEVICE_RESET_STATUSES.WARNING);
        setRemainingMs(Math.max(schedule.resetAt - Date.now(), 0));
      }, warningDelay);
    }

    const resetDelay = Math.max(schedule.resetAt - Date.now(), 0);
    resetTimerRef.current = window.setTimeout(() => {
      const liveSchedule = getDeviceResetSchedule({
        policy,
        lastActivityAt: activity.lastActivityAt,
        activeReasons: activity.activeReasons,
      });

      if (!liveSchedule.canReset) {
        setStatus(DEVICE_RESET_STATUSES.PENDING);
        setRemainingMs(0);
        return;
      }

      setIsResetting(true);
      setStatus(DEVICE_RESET_STATUSES.RESETTING);

      const result = executeDeviceReset({
        device,
        policy,
        pathname: location.pathname,
        storage: getSessionStorage(),
      });

      if (result?.route) {
        navigate(result.route, {
          replace: true,
          state: {
            deviceReset: true,
            policyId: result.policyId,
            message: result.message || null,
          },
        });
      }

      window.setTimeout(() => {
        setIsResetting(false);
        tracker?.record("reset");
      }, 0);
    }, resetDelay);

    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      if (warningTimerRef.current) {
        window.clearTimeout(warningTimerRef.current);
        warningTimerRef.current = null;
      }
    };
  }, [
    activity.activeReasons,
    activity.lastActivityAt,
    device,
    location.pathname,
    navigate,
    policy,
    schedule.resetAt,
    schedule.warningAt,
    tracker,
  ]);

  const value = useMemo(
    () => ({
      status: isResetting ? DEVICE_RESET_STATUSES.RESETTING : status,
      isResetPending:
        status === DEVICE_RESET_STATUSES.WARNING ||
        status === DEVICE_RESET_STATUSES.PENDING ||
        isResetting,
      remainingMs,
      lastActivityAt: activity.lastActivityAt,
      activeReason: activity.activeReason,
      activeReasons: activity.activeReasons,
      policy,
      canReset: schedule.canReset,
    }),
    [
      activity.activeReason,
      activity.activeReasons,
      activity.lastActivityAt,
      isResetting,
      policy,
      remainingMs,
      schedule.canReset,
      status,
    ]
  );

  const showCheckoutWarning =
    policy?.policyId === "checkout" && value.status === DEVICE_RESET_STATUSES.WARNING;

  return (
    <DeviceResetContext.Provider value={value}>
      {children}
      <DeviceCheckoutWarning visible={showCheckoutWarning} />
    </DeviceResetContext.Provider>
  );
}

export default DeviceResetProvider;
