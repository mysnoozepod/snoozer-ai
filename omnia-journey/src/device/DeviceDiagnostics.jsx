import React, { useEffect, useState } from "react";
import { canViewAdminDiagnostics } from "./deviceActionGuards.js";
import { DEVICE_STATUSES } from "./deviceModes.js";
import { useDeviceMode } from "./useDeviceMode.js";
import { BUILD_INFO } from "@/lib/buildInfo.js";

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
  const [expanded, setExpanded] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 0,
    height: typeof window !== "undefined" ? window.innerHeight : 0,
    visualWidth: typeof window !== "undefined" && window.visualViewport ? window.visualViewport.width : 0,
    visualHeight: typeof window !== "undefined" && window.visualViewport ? window.visualViewport.height : 0,
    clientWidth: typeof document !== "undefined" ? document.documentElement.clientWidth : 0,
    clientHeight: typeof document !== "undefined" ? document.documentElement.clientHeight : 0,
  }));
  const shouldShow = canViewAdminDiagnostics(deviceState);

  useEffect(() => {
    if (!shouldShow) return undefined;

    const onKeyDown = (event) => {
      if (event.ctrlKey && event.altKey && String(event.key || "").toLowerCase() === "d") {
        event.preventDefault();
        setExpanded((current) => !current);
      }
    };

    const update = () =>
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
        visualWidth: window.visualViewport?.width || 0,
        visualHeight: window.visualViewport?.height || 0,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
      });

    update();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [shouldShow]);

  if (!shouldShow) return null;

  const isHealthy = deviceState?.status === DEVICE_STATUSES.READY;

  if (!expanded) {
    return null;
  }

  return (
    <aside
      aria-label="Device diagnostics"
      data-pod-lab-ignore="true"
      style={{
        position: "fixed",
        left: 12,
        top: 84,
        zIndex: 2147483000,
        width: "min(420px, calc(100vw - 24px))",
        maxHeight: "190px",
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
        <button
          type="button"
          data-pod-lab-ignore="true"
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
        <DiagnosticRow label="deviceId" value={deviceState?.deviceId} />
        <DiagnosticRow label="deviceMode" value={deviceState?.deviceMode} />
        <DiagnosticRow label="source" value={deviceState?.configSource} />
        <DiagnosticRow label="env" value={deviceState?.environment} />
        <DiagnosticRow label="role" value={deviceState?.deploymentRole} />
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
        <DiagnosticRow label="build commit" value={BUILD_INFO.commit} />
        <DiagnosticRow label="build time" value={BUILD_INFO.timestamp} />
        <DiagnosticRow label="frontend version" value={BUILD_INFO.version} />
        <DiagnosticRow
          label="route"
          value={typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : ""}
        />
        <DiagnosticRow label="inner" value={`${Math.round(viewport.width)} x ${Math.round(viewport.height)}`} />
        <DiagnosticRow
          label="visual"
          value={`${Math.round(viewport.visualWidth)} x ${Math.round(viewport.visualHeight)}`}
        />
        <DiagnosticRow
          label="client"
          value={`${Math.round(viewport.clientWidth)} x ${Math.round(viewport.clientHeight)}`}
        />
      </dl>
    </aside>
  );
}
