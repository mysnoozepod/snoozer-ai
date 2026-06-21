function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").replace(/^\/+/, "").trim())
        .filter(Boolean)
    )
  );
}

const KNOWLEDGE_LOCAL_MIRROR_ALIASES = Object.freeze({
  "policies/delivery-policy.md": Object.freeze(["policies/delivery.md"]),
  "products/mattress/10-all-foam-mattress.md": Object.freeze([
    "products/mattress/all-foam-10.md",
  ]),
  "products/mattress/12-all-foam-mattress.md": Object.freeze([
    "products/mattress/all-foam-12.md",
  ]),
  "products/mattress/12-dual-comfort-hybrid.md": Object.freeze([
    "products/mattress/dual-comfort-12.md",
  ]),
  "products/mattress/14-hybrid.md": Object.freeze([
    "products/mattress/hybrid-14.md",
  ]),
  "products/bases/premium-motion-adjustable-base.md": Object.freeze([
    "products/bases/premium-motion-base.md",
  ]),
});

function getLocalMirrorCandidates(bucketType = "knowledge", sourceKey = "") {
  const normalizedKey = String(sourceKey || "").replace(/^\/+/, "").trim();
  if (!normalizedKey) return [];

  const candidates = [normalizedKey];
  if (String(bucketType || "").trim() === "knowledge") {
    candidates.push(...(KNOWLEDGE_LOCAL_MIRROR_ALIASES[normalizedKey] || []));
  }

  return uniqueStrings(candidates);
}

module.exports = {
  KNOWLEDGE_LOCAL_MIRROR_ALIASES,
  getLocalMirrorCandidates,
};
