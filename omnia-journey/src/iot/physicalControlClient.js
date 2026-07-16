import { api } from "@/lib/api";

export const PHYSICAL_LIGHTING_STATES = Object.freeze({
  OFF: "off",
  READY: "ready",
  ACTIVE: "active",
  REST_TEST: "rest-test",
  COMPLETE: "complete",
  FAULT: "fault",
});

export const PHYSICAL_AUDIO_STATES = Object.freeze({
  STOPPED: "stopped",
  PLAYING: "playing",
  FADING: "fading",
  FAULT: "fault",
});

export function buildPhysicalControlCommand({
  commandType,
  zoneId,
  deviceId,
  desiredState,
  sourceSurface = "showroom",
  metadata = {},
} = {}) {
  return {
    commandType,
    zoneId,
    ...(deviceId ? { deviceId } : {}),
    desiredState: desiredState || {},
    source: "frontend",
    sourceSurface,
    metadata,
  };
}

export async function issuePhysicalControlCommand(payload) {
  return api.issuePhysicalControlCommand(payload);
}

export function summarizePhysicalControlResponse(response) {
  if (!response || typeof response !== "object") {
    return { ok: false, status: "unknown", reason: "NO_RESPONSE" };
  }
  return {
    ok: response.ok === true,
    accepted: response.accepted === true,
    commandId: response.commandId || response.command?.commandId || null,
    status: response.status || response.command?.status || null,
    reason:
      response.reason ||
      response.reasonCodes?.[0] ||
      response.publish?.reason ||
      response.command?.failureReason ||
      null,
    raw: response,
  };
}
