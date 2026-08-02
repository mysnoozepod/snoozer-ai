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
  const safeStep = ["pillows", "sheets", "protector", "review"].includes(stepKey)
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
    if (step && !["pillows", "sheets", "protector", "review"].includes(step)) {
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
