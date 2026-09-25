function normalizeMatchValue(value) {
  return String(value || "").trim().toLowerCase();
}

function lineIdFor(item) {
  return String(item?.lineId || item?.id || "").trim();
}

export function cartLineHasDesiredAttributes(item, spec) {
  const current = new Map(
    (Array.isArray(item?.attributes) ? item.attributes : []).map((attribute) => [
      String(attribute?.key || "").trim(),
      String(attribute?.value || "").trim(),
    ])
  );

  return spec.line.attributes.every(
    (attribute) =>
      current.get(String(attribute.key || "").trim()) ===
      String(attribute.value || "").trim()
  );
}

export function relatedCoreCartLines(cartItems, spec) {
  const desiredHandle = normalizeMatchValue(spec.handle);
  const desiredVariant = String(spec.line.merchandiseId || "").trim();
  return (Array.isArray(cartItems) ? cartItems : []).filter((item) => {
    const itemHandle = normalizeMatchValue(item?.handle);
    const itemVariant = String(item?.merchandiseId || "").trim();
    return itemVariant === desiredVariant || (desiredHandle && itemHandle === desiredHandle);
  });
}

export function exactCoreCartLines(cartItems, spec) {
  const desiredVariant = String(spec.line.merchandiseId || "").trim();
  return relatedCoreCartLines(cartItems, spec).filter(
    (item) =>
      String(item?.merchandiseId || "").trim() === desiredVariant &&
      cartLineHasDesiredAttributes(item, spec)
  );
}

export function classifyCoreCartState(cartItems, specs) {
  if (!Array.isArray(specs) || !specs.length) return "none";
  let hasRelatedLine = false;

  const exact = specs.every((spec) => {
    const related = relatedCoreCartLines(cartItems, spec);
    const matching = exactCoreCartLines(cartItems, spec);
    if (related.length) hasRelatedLine = true;
    return (
      related.length === 1 &&
      matching.length === 1 &&
      Number(matching[0]?.quantity || 0) === Number(spec.line.quantity || 0)
    );
  });

  if (exact) return "exact";
  return hasRelatedLine ? "partial" : "none";
}

export async function synchronizeCoreCartLines({
  cartItems,
  specs,
  removeLine,
  updateLine,
  addLines,
}) {
  const authoritativeCart = Array.isArray(cartItems) ? cartItems : [];
  const removedLineIds = new Set();
  const missingLines = [];

  for (const spec of Array.isArray(specs) ? specs : []) {
    const related = relatedCoreCartLines(authoritativeCart, spec).filter(
      (item) => !removedLineIds.has(lineIdFor(item))
    );
    const matching = related.filter((item) => exactCoreCartLines([item], spec).length === 1);
    const keeper = matching[0] || null;
    const keeperId = lineIdFor(keeper);

    for (const item of related) {
      const lineId = lineIdFor(item);
      if (keeper && lineId === keeperId) continue;
      await removeLine?.(lineId);
      removedLineIds.add(lineId);
    }

    if (!keeper) {
      missingLines.push(spec.line);
    } else if (Number(keeper.quantity || 0) !== Number(spec.line.quantity || 0)) {
      await updateLine?.(keeperId, spec.line.quantity);
    }
  }

  if (missingLines.length) await addLines?.(missingLines);

  return {
    removedLineIds: [...removedLineIds],
    missingLines,
  };
}
