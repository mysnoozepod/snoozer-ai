import { useCallback, useMemo, useState } from "react";

import { useDeviceMode } from "@/device/useDeviceMode";
import { useZoneState } from "@/iot/useZoneState";

import {
  buildPhysicalControlCommand,
  issuePhysicalControlCommand,
  summarizePhysicalControlResponse,
} from "./physicalControlClient";

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function normalizePodZoneId(zoneId) {
  const raw = cleanString(zoneId).toLowerCase();
  if (!raw) return "";
  return raw.startsWith("pod-") ? raw : `pod-${raw.replace(/^snoozepod\s*/i, "")}`;
}

function getPhysicalControlForZone(zoneState, zoneId) {
  return zoneState?.zoneStateByZone?.[zoneId]?.physicalControl || null;
}

export function usePhysicalControl({
  zoneId = "",
  sourceSurface = "showroom",
  enabled = true,
} = {}) {
  const device = useDeviceMode();
  const zoneState = useZoneState();
  const resolvedZoneId = normalizePodZoneId(zoneId || device?.zoneId || device?.podId);
  const [lastCommand, setLastCommand] = useState(null);
  const [lastError, setLastError] = useState(null);

  const physical = useMemo(
    () => getPhysicalControlForZone(zoneState, resolvedZoneId),
    [zoneState, resolvedZoneId]
  );

  const issue = useCallback(
    async (payload) => {
      if (!enabled || !resolvedZoneId) {
        return { ok: false, skipped: true, reason: "PHYSICAL_CONTROL_DISABLED" };
      }

      try {
        const response = await issuePhysicalControlCommand({
          ...payload,
          zoneId: payload?.zoneId || resolvedZoneId,
          sourceSurface,
        });
        const summary = summarizePhysicalControlResponse(response);
        setLastCommand(summary);
        setLastError(summary.ok ? null : summary.reason || "PHYSICAL_CONTROL_REQUEST_FAILED");
        return summary;
      } catch (error) {
        const summary = {
          ok: false,
          status: "failed",
          reason: error?.message || "PHYSICAL_CONTROL_REQUEST_FAILED",
        };
        setLastCommand(summary);
        setLastError(summary.reason);
        return summary;
      }
    },
    [enabled, resolvedZoneId, sourceSurface]
  );

  const requestLightingState = useCallback(
    (lightingState, metadata = {}) =>
      issue(
        buildPhysicalControlCommand({
          commandType: "set_lighting_state",
          desiredState: { lightingState },
          metadata,
        })
      ),
    [issue]
  );

  const requestAudioState = useCallback(
    (audioState, metadata = {}) =>
      issue(
        buildPhysicalControlCommand({
          commandType: "set_audio_state",
          zoneId: "help",
          desiredState: {
            audioState,
            ...(metadata.track ? { track: metadata.track } : {}),
          },
          metadata,
        })
      ),
    [issue]
  );

  return {
    zoneId: resolvedZoneId,
    desiredState: lastCommand?.raw?.command?.desiredState || {},
    appliedState: physical?.appliedState || {},
    reportedState: physical?.reportedState || {},
    status: physical?.status || lastCommand?.status || "idle",
    fault: physical?.fault || lastError || null,
    lastCommand,
    requestLightingState,
    requestAudioState,
  };
}

export default usePhysicalControl;
