function text(value) {
  return String(value ?? "").trim();
}

export function toVariantGid(value) {
  const raw = text(value);
  if (!raw) return null;
  if (raw.startsWith("gid://shopify/ProductVariant/")) return raw;
  if (/^\d+$/.test(raw) && raw !== "0") return `gid://shopify/ProductVariant/${raw}`;
  return null;
}

export function normalizeCartAttributes(attributes) {
  if (!Array.isArray(attributes)) return [];

  return attributes
    .map((attribute) => ({
      key: text(attribute?.key ?? attribute?.name),
      value: text(attribute?.value),
    }))
    .filter((attribute) => attribute.key)
    .sort((left, right) => {
      const keyOrder = left.key.localeCompare(right.key);
      return keyOrder || left.value.localeCompare(right.value);
    });
}

export function cartAttributeDigest(attributes) {
  return JSON.stringify(normalizeCartAttributes(attributes));
}

export function plannedCartLineKey(line) {
  const merchandiseId = toVariantGid(
    line?.merchandiseId ?? line?.variantId ?? line?.variant_id ?? line?.id
  );
  if (!merchandiseId) return null;
  return `${merchandiseId}::${cartAttributeDigest(line?.attributes)}`;
}

export function cartItemIdentity(item) {
  const lineId = text(item?.lineId);
  if (lineId.startsWith("gid://shopify/CartLine/")) return lineId;
  return plannedCartLineKey(item);
}

export function normalizeMutationLine(line) {
  const merchandiseId = toVariantGid(
    line?.merchandiseId ?? line?.variantId ?? line?.variant_id ?? line?.id
  );
  if (!merchandiseId) return null;

  const quantity = Math.max(1, Math.floor(Number(line?.quantity ?? line?.qty ?? 1) || 1));
  const attributes = normalizeCartAttributes(line?.attributes);
  return {
    merchandiseId,
    quantity,
    ...(attributes.length ? { attributes } : {}),
  };
}

export function cartItemsToMutationLines(items) {
  return (Array.isArray(items) ? items : []).map(normalizeMutationLine).filter(Boolean);
}

function flattenLines(lines) {
  if (Array.isArray(lines?.edges)) return lines.edges.map((edge) => edge?.node || edge).filter(Boolean);
  if (Array.isArray(lines?.nodes)) return lines.nodes.filter(Boolean);
  if (Array.isArray(lines)) return lines.map((line) => line?.node || line).filter(Boolean);
  return [];
}

export function serverCartToMutationLines(cart) {
  return flattenLines(cart?.lines).map((line) =>
    normalizeMutationLine({
      merchandiseId: line?.merchandise?.id ?? line?.merchandiseId,
      quantity: line?.quantity,
      attributes: line?.attributes,
    })
  ).filter(Boolean);
}

export function cartLinesDigest(lines) {
  const grouped = new Map();
  for (const line of (Array.isArray(lines) ? lines : []).map(normalizeMutationLine).filter(Boolean)) {
    const key = plannedCartLineKey(line);
    grouped.set(key, (grouped.get(key) || 0) + line.quantity);
  }

  return JSON.stringify(
    Array.from(grouped.entries())
      .map(([key, quantity]) => ({ key, quantity }))
      .sort((left, right) => left.key.localeCompare(right.key))
  );
}

export function cartLinesEqual(left, right) {
  return cartLinesDigest(left) === cartLinesDigest(right);
}

