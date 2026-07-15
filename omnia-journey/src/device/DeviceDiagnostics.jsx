import React from "react";
import { canViewAdminDiagnostics } from "./deviceActionGuards.js";
import { DEVICE_STATUSES } from "./deviceModes.js";
import { useDeviceMode } from "./useDeviceMode.js";

function DiagnosticRow({ label, value }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
      <dt style={{ color: "#64748b", fontWeight: 700 }}>{label}</dt>
      <dd style={{ color: "#0f172a", margin: 0, overflowWrap: "anywhere" }}>{value || "none"}</dd>
    </div>
  );
}

function formatList(values) {
  return Array.isArray(values) && values.length ? values.join(", ") : "none";
}

export default function DeviceDiagnostics() {
  const deviceState = useDeviceMode();
  const shouldShow = canViewAdminDiagnostics(deviceState);

  if (!shouldShow) return null;

  const isHealthy = deviceState?.status === DEVICE_STATUSES.READY;

  return (
    <aside
      aria-label="Device diagnostics"
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        zIndex: 2147483000,
        width: "min(420px, calc(100vw - 24px))",
        maxHeight: "50vh",
        overflow: "auto",
        border: "1px solid rgba(37, 99, 235, 0.25)",
        borderRadius: 16,
        background: "rgba(255, 255, 255, 0.94)",
        boxShadow: "0 20px 60px rgba(15, 23, 42, 0.18)",
        padding: 14,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <strong style={{ color: "#1d4ed8", letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Device Diagnostics
        </strong>
        <span
          style={{
            borderRadius: 999,
            padding: "3px 8px",
            background: isHealthy ? "#dcfce7" : "#fee2e2",
            color: isHealthy ? "#166534" : "#991b1b",
            fontWeight: 800,
          }}
        >
          {deviceState?.status || "loading"}
        </span>
      </div>

      <dl style={{ display: "grid", gap: 6, margin: 0 }}>
        <DiagnosticRow label="deviceId" value={deviceState?.deviceId} />
        <DiagnosticRow label="deviceMode" value={deviceState?.deviceMode} />
        <DiagnosticRow label="source" value={deviceState?.configSource} />
        <DiagnosticRow label="env" value={deviceState?.environment} />
        <DiagnosticRow label="storeId" value={deviceState?.storeId} />
        <DiagnosticRow label="zoneId" value={deviceState?.zoneId} />
        <DiagnosticRow label="podId" value={deviceState?.podId} />
        <DiagnosticRow label="default" value={deviceState?.defaultRoute} />
        <DiagnosticRow label="cart" value={deviceState?.cartAuthority} />
        <DiagnosticRow label="checkout" value={String(Boolean(deviceState?.checkoutAuthority))} />
        <DiagnosticRow label="version" value={String(deviceState?.configVersion || "")} />
        <DiagnosticRow label="allowed" value={formatList(deviceState?.allowedRoutePatterns)} />
        <DiagnosticRow label="blocked" value={formatList(deviceState?.blockedRoutePatterns)} />
        <DiagnosticRow label="errors" value={formatList(deviceState?.validationErrors)} />
      </dl>
    </aside>
  );
}
