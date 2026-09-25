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
