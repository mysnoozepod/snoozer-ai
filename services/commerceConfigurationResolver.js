const contract = require("../data/commerce-configuration-rules.v1.json");

function text(value) {
  return String(value == null ? "" : value).trim();
}

function normalized(value) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function variantsFor(product = {}) {
  const variants = product?.variants;
  if (Array.isArray(variants)) return variants;
  if (Array.isArray(variants?.edges)) return variants.edges.map((edge) => edge?.node).filter(Boolean);
  if (Array.isArray(variants?.nodes)) return variants.nodes.filter(Boolean);
  return [];
}

function optionLabels(variant = {}) {
  const selected = Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : [];
  const values = selected.map((option) => text(option?.value)).filter(Boolean);
  const title = text(variant?.title);
  return [...new Set([...values, ...(title && !/^default title$/i.test(title) ? [title] : [])])];
}

function isAvailable(variant = {}) {
  return !(
    variant?.availableForSale === false ||
    variant?.available === false ||
    variant?.isAvailable === false ||
    variant?.inventoryAvailable === false
  );
}

function variantId(variant = {}) {
  const id = text(variant?.id);
  return id.startsWith("gid://shopify/ProductVariant/") ? id : null;
}

function setupSizeForSelection(selection = "") {
  const exact = Object.entries(contract.setupSizeAliases || {}).find(
    ([label]) => normalized(label) === normalized(selection)
  );
  return exact ? exact[1] : text(selection);
}

function requestedOptionForConfiguration({ category, setupSize, motionType, requestedOption } = {}) {
  if (category === "pillow") return text(requestedOption);
  const normalizedSetup = setupSizeForSelection(setupSize);
  const matchingRules = (contract.rules || []).filter((rule) =>
    rule.category === category &&
    normalized(rule.setupSize) === normalized(normalizedSetup) &&
    (!rule.motionType || normalized(rule.motionType) === normalized(motionType))
  );
  const motionSpecific = matchingRules.find((rule) => Boolean(rule.motionType));
  const general = matchingRules.find((rule) => !rule.motionType);
  return text(motionSpecific?.requestedOption || general?.requestedOption || requestedOption || normalizedSetup);
}

function resolveApprovedVariant({ product, category, setupSize, motionType = "standard", requestedOption = "" } = {}) {
  const requested = requestedOptionForConfiguration({ category, setupSize, motionType, requestedOption });
  const variants = variantsFor(product);
  const availableOptions = [...new Set(variants.flatMap(optionLabels))];
  const base = { category: text(category), requestedOption: requested, availableOptions };
  if (!requested) return { ok: false, ...base, reason: "REQUESTED_OPTION_REQUIRED" };
  const exact = variants.filter((variant) => optionLabels(variant).some((label) => normalized(label) === normalized(requested)));
  if (!exact.length) return { ok: false, ...base, reason: "EXACT_OPTION_NOT_FOUND" };
  const available = exact.filter((variant) => isAvailable(variant) && variantId(variant));
  if (!available.length) return { ok: false, ...base, reason: "EXACT_OPTION_UNAVAILABLE" };
  if (available.length > 1) return { ok: false, ...base, reason: "EXACT_OPTION_AMBIGUOUS" };
  return {
    ok: true,
    ...base,
    variant: available[0],
    variantId: variantId(available[0]),
    actualOption: optionLabels(available[0]).find((label) => normalized(label) === normalized(requested)) || requested,
  };
}

module.exports = {
  COMMERCE_CONFIGURATION_VERSION: contract.version,
  requestedOptionForConfiguration,
  resolveApprovedVariant,
  setupSizeForSelection,
};
