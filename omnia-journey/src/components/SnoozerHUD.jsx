// src/components/SnoozerHUD.jsx
import React, { useMemo, useState } from "react";
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
  const [hudState, setHudState] = useState("idle");
  const [captions, setCaptions] = useState("");

  const normalized = useMemo(() => {
    const p = { ...(props || {}) };
    const controlledState = lower(p.state) || lower(p.hudState);
    const controlledCaptions = String(p.captions || "").trim();

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

    // Safe passthrough props for later integration inside SnoozerPanel.
    // If SnoozerPanel does not use them yet, they are harmless.
    p.state = controlledState || hudState;
    p.captions = controlledCaptions || captions;
    p.onHudStateChange = setHudState;
    p.onCaptionsChange = setCaptions;

    return p;
  }, [props, hudState, captions]);

  return <SnoozerHUDImpl {...normalized} />;
}

export default SnoozerHUD;
export const SnoozerHUDImplExport = SnoozerHUDImpl;
