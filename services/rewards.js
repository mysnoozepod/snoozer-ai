// services/rewards.js
//
// Rewards service backed by DynamoDB (v3) + optional Shopify Admin coupon issuance.
// Routes that call this live in routes/rewardsRoutes.js (already compatible).
//
// Exposes:
//   - earnPoints({ shopperId, points, reason })
//   - getBalance(shopperId)                        // returns balance only
//   - getCatalog()                                 // static catalog stub (replace later)
//   - redeemReward({ shopperId, rewardId, idempotencyKey })  // mints coupon (if enabled) and debits points
//
// DynamoDB:
//   REWARDS_TABLE (env; default "rewards_balances")
//   PK: shopperId (S)
//   Attributes:
//     - shopperId: string
//     - balance: number
//     - updatedAt: ISO string
//     - history: Array<{
//         ts: ISO,
//         type: 'earn'|'redeem',
//         delta: number,
//         reason?: string,
//         rewardId?: string,
//         code?: string,
//         idem?: string
//       }>
//
// Shopify Admin (optional):
//   - Set REWARDS_ISSUE_COUPONS="1" to actually create discount codes.
//   - Map a reward to a specific price rule via reward.meta.priceRuleId,
//     otherwise REWARDS_DEFAULT_PRICE_RULE_ID is used.
//   - We retry code creation on conflicts because Shopify codes must be unique.
//
// Idempotency:
//   - Provide idempotencyKey and we’ll return the existing redemption if it was already created.
//   - Without idempotencyKey, repeated calls will happily mint more codes. Don’t do that.
//
// Compensating action:
//   - If coupon issuance fails after we debit points, we credit the points back immediately.
//

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  UpdateCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");

// Optional Shopify coupon issuance
let shopify;
try {
  shopify = require("./shopify"); // needs createDiscountCode + listPriceRules if you want to introspect
} catch {
  shopify = null;
}

const REGION = process.env.AWS_REGION || "us-east-1";
const REWARDS_TABLE = process.env.REWARDS_TABLE || "rewards_balances";
const ISSUE_COUPONS = ["1", "true", "yes"].includes(String(process.env.REWARDS_ISSUE_COUPONS || "0").toLowerCase());
const DEFAULT_PRICE_RULE_ID = process.env.REWARDS_DEFAULT_PRICE_RULE_ID || "";

// Initialize DDB DocClient
const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

// ─────────────────────────────────────────────────────────────────────────────
// Catalog (stub)
// ─────────────────────────────────────────────────────────────────────────────
const CATALOG = [
  { id: "5OFF",     title: "$5 off coupon",   amount: 500,  type: "coupon", meta: { value: 5, currency: "USD", priceRuleId: process.env.PRICE_RULE_5OFF || "" } },
  { id: "10OFF",    title: "$10 off coupon",  amount: 950,  type: "coupon", meta: { value: 10, currency: "USD", priceRuleId: process.env.PRICE_RULE_10OFF || "" } },
  { id: "FREESHIP", title: "Free shipping",   amount: 300,  type: "perk",   meta: { shipping: "standard",       priceRuleId: process.env.PRICE_RULE_FREESHIP || "" } },
];

function findReward(rewardId) {
  return CATALOG.find(r => r.id === rewardId) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function nowIso() { return new Date().toISOString(); }

async function getRaw(shopperId) {
  const out = await ddbDoc.send(new GetCommand({
    TableName: REWARDS_TABLE,
    Key: { shopperId },
  }));
  return out.Item || null;
}

function safeNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// Generate a code; we’ll still let Shopify be the final arbiter for uniqueness.
function genCode({ shopperId, rewardId }) {
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RWD-${rewardId}-${shopperId.slice(0, 6).toUpperCase()}-${rnd}`;
}

function pickPriceRuleId(reward) {
  const rule = reward?.meta?.priceRuleId || DEFAULT_PRICE_RULE_ID;
  return String(rule || "").trim();
}

async function issueCouponForReward({ shopperId, reward }) {
  if (!ISSUE_COUPONS || !shopify) {
    // Simulate issuance; frontend can still display code.
    return { code: genCode({ shopperId, rewardId: reward.id }), meta: reward.meta || {} };
  }

  const priceRuleId = pickPriceRuleId(reward);
  if (!priceRuleId) {
    const e = new Error("No price rule configured for reward");
    e.code = "NO_PRICE_RULE";
    throw e;
  }

  // Try up to 3 times in case of code conflict
  let lastErr;
  for (let i = 0; i < 3; i++) {
    const code = genCode({ shopperId, rewardId: reward.id });
    try {
      const created = await shopify.createDiscountCode({ code, priceRuleId });
      if (!created || !created.code) throw new Error("Discount creation returned no code");
      return { code: created.code, meta: reward.meta || {} };
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || "");
      if (!/already exists|has already been taken|duplicate/i.test(msg)) break;
    }
  }
  throw lastErr || new Error("Failed to create discount code");
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a shopper’s current balance.
 * @param {string} shopperId
 * @returns {{shopperId:string, balance:number, updatedAt?:string}}
 */
async function getBalance(shopperId) {
  if (!shopperId) throw new Error("shopperId required");
  const item = await getRaw(shopperId);
  return {
    shopperId,
    balance: safeNumber(item?.balance),
    updatedAt: item?.updatedAt || null,
  };
}

/**
 * Earn points (positive or negative deltas allowed; caller validates meaning).
 * @param {{shopperId:string, points:number, reason?:string}}
 * @returns {{shopperId:string, balance:number, delta:number, updatedAt:string}}
 */
async function earnPoints({ shopperId, points, reason }) {
  if (!shopperId) throw new Error("shopperId required");
  if (typeof points !== "number" || !Number.isFinite(points)) throw new Error("points must be a number");
  if (points === 0) return await getBalance(shopperId);

  const ts = nowIso();
  const isDebit = points < 0;
  const abs = Math.abs(points);

  const updateExpr = [
    "ADD #balance :delta",
    "SET #updatedAt = :ts, #history = list_append(if_not_exists(#history, :emptyList), :entry)"
  ].join(" ");

  const cmd = new UpdateCommand({
    TableName: REWARDS_TABLE,
    Key: { shopperId },
    UpdateExpression: updateExpr,
    ExpressionAttributeNames: {
      "#balance": "balance",
      "#updatedAt": "updatedAt",
      "#history": "history",
    },
    ExpressionAttributeValues: {
      ":delta": points,
      ":ts": ts,
      ":emptyList": [],
      ":entry": [{
        ts,
        type: "earn",
        delta: points,
        reason: reason || null,
      }],
      ...(isDebit ? { ":need": abs } : {}),
    },
    // Guard debits so balance never goes negative; allow credits unconditionally
    ConditionExpression: isDebit ? "(attribute_exists(#balance) AND #balance >= :need)" : undefined,
    ReturnValues: "ALL_NEW",
  });

  try {
    const out = await ddbDoc.send(cmd);
    return {
      shopperId,
      balance: safeNumber(out.Attributes?.balance),
      delta: points,
      updatedAt: out.Attributes?.updatedAt || ts,
    };
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      const bal = await getBalance(shopperId);
      const e = new Error("Insufficient points to debit");
      e.code = "INSUFFICIENT_POINTS";
      e.balance = bal.balance;
      throw e;
    }
    throw err;
  }
}

/**
 * Return the static catalog.
 */
async function getCatalog() {
  return { items: CATALOG, currency: "POINTS" };
}

/**
 * Redeem a reward (with debit + issuance + history patch).
 */
async function redeemReward({ shopperId, rewardId, idempotencyKey }) {
  if (!shopperId) throw new Error("shopperId required");
  if (!rewardId) throw new Error("rewardId required");

  const reward = findReward(rewardId);
  if (!reward) {
    const e = new Error("Unknown rewardId");
    e.code = "UNKNOWN_REWARD";
    throw e;
  }

  const cost = Number(reward.amount || 0);
  if (!Number.isFinite(cost) || cost <= 0) {
    const e = new Error("Invalid reward configuration");
    e.code = "INVALID_REWARD";
    throw e;
  }

  // Idempotency check
  if (idempotencyKey) {
    const current = await getRaw(shopperId);
    const hit = (current?.history || []).find(
      h => h?.type === "redeem" && h?.rewardId === rewardId && h?.idem === idempotencyKey && h?.code
    );
    if (hit) {
      return {
        ok: true,
        shopperId,
        rewardId,
        balance: safeNumber(current?.balance),
        issued: { code: hit.code, meta: reward.meta || {} },
        idem: idempotencyKey,
      };
    }
  }

  // 1) Debit points with guard
  const debitTs = nowIso();
  const debitExpr = [
    "ADD #balance :neg",
    "SET #updatedAt = :ts, #history = list_append(if_not_exists(#history, :emptyList), :entry)"
  ].join(" ");

  const debitCmd = new UpdateCommand({
    TableName: REWARDS_TABLE,
    Key: { shopperId },
    UpdateExpression: debitExpr,
    ExpressionAttributeNames: {
      "#balance": "balance",
      "#updatedAt": "updatedAt",
      "#history": "history",
    },
    ExpressionAttributeValues: {
      ":neg": -cost,
      ":ts": debitTs,
      ":emptyList": [],
      ":entry": [{
        ts: debitTs,
        type: "redeem",
        delta: -cost,
        rewardId: reward.id,
      }],
      ":need": cost,
    },
    ConditionExpression: "(attribute_exists(#balance) AND #balance >= :need)",
    ReturnValues: "ALL_NEW",
  });

  let afterDebit;
  try {
    afterDebit = await ddbDoc.send(debitCmd);
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      const bal = await getBalance(shopperId);
      const e = new Error("Insufficient points");
      e.code = "INSUFFICIENT_POINTS";
      e.balance = bal.balance;
      throw e;
    }
    throw err;
  }

  // 2) Issue coupon
  let issued;
  try {
    issued = await issueCouponForReward({ shopperId, reward });
  } catch (issueErr) {
    // Compensate: credit back points
    try {
      await earnPoints({ shopperId, points: cost, reason: "compensate_failed_redemption" });
    } catch (_) {}
    throw issueErr;
  }

  // 3) Annotate history with code + idem
  try {
    const patchTs = nowIso();
    const patchExpr = "SET #updatedAt = :ts, #history = list_append(if_not_exists(#history, :emptyList), :entry)";
    await ddbDoc.send(new UpdateCommand({
      TableName: REWARDS_TABLE,
      Key: { shopperId },
      UpdateExpression: patchExpr,
      ExpressionAttributeNames: {
        "#updatedAt": "updatedAt",
        "#history": "history",
      },
      ExpressionAttributeValues: {
        ":ts": patchTs,
        ":entry": [{
          ts: patchTs,
          type: "redeem",
          delta: 0,
          rewardId: reward.id,
          code: issued.code,
          idem: idempotencyKey || null,
        }],
      },
      ReturnValues: "NONE",
    }));
  } catch (_) {
    // Non-fatal
  }

  const newBalance = safeNumber(afterDebit?.Attributes?.balance) || (await getBalance(shopperId)).balance;

  return {
    ok: true,
    shopperId,
    rewardId: reward.id,
    balance: newBalance,
    issued,
    ...(idempotencyKey ? { idem: idempotencyKey } : {}),
  };
}

module.exports = {
  earnPoints,
  getBalance,
  getCatalog,
  redeemReward,
};

