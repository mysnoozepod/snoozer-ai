export const SLEEP_ESSENTIAL_CATEGORIES = Object.freeze([
  {
    id: "pillows",
    label: "Pillows",
    actionLabel: "Browse Pillows",
  },
  {
    id: "sheets_bedding",
    label: "Sheets & Bedding",
    actionLabel: "Shop Sheets and Bedding",
  },
  {
    id: "protectors",
    label: "Mattress Protectors",
    actionLabel: "Explore Mattress Protectors",
  },
]);

export const SLEEP_ESSENTIAL_CATEGORY_IDS = Object.freeze(
  SLEEP_ESSENTIAL_CATEGORIES.map((category) => category.id)
);

export const SLEEP_ESSENTIAL_SORT_OPTIONS = Object.freeze([
  Object.freeze({ value: "featured", label: "Featured" }),
  Object.freeze({ value: "price-low", label: "Price: Low to High" }),
  Object.freeze({ value: "price-high", label: "Price: High to Low" }),
  Object.freeze({ value: "name", label: "Name: A–Z" }),
]);

function sortPrice(product) {
  const availableVariants = (Array.isArray(product?.variants) ? product.variants : [])
    .filter((variant) => variant?.available !== false && variant?.availableForSale !== false);
  const prices = availableVariants
    .map((variant) => Number(variant?.price ?? variant?.priceV2?.amount))
    .filter(Number.isFinite);
  if (prices.length) return Math.min(...prices);
  const fallback = Number(product?.price ?? product?.priceRange?.min);
  return Number.isFinite(fallback) ? fallback : null;
}

export function sortSleepEssentialProducts(products, sortKey = "featured") {
  const indexed = (Array.isArray(products) ? products : []).map((product, index) => ({ product, index }));
  if (sortKey === "featured") return indexed.map(({ product }) => product);

  indexed.sort((left, right) => {
    if (sortKey === "name") {
      const byName = String(left.product?.title || "").localeCompare(
        String(right.product?.title || ""),
        undefined,
        { sensitivity: "base" }
      );
      return byName || left.index - right.index;
    }

    const leftPrice = sortPrice(left.product);
    const rightPrice = sortPrice(right.product);
    const leftComparable = leftPrice == null ? (sortKey === "price-high" ? -Infinity : Infinity) : leftPrice;
    const rightComparable = rightPrice == null ? (sortKey === "price-high" ? -Infinity : Infinity) : rightPrice;
    const byPrice = sortKey === "price-high"
      ? rightComparable - leftComparable
      : leftComparable - rightComparable;
    return byPrice || left.index - right.index;
  });

  return indexed.map(({ product }) => product);
}

const SLEEP_ESSENTIAL_NOTICE_CUES = Object.freeze({
  pillows: Object.freeze([
    Object.freeze({
      id: "support",
      label: "Neck & shoulder support",
      description: "Notice whether your head and neck feel naturally supported.",
    }),
    Object.freeze({
      id: "loft",
      label: "Loft / height",
      description: "Compare whether the pillow feels too high, too low, or balanced.",
    }),
    Object.freeze({
      id: "temperature",
      label: "Temperature",
      description: "Notice whether heat starts building while you settle in.",
    }),
    Object.freeze({
      id: "response",
      label: "Feel",
      description: "Compare how quickly the pillow responds when you change position.",
    }),
  ]),
  sheets_bedding: Object.freeze([
    Object.freeze({
      id: "surface-feel",
      label: "Surface feel",
      description: "Compare how the fabric feels directly against your skin.",
    }),
    Object.freeze({
      id: "temperature",
      label: "Temperature",
      description: "Notice whether the material feels cool, neutral, or warm.",
    }),
    Object.freeze({
      id: "drape",
      label: "Weight / drape",
      description: "Compare whether you prefer a lighter or more substantial feel.",
    }),
    Object.freeze({
      id: "fit",
      label: "Fit",
      description: "Make sure the set matches the mattress size you are building.",
    }),
  ]),
  protectors: Object.freeze([
    Object.freeze({
      id: "surface-feel",
      label: "Surface feel",
      description: "Notice whether the protector changes the feel of the mattress.",
    }),
    Object.freeze({
      id: "sound",
      label: "Sound",
      description: "Listen for unwanted noise when you move.",
    }),
    Object.freeze({
      id: "temperature",
      label: "Temperature",
      description: "Notice whether the sleep surface still feels breathable.",
    }),
    Object.freeze({
      id: "coverage",
      label: "Fit / coverage",
      description: "Confirm the protector fits the mattress size you selected.",
    }),
  ]),
});

function readAssessmentValue(assessment, ...keys) {
  for (const key of keys) {
    const direct = assessment?.[key];
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct).trim();
    const nested = assessment?.answers?.[key];
    if (nested !== undefined && nested !== null && String(nested).trim()) return String(nested).trim();
  }
  return "";
}

function normalizeSleepPosition(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("side")) return "side";
  if (normalized.includes("back")) return "back";
  if (normalized.includes("stomach")) return "stomach";
  if (normalized.includes("combination") || normalized.includes("multiple")) return "several positions";
  return normalized;
}

export function buildSleepEssentialsGuidance(categoryId, assessment) {
  const safeCategoryId = normalizeSleepEssentialsCategory(categoryId);
  if (safeCategoryId === "pillows") {
    const position = normalizeSleepPosition(
      readAssessmentValue(assessment, "sleepPosition", "position", "primarySleepPosition")
    );
    return position
      ? `You told me you sleep mostly on your ${position}. Compare how each pillow supports the space between your shoulder and neck.`
      : "Try these pillow options and compare support, height, temperature, and response.";
  }
  if (safeCategoryId === "sheets_bedding") {
    const temperature = readAssessmentValue(assessment, "sleepTemperature", "temperature", "sleepsHot");
    return temperature
      ? `Keep your ${temperature.toLowerCase()} temperature preference in mind as you compare feel and breathability.`
      : "Compare how each fabric feels against your skin and how breathable it feels.";
  }
  return "A protector should protect the mattress without distracting from the feel you chose.";
}

export function buildSleepEssentialsNoticeCues(categoryId) {
  return SLEEP_ESSENTIAL_NOTICE_CUES[normalizeSleepEssentialsCategory(categoryId)] || [];
}

export function getSleepEssentialsVariantLabel(categoryId) {
  const safeCategoryId = normalizeSleepEssentialsCategory(categoryId);
  if (safeCategoryId === "pillows") return "Pillow Size";
  if (safeCategoryId === "sheets_bedding") return "Set Size";
  return "Mattress Size";
}

export function normalizeSleepEssentialsCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SLEEP_ESSENTIAL_CATEGORY_IDS.includes(normalized)
    ? normalized
    : SLEEP_ESSENTIAL_CATEGORY_IDS[0];
}

export function getSleepEssentialsJourneyId(shopperId) {
  const canonicalShopperId = String(shopperId || "").trim();
  return canonicalShopperId
    ? `sleep-essentials-${canonicalShopperId}`
    : "";
}

export function buildPodCustomizeReturnPath(podId, stepKey = "review") {
  const normalizedPodId = String(podId || "").trim().toLowerCase();
  if (!/^pod-[1-5]$/.test(normalizedPodId)) return "/results";
  const safeStep = ["essentials", "pillows", "sheets", "protector", "review"].includes(stepKey)
    ? stepKey
    : "review";
  return `/pod/${normalizedPodId}?stage=build&buildStep=${safeStep}`;
}

export function getSafeSleepEssentialsReturnPath(value, fallback = "/results") {
  const raw = String(value || "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;

  try {
    const url = new URL(raw, "https://showroom.mysnoozepod.com");
    if (!/^\/pod\/pod-[1-5]$/.test(url.pathname)) return fallback;

    const stage = url.searchParams.get("stage");
    const step = url.searchParams.get("buildStep");
    if (stage !== "build") return fallback;
    if (step && !["essentials", "pillows", "sheets", "protector", "review"].includes(step)) {
      return fallback;
    }

    const params = new URLSearchParams({ stage: "build" });
    if (step) params.set("buildStep", step);
    return `${url.pathname}?${params.toString()}`;
  } catch {
    return fallback;
  }
}

export function buildSleepEssentialsPath({ category, returnTo } = {}) {
  const params = new URLSearchParams();
  params.set("category", normalizeSleepEssentialsCategory(category));
  const safeReturn = getSafeSleepEssentialsReturnPath(returnTo, "");
  if (safeReturn) params.set("returnTo", safeReturn);
  return `/sleep-essentials?${params.toString()}`;
}

export function getSleepEssentialsFinishPath(value, fallback = "/results") {
  const safeReturn = getSafeSleepEssentialsReturnPath(value, "");
  if (!safeReturn) return fallback;

  try {
    const url = new URL(safeReturn, "https://showroom.mysnoozepod.com");
    const podId = url.pathname.split("/").filter(Boolean).at(-1) || "";
    return buildPodCustomizeReturnPath(podId, "review");
  } catch {
    return fallback;
  }
}
