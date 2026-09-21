const SHOWROOM_COMMAND_VERSION = "showroom-command.v1";
const SHOWROOM_COMMAND_AUTHORITY = "typed_showroom_action";
const MAX_BROWSE_OFFSET = 100;

const COMMAND_TYPES = new Set([
  "find_rewards",
  "analyze_cart",
  "browse_products",
  "compare_products",
  "motion_base_features",
  "product_sizes",
  "policy_fact",
  "price_quote",
]);

const POLICY_TOPICS = new Set(["returns", "delivery", "warranty", "financing"]);
const STATION_COMMAND_TYPES = new Set([
  "find_rewards",
  "analyze_cart",
  "browse_products",
  "compare_products",
  "motion_base_features",
]);

function clean(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function manifestProducts(manifest) {
  return Array.isArray(manifest?.products) ? manifest.products : [];
}

function manifestHandleSet(manifest) {
  return new Set(
    manifestProducts(manifest)
      .filter((product) => product?.active !== false)
      .map((product) => clean(product?.handle).toLowerCase())
      .filter(Boolean)
  );
}

function allowedSizeMap(manifest) {
  const sizes = Array.isArray(manifest?.assessmentSchema?.sizes)
    ? manifest.assessmentSchema.sizes
    : [];
  const aliases = isPlainObject(manifest?.assessmentSchema?.aliases?.size)
    ? manifest.assessmentSchema.aliases.size
    : {};
  const map = new Map();
  for (const size of sizes) {
    const label = clean(size);
    if (label) map.set(label.toLowerCase(), label);
  }
  for (const [alias, label] of Object.entries(aliases)) {
    const normalizedLabel = map.get(clean(label).toLowerCase());
    if (clean(alias) && normalizedLabel) map.set(clean(alias).toLowerCase(), normalizedLabel);
  }
  return map;
}

function invalid(validationReason, commandType = null) {
  return {
    ok: false,
    code: "E_INVALID_SHOWROOM_COMMAND",
    validationReason,
    commandType,
    commandVersion: SHOWROOM_COMMAND_VERSION,
    semanticAuthority: SHOWROOM_COMMAND_AUTHORITY,
    plannerBypassed: true,
    fallbackUsed: false,
    productHandleCount: 0,
  };
}

function rejectUnknownPayloadKeys(payload, allowedKeys, type) {
  const unknown = Object.keys(payload).filter((key) => !allowedKeys.has(key));
  return unknown.length ? invalid(`unexpected_payload_field:${unknown[0]}`, type) : null;
}

function validateShowroomCommand(command, { manifest } = {}) {
  if (!isPlainObject(command)) return invalid("command_must_be_object");

  const version = clean(command.version);
  const type = clean(command.type).toLowerCase();
  if (version !== SHOWROOM_COMMAND_VERSION) return invalid("unsupported_version", type || null);
  if (!COMMAND_TYPES.has(type)) return invalid("unsupported_type", type || null);
  if (!isPlainObject(command.payload)) return invalid("payload_must_be_object", type);

  const payload = command.payload;
  const handles = manifestHandleSet(manifest);
  const normalizeHandle = (value) => clean(value).toLowerCase();
  let normalizedPayload = {};

  if (["find_rewards", "analyze_cart", "motion_base_features"].includes(type)) {
    const unknown = rejectUnknownPayloadKeys(payload, new Set(), type);
    if (unknown) return unknown;
  }

  if (type === "browse_products") {
    const unknown = rejectUnknownPayloadKeys(payload, new Set(["offset"]), type);
    if (unknown) return unknown;
    const offset = Number(payload.offset);
    if (!Number.isInteger(offset) || offset < 0 || offset > MAX_BROWSE_OFFSET) {
      return invalid("invalid_browse_offset", type);
    }
    normalizedPayload = { offset };
  }

  if (type === "compare_products") {
    const unknown = rejectUnknownPayloadKeys(payload, new Set(["productHandles"]), type);
    if (unknown) return unknown;
    if (!Array.isArray(payload.productHandles)) return invalid("product_handles_must_be_array", type);
    const productHandles = payload.productHandles.map(normalizeHandle).filter(Boolean);
    if (![0, 2].includes(productHandles.length)) return invalid("compare_requires_zero_or_two_handles", type);
    if (new Set(productHandles).size !== productHandles.length) return invalid("duplicate_product_handle", type);
    if (productHandles.some((handle) => !handles.has(handle))) return invalid("unknown_product_handle", type);
    normalizedPayload = { productHandles };
  }

  if (type === "product_sizes") {
    const unknown = rejectUnknownPayloadKeys(payload, new Set(["productHandle"]), type);
    if (unknown) return unknown;
    const productHandle = normalizeHandle(payload.productHandle);
    if (!productHandle || !handles.has(productHandle)) return invalid("unknown_product_handle", type);
    normalizedPayload = { productHandle };
  }

  if (type === "policy_fact") {
    const unknown = rejectUnknownPayloadKeys(payload, new Set(["topic"]), type);
    if (unknown) return unknown;
    const topic = clean(payload.topic).toLowerCase();
    if (!POLICY_TOPICS.has(topic)) return invalid("unsupported_policy_topic", type);
    normalizedPayload = { topic };
  }

  if (type === "price_quote") {
    const unknown = rejectUnknownPayloadKeys(payload, new Set(["productHandle", "size"]), type);
    if (unknown) return unknown;
    const productHandle = normalizeHandle(payload.productHandle);
    if (productHandle && !handles.has(productHandle)) return invalid("unknown_product_handle", type);
    const sizes = allowedSizeMap(manifest);
    const rawSize = clean(payload.size);
    const size = rawSize ? sizes.get(rawSize.toLowerCase()) : null;
    if (rawSize && !size) return invalid("unsupported_size", type);
    if (!productHandle && !size) return invalid("price_quote_requires_product_or_size", type);
    normalizedPayload = {
      ...(productHandle ? { productHandle } : {}),
      ...(size ? { size } : {}),
    };
  }

  const normalizedCommand = { version: SHOWROOM_COMMAND_VERSION, type, payload: normalizedPayload };
  const productHandleCount = type === "compare_products"
    ? normalizedPayload.productHandles.length
    : normalizedPayload.productHandle
      ? 1
      : 0;
  return {
    ok: true,
    command: normalizedCommand,
    commandVersion: SHOWROOM_COMMAND_VERSION,
    commandType: type,
    semanticAuthority: SHOWROOM_COMMAND_AUTHORITY,
    executionPath: STATION_COMMAND_TYPES.has(type) ? "station_domain_service" : "advisor_truth_lane",
    plannerBypassed: true,
    fallbackUsed: false,
    productHandleCount,
  };
}

function productReferences(handles) {
  return handles.map((handle, index) => ({
    handle,
    role: index === 0 ? "subject" : "comparison",
    source: SHOWROOM_COMMAND_AUTHORITY,
  }));
}

function buildShowroomCommandDecision(command) {
  const type = clean(command?.type).toLowerCase();
  const payload = isPlainObject(command?.payload) ? command.payload : {};
  const comparisonProductHandles = type === "compare_products" ? payload.productHandles || [] : [];
  const subjectHandles = comparisonProductHandles.length
    ? comparisonProductHandles
    : payload.productHandle
      ? [payload.productHandle]
      : [];
  const topic = type === "policy_fact" ? payload.topic : null;
  const primaryTask = {
    find_rewards: "rewards_explanation",
    analyze_cart: "cart_review",
    browse_products: "browse_products",
    compare_products: "product_comparison",
    motion_base_features: "base_education",
    product_sizes: "product_sizes",
    policy_fact: topic === "warranty" ? "warranty_explanation" : "compound_fact_answer",
    price_quote: "price_quote",
  }[type] || null;
  const requestedFacts = {
    find_rewards: ["rewards"],
    analyze_cart: ["cart"],
    product_sizes: ["product_sizes"],
    policy_fact: topic ? [topic] : [],
    price_quote: ["price"],
  }[type] || [];

  return {
    version: SHOWROOM_COMMAND_VERSION,
    authority: SHOWROOM_COMMAND_AUTHORITY,
    primaryTask,
    shopperGoal: type,
    modality: "asserted",
    acts: [],
    productReferences: productReferences(subjectHandles),
    comparisonProductHandles,
    requestedFacts,
    knownFacts: payload.size ? { size: payload.size } : {},
    answerRequirements: [],
    requiresComposition: false,
    confidence: 1,
    validation: { source: SHOWROOM_COMMAND_AUTHORITY, commandType: type },
  };
}

module.exports = {
  COMMAND_TYPES,
  MAX_BROWSE_OFFSET,
  POLICY_TOPICS,
  SHOWROOM_COMMAND_AUTHORITY,
  SHOWROOM_COMMAND_VERSION,
  STATION_COMMAND_TYPES,
  buildShowroomCommandDecision,
  validateShowroomCommand,
};
