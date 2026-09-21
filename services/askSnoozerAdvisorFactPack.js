const advisorKnowledgeRollback = require("../data/ask-snoozer-advisor-knowledge.v1.json");
const {
  normalizeDurabilityFacts,
  safeKnowledgeLines,
} = require("./askSnoozerTypedTruth");
const { resolveAskSnoozerPolicyTruth } = require("./askSnoozerPolicy");
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
  identity = null,
  rewardsService = null,
  resolvePolicyTruth = resolveAskSnoozerPolicyTruth,
  advisorKnowledgeOverride = null,
  productFactsOverride = null,
} = {}) {
  let advisorKnowledge = advisorKnowledgeOverride || advisorKnowledgeRollback;
  if (!advisorKnowledgeOverride) {
    try {
      const remote = await getObjectJson(KNOWLEDGE_BUCKET, ADVISOR_KNOWLEDGE_KEY);
      if (remote.value && typeof remote.value === "object") advisorKnowledge = remote.value;
    } catch {
      // The packaged copy is the safe rollback when the remote knowledge object is unavailable.
    }
  }

  const handles = [
    ...new Set((Array.isArray(productHandles) ? productHandles : []).filter(Boolean)),
  ].slice(0, 3);
  const productFacts = Array.isArray(productFactsOverride) ? productFactsOverride : [];
  for (const handle of Array.isArray(productFactsOverride) ? [] : handles) {
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
  const policyTopics = ["delivery", "returns", "financing", "warranty"].filter((topic) =>
    requested.has(topic) ||
    (topic === "warranty" && (taskType === "warranty_explanation" || /\bwarrant|coverage\b/i.test(query))) ||
    (topic === "delivery" && /\bdeliver(?:y|ies|ed)|shipping?\b/i.test(query)) ||
    (topic === "returns" && /\breturn|exchange|sleep trial\b/i.test(query)) ||
    (topic === "financing" && /\bfinanc|payment plan\b/i.test(query))
  );
  for (const topic of policyTopics) {
    try {
      const fact = await resolvePolicyTruth({ topic, query });
      if (fact) policyFacts.push(fact);
    } catch {
      policyFacts.push({
        type: topic,
        topic,
        status: "unknown",
        known: false,
        sourceKind: "unknown",
        sourceKey: null,
        sourcePriority: 4,
        fallbackUsed: false,
        conflictDetected: false,
      });
    }
  }

  const durabilityRequested = requested.has("durability") || taskType === "durability_objection" || /\bsag|durab|wear|hold up|lifespan\b/i.test(query);
  const durabilityFacts = durabilityRequested
    ? [normalizeDurabilityFacts({
        productFacts: productFacts.flatMap((item) => item.facts || []),
        sourceKey: productFacts.map((item) => TRUSTED_ADVISOR_PRODUCT_KEYS[item.handle]).filter(Boolean).join(","),
      })]
    : [];

  let rewardFacts = null;
  const rewardsRequested = requested.has("rewards") || taskType === "rewards_explanation" || /\brewards?|sleep points?|badge|milestone|unlocked offer\b/i.test(query);
  if (rewardsRequested) {
    const canonicalIdentity = Boolean(
      identity?.profileId && identity?.shopperId &&
      identity?.isTemporary !== true &&
      String(identity.profileId).trim() === `shopper#${String(identity.shopperId).trim()}`
    );
    if (!canonicalIdentity) {
      rewardFacts = {
        type: "rewards",
        known: false,
        failureReason: "reward_identity_missing",
        sourceKind: "rewards_repository",
        sourceKey: null,
        sourcePriority: 1,
        fallbackUsed: false,
        summaryResolved: false,
        offersResolved: false,
        activeRulesVersion: null,
      };
    } else {
      try {
        const [summary, offers, rules] = await Promise.all([
          rewardsService?.getRewardSummary(identity),
          rewardsService?.getRewardOffers(identity),
          rewardsService?.activeRules(identity?.rewardsOptions || {}),
        ]);
        rewardFacts = {
          type: "rewards",
          known: Boolean(summary && rules),
          summary: summary || null,
          offers: Array.isArray(offers) ? offers : [],
          rules: rules ? {
            activeRulesVersion: rules.rulesVersion || summary?.activeRulesVersion || null,
            milestones: (rules.milestones || []).map((item) => ({
              id: item.id,
              label: item.displayName,
              pointAward: Number(item.pointAward || 0),
            })),
            badges: (rules.badges || []).map((item) => ({
              id: item.id,
              label: item.label,
              thresholdPoints: Number(item.thresholdPoints || 0),
            })),
            offers: (rules.offers || []).map((item) => ({
              id: item.id,
              label: item.displayLabel,
              requiredPoints: Number(item.requiredPoints || 0),
            })),
          } : null,
          sourceKind: "rewards_repository_and_active_rules",
          sourceKey: summary?.activeRulesVersion || rules?.rulesVersion || null,
          sourcePriority: 1,
          fallbackUsed: false,
          summaryResolved: Boolean(summary),
          offersResolved: Array.isArray(offers),
          activeRulesVersion: rules?.rulesVersion || summary?.activeRulesVersion || null,
        };
      } catch (error) {
        rewardFacts = {
          type: "rewards",
          known: false,
          failureReason: error?.code || "rewards_unavailable",
          sourceKind: "rewards_repository_and_active_rules",
          sourceKey: null,
          sourcePriority: 1,
          fallbackUsed: true,
          summaryResolved: false,
          offersResolved: false,
          activeRulesVersion: null,
        };
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
    durabilityFacts,
    rewardFacts,
  };
}

module.exports = { loadTrustedAdvisorFactPack };
