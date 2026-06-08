export const USE_CANONICAL_RECOMMENDATIONS_FLAG = "VITE_USE_CANONICAL_RECOMMENDATIONS";

function normalizeText(value) {
  return String(value || "").trim();
}

function lowerText(value) {
  return normalizeText(value).toLowerCase();
}

function simplifyMattressTitle(value) {
  const text = normalizeText(value)
    .replace(/^In-store:\s*/i, "")
    .replace(/^On display:\s*/i, "")
    .replace(/\s+/g, " ");

  const inchMatch = text.match(/(\d{1,2}")/);
  const inch = inchMatch ? inchMatch[1] : "";

  const materials = [
    "Dual Comfort Hybrid",
    "Classic Memory Foam",
    "All Foam Mattress",
    "All Foam",
    "Hybrid Mattress",
    "Hybrid",
    "Memory Foam",
    "Latex",
  ];

  const foundMaterial = materials.find((item) =>
    text.toLowerCase().includes(item.toLowerCase())
  );

  if (inch && foundMaterial) {
    return `${inch} ${foundMaterial.replace(/\s+Mattress$/i, "")}`;
  }
  if (foundMaterial) return foundMaterial.replace(/\s+Mattress$/i, "");
  if (inch) return inch;
  return text || "Mattress";
}

function fallbackMattressTitleFromHandle(handle) {
  const raw = lowerText(handle);
  if (raw.includes("dual") && raw.includes("comfort")) return '12" Dual Comfort Hybrid';
  if (raw.includes("14") && raw.includes("hybrid")) return '14" Hybrid';
  if (raw.includes("12") && raw.includes("foam")) return '12" All Foam';
  if (raw.includes("10") && raw.includes("foam")) return '10" All Foam';
  return "Mattress";
}

function motionLabelFromKey(key) {
  switch (String(key || "").trim()) {
    case "standard":
      return "Standard Motion";
    case "half_split":
      return "Half Split Motion";
    case "full_split":
      return "Full Split Motion";
    case "none":
    default:
      return "No Motion";
  }
}

function buildDisplayedSizeLine(size, motionLabel) {
  const cleanSize = normalizeText(size) || "-";
  const cleanMotion = lowerText(motionLabel);
  if (cleanMotion.includes("half split")) return `Half Split ${cleanSize}`;
  if (cleanMotion.includes("full split")) return `Full Split ${cleanSize}`;
  return cleanSize;
}

function inferBaseTypeFromHandle(handle) {
  const raw = lowerText(handle);
  if (!raw) return "none";
  if (raw.includes("adjust")) return "adjustable";
  if (raw.includes("storage")) return "storage";
  if (raw.includes("platform")) return "platform";
  return "none";
}

function baseLabelFromType(baseType) {
  switch (String(baseType || "").trim()) {
    case "adjustable":
      return "Adjustable Base";
    case "storage":
      return "Storage Base";
    case "platform":
      return "Platform Base";
    case "none":
    default:
      return "No Base";
  }
}

function isDualComfortHandle(handle) {
  const raw = lowerText(handle);
  return raw.includes("dual") && raw.includes("comfort");
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function isCanonicalRecommendationsEnabled(rawValue, { defaultValue = false } = {}) {
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  return defaultValue;
}

export function sanitizeRecommendationsPayload(payload) {
  const safe = payload && typeof payload === "object" ? payload : {};
  return {
    ...safe,
    pods: ensureArray(safe.pods),
    pillows: ensureArray(safe.pillows),
    bedding: ensureArray(safe.bedding),
  };
}

export function adaptCanonicalRecommendations(payload) {
  const normalizedAssessment =
    payload?.normalizedAssessment && typeof payload.normalizedAssessment === "object"
      ? payload.normalizedAssessment
      : null;
  const recommendation =
    payload?.recommendation && typeof payload.recommendation === "object"
      ? payload.recommendation
      : null;

  if (!normalizedAssessment || !recommendation) {
    throw new Error("Canonical recommendation payload is missing normalizedAssessment or recommendation.");
  }

  const selectedBaseHandle = recommendation.baseHandle ?? null;
  const selectedBaseType =
    normalizeText(normalizedAssessment.baseType) ||
    inferBaseTypeFromHandle(selectedBaseHandle);
  const selectedMotionKey = normalizeText(normalizedAssessment.motionKey) || "none";
  const selectedMotionLabel =
    normalizeText(normalizedAssessment.motionLabel) || motionLabelFromKey(selectedMotionKey);

  const productByHandle = new Map(
    ensureArray(payload?.products)
      .filter((product) => product && typeof product === "object" && normalizeText(product.handle))
      .map((product) => [normalizeText(product.handle), product])
  );

  const pods = ensureArray(payload?.pods)
    .map((pod) => {
      const podId = normalizeText(pod?.podId || pod?.id);
      const mattressHandle = normalizeText(pod?.mattressHandle);
      const mattressProduct = productByHandle.get(mattressHandle) || null;
      const displayMattress = simplifyMattressTitle(
        mattressProduct?.title ||
          pod?.displayMattress ||
          fallbackMattressTitleFromHandle(mattressHandle)
      );
      const fixtureBaseHandle = pod?.baseHandle ?? null;
      const fixtureBaseType =
        normalizeText(pod?.baseTypeKey) || inferBaseTypeFromHandle(fixtureBaseHandle);
      const fixtureMotionLabel =
        normalizeText(pod?.displayedIn?.motionLabel) ||
        normalizeText(pod?.displayedIn?.motion) ||
        motionLabelFromKey(pod?.defaultMotionKey);
      const displayedSize = normalizeText(pod?.displayedIn?.size || pod?.defaultSize || normalizedAssessment.size);
      const displayedSizeLine = buildDisplayedSizeLine(displayedSize, fixtureMotionLabel);

      return {
        ...pod,
        id: podId,
        podId,
        title: normalizeText(pod?.name) || `SnoozePod ${podId}`,
        displayMattress,
        subtitle: `In-store: ${displayedSizeLine} • ${displayMattress}`,
        mattressHandle,
        baseHandle: selectedBaseHandle,
        baseType: selectedBaseType,
        motionType: selectedMotionKey,
        hasAdjustableBase: selectedBaseType === "adjustable",
        adjustableBase: selectedBaseType === "adjustable",
        fixtureBaseHandle,
        fixtureBaseType,
        fixtureMotionType: normalizeText(pod?.defaultMotionKey),
        displayedIn: {
          ...(pod?.displayedIn || {}),
          size: displayedSize,
          baseLabel:
            normalizeText(pod?.displayedIn?.baseLabel) || baseLabelFromType(fixtureBaseType),
          motion: fixtureMotionLabel,
          motionLabel: fixtureMotionLabel,
        },
        inStore: {
          size: displayedSize,
          baseLabel:
            normalizeText(pod?.displayedIn?.baseLabel) || baseLabelFromType(fixtureBaseType),
          motion: fixtureMotionLabel,
          motionLabel: fixtureMotionLabel,
        },
        flags: {
          isDualComfortMattress: isDualComfortHandle(mattressHandle),
          isAdjustableFixture: fixtureBaseType === "adjustable",
        },
        diagnostics: {
          score: Number.isFinite(Number(pod?.score)) ? Number(pod.score) : 0,
          scoreReasons: ensureArray(pod?.reasonKeys).map((value) => normalizeText(value)).filter(Boolean),
        },
      };
    })
    .sort((a, b) => Number(a?.rank || 999) - Number(b?.rank || 999));

  return {
    meta: {
      size: normalizeText(normalizedAssessment.size),
      motionMode: selectedMotionLabel,
      motionKey: selectedMotionKey,
      firmness: normalizeText(normalizedAssessment.firmness),
      position: normalizeText(normalizedAssessment.position),
      hasPartner: normalizedAssessment.hasPartner === true,
      warnings: ensureArray(recommendation.warnings || normalizedAssessment.warnings),
      primaryMattressHandle: normalizeText(recommendation.primaryMattressHandle),
      primaryMattressFamily: normalizeText(recommendation.primaryMattressFamily),
      recommendedBaseHandle: selectedBaseHandle,
      recommendedBaseType: selectedBaseType,
      source: "canonical_resolver",
      manifestVersion: normalizeText(payload?.manifestVersion),
      reasonKeys: ensureArray(recommendation.reasonKeys),
    },
    pods,
    pillows: [],
    bedding: [],
  };
}

export async function getResultsRecommendations({
  answers,
  useCanonical = false,
  resolveCanonical,
  generateLocal,
  logger = console,
} = {}) {
  if (typeof generateLocal !== "function") {
    throw new Error("generateLocal is required");
  }

  const loadLocal = async () => sanitizeRecommendationsPayload(await generateLocal(answers || {}));

  if (!useCanonical) {
    return {
      mode: "local",
      recommendations: await loadLocal(),
    };
  }

  if (typeof resolveCanonical !== "function") {
    logger?.warn?.(
      "[results] canonical recommendations flag is enabled, but no canonical resolver was provided. Falling back to local recommendations."
    );
    return {
      mode: "local_fallback",
      recommendations: await loadLocal(),
      error: new Error("Missing canonical resolver"),
    };
  }

  try {
    const canonical = await resolveCanonical({
      source: "react_results",
      assessment: answers || {},
      includeProducts: true,
      includePods: true,
      includeBuilderConfig: false,
    });

    return {
      mode: "canonical",
      recommendations: adaptCanonicalRecommendations(canonical),
    };
  } catch (error) {
    logger?.warn?.(
      "[results] canonical recommendations failed, falling back to local recommendations.",
      error
    );
    return {
      mode: "local_fallback",
      recommendations: await loadLocal(),
      error,
    };
  }
}
