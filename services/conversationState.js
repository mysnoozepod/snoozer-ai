/**
 * Snoozer Conversation State
 * Lightweight in-memory session memory for bounded turns + deterministic tool breadcrumbs.
 *
 * IMPORTANT:
 * - This is NOT the source of truth for shopper identity/location. Dynamo SCO is.
 * - This is a best-effort warm-container cache only.
 *
 * Exports:
 *  - initializeSession(threadId)
 *  - getMemory(threadId) -> session|null
 *  - updateMemory(threadId, newData) -> session
 *  - resetMemory(threadId)
 *  - rememberTurn(threadId, role, content, opts?)
 *  - getLastTurns(threadId, n=3) -> Array<{role, content}>
 *  - clearTurns(threadId)
 *  - setContext(threadId, { lastHash?, text?, keys? })
 *  - getContext(threadId) -> { lastHash?, text?, keys? }|null
 *  - recordStats(threadId, partialStats)
 *  - sweepExpired()
 *  - touch(threadId)
 *
 * Compat aliases:
 *  - getThreadMemory, getSession, getThreadState
 */

const sessions = new Map();

/** Default TTL: 20 min (configurable) */
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 20 * 60 * 1000);

/** Bounded turns: keep at most 3 user/assistant pairs (6 entries) */
const MAX_TURNS = Number(process.env.SESSION_MAX_TURNS || 3);

/** Per-turn content cap to prevent payload bloat */
const MAX_TURN_CHARS = Number(process.env.SESSION_MAX_TURN_CHARS || 900);

/** Valid phases (order matters for progression) */
const PHASES = ["welcome", "explore", "checkout"];

// ──────────────────────────────
// Internal utils
// ──────────────────────────────
function now() {
  return Date.now();
}

function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function safeStr(v, cap = MAX_TURN_CHARS) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.length > cap ? s.slice(0, cap) + "…" : s;
}

function phaseIndex(p) {
  return PHASES.indexOf(p);
}

/**
 * Allowlist patching: we only keep fields that matter for deterministic tooling
 * and observability. SCO lives in Dynamo, so we don't mirror the world here.
 */
function sanitizePatch(patch) {
  if (!isObject(patch)) return {};

  const out = {};

  // phase (forward-only enforced later)
  if (typeof patch.phase === "string") out.phase = patch.phase;

  // deterministic breadcrumbs used by tools/openai
  if (typeof patch.checkoutUrl === "string") out.checkoutUrl = patch.checkoutUrl;

  // ids (cartId primarily)
  if (isObject(patch.ids)) {
    const ids = {};
    if (typeof patch.ids.cartId === "string") ids.cartId = patch.ids.cartId;
    if (typeof patch.ids.checkoutId === "string") ids.checkoutId = patch.ids.checkoutId;
    if (typeof patch.ids.zohoLeadId === "string") ids.zohoLeadId = patch.ids.zohoLeadId;
    if (typeof patch.ids.shopifyCustomerId === "string") ids.shopifyCustomerId = patch.ids.shopifyCustomerId;
    if (Object.keys(ids).length) out.ids = ids;
  }

  // cartState anchors
  if (isObject(patch.cartState)) {
    const cs = {};
    if (typeof patch.cartState.lastViewedHandle === "string") cs.lastViewedHandle = patch.cartState.lastViewedHandle;
    if (typeof patch.cartState.lastAddedHandle === "string") cs.lastAddedHandle = patch.cartState.lastAddedHandle;
    if (Array.isArray(patch.cartState.items)) cs.items = patch.cartState.items; // optional, best-effort
    if (Object.keys(cs).length) out.cartState = cs;
  }

  // pricing/financing crumbs (optional but useful)
  if (typeof patch.lastTotal === "number" && Number.isFinite(patch.lastTotal)) out.lastTotal = patch.lastTotal;

  if (isObject(patch.financing)) {
    const f = {};
    if (typeof patch.financing.total === "number" && Number.isFinite(patch.financing.total)) f.total = patch.financing.total;
    if (typeof patch.financing.months === "number" && Number.isFinite(patch.financing.months)) f.months = patch.financing.months;
    if (typeof patch.financing.monthly === "string") f.monthly = patch.financing.monthly;
    if (typeof patch.financing.interestRate === "number" && Number.isFinite(patch.financing.interestRate)) f.interestRate = patch.financing.interestRate;
    if (Object.keys(f).length) out.financing = f;
  }

  // delivery crumbs
  if (typeof patch.zipCode === "string") out.zipCode = patch.zipCode;
  if (typeof patch.deliveryEstimate === "number" && Number.isFinite(patch.deliveryEstimate)) out.deliveryEstimate = patch.deliveryEstimate;

  // rewards crumb
  if (typeof patch.lastRewards === "number" && Number.isFinite(patch.lastRewards)) out.lastRewards = patch.lastRewards;

  // ctx/stats are allowed but merged separately
  if (isObject(patch.ctx)) out.ctx = patch.ctx;
  if (isObject(patch.stats)) out.stats = patch.stats;

  // turns are NEVER patched via updateMemory (only via rememberTurn/clearTurns)
  // because patching turns causes subtle adjacency corruption.

  return out;
}

function deepMerge(target, patch) {
  if (!isObject(target)) return isObject(patch) ? { ...patch } : patch;
  if (!isObject(patch)) return target;

  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (isObject(v) && isObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function newSession() {
  const ts = now();
  return {
    created: ts,
    updated: ts,
    phase: "welcome",

    // Deterministic tool breadcrumbs (minimal, not SCO)
    ids: {
      cartId: "",
      checkoutId: "",
      zohoLeadId: "",
      shopifyCustomerId: "",
    },
    checkoutUrl: "",
    cartState: {
      items: [],
      lastViewedHandle: "",
      lastAddedHandle: "",
    },

    // Optional crumbs
    zipCode: "",
    deliveryEstimate: undefined,
    lastTotal: undefined,
    financing: undefined,
    lastRewards: undefined,

    // Turns buffer (bounded)
    turns: [], // Array<{ role: 'user'|'assistant', content: string, ts: number }>

    // Context suppression / dedupe bookkeeping
    ctx: {
      lastHash: undefined,
      text: undefined,
      keys: undefined,
    },

    // Observability breadcrumbs
    stats: {
      lastPath: undefined,
      lastModel: undefined,
      lastLatencyMs: undefined,
      retries: undefined,
      lastReqId: undefined,
      lastError: undefined,
    },
  };
}

function ensureSession(threadId) {
  if (!threadId) return null;

  const existing = sessions.get(threadId);
  if (existing) {
    existing.updated = now();
    return existing;
  }

  const created = newSession();
  sessions.set(threadId, created);
  return created;
}

function isExpired(session) {
  return !session || now() - session.updated > SESSION_TTL_MS;
}

function boundTurns(arr, maxPairs = MAX_TURNS) {
  const maxEntries = Math.max(0, Number(maxPairs)) * 2; // user+assistant pairs
  while (arr.length > maxEntries) arr.shift();
  return arr;
}

// ──────────────────────────────
// Public API
// ──────────────────────────────

/** Initialize or refresh session */
function initializeSession(threadId) {
  if (!threadId) return;
  ensureSession(threadId);
}

/** Retrieve memory (null if expired) */
function getMemory(threadId) {
  if (!threadId) return null;

  const session = sessions.get(threadId);
  if (!session) return null;

  if (isExpired(session)) {
    sessions.delete(threadId);
    return null;
  }

  session.updated = now(); // touch on read
  return session;
}

/**
 * Update memory (allowlist merge + enforce forward-only phase flow)
 * Also merges ctx/stats so partial patches don't wipe nested objects.
 */
function updateMemory(threadId, newData = {}) {
  if (!threadId) return null;

  const existing = getMemory(threadId) || newSession();
  const patch = sanitizePatch(newData);

  // Phase stickiness: only move forward
  let nextPhase = existing.phase;
  if (typeof existing.phase === "string" && typeof patch.phase === "string") {
    const oldIdx = phaseIndex(existing.phase);
    const newIdx = phaseIndex(patch.phase);
    nextPhase = newIdx >= 0 && newIdx >= oldIdx ? patch.phase : existing.phase;
  }

  // Merge ctx/stats instead of overwriting them wholesale
  const mergedCtx = isObject(patch.ctx) ? { ...(existing.ctx || {}), ...patch.ctx } : existing.ctx || {};
  const mergedStats = isObject(patch.stats) ? { ...(existing.stats || {}), ...patch.stats } : existing.stats || {};

  // Deep-merge deterministic objects (ids/cartState) to avoid clobbering siblings
  const merged = deepMerge(existing, patch);

  merged.phase = nextPhase;
  merged.updated = now();
  merged.ctx = mergedCtx;
  merged.stats = mergedStats;

  // Preserve turns (not patchable here)
  if (!Array.isArray(merged.turns)) merged.turns = existing.turns || [];

  sessions.set(threadId, merged);
  return merged;
}

/** Reset memory (for debugging / force reset) */
function resetMemory(threadId) {
  if (threadId) sessions.delete(threadId);
}

/** Refresh the session's updated timestamp without changing content */
function touch(threadId) {
  const s = getMemory(threadId);
  if (s) s.updated = now();
  return s || null;
}

/** Remember a single turn; keeps at most MAX_TURNS user/assistant pairs */
function rememberTurn(threadId, role, content, { capPairs = MAX_TURNS } = {}) {
  if (!threadId) return;

  const s = ensureSession(threadId);
  if (!s) return;

  const r = role === "assistant" ? "assistant" : "user";
  const c = safeStr(content, MAX_TURN_CHARS);
  if (!c) return;

  const rec = { role: r, content: c, ts: now() };

  if (!Array.isArray(s.turns)) s.turns = [];
  s.turns.push(rec);
  boundTurns(s.turns, capPairs);
  s.updated = now();
}

/** Return the last n user/assistant pairs (2n entries) in order */
function getLastTurns(threadId, n = MAX_TURNS) {
  const s = getMemory(threadId);
  if (!s || !Array.isArray(s.turns)) return [];

  const cap = Math.max(0, Number(n)) * 2;
  return s.turns.slice(-cap).map(({ role, content }) => ({ role, content }));
}

/** Clear all remembered turns */
function clearTurns(threadId) {
  const s = getMemory(threadId);
  if (s) {
    s.turns = [];
    s.updated = now();
  }
}

/** Set per-thread context info used for suppression/dedupe */
function setContext(threadId, { lastHash, text, keys } = {}) {
  if (!threadId) return;
  const s = ensureSession(threadId);
  if (!s.ctx) s.ctx = {};

  if (lastHash !== undefined) s.ctx.lastHash = lastHash;
  if (text !== undefined) s.ctx.text = safeStr(text, 4000);
  if (keys !== undefined) s.ctx.keys = keys;

  s.updated = now();
}

/** Get per-thread context info */
function getContext(threadId) {
  const s = getMemory(threadId);
  return s ? s.ctx || null : null;
}

/** Record simple stats about last response for observability */
function recordStats(threadId, partial = {}) {
  if (!threadId) return;

  const s = ensureSession(threadId);
  if (!s.stats) s.stats = {};

  if (partial && typeof partial === "object") {
    // keep stats small and string-safe
    const clean = {};
    for (const [k, v] of Object.entries(partial)) {
      if (v === undefined) continue;
      if (v === null) clean[k] = null;
      else if (typeof v === "number" && Number.isFinite(v)) clean[k] = v;
      else if (typeof v === "boolean") clean[k] = v;
      else clean[k] = safeStr(v, 500);
    }
    s.stats = { ...s.stats, ...clean };
  }

  s.updated = now();
}

/** Sweep expired sessions to keep warm containers tidy */
function sweepExpired() {
  const cutoff = now() - SESSION_TTL_MS;
  let removed = 0;
  for (const [key, session] of sessions.entries()) {
    if (!session || session.updated < cutoff) {
      sessions.delete(key);
      removed++;
    }
  }
  return removed;
}

// ──────────────────────────────
// Compat aliases
// ──────────────────────────────
const getThreadMemory = getMemory;
const getSession = getMemory;
const getThreadState = getMemory;

module.exports = {
  // Core
  initializeSession,
  getMemory,
  updateMemory,
  resetMemory,
  touch,

  // Turns
  rememberTurn,
  getLastTurns,
  clearTurns,

  // Context & Stats
  setContext,
  getContext,
  recordStats,

  // Maintenance
  sweepExpired,

  // Constants
  SESSION_TTL_MS,
  MAX_TURNS,
  PHASES,

  // Compat
  getThreadMemory,
  getSession,
  getThreadState,
};