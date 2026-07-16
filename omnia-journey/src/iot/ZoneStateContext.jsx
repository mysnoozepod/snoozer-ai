import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useDeviceMode } from "../device/useDeviceMode.js";
import {
  resolveAuthorizedZoneIds,
  shouldEnableZoneSocket,
  shouldShowIotDiagnostics,
} from "./zoneSubscriptionPolicy.js";
import { createShowroomIotClient, getReconnectDelay } from "./showroomIotClient.js";
import {
  ZONE_CONNECTION_STATUSES,
  applyZoneEventToState,
  createInitialZoneState,
  markZoneStateStale,
  normalizeZoneEventMessage,
  shouldMarkZoneStateStale,
} from "./zoneStateReducer.js";
import {
  readLastKnownZoneState,
  writeLastKnownZoneState,
} from "./zoneStateCache.js";

const STALE_AFTER_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 8;

export const ZoneStateContext = createContext(createInitialZoneState());

function getEndpoint() {
  return String(import.meta.env?.VITE_IOT_WEBSOCKET_URL || "").trim();
}

function errorMessage(error) {
  if (!error) return null;
  if (typeof error === "string") return error;
  return error.message || error.reason || "IOT_WEBSOCKET_ERROR";
}

function IotZoneDiagnostics({ endpoint, state }) {
  const device = useDeviceMode();
  const [expanded, setExpanded] = useState(false);

  if (!shouldShowIotDiagnostics(device)) return null;

  const endpointLabel = endpoint ? endpoint.split("?")[0] : "not configured";
  const latestEvent = Object.values(state.latestEventByZone || {}).slice(-1)[0];

  if (!expanded) {
    return (
      <button
        type="button"
        aria-label="Open IoT diagnostics"
        onClick={() => setExpanded(true)}
        style={{
          position: "fixed",
          right: 12,
          bottom: 12,
          zIndex: 2147483000,
          border: "1px solid rgba(37, 99, 235, 0.24)",
          borderRadius: 999,
          background: "rgba(255, 255, 255, 0.9)",
          boxShadow: "0 14px 38px rgba(15, 23, 42, 0.14)",
          color: "#1d4ed8",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: "0.08em",
          padding: "8px 11px",
          textTransform: "uppercase",
        }}
      >
        IoT {state.connectionStatus}
      </button>
    );
  }

  return (
    <aside
      aria-label="IoT zone diagnostics"
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 2147483000,
        width: "min(440px, calc(100vw - 24px))",
        maxHeight: "46vh",
        overflow: "auto",
        border: "1px solid rgba(37, 99, 235, 0.25)",
        borderRadius: 16,
        background: "rgba(255, 255, 255, 0.94)",
        boxShadow: "0 20px 60px rgba(15, 23, 42, 0.18)",
        color: "#0f172a",
        fontSize: 12,
        lineHeight: 1.45,
        padding: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <strong style={{ color: "#1d4ed8", letterSpacing: "0.12em", textTransform: "uppercase" }}>
          IoT Diagnostics
        </strong>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{
            border: "1px solid rgba(100, 116, 139, 0.22)",
            borderRadius: 999,
            background: "#fff",
            color: "#475569",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 900,
            padding: "3px 8px",
          }}
        >
          Hide
        </button>
      </div>
      <dl style={{ display: "grid", gap: 6, margin: 0 }}>
        <dt style={{ color: "#64748b", fontWeight: 800 }}>endpoint</dt>
        <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{endpointLabel}</dd>
        <dt style={{ color: "#64748b", fontWeight: 800 }}>status</dt>
        <dd style={{ margin: 0 }}>{state.connectionStatus}</dd>
        <dt style={{ color: "#64748b", fontWeight: 800 }}>zones</dt>
        <dd style={{ margin: 0 }}>{state.subscribedZoneIds?.join(", ") || "none"}</dd>
        <dt style={{ color: "#64748b", fontWeight: 800 }}>stale</dt>
        <dd style={{ margin: 0 }}>{String(Boolean(state.isStale))}</dd>
        <dt style={{ color: "#64748b", fontWeight: 800 }}>reconnect</dt>
        <dd style={{ margin: 0 }}>{state.reconnectAttempt || 0}</dd>
        <dt style={{ color: "#64748b", fontWeight: 800 }}>last error</dt>
        <dd style={{ margin: 0 }}>{state.lastError || "none"}</dd>
        <dt style={{ color: "#64748b", fontWeight: 800 }}>latest event</dt>
        <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
          {latestEvent ? `${latestEvent.zoneId} / ${latestEvent.eventType} / ${latestEvent.eventId}` : "none"}
        </dd>
      </dl>
    </aside>
  );
}

export function ZoneStateProvider({ children }) {
  const device = useDeviceMode();
  const endpoint = getEndpoint();
  const subscribedZoneIds = useMemo(() => resolveAuthorizedZoneIds(device), [device]);
  const zonesKey = subscribedZoneIds.join("|");
  const [state, setState] = useState(() =>
    createInitialZoneState({ subscribedZoneIds, connectionStatus: ZONE_CONNECTION_STATUSES.DISABLED })
  );
  const clientRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  useEffect(() => {
    const cached = readLastKnownZoneState({ deviceId: device?.deviceId });
    setState((current) =>
      createInitialZoneState({
        ...current,
        ...(cached.ok ? cached.snapshot : {}),
        subscribedZoneIds,
        connectionStatus: shouldEnableZoneSocket({ endpoint, device })
          ? ZONE_CONNECTION_STATUSES.CONNECTING
          : ZONE_CONNECTION_STATUSES.DISABLED,
        isStale: cached.ok ? true : current.isStale,
        lastError: !endpoint ? "VITE_IOT_WEBSOCKET_URL_NOT_CONFIGURED" : null,
      })
    );
  }, [device?.deviceId, endpoint, zonesKey]);

  useEffect(() => {
    let canceled = false;
    let reconnectAttempt = 0;

    function clearReconnectTimer() {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function closeClient() {
      if (clientRef.current) {
        clientRef.current.close();
        clientRef.current = null;
      }
    }

    if (!shouldEnableZoneSocket({ endpoint, device })) {
      clearReconnectTimer();
      closeClient();
      setState((current) =>
        createInitialZoneState({
          ...current,
          subscribedZoneIds,
          connectionStatus: ZONE_CONNECTION_STATUSES.DISABLED,
          lastError: !endpoint ? "VITE_IOT_WEBSOCKET_URL_NOT_CONFIGURED" : null,
        })
      );
      return () => {
        canceled = true;
        clearReconnectTimer();
        closeClient();
      };
    }

    function scheduleReconnect(reason) {
      if (canceled || reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
        setState((current) => ({
          ...markZoneStateStale(current, reason || "DISCONNECTED"),
          connectionStatus: ZONE_CONNECTION_STATUSES.DISCONNECTED,
          lastError: reason || null,
        }));
        return;
      }

      const attempt = reconnectAttempt + 1;
      reconnectAttempt = attempt;
      const delay = getReconnectDelay(attempt - 1);
      setState((current) => ({
        ...markZoneStateStale(current, reason || "RECONNECTING"),
        connectionStatus: ZONE_CONNECTION_STATUSES.RECONNECTING,
        reconnectAttempt: attempt,
        lastError: reason || null,
      }));
      reconnectTimerRef.current = window.setTimeout(connect, delay);
    }

    function connect() {
      if (canceled) return;
      closeClient();
      setState((current) => ({
        ...current,
        subscribedZoneIds,
        connectionStatus:
          reconnectAttempt > 0
            ? ZONE_CONNECTION_STATUSES.RECONNECTING
            : ZONE_CONNECTION_STATUSES.CONNECTING,
        reconnectAttempt,
      }));

      const client = createShowroomIotClient({
        endpoint,
        deviceId: device.deviceId,
        zoneIds: subscribedZoneIds,
        onOpen: () => {
          reconnectAttempt = 0;
          setState((current) => ({
            ...current,
            connectionStatus: ZONE_CONNECTION_STATUSES.CONNECTED,
            subscribedZoneIds,
            reconnectAttempt: 0,
            lastError: null,
          }));
        },
        onMessage: (raw) => {
          const normalized = normalizeZoneEventMessage(raw, subscribedZoneIds);
          if (!normalized.ok) return;
          setState((current) => {
            const result = applyZoneEventToState(current, normalized.event);
            if (result.accepted) {
              writeLastKnownZoneState(result.state, { deviceId: device.deviceId });
            }
            return result.state;
          });
        },
        onClose: ({ closedByClient }) => {
          if (!canceled && !closedByClient) scheduleReconnect("WEBSOCKET_CLOSED");
        },
        onError: (event) => {
          setState((current) => ({
            ...current,
            connectionStatus: ZONE_CONNECTION_STATUSES.ERROR,
            lastError: errorMessage(event) || "WEBSOCKET_ERROR",
          }));
        },
      });

      clientRef.current = client;
      try {
        client.connect();
      } catch (error) {
        scheduleReconnect(errorMessage(error));
      }
    }

    connect();

    return () => {
      canceled = true;
      clearReconnectTimer();
      closeClient();
    };
  }, [device?.deviceId, device?.status, endpoint, zonesKey]);

  useEffect(() => {
    if (!state.lastReceivedAt) return undefined;
    const delay = Math.max(STALE_AFTER_MS - (Date.now() - new Date(state.lastReceivedAt).getTime()), 0);
    const timer = window.setTimeout(() => {
      setState((current) =>
        shouldMarkZoneStateStale(current.lastReceivedAt, { staleAfterMs: STALE_AFTER_MS })
          ? markZoneStateStale(current, "NO_RECENT_ZONE_UPDATES")
          : current
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [state.lastReceivedAt]);

  const value = useMemo(() => state, [state]);

  return (
    <ZoneStateContext.Provider value={value}>
      {children}
      <IotZoneDiagnostics endpoint={endpoint} state={value} />
    </ZoneStateContext.Provider>
  );
}

export function useZoneState() {
  return useContext(ZoneStateContext);
}

export default ZoneStateProvider;
