const POD_ID_PATTERN = /^pod-([1-5])$/;
const LEGACY_POD_ID_PATTERN = /^[1-5]$/;
const POD_ROUTE_PATTERN = /^\/pod\/([^/?#]+)(?:[/?#]|$)/;

export function normalizePodId(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (LEGACY_POD_ID_PATTERN.test(raw)) return `pod-${raw}`;
  if (POD_ID_PATTERN.test(raw)) return raw;
  return null;
}

export function isValidPodId(value) {
  return Boolean(normalizePodId(value));
}

export function getPodNumber(value) {
  const normalized = normalizePodId(value);
  if (!normalized) return null;
  return normalized.replace("pod-", "");
}

export function makePodRoute(value) {
  const normalized = normalizePodId(value);
  return normalized ? `/pod/${normalized}` : null;
}

export function getRoutePodId(pathname) {
  const path = String(pathname || "").trim();
  const match = path.match(POD_ROUTE_PATTERN);
  return match ? normalizePodId(match[1]) : null;
}

export function isPodRoute(pathname) {
  return /^\/pod(?:\/|$)/.test(String(pathname || "").trim());
}

export function isCanonicalPodRoute(pathname) {
  const podId = getRoutePodId(pathname);
  return Boolean(podId && String(pathname || "").split(/[?#]/)[0] === makePodRoute(podId));
}

export function getCanonicalPodRouteForPath(pathname) {
  return makePodRoute(getRoutePodId(pathname));
}

export function routeMatchesBoundPod(pathname, boundPodId) {
  const routePodId = getRoutePodId(pathname);
  const normalizedBoundPodId = normalizePodId(boundPodId);
  return Boolean(routePodId && normalizedBoundPodId && routePodId === normalizedBoundPodId);
}

