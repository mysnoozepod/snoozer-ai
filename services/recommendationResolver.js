const { loadShowroomManifest } = require("./showroomManifest");

function createResolverError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function pick(value) {
  return String(value == null ? "" : value).trim();
}

function lower(value) {
  return pick(value).toLowerCase();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      if (value.length) return value;
      continue;
    }
    const str = pick(value);
    if (str) return value;
  }
  return "";
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function asBoolean(value) {
  if (typeof value === "boolean") return value;
  const normalized = lower(value);
  return normalized === "yes" || normalized === "true" || normalized === "1" || normalized === "partner" || normalized === "shared" || normalized === "share";
}

function getBaseTypeMap(manifest) {
  return new Map(
    manifest.assessmentSchema.baseTypes.map((item) => [item.key, item])
  );
}

function getMotionModeMap(manifest) {
  return new Map(
    manifest.assessmentSchema.motionModes.map((item) => [item.key, item])
  );
}

function buildAliasLookup(entries = {}) {
  const out = new Map();
  for (const [rawKey, rawValue] of Object.entries(entries)) {
    out.set(lower(rawKey), rawValue);
  }
  return out;
}

function normalizeSize(value, manifest) {
  const sizes = manifest.assessmentSchema.sizes;
  const aliases = buildAliasLookup(manifest.assessmentSchema.aliases?.size || {});
  const raw = pick(value);
  if (!raw) return "";
  const alias = aliases.get(lower(raw));
  if (alias && sizes.includes(alias)) return alias;
  const exact = sizes.find((size) => lower(size) === lower(raw));
  return exact || "";
}

function normalizePosition(value, manifest) {
  const positions = manifest.assessmentSchema.positions;
  const aliases = buildAliasLookup(manifest.assessmentSchema.aliases?.position || {});
  const raw = lower(value);
  if (!raw) return "side";
  if (aliases.has(raw)) return aliases.get(raw);
  if (positions.includes(raw)) return raw;
  if (raw.includes("side")) return "side";
  if (raw.includes("back")) return "back";
  if (raw.includes("stomach")) return "stomach";
  if (raw.includes("combo")) return "combo";
  return "side";
}

function normalizeFirmness(value, manifest) {
  const firmnesses = manifest.assessmentSchema.firmnesses;
  const aliases = buildAliasLookup(manifest.assessmentSchema.aliases?.firmness || {});
  const raw = lower(value);
  if (!raw) return "medium";
  if (aliases.has(raw)) return aliases.get(raw);
  if (firmnesses.includes(raw)) return raw;
  if (raw.includes("firm")) return "firm";
  if (raw.includes("soft")) return "soft";
  if (raw.includes("medium")) return "medium";
  return "medium";
}

function normalizeBaseType(value, manifest) {
  const baseTypes = getBaseTypeMap(manifest);
  const aliases = buildAliasLookup(manifest.assessmentSchema.aliases?.baseType || {});
  const raw = lower(value);
  if (!raw) return "none";
  if (aliases.has(raw)) return aliases.get(raw);
  if (baseTypes.has(raw)) return raw;
  if (raw.includes("adjust")) return "adjustable";
  if (raw.includes("platform")) return "platform";
  if (raw.includes("storage")) return "storage";
  if (raw.includes("mattress") || raw.includes("none")) return "none";
  return "none";
}

function normalizeMotionKey(value, manifest) {
  const motionModes = getMotionModeMap(manifest);
  const aliases = buildAliasLookup(manifest.assessmentSchema.aliases?.motionMode || {});
  const raw = lower(value);
  if (!raw) return "none";
  if (aliases.has(raw)) return aliases.get(raw);
  if (motionModes.has(raw)) return raw;
  if (raw.includes("full split")) return "full_split";
  if (raw.includes("half split")) return "half_split";
  if (raw.includes("split")) return "half_split";
  if (raw.includes("standard")) return "standard";
  if (raw.includes("motion")) return "standard";
  return "none";
}

function normalizePainPoints(value) {
  return toArray(value)
    .map((entry) => pick(entry))
    .filter(Boolean);
}

function normalizeAssessment(inputAssessment, manifest) {
  const assessment = inputAssessment && typeof inputAssessment === "object" ? inputAssessment : null;
  if (!assessment) {
    throw createResolverError("E_BAD_ASSESSMENT", "assessment must be an object");
  }

  const answers = assessment.answers && typeof assessment.answers === "object" ? assessment.answers : {};
  const size = normalizeSize(
    firstNonEmpty(assessment.size, answers.size, assessment.preferredSize),
    manifest
  );
  const position = normalizePosition(
    firstNonEmpty(
      assessment.sleepPosition,
      assessment.position,
      assessment.primaryPosition,
      answers.sleepPosition,
      answers.position
    ),
    manifest
  );
  const firmness = normalizeFirmness(
    firstNonEmpty(
      assessment.firmness,
      assessment.comfortPreference,
      answers.firmness,
      answers.comfortPreference
    ),
    manifest
  );
  const baseType = normalizeBaseType(
    firstNonEmpty(
      assessment.baseType,
      assessment.base,
      assessment.foundation,
      answers.baseType,
      answers.base,
      answers.foundation
    ),
    manifest
  );
  const hasPartner = asBoolean(
    firstNonEmpty(
      assessment.sleepPartner,
      assessment.partner,
      assessment.shareBed,
      answers.sleepPartner,
      answers.partner,
      answers.shareBed
    )
  );
  const requestedMotionKey = normalizeMotionKey(
    firstNonEmpty(
      assessment.motionMode,
      assessment.motion,
      answers.motionMode,
      answers.motion
    ),
    manifest
  );
  const painPoints = normalizePainPoints(firstNonEmpty(assessment.painPoints, answers.painPoints));
  const temperatureValue = firstNonEmpty(
    assessment.temperature,
    assessment.sleepsHot,
    answers.temperature,
    answers.sleepsHot
  );
  const sleepsHot =
    assessment.sleepsHot === true ||
    answers.sleepsHot === true ||
    lower(temperatureValue).includes("hot") ||
    lower(temperatureValue).includes("warm");
  const hasBackPain =
    assessment.backPain === true ||
    answers.backPain === true ||
    painPoints.some((item) => /back|lumbar|lower/i.test(item));

  const warnings = [];
  let motionKey = requestedMotionKey;

  if (motionKey === "full_split" && size !== "King") {
    warnings.push("Full Split Motion is only available in King setups.");
    motionKey = size === "Queen" ? "half_split" : "standard";
  }

  if (motionKey === "half_split" && size !== "Queen" && size !== "King") {
    warnings.push("Half Split Motion is only available in Queen or King sizes.");
    motionKey = "standard";
  }

  const baseTypeMap = getBaseTypeMap(manifest);
  const motionModeMap = getMotionModeMap(manifest);

  return {
    size: size || "Queen",
    position,
    firmness,
    baseType,
    baseTypeLabel: baseTypeMap.get(baseType)?.label || "No Base",
    hasPartner,
    motionKey,
    requestedMotionKey,
    motionLabel: motionModeMap.get(motionKey)?.label || "No Motion",
    sleepsHot,
    hasBackPain,
    painPoints,
    warnings,
  };
}

function getProductMap(manifest) {
  return new Map(manifest.products.map((product) => [product.handle, product]));
}

function getPodContext(pod, productMap) {
  const mattress = productMap.get(pod.mattressHandle);
  return {
    podId: String(pod.podId),
    name: pod.name,
    mattressHandle: pod.mattressHandle,
    mattressFamily: mattress?.family || "",
    baseHandle: pod.baseHandle,
    baseTypeKey: pod.baseTypeKey,
    motionKey: pod.defaultMotionKey,
    displayedSize: pod.displayedIn?.size || pod.defaultSize || "",
    hasAdjustableBase: pod.hasAdjustableBase === true || pod.baseTypeKey === "adjustable",
    tags: Array.isArray(pod.tags) ? pod.tags : [],
  };
}

function resolveRuleValue(value, context) {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveRuleValue(entry, context));
  }
  if (typeof value === "string" && value.startsWith("$")) {
    return context[value.slice(1)];
  }
  return value;
}

function valuesMatch(actual, expected, context) {
  const resolved = resolveRuleValue(expected, context);
  const expectedValues = Array.isArray(resolved) ? resolved : [resolved];
  return expectedValues.some((candidate) => actual === candidate);
}

function matchesWhen(conditions, state) {
  if (!conditions || typeof conditions !== "object") return true;
  for (const [key, expected] of Object.entries(conditions)) {
    if (!valuesMatch(state[key], expected, state)) {
      return false;
    }
  }
  return true;
}

function matchesPod(podContext, match = {}, state) {
  for (const [key, expected] of Object.entries(match || {})) {
    if (key === "tagsAny") {
      const resolved = resolveRuleValue(expected, state);
      const values = Array.isArray(resolved) ? resolved : [resolved];
      if (!values.some((item) => podContext.tags.includes(item))) return false;
      continue;
    }

    if (key === "tagsAll") {
      const resolved = resolveRuleValue(expected, state);
      const values = Array.isArray(resolved) ? resolved : [resolved];
      if (!values.every((item) => podContext.tags.includes(item))) return false;
      continue;
    }

    if (!valuesMatch(podContext[key], expected, state)) {
      return false;
    }
  }
  return true;
}

function choosePrimaryMattress(normalizedAssessment, manifest) {
  const rules = manifest.recommendationRules.primaryMattressRules || [];
  for (const rule of rules) {
    if (rule.defaultHandle) {
      return { handle: rule.defaultHandle, reasonKey: rule.reasonKey || "default_support" };
    }

    if (matchesWhen(rule.when, normalizedAssessment)) {
      return { handle: rule.pickHandle, reasonKey: rule.reasonKey || "rule_match" };
    }
  }

  throw createResolverError("E_RULES_PRIMARY", "unable to choose primary mattress", 500);
}

function chooseBaseHandle(normalizedAssessment, manifest) {
  const rules = manifest.recommendationRules.baseRules || [];
  for (const rule of rules) {
    if (matchesWhen(rule.when, normalizedAssessment)) {
      return { handle: rule.pickHandle || null, reasonKey: rule.reasonKey || "rule_match" };
    }
  }
  return { handle: null, reasonKey: "requested_no_base" };
}

function scorePods(normalizedAssessment, manifest, productMap, derivedState) {
  const rules = manifest.recommendationRules.podScoreBoosts || [];

  return manifest.pods
    .filter((pod) => pod.active !== false)
    .map((pod) => {
      const podContext = getPodContext(pod, productMap);
      let score = 0;
      const reasonKeys = [];

      for (const rule of rules) {
        if (!matchesWhen(rule.when, derivedState)) continue;
        if (
          rule.reasonKey === "primary_mattress_family" &&
          podContext.mattressHandle === derivedState.primaryMattressHandle
        ) {
          continue;
        }
        if (!matchesPod(podContext, rule.match, derivedState)) continue;
        score += Number(rule.points || 0);
        if (rule.reasonKey) reasonKeys.push(rule.reasonKey);
      }

      return {
        pod,
        podContext,
        score,
        reasonKeys,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Number(a.pod.podId) - Number(b.pod.podId);
    });
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && value !== ""))];
}

function productSummary(product) {
  if (!product) return null;
  return {
    handle: product.handle,
    title: product.title,
    catalogType: product.catalogType,
    family: product.family,
    shopifyPath: product.shopifyPath,
    attributes: product.attributes || {},
  };
}

async function resolveRecommendation(input = {}) {
  const manifest = loadShowroomManifest();
  const productMap = getProductMap(manifest);

  const assessment =
    input.assessment ||
    (input.answers && typeof input.answers === "object" ? { answers: input.answers } : null);

  if (!assessment) {
    throw createResolverError("E_BAD_ASSESSMENT", "assessment is required");
  }

  const normalizedAssessment = normalizeAssessment(assessment, manifest);
  const includeProducts = input.includeProducts !== false;
  const includePods = input.includePods !== false;
  const includeBuilderConfig = input.includeBuilderConfig === true;

  const primaryMattress = choosePrimaryMattress(normalizedAssessment, manifest);
  const baseSelection = chooseBaseHandle(normalizedAssessment, manifest);
  const primaryProduct = productMap.get(primaryMattress.handle);

  if (!primaryProduct) {
    throw createResolverError("E_PRIMARY_HANDLE", `unknown primary mattress handle: ${primaryMattress.handle}`, 500);
  }

  const derivedState = {
    ...normalizedAssessment,
    primaryMattressHandle: primaryMattress.handle,
    primaryMattressFamily: primaryProduct.family,
  };

  const rankedPods = scorePods(normalizedAssessment, manifest, productMap, derivedState);
  const recommendedCount = manifest.recommendationRules.recommendedCount || 3;
  const rankedPodSummaries = rankedPods.map(({ pod, podContext, score, reasonKeys }, index) => ({
    podId: String(pod.podId),
    name: pod.name,
    rank: index + 1,
    recommended: index < recommendedCount,
    score,
    reasonKeys,
    mattressHandle: pod.mattressHandle,
    baseHandle: pod.baseHandle,
    baseTypeKey: pod.baseTypeKey,
    defaultSize: pod.defaultSize,
    defaultMotionKey: pod.defaultMotionKey,
    displayedIn: pod.displayedIn,
    tags: pod.tags,
    hasAdjustableBase: podContext.hasAdjustableBase,
  }));

  const topPods = rankedPodSummaries.slice(0, recommendedCount);
  const topPodIds = topPods.map((pod) => pod.podId);
  const topPod = topPods[0] || null;

  const referencedHandles = includeProducts
    ? unique([
        primaryMattress.handle,
        baseSelection.handle,
        ...topPods.flatMap((pod) => [pod.mattressHandle, pod.baseHandle]),
      ])
    : [];

  const products = referencedHandles
    .map((handle) => productSummary(productMap.get(handle)))
    .filter(Boolean);

  const builderConfig = includeBuilderConfig
    ? {
        size: normalizedAssessment.size,
        baseType: normalizedAssessment.baseType,
        motionKey: normalizedAssessment.motionKey,
        motionLabel: normalizedAssessment.motionLabel,
        primaryMattressHandle: primaryMattress.handle,
        recommendedBaseHandle: baseSelection.handle,
        topPodId: topPod ? topPod.podId : null,
      }
    : null;

  return {
    ok: true,
    manifestVersion: manifest.version,
    source: pick(input.source) || "manual",
    normalizedAssessment: {
      size: normalizedAssessment.size,
      position: normalizedAssessment.position,
      firmness: normalizedAssessment.firmness,
      baseType: normalizedAssessment.baseType,
      baseTypeLabel: normalizedAssessment.baseTypeLabel,
      hasPartner: normalizedAssessment.hasPartner,
      motionKey: normalizedAssessment.motionKey,
      motionLabel: normalizedAssessment.motionLabel,
      sleepsHot: normalizedAssessment.sleepsHot,
      hasBackPain: normalizedAssessment.hasBackPain,
      painPoints: normalizedAssessment.painPoints,
      warnings: normalizedAssessment.warnings,
    },
    recommendation: {
      topPodId: topPod ? topPod.podId : null,
      topPodIds,
      primaryMattressHandle: primaryMattress.handle,
      primaryMattressFamily: primaryProduct.family,
      baseHandle: baseSelection.handle,
      warnings: normalizedAssessment.warnings,
      reasonKeys: unique([
        primaryMattress.reasonKey,
        baseSelection.reasonKey,
        ...(topPod?.reasonKeys || []),
      ]),
    },
    pods: includePods ? rankedPodSummaries : [],
    products,
    builderConfig,
  };
}

module.exports = {
  resolveRecommendation,
};
