const FAILED_CONTROL_STATUSES = new Set(["failed", "rejected", "expired", "unavailable", "offline"]);

function automatedInstructionFor(stage) {
  switch (stage?.id) {
    case "side_flat":
      return "I’m keeping the base flat. Turn onto your side.";
    case "back_recalibration":
      return "I’m keeping the base flat. Return to your back.";
    case "zero_gravity":
      return "I’m moving the base to Zero Gravity.";
    case "snore":
      return "I’m raising the head for the Snore preset.";
    case "back_flat":
    case "final_flat":
    default:
      return "I’m returning the base to flat.";
  }
}

export function getRestTestPositioningCopy({ stage, physicalControl = {} } = {}) {
  const status = String(physicalControl.status || "").trim().toLowerCase();
  const automated =
    physicalControl.baseAutomationAvailable === true &&
    physicalControl.manualOverride !== true &&
    !physicalControl.fault &&
    !FAILED_CONTROL_STATUSES.has(status);

  if (automated) {
    return {
      mode: "automated",
      instruction: automatedInstructionFor(stage),
      supporting: "Snoozer is controlling the base. Active testing starts automatically afterward.",
    };
  }

  return {
    mode: physicalControl.fault || FAILED_CONTROL_STATUSES.has(status) ? "failed" : "manual",
    instruction: stage?.manualInstruction || "Use the base remote to set the mattress position.",
    supporting:
      physicalControl.fault || FAILED_CONTROL_STATUSES.has(status)
        ? "Automatic base control isn’t available. Follow the remote instruction above; active testing starts afterward."
        : "Follow the remote instruction above. Active testing starts automatically afterward.",
  };
}
