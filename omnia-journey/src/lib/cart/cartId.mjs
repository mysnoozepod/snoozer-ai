const CART_GID_PATTERN = /^gid:\/\/shopify\/Cart\/[^/?#\s]+(?:\?key=[^#\s]+)?$/i;
const CART_GID_SEARCH_PATTERN = /gid:\/\/shopify\/Cart\/[^/?#\s]+(?:\?key=[^#\s"'<>]+)?/i;

export function isShopifyCartGid(value) {
  return CART_GID_PATTERN.test(String(value || "").trim());
}

export function extractShopifyCartGid(value) {
  if (!value) return "";

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (isShopifyCartGid(trimmed)) return trimmed;

    const match = trimmed.match(CART_GID_SEARCH_PATTERN);
    return match?.[0] && isShopifyCartGid(match[0]) ? match[0] : "";
  }

  if (typeof value === "object") {
    const candidates = [
      value?.id,
      value?.cartId,
      value?.cart?.id,
      value?.data?.id,
      value?.data?.cartId,
      value?.data?.cart?.id,
      value?.result?.cart?.id,
      value?.contextPatch?.ids?.cartId,
      value?.contextPatch?.cartId,
    ];

    for (const candidate of candidates) {
      const gid = extractShopifyCartGid(candidate);
      if (gid) return gid;
    }
  }

  return "";
}

export function redactShopifyCartGid(value) {
  const gid = extractShopifyCartGid(value);
  return gid ? gid.replace(/\?key=[^#\s]+$/i, "?key=[redacted]") : "";
}
