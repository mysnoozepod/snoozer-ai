const HUD_SAFE_PAGE_ROUTES = Object.freeze({
  assessment: "/pages/snooze-assessment",
  booking: "/pages/booking-a-snooze-session",
});

const HUD_SAFE_COLLECTION_ROUTES = Object.freeze({
  mattresses: "/collections/mattresses",
});

const HUD_SAFE_PRODUCT_ROUTES = Object.freeze({
  adjustableBase: "/products/premium-motion-adjustable-base",
});

const HUD_HREF_ALIASES = Object.freeze({
  "/pages/book-your-snooze-session": HUD_SAFE_PAGE_ROUTES.booking,
});

const HUD_KNOWN_DEAD_HREFS = Object.freeze([
  "",
  "#",
  "/pages/book-your-snooze-session",
]);

function normalizeHudInternalHref(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^javascript:/i.test(raw)) return "";
  if (/^[a-z]+:\/\//i.test(raw)) return "";
  if (raw.startsWith("//")) return "";

  const withoutHash = raw.split("#")[0].trim();
  const withoutQuery = withoutHash.split("?")[0].trim();
  if (!withoutQuery) return "";

  const prefixed = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery.replace(/^\/+/, "")}`;
  if (prefixed === "/") return prefixed;

  const trimmed = prefixed.replace(/\/+$/, "");
  return HUD_HREF_ALIASES[trimmed] || trimmed;
}

function isKnownDeadHudHref(value = "") {
  const normalized = normalizeHudInternalHref(value);
  const raw = String(value || "").trim();
  if (!raw || raw === "#") return true;
  return HUD_KNOWN_DEAD_HREFS.includes(normalized) || HUD_KNOWN_DEAD_HREFS.includes(raw);
}

function isSafeHudInternalHref(
  value = "",
  {
    allowProducts = true,
    allowPages = true,
    allowCollections = true,
    allowStaticProducts = true,
  } = {}
) {
  const href = normalizeHudInternalHref(value);
  if (!href || isKnownDeadHudHref(href)) return false;

  if (allowPages && Object.values(HUD_SAFE_PAGE_ROUTES).includes(href)) return true;
  if (allowCollections && Object.values(HUD_SAFE_COLLECTION_ROUTES).includes(href)) return true;
  if (allowStaticProducts && Object.values(HUD_SAFE_PRODUCT_ROUTES).includes(href)) return true;
  if (allowProducts && /^\/products\/[a-z0-9-]+$/i.test(href)) return true;

  return false;
}

function canonicalizeHudHref(value = "", options = {}) {
  const href = normalizeHudInternalHref(value);
  return isSafeHudInternalHref(href, options) ? href : "";
}

module.exports = {
  HUD_SAFE_PAGE_ROUTES,
  HUD_SAFE_COLLECTION_ROUTES,
  HUD_SAFE_PRODUCT_ROUTES,
  HUD_HREF_ALIASES,
  HUD_KNOWN_DEAD_HREFS,
  normalizeHudInternalHref,
  isKnownDeadHudHref,
  isSafeHudInternalHref,
  canonicalizeHudHref,
};
