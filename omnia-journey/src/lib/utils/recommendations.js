// src/lib/utils/recommendations.js
//
// Canonical showroom recommendation engine (DETERMINISTIC).
// Returns ALL 5 SnoozePods (ranked) + optional accessory query hints.
//
// TRUTH RULES (ENFORCED):
// - Half Split: Queen or King ONLY, Dual Comfort ONLY
// - Full Split: King ONLY (and split motion requires Dual Comfort)
// - Pods are fixed physical fixtures
// - UI renders ranking, not logic
//
// IMPORTANT CHANGE:
// - Ranking remains deterministic.
// - Pod cards no longer inject local /pods/* image paths.
// - Results/Pod UI should hydrate product imagery from Shopify product data by handle.
// - Accessories are returned as query hints so the UI can lazy-load them later.
// - Optional accessory prefetch remains OFF by default.
//
// NO LOCAL POD IMAGE PATHS.
// NO SHOPIFY IMAGE GUESSING HERE.
// NO NETWORK CALLS for pod images.

import { api } from "@/lib/api";

/* ─────────────────────────────────────────────
   Shopify Handles (confirmed)
───────────────────────────────────────────── */
export const HANDLES = {
  mattresses: {
    dualComfort: "12-dual-comfort-hybrid",
    hybrid14: "14-hybrid",
    allFoam12: "12-all-foam-mattress",
    allFoam10: "10-all-foam-mattress",
  },
  bases: {
    adjustable: "premium-motion-adjustable-base",
    storage: "storage-base",
    platform: "platform-base",
  },
};

/* ─────────────────────────────────────────────
   Canonical dropdown options
───────────────────────────────────────────── */

// Size options (order matters)
export const SIZE_OPTIONS = ["Twin", "Twin XL", "Full", "Queen", "King"];

// Base options
export const BASE_OPTIONS_DATA = [
  { key: "none", label: "No Base", handle: null },
  { key: "adjustable", label: "Adjustable Base", handle: HANDLES.bases.adjustable },
  { key: "platform", label: "Platform Base", handle: HANDLES.bases.platform },
  { key: "storage", label: "Storage Base", handle: HANDLES.bases.storage },
];

export const BASE_OPTIONS_UI = BASE_OPTIONS_DATA.map((b) => ({
  value: b.key,
  label: b.label,
}));

// Mattress options
export const MATTRESS_OPTIONS_DATA = [
  { key: "foam10", label: '10" All Foam', handle: HANDLES.mattresses.allFoam10 },
  { key: "foam12", label: '12" All Foam', handle: HANDLES.mattresses.allFoam12 },
  { key: "hybrid14", label: '14" Hybrid', handle: HANDLES.mattresses.hybrid14 },
  { key: "dual12", label: '12" Dual Comfort Hybrid', handle: HANDLES.mattresses.dualComfort },
];

export const MATTRESS_OPTIONS_UI = MATTRESS_OPTIONS_DATA.map((m) => ({
  value: m.key,
  label: m.label,
}));

// Motion options (UI labels)
export const MOTION_TYPES_UI = [
  { value: "standard", label: "Standard" },
  { value: "half_split", label: "Half Split" },
  { value: "full_split", label: "Full Split" },
];

export const MOTION_OPTIONS_LEGACY = [
  "No Motion",
  "Standard Motion",
  "Half Split Motion",
  "Full Split Motion",
];

export const DUAL_COMFORT_OPTIONS = ["Soft", "Medium Soft", "Medium Firm", "Firm"];

/* ─────────────────────────────────────────────
   Utilities
───────────────────────────────────────────── */
export const lower = (v) => String(v || "").toLowerCase().trim();
export const pick = (v) => String(v || "").trim();
const isYes = (v) => {
  const s = lower(v);
  return s === "yes" || s === "true" || s === "partner" || s === "shared" || s === "share";
};

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function includesAny(value, terms = []) {
  const v = lower(value);
  return terms.some((term) => v.includes(lower(term)));
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const s = pick(value);
    if (s) return s;
  }
  return "";
}

function normalizeSize(size) {
  const s = pick(size);
  return SIZE_OPTIONS.includes(s) ? s : "";
}

function normalizeFirmness(value) {
  const v = lower(value);
  if (v.includes("firm")) return "firm";
  if (v.includes("soft")) return "soft";
  if (v.includes("medium")) return "medium";
  return "medium";
}

function normalizePosition(value) {
  const v = lower(value);
  if (v.includes("side")) return "side";
  if (v.includes("back")) return "back";
  if (v.includes("stomach")) return "stomach";
  if (v.includes("combo")) return "combo";
  return "side";
}

function normalizeMotionMode(value) {
  const v = lower(value);

  if (v.includes("full split")) return "Full Split Motion";
  if (v.includes("half split")) return "Half Split Motion";
  if (v.includes("standard")) return "Standard Motion";
  if (v.includes("no motion")) return "No Motion";
  if (v.includes("split")) return "Half Split Motion";

  return "";
}

export function isDualComfortHandle(handle) {
  const h = lower(handle);
  return h.includes("dual") && h.includes("comfort");
}

function mattressTypeFromHandle(handle) {
  const h = lower(handle);
  if (h === lower(HANDLES.mattresses.dualComfort) || isDualComfortHandle(h)) return "dual12";
  if (h === lower(HANDLES.mattresses.hybrid14) || (h.includes("hybrid") && h.includes("14"))) return "hybrid14";
  if (h === lower(HANDLES.mattresses.allFoam12) || (h.includes("foam") && h.includes("12"))) return "foam12";
  if (h === lower(HANDLES.mattresses.allFoam10) || (h.includes("foam") && h.includes("10"))) return "foam10";
  if (h.includes("hybrid")) return "hybrid14";
  if (h.includes("foam")) return "foam12";
  return "";
}

function mattressFamilyFromHandle(handle) {
  const t = mattressTypeFromHandle(handle);
  if (t === "dual12") return "dual";
  if (t === "hybrid14") return "hybrid";
  if (t === "foam12" || t === "foam10") return "foam";
  return "unknown";
}

function mattressLabelFromHandle(handle) {
  const h = lower(handle);
  if (h === lower(HANDLES.mattresses.dualComfort) || isDualComfortHandle(h)) return '12" Dual Comfort Hybrid';
  if (h === lower(HANDLES.mattresses.hybrid14) || (h.includes("14") && h.includes("hybrid"))) return '14" Hybrid';
  if (h === lower(HANDLES.mattresses.allFoam12) || (h.includes("foam") && h.includes("12"))) return '12" All Foam';
  if (h === lower(HANDLES.mattresses.allFoam10) || (h.includes("foam") && h.includes("10"))) return '10" All Foam';
  return "Mattress";
}

function baseTypeFromHandle(handle) {
  const h = lower(handle);
  if (!h) return "none";
  if (h === lower(HANDLES.bases.adjustable) || includesAny(h, ["adjust", "motion"])) return "adjustable";
  if (h === lower(HANDLES.bases.storage) || h.includes("storage")) return "storage";
  if (h === lower(HANDLES.bases.platform) || h.includes("platform")) return "platform";
  return "none";
}

function motionTypeFromDisplay(motion) {
  const m = lower(motion);
  if (m.includes("full split")) return "full_split";
  if (m.includes("half split")) return "half_split";
  return "standard";
}

function inStoreSizeLine({ size, motion } = {}) {
  const s = pick(size) || "—";
  const m = lower(motion);
  if (m.includes("half split")) return `Half Split ${s}`;
  if (m.includes("full split")) return `Full Split ${s}`;
  return s;
}

function stripLegacyLocalImageFields(pod) {
  const next = { ...(pod || {}) };

  delete next.image;
  delete next.imageUrl;
  delete next.image_url;
  delete next.mattressImage;
  delete next.mattressImageUrl;
  delete next.mattress_image;

  return next;
}

/* ─────────────────────────────────────────────
   Selection → Handle helpers
───────────────────────────────────────────── */
export function getMattressHandleForType(mattressType) {
  const key = pick(mattressType);
  const found = MATTRESS_OPTIONS_DATA.find((m) => m.key === key);
  return found?.handle || null;
}

export function getBaseHandleForType(baseType) {
  const key = pick(baseType);
  const found = BASE_OPTIONS_DATA.find((b) => b.key === key);
  return found?.handle || null; // "none" returns null
}

/* ─────────────────────────────────────────────
   Motion helpers
───────────────────────────────────────────── */
export function allowedMotionTypesForSize(size) {
  const s = pick(size);
  if (s === "King") return ["standard", "half_split", "full_split"];
  if (s === "Queen") return ["standard", "half_split"];
  return ["standard"];
}

export function isSplitMotionType(motionType) {
  return motionType === "half_split" || motionType === "full_split";
}

/**
 * Core resolver: turns a shopper selection into real product handles.
 * Deterministic: no guesswork beyond defined rules.
 */
export function resolvePodSelectionToHandles(pod, selection = {}) {
  const warnings = [];

  const fallbackSize =
    normalizeSize(selection.size) ||
    normalizeSize(pod?.displayedIn?.size) ||
    normalizeSize(pod?.meta?.size) ||
    "Queen";

  const fallbackBaseType =
    pick(selection.baseType) ||
    pick(pod?.baseType) ||
    baseTypeFromHandle(pod?.baseHandle) ||
    "none";

  const fallbackMotionType =
    pick(selection.motionType) ||
    pick(pod?.motionType) ||
    motionTypeFromDisplay(pod?.displayedIn?.motion) ||
    "standard";

  const fallbackMattressType =
    pick(selection.mattressType) ||
    mattressTypeFromHandle(pod?.mattressHandle) ||
    "foam12";

  const normalized = {
    size: fallbackSize,
    baseType: fallbackBaseType,
    motionType: fallbackMotionType,
    mattressType: fallbackMattressType,
    dcLeft: pick(selection.dcLeft) || pick(pod?.displayedIn?.dualComfort?.left) || "Medium Firm",
    dcRight: pick(selection.dcRight) || pick(pod?.displayedIn?.dualComfort?.right) || "Medium Soft",
  };

  const wantsAdjustable = normalized.baseType === "adjustable";

  if (!wantsAdjustable && normalized.motionType !== "standard") {
    warnings.push("Motion only applies to Adjustable Base. Motion set to Standard.");
    normalized.motionType = "standard";
  }

  if (wantsAdjustable) {
    if (normalized.motionType === "full_split" && normalized.size !== "King") {
      warnings.push("Full Split Motion is King-only. Motion downgraded.");
      normalized.motionType = normalized.size === "Queen" ? "half_split" : "standard";
    }

    const allowed = allowedMotionTypesForSize(normalized.size);
    if (!allowed.includes(normalized.motionType)) {
      const next = allowed[0] || "standard";
      warnings.push(`Motion "${normalized.motionType}" not allowed for ${normalized.size}. Using "${next}".`);
      normalized.motionType = next;
    }

    if (isSplitMotionType(normalized.motionType) && normalized.mattressType !== "dual12") {
      warnings.push("Split motion requires Dual Comfort. Mattress updated.");
      normalized.mattressType = "dual12";
    }
  }

  const selectionHasMattressType = Object.prototype.hasOwnProperty.call(selection, "mattressType");
  const selectionHasBaseType = Object.prototype.hasOwnProperty.call(selection, "baseType");

  const mattressHandle = getMattressHandleForType(normalized.mattressType);
  if (!mattressHandle && selectionHasMattressType) {
    warnings.push(`Unknown mattressType "${normalized.mattressType}". Mattress handle not resolved.`);
  }

  const baseHandle = getBaseHandleForType(normalized.baseType);
  if (normalized.baseType !== "none" && !baseHandle && selectionHasBaseType) {
    warnings.push(`Unknown baseType "${normalized.baseType}". Base handle not resolved.`);
  }

  const finalMattressHandle =
    mattressHandle || (!selectionHasMattressType ? pick(pod?.mattressHandle) : null) || null;

  const finalBaseHandle =
    normalized.baseType === "none"
      ? null
      : baseHandle || (!selectionHasBaseType ? pick(pod?.baseHandle) : null) || null;

  return {
    mattressHandle: finalMattressHandle,
    baseHandle: finalBaseHandle,
    normalizedSelection: normalized,
    warnings,
  };
}

/* ─────────────────────────────────────────────
   Motion Validation (assessment legacy)
───────────────────────────────────────────── */
function validateMotion({ size, motionMode }) {
  const warnings = [];
  const s = lower(size);
  const m = lower(motionMode);

  let forcedMattressHandle = null;

  const isHalfSplit = m.includes("half split");
  const isFullSplit = m.includes("full split");
  const isAnySplit = isHalfSplit || isFullSplit;

  if (isFullSplit && s !== "king") {
    warnings.push("Full Split Motion is only available in King setups.");
  }

  if (isHalfSplit && s !== "queen" && s !== "king") {
    warnings.push("Half Split Motion is only available in Queen or King sizes.");
  }

  if (isAnySplit) {
    forcedMattressHandle = HANDLES.mattresses.dualComfort;
  }

  return {
    motionOk: warnings.length === 0,
    warnings,
    forcedMattressHandle,
    isAnySplit,
    isHalfSplit,
    isFullSplit,
  };
}

/* ─────────────────────────────────────────────
   Mattress Selection
───────────────────────────────────────────── */
function choosePrimaryMattress({ firmness, position }) {
  const f = lower(firmness);
  const p = lower(position);

  if (f === "firm" || p === "back" || p === "stomach") return HANDLES.mattresses.hybrid14;
  if (p === "side") return HANDLES.mattresses.allFoam12;
  return HANDLES.mattresses.hybrid14;
}

/* ─────────────────────────────────────────────
   Fixed Physical SnoozePods (ALL 5)
───────────────────────────────────────────── */
function buildShowroomPods() {
  return [
    {
      id: 1,
      podId: 1,
      mattressHandle: HANDLES.mattresses.dualComfort,
      baseHandle: HANDLES.bases.adjustable,
      baseType: "adjustable",
      motionType: "half_split",
      hasAdjustableBase: true,
      displayMattress: '12" Dual Comfort Hybrid',
      displayedIn: {
        size: "King",
        baseLabel: "Adjustable Base",
        motion: "Half Split Motion",
        dualComfort: { left: "Medium Firm", right: "Medium Soft" },
      },
      availableIn: {
        sizes: SIZE_OPTIONS,
        baseOptions: ["Adjustable Base", "Platform Base", "Storage Base", "No Base"],
        motionNotes: [
          "Split motion requires Dual Comfort. Half Split available in Queen/King. Full Split available in King only.",
        ],
      },
    },
    {
      id: 2,
      podId: 2,
      mattressHandle: HANDLES.mattresses.dualComfort,
      baseHandle: HANDLES.bases.adjustable,
      baseType: "adjustable",
      motionType: "full_split",
      hasAdjustableBase: true,
      displayMattress: '12" Dual Comfort Hybrid',
      displayedIn: {
        size: "King",
        baseLabel: "Adjustable Base",
        motion: "Full Split Motion",
        dualComfort: { left: "Soft", right: "Firm" },
      },
      availableIn: {
        sizes: SIZE_OPTIONS,
        baseOptions: ["Adjustable Base", "Platform Base", "Storage Base", "No Base"],
        motionNotes: ["Full Split motion is King-only. Split motion requires Dual Comfort."],
      },
    },
    {
      id: 3,
      podId: 3,
      mattressHandle: HANDLES.mattresses.hybrid14,
      baseHandle: HANDLES.bases.adjustable,
      baseType: "adjustable",
      motionType: "standard",
      hasAdjustableBase: true,
      displayMattress: '14" Hybrid',
      displayedIn: { size: "King", baseLabel: "Adjustable Base", motion: "Standard Motion" },
      availableIn: {
        sizes: SIZE_OPTIONS,
        baseOptions: ["Adjustable Base", "Platform Base", "Storage Base", "No Base"],
        motionNotes: ["Standard Motion is available across most sizes."],
      },
    },
    {
      id: 4,
      podId: 4,
      mattressHandle: HANDLES.mattresses.allFoam12,
      baseHandle: HANDLES.bases.storage,
      baseType: "storage",
      motionType: "standard",
      hasAdjustableBase: false,
      displayMattress: '12" All Foam',
      displayedIn: { size: "Queen", baseLabel: "Storage Base", motion: "No Motion" },
      availableIn: {
        sizes: SIZE_OPTIONS,
        baseOptions: ["Storage Base", "Platform Base", "No Base", "Adjustable Base"],
        motionNotes: ["No-motion foundations are available across most sizes."],
      },
    },
    {
      id: 5,
      podId: 5,
      mattressHandle: HANDLES.mattresses.allFoam10,
      baseHandle: HANDLES.bases.platform,
      baseType: "platform",
      motionType: "standard",
      hasAdjustableBase: false,
      displayMattress: '10" All Foam',
      displayedIn: { size: "Queen", baseLabel: "Platform Base", motion: "No Motion" },
      availableIn: {
        sizes: SIZE_OPTIONS,
        baseOptions: ["Platform Base", "Storage Base", "No Base", "Adjustable Base"],
        motionNotes: ["No-motion foundations are available across most sizes."],
      },
    },
  ].map(stripLegacyLocalImageFields);
}

/* ─────────────────────────────────────────────
   Deterministic ranking
───────────────────────────────────────────── */
function fixtureSupportsPartnerNeed(pod) {
  const mattressIsDual = isDualComfortHandle(pod?.mattressHandle);
  const baseIsAdjustable = (pick(pod?.baseType) || baseTypeFromHandle(pod?.baseHandle)) === "adjustable";
  return mattressIsDual || baseIsAdjustable;
}

function scorePodForShopper(pod, shopper) {
  let score = 0;
  const reasons = [];

  const podMattressHandle = pick(pod?.mattressHandle);
  const podMattressType = mattressTypeFromHandle(podMattressHandle);
  const podMattressFamily = mattressFamilyFromHandle(podMattressHandle);
  const podMotionType = pick(pod?.motionType) || motionTypeFromDisplay(pod?.displayedIn?.motion);
  const podSize = pick(pod?.displayedIn?.size);
  const podBaseType = pick(pod?.baseType) || baseTypeFromHandle(pod?.baseHandle);
  const podIsAdjustable = pod?.hasAdjustableBase === true || podBaseType === "adjustable";
  const podSupportsPartner = fixtureSupportsPartnerNeed(pod);

  if (podMattressHandle === shopper.primaryMattressHandle) {
    score += 100;
    reasons.push("primary_mattress_exact");
  } else if (podMattressFamily === shopper.primaryMattressFamily) {
    score += 55;
    reasons.push("primary_mattress_family");
  }

  if (shopper.motionCheck.isFullSplit && podMotionType === "full_split") {
    score += 70;
    reasons.push("requested_full_split");
  } else if (shopper.motionCheck.isHalfSplit && podMotionType === "half_split") {
    score += 60;
    reasons.push("requested_half_split");
  } else if (!shopper.motionCheck.isAnySplit && shopper.requestedMotionMode === "Standard Motion" && podMotionType === "standard" && podIsAdjustable) {
    score += 28;
    reasons.push("requested_standard_motion");
  }

  if (shopper.motionCheck.isAnySplit && isDualComfortHandle(podMattressHandle)) {
    score += 35;
    reasons.push("split_requires_dual");
  }

  if (shopper.hasPartner && podSupportsPartner) {
    score += 18;
    reasons.push("partner_friendly");
  }

  if (shopper.position === "side" && podMattressType === "foam12") {
    score += 18;
    reasons.push("side_sleeper_pressure_relief");
  }

  if ((shopper.position === "back" || shopper.position === "stomach") && podMattressType === "hybrid14") {
    score += 18;
    reasons.push("back_or_stomach_support");
  }

  if (shopper.firmness === "firm" && podMattressType === "hybrid14") {
    score += 12;
    reasons.push("firmness_firm_match");
  }

  if (shopper.firmness === "soft" && (podMattressType === "foam12" || podMattressType === "dual12")) {
    score += 12;
    reasons.push("firmness_soft_match");
  }

  if (shopper.size && podSize === shopper.size) {
    score += 10;
    reasons.push("fixture_size_match");
  }

  if (!shopper.motionCheck.isAnySplit && !shopper.hasPartner && !podIsAdjustable && podMattressFamily === "foam") {
    score += 8;
    reasons.push("simple_non_motion_option");
  }

  return { score, reasons };
}

/* ─────────────────────────────────────────────
   Optional accessory prefetch (OFF by default)
───────────────────────────────────────────── */
async function safeGetProducts({ q, limit }) {
  try {
    const data = await api.getProducts({ q, limit });
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}

function toAccessoryCard(x) {
  return {
    handle: x?.handle || slugify(x?.title || ""),
    title: x?.title || "",
    subtitle: String(x?.description || "").slice(0, 80),
  };
}

/* ─────────────────────────────────────────────
   MAIN ENGINE (Deterministic core)
───────────────────────────────────────────── */

/**
 * generateShowroomRecommendations(results, opts)
 *
 * opts:
 *  - includeAccessories: boolean (default false)
 *  - accessoryLimit: number (default 2)
 *
 * Deterministic guarantee:
 *  - With includeAccessories=false, this function performs ZERO network calls.
 */
export async function generateShowroomRecommendations(results = {}, opts = {}) {
  const includeAccessories = opts?.includeAccessories === true;
  const accessoryLimit = Number.isFinite(Number(opts?.accessoryLimit)) ? Number(opts.accessoryLimit) : 2;

  const size = normalizeSize(
    firstNonEmpty(
      results?.size,
      results?.answers?.size,
      results?.preferredSize
    )
  );

  const motionMode = normalizeMotionMode(
    firstNonEmpty(
      results?.motionMode,
      results?.answers?.motionMode,
      results?.motion,
      results?.answers?.motion
    )
  );

  const firmness = normalizeFirmness(
    firstNonEmpty(
      results?.firmness,
      results?.comfortPreference,
      results?.answers?.firmness,
      results?.answers?.comfortPreference,
      "medium"
    )
  );

  const position = normalizePosition(
    firstNonEmpty(
      results?.sleepPosition,
      results?.position,
      results?.primaryPosition,
      results?.answers?.sleepPosition,
      results?.answers?.position,
      "side"
    )
  );

  const hasPartner = isYes(
    firstNonEmpty(
      results?.sleepPartner,
      results?.partner,
      results?.shareBed,
      results?.answers?.sleepPartner,
      results?.answers?.partner,
      results?.answers?.shareBed
    )
  );

  const motionCheck = validateMotion({ size, motionMode });
  const primaryMattressHandle =
    motionCheck.forcedMattressHandle || choosePrimaryMattress({ firmness, position });
  const primaryMattressFamily = mattressFamilyFromHandle(primaryMattressHandle);

  const shopperProfile = {
    size,
    requestedMotionMode: motionMode,
    firmness,
    position,
    hasPartner,
    motionCheck,
    primaryMattressHandle,
    primaryMattressFamily,
  };

  const pods = buildShowroomPods();

  const rankedAll = [...pods]
    .map((pod) => {
      const ranking = scorePodForShopper(pod, shopperProfile);
      return {
        pod,
        score: ranking.score,
        scoreReasons: ranking.reasons,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Number(a.pod?.podId || 999) - Number(b.pod?.podId || 999);
    })
    .map(({ pod, score, scoreReasons }, idx) => {
      const rank = idx + 1;
      const recommended = rank <= 3;

      const storeSizeLine = inStoreSizeLine({
        size: pod.displayedIn?.size,
        motion: pod.displayedIn?.motion,
      });

      const storeMattressLabel = pod.displayMattress || mattressLabelFromHandle(pod.mattressHandle);
      const resolvedBaseType = pick(pod?.baseType) || baseTypeFromHandle(pod?.baseHandle);
      const resolvedMotionType = pick(pod?.motionType) || motionTypeFromDisplay(pod?.displayedIn?.motion);
      const resolvedHasAdjustableBase =
        pod?.hasAdjustableBase === true || resolvedBaseType === "adjustable";

      return {
        ...stripLegacyLocalImageFields(pod),
        rank,
        recommended,
        title: `SnoozePod ${pod.podId}`,
        displayMattress: storeMattressLabel,
        subtitle: `In-store: ${storeSizeLine} • ${storeMattressLabel}`,
        baseType: resolvedBaseType,
        motionType: resolvedMotionType,
        hasAdjustableBase: resolvedHasAdjustableBase,
        flags: {
          isDualComfortMattress: isDualComfortHandle(pod.mattressHandle),
          isAdjustableFixture: resolvedHasAdjustableBase,
        },
        diagnostics: {
          score,
          scoreReasons,
        },
      };
    });

  const accessoryQueries = {
    pillows: `pillow ${position}`,
    bedding: `bedding ${firmness}`,
    limit: accessoryLimit,
  };

  let pillows = [];
  let bedding = [];

  if (includeAccessories) {
    const [pillowItems, beddingItems] = await Promise.all([
      safeGetProducts({ q: accessoryQueries.pillows, limit: accessoryLimit }),
      safeGetProducts({ q: accessoryQueries.bedding, limit: accessoryLimit }),
    ]);

    pillows = pillowItems.map(toAccessoryCard).filter((x) => x.handle && x.title);
    bedding = beddingItems.map(toAccessoryCard).filter((x) => x.handle && x.title);
  }

  return {
    meta: {
      size,
      motionMode,
      firmness,
      position,
      hasPartner,
      warnings: motionCheck.warnings,
      primaryMattressHandle,
      primaryMattressFamily,

      sizeOptions: SIZE_OPTIONS,
      baseOptionsData: BASE_OPTIONS_DATA,
      baseOptionsUi: BASE_OPTIONS_UI,
      mattressOptionsData: MATTRESS_OPTIONS_DATA,
      mattressOptionsUi: MATTRESS_OPTIONS_UI,
      motionTypesUi: MOTION_TYPES_UI,
      dualComfortOptions: DUAL_COMFORT_OPTIONS,

      accessoryQueries,
      accessoriesPrefetched: includeAccessories,
    },
    pods: rankedAll,
    pillows,
    bedding,
  };
}