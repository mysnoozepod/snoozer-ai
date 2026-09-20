const advisorKnowledgeRollback = require("../data/ask-snoozer-advisor-knowledge.v1.json");
const packagedFaqs = require("../faqs.json");
const { normalizePolicyDocument, safeKnowledgeLines } = require("./askSnoozerTypedTruth");
const {
  KNOWLEDGE_BUCKET,
  getObjectJson,
  getObjectText,
} = require("./s3TextLoader");

const ADVISOR_KNOWLEDGE_KEY =
  process.env.SNOOZER_ADVISOR_KNOWLEDGE_KEY ||
  "advisor/mysnoozepod-selling-methodology-v1.json";

const TRUSTED_ADVISOR_PRODUCT_KEYS = Object.freeze({
  "10-all-foam-mattress": "products/mattress/10-all-foam-mattress.md",
  "12-all-foam-mattress": "products/mattress/12-all-foam-mattress.md",
  "12-dual-comfort-hybrid": "products/mattress/12-dual-comfort-hybrid.md",
  "14-hybrid": "products/mattress/14-hybrid.md",
});

function compactAdvisorLines(raw = "", { limit = 10, include = [] } = {}) {
  return safeKnowledgeLines(raw, { limit, include });
}

async function loadTrustedAdvisorFactPack({
  productHandles = [],
  taskType = "",
  query = "",
  requestedFacts = [],
} = {}) {
  let advisorKnowledge = advisorKnowledgeRollback;
  try {
    const remote = await getObjectJson(KNOWLEDGE_BUCKET, ADVISOR_KNOWLEDGE_KEY);
    if (remote.value && typeof remote.value === "object") advisorKnowledge = remote.value;
  } catch {
    // The packaged copy is the safe rollback when the remote knowledge object is unavailable.
  }

  const handles = [
    ...new Set((Array.isArray(productHandles) ? productHandles : []).filter(Boolean)),
  ].slice(0, 3);
  const productFacts = [];
  for (const handle of handles) {
    const key = TRUSTED_ADVISOR_PRODUCT_KEYS[handle];
    if (!key) continue;
    try {
      const loaded = await getObjectText(KNOWLEDGE_BUCKET, key);
      if (loaded.value) {
        productFacts.push({
          handle,
          status: "verified_fact",
          facts: compactAdvisorLines(loaded.value, {
            limit: 7,
            include: [
              "feel",
              "pressure",
              "support",
              "foam",
              "coil",
              "airflow",
              "motion",
              "certipur",
              "care",
              "ideal",
              "split comfort",
            ],
          }),
        });
      }
    } catch {
      // Missing optional product knowledge remains UNKNOWN in the caller's fact pack.
    }
  }

  const requested = new Set(
    (Array.isArray(requestedFacts) ? requestedFacts : []).map((fact) =>
      String(fact).toLowerCase()
    )
  );
  const policyFacts = [];
  if (
    requested.has("warranty") ||
    taskType === "warranty_explanation" ||
    /\bwarrant|coverage|sagging?\b/i.test(query)
  ) {
    try {
      const loaded = await getObjectText(KNOWLEDGE_BUCKET, "faq/warranty.md");
      if (loaded.value) {
        policyFacts.push(normalizePolicyDocument({ topic: "warranty", raw: loaded.value }));
      }
    } catch {
      // An unavailable policy object must not become an invented policy term.
    }
    if (!policyFacts.length) {
      const packagedWarranty = String(packagedFaqs?.warranty || "").trim();
      if (packagedWarranty) {
        policyFacts.push(
          normalizePolicyDocument({ topic: "warranty", fallback: packagedWarranty })
        );
      }
    }
  }

  const supplementalPolicies = [
    {
      topic: "delivery",
      requested: requested.has("delivery") || /\bdeliver(?:y|ies|ed)\b/i.test(query),
      keys: ["policies/delivery-policy.md", "faq/delivery.md"],
      include: ["delivery", "business day", "schedule", "window", "availability", "zip"],
      packagedKey: "shipping_time",
    },
    {
      topic: "returns",
      requested: requested.has("returns") || /\breturn|exchange|sleep trial\b/i.test(query),
      keys: ["policies/returns.md", "faq/returns.md"],
      include: ["return", "exchange", "sleep trial", "night", "final sale"],
      packagedKey: "return_policy",
    },
    {
      topic: "financing",
      requested: requested.has("financing") || /\bfinanc|payment plan\b/i.test(query),
      keys: ["faq/financing.md"],
      include: ["financing", "payment", "affirm", "credit"],
      packagedKey: "payment_options",
    },
  ];

  for (const policy of supplementalPolicies.filter((item) => item.requested)) {
    let loadedPolicy = false;
    for (const key of policy.keys) {
      try {
        const loaded = await getObjectText(KNOWLEDGE_BUCKET, key);
        if (!loaded.value) continue;
        const typedFact = normalizePolicyDocument({ topic: policy.topic, raw: loaded.value });
        if (!typedFact.known) continue;
        policyFacts.push(typedFact);
        loadedPolicy = true;
        break;
      } catch {
        // Try the next approved key, then the packaged rollback fact.
      }
    }
    if (!loadedPolicy) {
      const packaged = String(packagedFaqs?.[policy.packagedKey] || "").trim();
      if (packaged) {
        policyFacts.push(normalizePolicyDocument({ topic: policy.topic, fallback: packaged }));
      }
    }
  }

  return {
    version: advisorKnowledge.version || null,
    status: "advisor_interpretation",
    principles: (advisorKnowledge.principles || []).slice(0, 4),
    topicGuidance: (() => {
      const topics = advisorKnowledge.topics || {};
      const keys =
        taskType === "durability_objection" || /\bsag|durab|wear\b/i.test(query)
          ? ["durability"]
          : taskType === "base_education" ||
              taskType === "value_judgment" ||
              taskType === "value_objection"
            ? ["adjustable_base_value"]
            : taskType === "confusion_recovery"
              ? ["confusion"]
              : taskType === "compound_product_base" || /\bpartner|split\b/i.test(query)
                ? ["couples_and_split"]
                : ["feel"];
      return Object.fromEntries(
        keys.filter((key) => topics[key] != null).map((key) => [key, topics[key]])
      );
    })(),
    productFacts,
    policyFacts,
  };
}

module.exports = { loadTrustedAdvisorFactPack };
