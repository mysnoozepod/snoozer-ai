// src/components/SnoozerHUD.jsx
import React, { useMemo } from "react";
import { SnoozerHUD as SnoozerHUDImpl } from "@/components/SnoozerPanel";

function lower(v) {
  return String(v || "").toLowerCase().trim();
}

function normalizePodId(podId) {
  if (podId === undefined || podId === null) return podId;
  const s = String(podId).trim();
  return s || podId;
}

export function SnoozerHUD(props) {
  const normalized = useMemo(() => {
    const p = { ...(props || {}) };

    const mode = lower(p.mode);
    const chrome = lower(p.chrome);

    if (p.podId != null) {
      p.podId = normalizePodId(p.podId);
    }

    if (mode === "results") {
      if (typeof p.showInput !== "boolean") p.showInput = false;
      if (typeof p.showTranscriptToggle !== "boolean") p.showTranscriptToggle = false;
      if (typeof p.showStateLabel !== "boolean") p.showStateLabel = false;
      if (typeof p.showHeader !== "boolean") p.showHeader = false;
      if (!p.chrome) p.chrome = "none";
      if (!p.presentation) p.presentation = "default";
    }

    if (mode === "pod") {
      if (typeof p.showInput !== "boolean") p.showInput = false;
      if (typeof p.showTranscriptToggle !== "boolean") p.showTranscriptToggle = false;
      if (typeof p.showStateLabel !== "boolean") p.showStateLabel = false;
      if (typeof p.showHeader !== "boolean") p.showHeader = false;
      if (!p.chrome) p.chrome = "none";
      if (!p.presentation) p.presentation = "coach";
    }

    if (chrome === "none" && typeof p.showHeader !== "boolean") {
      p.showHeader = false;
    }

    return p;
  }, [props]);

  return <SnoozerHUDImpl {...normalized} />;
}

export default SnoozerHUD;
export const SnoozerHUDImplExport = SnoozerHUDImpl;