const productKnowledge = require("../docs/product-knowledge/PRODUCT_KNOWLEDGE_FEED.v1.json");
const { buildProductCardTruth } = require("./askSnoozerProductCardTruth");

const BOOK_SESSION_PATH = "/pages/book-a-snooze-session";
const SYSTEMS_PATH = "/pages/sleep-systems";
const SYSTEM_PATH_KEYS = { standard: "standard", half_split: "split_head", full_split: "full_split" };
const MOTION_PREFERENCES = ["flat", "adjustable", ...Object.keys(SYSTEM_PATH_KEYS)];
const WEBSITE_ASSESSMENT_KEYS = ["motion_preference", "shares_bed", "motion_sensitivity"];

const WEBSITE_ASSESSMENT_INSTRUCTIONS = [
  "This is Ask Snoozer on the MySnoozePod website. Help the shopper book a Snooze Session, assess what would suit them through natural conversation, or answer and guide them to the relevant verified destination. They can switch goals at any time.",
  "If websitePage supplies a productHandle, use it to resolve references such as this mattress when the shopper is talking about the page. Treat it as a reference only; a page view does not establish a preference, variant, price, availability, or compatibility.",
  `If they want to book, answer immediately and propose a navigate action to ${BOOK_SESSION_PATH}. The assessment is optional. When useful, relate the visit to what they want to try. Never claim a booking was made or that notes will be sent.`,
  "Use the showroom assessment topics: size, motion, and mattress feel, with relevant follow-ups about sharing the bed, sleeping position, feel, temperature, partner movement sensitivity, pressure areas, or budget. Use what they already told you, ask at most one natural question per reply, and only ask if the answer can change your guidance. No numbered questions, scripted survey, or repeated questions. If they ask a specific product or policy question, answer it directly without requiring an assessment.",
  "For a new bed configuration, first resolve whether they want an adjustable bed or want it to stay flat. If they want motion, resolve how they want it to move: Standard moves together, Half Split raises each head independently with the foot moving together, and Full Split lets each person adjust head and foot independently. Ask size when it changes the available options. If they already gave you a relevant answer, carry it forward.",
  "Dual Comfort is mattress feel. Each person can choose a different feel on one shared, unsplit Dual Comfort mattress, flat or on a compatible standard base. Dual Motion comes from the adjustable base setup. Explain that splitting the bed is useful when they want independent elevation; different comfort alone never requires a split. Keep the distinction between a partner disturbing sleep by moving and choosing an adjustable base.",
  "Record the household motion_preference as flat, adjustable (mode undecided), standard, half_split, or full_split; use one preference so a correction replaces the prior motion choice. Keep mattress feel as firmness with separate shopper and partner subjects. Use Soft, Medium Soft, Medium Firm, and Firm to describe the four online Dual Comfort choices. Preserve size, comfort, and other preferences when only motion changes. Record shares_bed as a household yes or no and motion_sensitivity for the relevant sleeper when stated. A question, example, or hypothetical alone is not a preference. Never assume a side choice, size, or deal-breaker they have not given you.",
  "The website offers Split Head systems with Flex SH; Split King uses two Twin XL mattresses and two compatible Twin XL bases. Full Split Queen is not offered. If asked for Full Split Queen, explain the difference and offer keeping Queen with Half Split or considering Split King for independent head and foot. Never substitute a different geometry without telling the shopper or claim a specific system is available or priced without live evidence.",
  `For general adjustable-system browsing propose a navigate action to ${SYSTEMS_PATH}, with motionKey standard, half_split, or full_split when that path fits. Use product facts for product details and live commerce for exact size, price, availability, or product links. For a product link propose navigate with the grounded product handle and size when applicable; the server builds the link. Use structured navigation actions for links, never write URLs in the reply or put links in suggestion chips.`,
  "On website discovery, use partnerConsiderations only when shoppers want independent mattress feel, to look for genuinely verified Dual Comfort. Bring up other preferences when the retrieved evidence supports them. Explain why the option fits in plain language. Keep the latest answer brief and practical. Do not add anything to the cart or offer to execute checkout on this website surface.",
];

function isWebsiteAssessmentSource(source) {
  return String(source ?? "").trim().toLowerCase() === "website";
}

function verifiedFields(product) {
  const fields = product.technical?.fields || {};
  const fieldValue = (key) => fields[key]?.value;
  const construction = fieldValue("snoozepod_mattress.construction");
  const dualComfort = fieldValue("snoozepod_mattress.dual_comfort_capable") === "true";
  const verifiedFeatures = JSON.parse(fieldValue("snoozepod_technical.verified_features") || "[]");
  const facts = [
    ...(construction ? [`Mattress construction: ${construction}`] : []),
    ...(dualComfort ? ["Supports independent comfort choices on each side of the mattress."] : []),
    ...verifiedFeatures,
  ];
  return { construction, dualComfort, facts };
}

const websiteProducts = productKnowledge.products
  .filter((product) => product.commerce?.status === "ACTIVE")
  .map((product) => {
    const { construction, dualComfort, facts } = verifiedFields(product);
    return {
      handle: product.handle,
      title: product.title,
      catalogType: product.categoryContract,
      family: dualComfort ? "dual" : { Hybrid: "hybrid", "Memory foam": "foam" }[construction] || null,
      attributes: dualComfort ? { dualComfort: true, preferredForPartnerSleep: true } : {},
      active: true,
      facts,
    };
  });

const websiteManifest = { version: `website-knowledge:${productKnowledge.generatedAt}`, products: websiteProducts };
const websiteProductsByHandle = new Map(websiteProducts.map((product) => [product.handle, product]));

async function getWebsiteMattressCatalog(_input, { shopify }) {
  const handles = websiteProducts.filter((product) => product.catalogType === "mattress").map((product) => product.handle);
  const { items } = await shopify.fetchProductsByHandles({ handles, lite: false });
  return { catalogVersion: websiteManifest.version, products: (items || []).filter((item) => handles.includes(item.handle)) };
}

function getWebsiteProductFacts({ productHandles }) {
  return {
    productFacts: productHandles.flatMap((handle) => {
      const product = websiteProductsByHandle.get(handle);
      return product?.facts.length ? [{ handle, status: "verified_fact", facts: product.facts }] : [];
    }),
  };
}

function normalizeSize(size) {
  return String(size ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/\bcal king\b/g, "california king");
}

function websiteProductCard(product, { activeSize = "" } = {}) {
  const card = buildProductCardTruth(product);
  if (!card) return null;
  const isMattress = websiteProductsByHandle.get(card.handle)?.catalogType === "mattress";
  const sizedVariants = card.variants.map((variant) => ({
    variant,
    size: variant.selectedOptions.find((option) => option.name.toLowerCase() === "size")?.value,
  })).filter(({ size }) => !isMattress || !/\bsplit\b|\btwin xl\s*x\s*2\b/i.test(size || ""));
  const offeredSizes = [...new Set(sizedVariants.map(({ size }) => size).filter(Boolean))];
  const prices = sizedVariants.map(({ variant }) => variant.price).filter(Number.isFinite);
  const result = {
    ...card,
    variants: sizedVariants.map(({ variant }) => variant),
    offeredSizes,
    priceRange: { ...card.priceRange, min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null },
  };
  if (!activeSize) return result;

  const matches = sizedVariants.filter(({ size }) => normalizeSize(size) === normalizeSize(activeSize));
  const variant = matches.length === 1 ? matches[0].variant : null;
  const variantNumber = variant?.id.match(/^gid:\/\/shopify\/ProductVariant\/(\d+)$/)?.[1];
  return {
    ...result,
    activeSize,
    price: variant?.price ?? null,
    currencyCode: variant?.currencyCode || card.currencyCode,
    pricingMode: Number.isFinite(variant?.price) ? "exact_variant" : "unresolved",
    priceLabel: null,
    pricingReason: variant ? "exact_variant_resolved" : (matches.length ? "additional_options_required" : "size_not_resolved"),
    variantId: variant?.id || null,
    selectedOptions: variant?.selectedOptions || [],
    exactVariantResolved: Boolean(variant),
    availabilityResolved: Boolean(variant),
    available: variant?.availableForSale ?? null,
    url: variantNumber ? `${card.url}?variant=${variantNumber}` : card.url,
    href: variantNumber ? `${card.href}?variant=${variantNumber}` : card.href,
  };
}

function websiteNavigationActions(proposals, toolResults) {
  const liveProducts = toolResults.filter((result) => result.ok).flatMap((result) => {
    if (result.name === "get_live_commerce") return result.data.products || [];
    if (result.name === "discover_products") return (result.data.products || []).map((item) => item.commerce);
    return [];
  });
  const actions = new Map();
  const add = (label, target) => actions.set(target, { type: "navigate", label, target, payload: {} });
  for (const proposal of proposals || []) {
    if (proposal.type !== "navigate") continue;
    if (!proposal.productHandles?.length && proposal.target === BOOK_SESSION_PATH) {
      add("Book a Snooze Session", BOOK_SESSION_PATH);
    } else if (!proposal.productHandles?.length && proposal.target === SYSTEMS_PATH) {
      const mode = Object.hasOwn(SYSTEM_PATH_KEYS, proposal.motionKey) ? SYSTEM_PATH_KEYS[proposal.motionKey] : null;
      const size = normalizeSize(proposal.size);
      if (proposal.motionKey && !mode) continue;
      if (mode === "full_split" && size && !["king", "split king"].includes(size)) continue;
      if (mode === "split_head" && size && !/^(?:split head )?(?:queen|king|california king)$/.test(size)) continue;
      add("View Sleep Systems", mode ? `${SYSTEMS_PATH}?system=${mode}#sleep-systems` : SYSTEMS_PATH);
    } else if (proposal.productHandles?.length === 1) {
      const handle = proposal.productHandles[0];
      const product = [...liveProducts].reverse().find((item) => (
        item?.handle === handle &&
        (!item.activeSize || item.exactVariantResolved) &&
        (!proposal.size || normalizeSize(item.activeSize) === normalizeSize(proposal.size))
      ));
      if (product) add(`View ${product.title}`, product.url);
    }
  }
  return [...actions.values()];
}

module.exports = {
  MOTION_PREFERENCES,
  WEBSITE_ASSESSMENT_INSTRUCTIONS,
  WEBSITE_ASSESSMENT_KEYS,
  getWebsiteMattressCatalog,
  getWebsiteProductFacts,
  isWebsiteAssessmentSource,
  websiteManifest,
  websiteNavigationActions,
  websiteProductCard,
};
