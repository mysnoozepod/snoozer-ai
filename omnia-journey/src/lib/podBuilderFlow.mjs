const LEGACY_EMBEDDED_ESSENTIALS_STEPS = Object.freeze([
  "essentials",
  "pillows",
  "sheets",
  "protector",
]);

export function isLegacyEmbeddedEssentialsStep(value) {
  return LEGACY_EMBEDDED_ESSENTIALS_STEPS.includes(
    String(value || "").trim().toLowerCase()
  );
}

export function normalizeCoreBuildStepCandidate(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "dual") return "comfort";
  if (normalized === "mattress") return "size";
  if (isLegacyEmbeddedEssentialsStep(normalized)) return "review";
  if (["size", "base", "motion", "comfort", "review", "success"].includes(normalized)) {
    return normalized;
  }
  return "";
}

export function resolveCoreBuildStepKeys({ showMotion = false, isDualComfort = false } = {}) {
  return [
    "size",
    "base",
    ...(showMotion ? ["motion"] : []),
    ...(isDualComfort ? ["comfort"] : []),
    "review",
    "success",
  ];
}

function unavailableOptionLabel(resolution, fallback) {
  return String(resolution?.requestedOption || fallback || "selected").trim();
}

export function buildPodCommerceIssue({
  inputsConfirmed = false,
  mattressResolution,
  baseResolution,
  wantsBase = false,
  showMotion = false,
  size = "",
} = {}) {
  if (!inputsConfirmed) return null;

  if (!mattressResolution?.ok) {
    const requestedOption = unavailableOptionLabel(mattressResolution, size);
    return {
      type: "mattress",
      message: `The ${requestedOption} mattress option isn't available for this setup. Choose a different size${showMotion ? " or motion style" : ""}.`,
      recoverySteps: ["size", ...(showMotion ? ["motion"] : [])],
    };
  }

  if (wantsBase && !baseResolution?.ok) {
    const requestedOption = unavailableOptionLabel(baseResolution, size);
    return {
      type: "base",
      message: `The ${requestedOption} base option isn't available for this setup. Choose a different base or size${showMotion ? ", or try another motion style" : ""}.`,
      recoverySteps: ["base", "size", ...(showMotion ? ["motion"] : [])],
    };
  }

  return null;
}
