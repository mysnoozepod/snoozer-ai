function stripQueryAndHash(pathname) {
  return String(pathname || "/").split(/[?#]/)[0] || "/";
}

export function normalizeRoutePath(pathname) {
  const raw = stripQueryAndHash(pathname).trim();
  if (!raw || raw === "/") return "/";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

function splitSegments(pathname) {
  const normalized = normalizeRoutePath(pathname);
  if (normalized === "/") return [];
  return normalized.slice(1).split("/");
}

export function matchesRoutePattern(pathname, pattern) {
  const normalizedPath = normalizeRoutePath(pathname);
  const normalizedPattern = normalizeRoutePath(pattern);

  if (pattern === "*" || normalizedPattern === "/*") return true;
  if (normalizedPath === normalizedPattern) return true;

  const pathSegments = splitSegments(normalizedPath);
  const patternSegments = splitSegments(normalizedPattern);

  for (let i = 0; i < patternSegments.length; i += 1) {
    const patternSegment = patternSegments[i];
    const pathSegment = pathSegments[i];

    if (patternSegment === "*") return true;
    if (pathSegment === undefined) return false;
    if (patternSegment.startsWith(":")) continue;
    if (patternSegment !== pathSegment) return false;
  }

  return pathSegments.length === patternSegments.length;
}

export function matchesAnyRoutePattern(pathname, patterns = []) {
  if (!Array.isArray(patterns)) return false;
  return patterns.some((pattern) => matchesRoutePattern(pathname, pattern));
}

