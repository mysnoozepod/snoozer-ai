const { loadShowroomManifest } = require("./showroomManifest");

function cleanText(value) {
  return String(value == null ? "" : value)
    .replace(/(\d+)\s*"/g, "$1-inch")
    .replace(/\s+/g, " ")
    .trim();
}

function joinReplyParts(parts = []) {
  return parts
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
}

function getManifestProductMap() {
  const manifest = loadShowroomManifest();
  const products = Array.isArray(manifest?.products) ? manifest.products : [];
  return new Map(products.map((product) => [String(product.handle || "").trim(), product]));
}

function getProductMeta(handle = "") {
  return getManifestProductMap().get(String(handle || "").trim()) || null;
}

function inferCatalogType(handle = "", fallbackType = "") {
  const explicit = cleanText(fallbackType).toLowerCase();
  if (explicit) return explicit;

  const manifestProduct = getProductMeta(handle);
  const manifestType = cleanText(manifestProduct?.catalogType).toLowerCase();
  if (manifestType) return manifestType;

  const normalizedHandle = cleanText(handle).toLowerCase();
  if (
    normalizedHandle.includes("base") ||
    normalizedHandle.includes("foundation") ||
    normalizedHandle.includes("frame")
  ) {
    return "base";
  }

  return "mattress";
}

function formatCustomerProductTitle({
  handle = "",
  title = "",
  catalogType = "",
} = {}) {
  const manifestProduct = getProductMeta(handle);
  const baseTitle =
    cleanText(title) ||
    cleanText(manifestProduct?.title) ||
    cleanText(handle);
  const resolvedType = inferCatalogType(handle, catalogType);

  if (resolvedType === "mattress" && !/\bmattress$/i.test(baseTitle)) {
    return `${baseTitle} mattress`;
  }

  return baseTitle;
}

function formatCurrency(amount, currencyCode = "USD") {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return "";

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cleanText(currencyCode) || "USD",
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `$${Math.round(numeric)}`;
  }
}

function formatChoiceList(items = []) {
  const cleanItems = items.map(cleanText).filter(Boolean);
  if (!cleanItems.length) return "";
  if (cleanItems.length === 1) return cleanItems[0];
  if (cleanItems.length === 2) return `${cleanItems[0]} or ${cleanItems[1]}`;
  return `${cleanItems.slice(0, -1).join(", ")}, or ${cleanItems[cleanItems.length - 1]}`;
}

function buildNoGuessReply(topic = "detail") {
  switch (String(topic || "").trim()) {
    case "return_policy":
    case "returns":
      return "I do not have the full approved return policy detail loaded yet, so I will not guess the terms. I can still help you get human support or continue with your recommendation.";
    case "delivery":
      return "I do not want to guess on delivery timing or fees. I can show you the delivery option available at checkout, or bring in a team member to confirm the details before you buy.";
    case "warranty":
      return "I do not have the full approved warranty detail loaded yet, so I will not guess the terms. I can still help with product fit or get you to human support.";
    case "financing":
      return "I do not want to guess on financing terms. The available options are shown at checkout, or I can bring in a team member if you want confirmation before you buy.";
    case "pricing":
      return "I do not have that approved pricing detail loaded yet, so I will not guess.";
    default:
      return "I do not have that approved detail loaded yet, so I will not guess.";
  }
}

function buildFallbackReply() {
  return "I can help with mattress fit, pricing, delivery, returns, Snooze Codes, or booking a Snooze Session. Tell me which lane you want to narrow first, and I will keep it simple.";
}

function buildMissingRecommendationReply() {
  return "I can recommend a setup once I have your assessment, or we can narrow it right now with a few basics like size, sleep position, firmness, whether you share the bed, and whether you want a base. The fastest route is the Snooze Assessment if you want me to do the sorting for you.";
}

function buildClarificationReply(decision = {}) {
  const slots = decision?.slots && typeof decision.slots === "object" ? decision.slots : {};
  const missingSlots = Array.isArray(decision?.missingSlots) ? decision.missingSlots : [];
  const candidateHandles = Array.isArray(slots.candidateProductHandles)
    ? slots.candidateProductHandles
    : [];
  const candidateTitles = candidateHandles
    .map((handle) =>
      formatCustomerProductTitle({
        handle,
        title: getProductMeta(handle)?.title || handle,
      })
    )
    .filter(Boolean);

  if (missingSlots.includes("baseHandle") && ["mattress_plus_base", "full_pod"].includes(slots.scope)) {
    const baseChoices =
      cleanText(slots.size) === "Queen"
        ? ["Platform Base", "Standard Motion", "Half Split Motion"]
        : cleanText(slots.size) === "King"
          ? ["Platform Base", "Standard Motion", "Half Split Motion", "Full Split Motion"]
          : ["Platform Base", "Standard Motion", "Half Split Motion", "Full Split Motion"];
    return `Which base do you want with it - ${formatChoiceList(baseChoices)}?`;
  }

  if (missingSlots.includes("productHandle")) {
    if (candidateTitles.length >= 2) {
      return `Which mattress do you mean - ${formatChoiceList(candidateTitles.slice(0, 3))}?`;
    }
    return "Which mattress do you mean - the 14-inch Hybrid, 12-inch Dual Comfort Hybrid, or 12-inch All Foam?";
  }

  if (missingSlots.includes("size")) {
    return "What size should I price - Queen, King, Split King, or another size?";
  }

  if (missingSlots.includes("policyTopic")) {
    return "Do you want the return policy, delivery, financing, warranty, or privacy details?";
  }

  return "Which detail do you want to narrow - mattress fit, pricing, delivery, returns, or booking a Snooze Session?";
}

function buildPolicyLaneLead({ query = "", policyTopic = "" } = {}) {
  const normalizedQuery = cleanText(query).toLowerCase();
  const normalizedTopic = cleanText(policyTopic).toLowerCase();
  if (!normalizedTopic || (normalizedTopic !== "return_policy" && normalizedTopic !== "returns")) {
    return "";
  }

  if (
    normalizedQuery.includes("return") ||
    normalizedQuery.includes("dont like") ||
    normalizedQuery.includes("don't like")
  ) {
    return "You can return or exchange your mattress within the 100-night sleep trial.";
  }

  if (
    normalizedQuery.includes("sleep trial") ||
    normalizedQuery.includes("comfort trial") ||
    normalizedQuery.includes("mattress trial") ||
    normalizedQuery.includes("trial")
  ) {
    return "Mattress purchases are covered by the sleep trial.";
  }

  return "The return policy applies to mattress trial questions.";
}

function presentCommerceResponse({ decision = {}, resolution = {} } = {}) {
  const slots = decision?.slots && typeof decision.slots === "object" ? decision.slots : {};
  const products = Array.isArray(resolution?.products) ? resolution.products : [];
  const mattressEntry = products[0] || null;
  const baseEntry = products[1] || null;
  const sizeLabel = cleanText(resolution?.size || slots.size || "");
  const isBaseOnly = cleanText(slots.scope) === "base_only";

  if (cleanText(resolution?.answerType) === "clarification") {
    return cleanText(resolution?.reply);
  }

  if (cleanText(resolution?.reason) === "availability") {
    const primaryEntry = mattressEntry || baseEntry || null;
    const name = formatCustomerProductTitle({
      handle: primaryEntry?.handle || "",
      title: primaryEntry?.title || "",
      catalogType: isBaseOnly ? "base" : "mattress",
    });
    if (primaryEntry?.available === true) {
      return `Yes - the ${joinReplyParts([sizeLabel, name])} is available.`;
    }
    if (primaryEntry?.available === false) {
      return `I do not have that exact ${joinReplyParts([sizeLabel, name])} available right now.`;
    }
    return buildNoGuessReply("pricing");
  }

  if (cleanText(resolution?.reason) === "bundle_price_resolved") {
    const mattressName = formatCustomerProductTitle({
      handle: mattressEntry?.handle || resolution?.resolvedProductHandle || "",
      title: mattressEntry?.title || "",
      catalogType: "mattress",
    });
    const baseName = formatCustomerProductTitle({
      handle: baseEntry?.handle || resolution?.resolvedBaseHandle || "",
      title: baseEntry?.title || "",
      catalogType: "base",
    });
    const total = formatCurrency(
      resolution?.itemizedTotal,
      mattressEntry?.currencyCode || baseEntry?.currencyCode || "USD"
    );
    const mattressPrice = formatCurrency(mattressEntry?.price, mattressEntry?.currencyCode || "USD");
    const basePrice = formatCurrency(baseEntry?.price, baseEntry?.currencyCode || "USD");
    const intro =
      cleanText(slots.scope) === "full_pod"
        ? `Your ${sizeLabel} SnoozePod setup comes to ${total} before taxes, delivery, or any active discounts.`
        : `Your ${joinReplyParts([sizeLabel, mattressName])} with the ${baseName} comes to ${total} before taxes, delivery, or any active discounts.`;
    const breakdown =
      cleanText(slots.scope) === "full_pod"
        ? `* ${mattressName}: ${mattressPrice}\n* ${baseName}: ${basePrice}`
        : `* Mattress: ${mattressPrice}\n* Base: ${basePrice}`;

    return `${intro}\n\nHere's the breakdown:\n\n${breakdown}`;
  }

  if (cleanText(resolution?.reason) === "single_price_resolved") {
    const primaryEntry = mattressEntry || baseEntry || null;
    const name = formatCustomerProductTitle({
      handle: primaryEntry?.handle || resolution?.resolvedProductHandle || resolution?.resolvedBaseHandle || "",
      title: primaryEntry?.title || "",
      catalogType: isBaseOnly ? "base" : "mattress",
    });
    const price = formatCurrency(primaryEntry?.price, primaryEntry?.currencyCode || "USD");
    return `The ${joinReplyParts([sizeLabel, name])} is ${price} before taxes, delivery, or any active discounts.`;
  }

  if (cleanText(resolution?.reason) === "cheapest_scope_unclear") {
    return "Do you want the cheapest mattress-only option, or the cheapest full setup with a base?";
  }

  return cleanText(resolution?.reply) || buildNoGuessReply("pricing");
}

module.exports = {
  buildClarificationReply,
  buildFallbackReply,
  buildMissingRecommendationReply,
  buildNoGuessReply,
  buildPolicyLaneLead,
  cleanText,
  formatChoiceList,
  formatCurrency,
  formatCustomerProductTitle,
  joinReplyParts,
  presentCommerceResponse,
};
