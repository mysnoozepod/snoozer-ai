// services/recommendations.js
//
// DETERMINISTIC Recommendations service (backend)
//
// Purpose (now sane):
//   - Convert assessment signals → deterministic product handles (NOT searches).
//   - Never call Shopify Storefront search here.
//   - In POD mode, return nothing (pod fixture context is authoritative).
//
// Exports:
//   - getRecommendations(shopperId, opts?) -> { products: Array, hints: Array<string>, source: string }
//
// Env:
//   - AWS_REGION               default "us-east-1"
//   - ASSESSMENT_TABLE         DynamoDB table where /assessment saves shopper answers
//   - RECS_LIMIT               number of handles to return (default 4)

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "us-east-1";
const RESULTS_TABLE = process.env.ASSESSMENT_TABLE || "";
const RECS_LIMIT = Math.max(1, Number(process.env.RECS_LIMIT || 4));

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

// Canonical handles (single source of truth for deterministic mapping)
const HANDLES = {
  mattresses: {
    dualComfort: "12-dual-comfort-hybrid",
    hybrid14: "14-hybrid",
    allFoam12: "12-all-foam-mattress",
    allFoam10: "10-all-foam-mattress",
  },
  bases: {
    adjustable: "premium-motion-adjustable-base",
    storage: "storage-base",
    platform: "platform-base",
  },
};

function log(event, data) {
  try {
    console.log(
      JSON.stringify({
        source: "recs",
        event,
        ts: new Date().toISOString(),
        ...(data || {}),
      })
    );
  } catch {
    console.log("[recs]", event, data || {});
  }
}

async function getAssessment(shopperId) {
  if (!RESULTS_TABLE || !shopperId) return null;
  try {
    const out = await ddbDoc.send(
      new GetCommand({ TableName: RESULTS_TABLE, Key: { shopperId } })
    );
    return out.Item || null;
  } catch (e) {
    log("ddb.get.error", { shopperId, msg: e.message });
    return null;
  }
}

function pick(arr = []) {
  return Array.isArray(arr) ? arr : [];
}

function firstTruthy(...vals) {
  for (const v of vals) if (v) return v;
  return null;
}

function deriveSignals(answers = {}) {
  const pos = String(firstTruthy(answers.sleepPosition, answers.position, "")).toLowerCase();
  const temp = String(firstTruthy(answers.temperature, answers.sleepsHot, "")).toLowerCase();

  const hot =
    answers.sleepsHot === true ||
    answers.temperatureSensitive === true ||
    /hot|warm|heat|sweat/.test(temp);

  const pains = pick(answers.painPoints)
    .map((s) => String(s).toLowerCase())
    .join(",");

  const hasBackPain = /lower|lumbar|back/.test(pains);

  // "wants motion control" is a better framing than "motion"
  const wantsMotionControl =
    /partner|motion|light/.test(String(answers.sensitivity || "").toLowerCase()) ||
    /motion/.test(pains) ||
    String(firstTruthy(answers.shareBed, answers.partner, "")).toLowerCase().includes("yes");

  const budgetMax = Number(answers.budgetMax || answers.budget || 0) || null;

  return { pos, hot, wantsMotionControl, hasBackPain, budgetMax };
}

function buildHints(sig) {
  const hints = [];

  if (sig.pos.includes("side")) hints.push("Side sleeper: prioritize pressure relief");
  if (sig.pos.includes("back")) hints.push("Back sleeper: prioritize lumbar support");
  if (sig.pos.includes("stomach")) hints.push("Stomach sleeper: prioritize firmer support");

  if (sig.hasBackPain) hints.push("Lower back: steady support");
  if (sig.hot) hints.push("Sleeps hot: cooling focus");
  if (sig.wantsMotionControl) hints.push("Share bed: motion control");

  if (sig.budgetMax) hints.push(`Budget: under $${sig.budgetMax}`);

  return hints.slice(0, 6);
}

/**
 * Deterministic mattress handle choice:
 * - Back/stomach or back pain -> Hybrid14 (support)
 * - Side -> AllFoam12 (pressure relief)
 * - Else -> Hybrid14 default
 *
 * Cooling/motion does NOT change the handle here (that belongs in pod/base guidance),
 * but it can affect ordering (Dual Comfort appears earlier for motion/cooling shoppers).
 */
function pickPrimaryMattress(sig) {
  if (sig.pos.includes("stomach")) return HANDLES.mattresses.hybrid14;
  if (sig.pos.includes("back")) return HANDLES.mattresses.hybrid14;
  if (sig.hasBackPain) return HANDLES.mattresses.hybrid14;
  if (sig.pos.includes("side")) return HANDLES.mattresses.allFoam12;
  return HANDLES.mattresses.hybrid14;
}

function buildDeterministicHandles(sig) {
  const primary = pickPrimaryMattress(sig);

  // Secondary logic:
  // - If motion control matters, Dual Comfort is a strong second option.
  // - If cooling matters, Dual Comfort often markets cooling better than all-foam.
  // - Otherwise, provide the opposite feel family as a comparison.
  const candidates = [];

  // Always start with primary
  candidates.push(primary);

  // Motion/cooling bias
  if (sig.wantsMotionControl || sig.hot) candidates.push(HANDLES.mattresses.dualComfort);

  // Comparison mattress
  if (primary === HANDLES.mattresses.hybrid14) {
    candidates.push(HANDLES.mattresses.allFoam12);
    candidates.push(HANDLES.mattresses.allFoam10);
  } else {
    candidates.push(HANDLES.mattresses.hybrid14);
    candidates.push(HANDLES.mattresses.dualComfort);
  }

  // Dedupe while keeping order
  const out = [];
  const seen = new Set();
  for (const h of candidates) {
    if (!h || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }

  return out;
}

function asProduct(handle, rank) {
  // Keep this intentionally lightweight: handle + title only.
  // No prices, no images, no Shopify fetch. That belongs elsewhere.
  const title =
    handle === HANDLES.mattresses.dualComfort
      ? '12" Dual Comfort Hybrid'
      : handle === HANDLES.mattresses.hybrid14
      ? '14" Hybrid'
      : handle === HANDLES.mattresses.allFoam12
      ? '12" All Foam Mattress'
      : handle === HANDLES.mattresses.allFoam10
      ? '10" All Foam Mattress'
      : handle;

  return { handle, title, rank };
}

/**
 * getRecommendations(shopperId, opts)
 * opts:
 *   - limit?: number
 *   - mode?: string  (if "pod" -> return empty; pod fixtures are authoritative)
 */
async function getRecommendations(shopperId = "guest", opts = {}) {
  const mode = String(opts.mode || "").toLowerCase();
  const limit = Math.max(1, Number(opts.limit || RECS_LIMIT));

  // POD MODE: DO NOT generate recs. The pod context should drive everything.
  if (mode === "pod") {
    log("recs.skip", { shopperId, mode: "pod" });
    return { products: [], hints: [], source: "pod_mode_skip" };
  }

  const assess = await getAssessment(shopperId);
  const answers = assess?.answers || assess || {};
  const sig = deriveSignals(answers);

  const hints = buildHints(sig);

  const handles = buildDeterministicHandles(sig).slice(0, limit);
  const products = handles.map((h, i) => asProduct(h, i + 1));

  log("recs.deterministic", {
    shopperId,
    mode: mode || "unknown",
    handles,
    hintsCount: hints.length,
  });

  return { products, hints, source: "assessment_deterministic" };
}

// Deprecated alias kept for compatibility (still deterministic)
async function getSeedRecommendations(shopperId) {
  const assess = await getAssessment(shopperId);
  const answers = assess?.answers || assess || {};
  const sig = deriveSignals(answers);

  const tags = [];
  if (sig.pos.includes("side")) tags.push("firmness:medium-soft");
  if (sig.pos.includes("back") || sig.hasBackPain) tags.push("support:lumbar");
  if (sig.hot) tags.push("cooling:gels");
  if (sig.wantsMotionControl) tags.push("motion:isolation");

  return { products: [], hints: tags.slice(0, 6), source: "assessment" };
}

module.exports = {
  getRecommendations,
  getSeedRecommendations,
};