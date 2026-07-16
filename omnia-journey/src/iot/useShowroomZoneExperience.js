import { useEffect, useMemo } from "react";

import {
  emitDeviceActivity,
  emitDevicePodOccupancy,
  emitDeviceZonePresence,
} from "@/device/deviceActivityTracker";
import { useDeviceMode } from "@/device/useDeviceMode";
import { resolveAuthorizedZoneIds } from "@/iot/zoneSubscriptionPolicy";
import { useZoneState } from "@/iot/useZoneState";

import { deriveZoneExperienceSnapshot } from "./showroomExperienceState";

function normalizePodZoneId(podId) {
  const raw = String(podId || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("pod-")) return raw;
  return `pod-${raw.replace(/^snoozepod\s*/i, "")}`;
}

function resolveZoneId({ device, zoneId, podId }) {
  const explicit = String(zoneId || "").trim();
  if (explicit) return explicit;
  const podZone = normalizePodZoneId(podId || device?.podId);
  if (podZone) return podZone;
  const authorized = resolveAuthorizedZoneIds(device);
  return authorized[0] || "";
}

export function useShowroomZoneExperience({
  zoneId = "",
  podId = "",
  restTestActive = false,
  restTestComplete = false,
  emitActivitySignals = false,
  sourceSurface = "showroom",
} = {}) {
  const device = useDeviceMode();
  const zoneStateContext = useZoneState();
  const resolvedZoneId = resolveZoneId({ device, zoneId, podId });

  const snapshot = useMemo(
    () =>
      deriveZoneExperienceSnapshot(zoneStateContext, resolvedZoneId, {
        restTestActive,
        restTestComplete,
      }),
    [zoneStateContext, resolvedZoneId, restTestActive, restTestComplete]
  );

  useEffect(() => {
    if (!emitActivitySignals) return undefined;
    if (!snapshot.zoneId || !snapshot.hasFreshPresenceSignal) return undefined;

    emitDeviceZonePresence(snapshot.isPresent, {
      reason: "zone-presence",
      zoneId: snapshot.zoneId,
      sourceSurface,
    });

    if (snapshot.isPresent) {
      emitDeviceActivity("zone-presence", {
        zoneId: snapshot.zoneId,
        sourceSurface,
      });
    }

    return () => {
      emitDeviceZonePresence(false, {
        reason: "zone-presence",
        zoneId: snapshot.zoneId,
        sourceSurface,
      });
    };
  }, [
    emitActivitySignals,
    snapshot.zoneId,
    snapshot.hasFreshPresenceSignal,
    snapshot.isPresent,
    sourceSurface,
  ]);

  useEffect(() => {
    if (!emitActivitySignals) return undefined;
    if (!snapshot.zoneId || !snapshot.hasFreshOccupancySignal || snapshot.isStale) {
      return undefined;
    }

    emitDevicePodOccupancy(snapshot.isOccupied, {
      reason: "pod-occupied",
      zoneId: snapshot.zoneId,
      sourceSurface,
    });

    if (snapshot.isOccupied) {
      emitDeviceActivity("pod-occupied", {
        zoneId: snapshot.zoneId,
        sourceSurface,
      });
    }

    return () => {
      emitDevicePodOccupancy(false, {
        reason: "pod-occupied",
        zoneId: snapshot.zoneId,
        sourceSurface,
      });
    };
  }, [
    emitActivitySignals,
    snapshot.zoneId,
    snapshot.hasFreshOccupancySignal,
    snapshot.isOccupied,
    snapshot.isStale,
    sourceSurface,
  ]);

  return snapshot;
}

export default useShowroomZoneExperience;
