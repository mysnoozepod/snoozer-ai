const SAFE_COMMERCE_PATHS = [
  /^\/shop$/,
  /^\/sleep-essentials$/,
  /^\/ask-snoozer$/,
  /^\/results$/,
  /^\/pod\/pod-[1-5]$/,
  /^\/products\/[a-z0-9][a-z0-9-]*$/,
];

function cleanPath(value) {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return "";
  try {
    const parsed = new URL(raw, "https://showroom.mysnoozepod.com");
    if (parsed.origin !== "https://showroom.mysnoozepod.com") return "";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}
export function isSafeCommercePath(value) {
  const path = cleanPath(value);
  if (!path) return false;
  const pathname = path.split(/[?#]/, 1)[0];
  return SAFE_COMMERCE_PATHS.some((pattern) => pattern.test(pathname));
}

export function commerceReturnLabel(pathname) {
  const path = String(pathname || "");
  if (path === "/shop") return "Continue Shopping";
  if (path === "/sleep-essentials") return "Back to Sleep Essentials";
  if (path === "/ask-snoozer") return "Back to Ask Snoozer";
  if (path.startsWith("/pod/")) return "Back to SnoozePod";
  if (path === "/results") return "Back to Results";
  return "Continue Shopping";
}

export function buildCommerceOrigin(location, label) {
  const path = cleanPath(`${location?.pathname || ""}${location?.search || ""}${location?.hash || ""}`);
  if (!isSafeCommercePath(path)) return null;
  return {
    path,
    label: String(label || commerceReturnLabel(location?.pathname)).trim(),
  };
}

export function commerceNavigationState(location, label) {
  const commerceOrigin = buildCommerceOrigin(location, label);
  return commerceOrigin ? { commerceOrigin } : {};
}

export function resolveCommerceOrigin(state, fallback = "/shop") {
  const candidate = state?.commerceOrigin;
  const path = cleanPath(candidate?.path);
  if (isSafeCommercePath(path)) {
    return {
      path,
      label: String(candidate?.label || commerceReturnLabel(path.split(/[?#]/, 1)[0])).trim(),
    };
  }
  const safeFallback = isSafeCommercePath(fallback) ? cleanPath(fallback) : "/shop";
  return {
    path: safeFallback,
    label: commerceReturnLabel(safeFallback.split(/[?#]/, 1)[0]),
  };
}
