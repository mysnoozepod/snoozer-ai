// services/zoho.js
//
// Thin Zoho CRM helper for Snoozer / Omnia.
// - Token refresh is handled by ./zohoauth
// - Supports Leads helpers + Contacts upsert by Snoozer Shopper ID
//
// ✅ Local-dev friendly:
// If Zoho env vars are missing, this module will NOT crash your backend.
// Instead, Zoho calls become no-ops (return null) with a single warning.

const axios = require("axios");

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────

const ZOHO_API_VERSION = process.env.ZOHO_API_VERSION || "v2";

// Contacts module + Shopper ID field
const CONTACTS_MODULE = "Contacts";
const SHOPPER_ID_FIELD =
  process.env.ZOHO_CONTACT_KEY_FIELD || "Snoozer_Shopper_ID";

const DEFAULT_CONTACT_LAST_NAME =
  process.env.ZOHO_DEFAULT_CONTACT_LAST_NAME || "Snooze Guest";

// ─────────────────────────────────────────────
// Local-dev guardrails (do not crash if Zoho isn't configured)
// ─────────────────────────────────────────────

let _warnedZohoDisabled = false;

function warnZohoDisabledOnce(reason) {
  if (_warnedZohoDisabled) return;
  _warnedZohoDisabled = true;

  console.log(
    "⚠️ Zoho disabled (local/dev). Skipping Zoho calls.",
    JSON.stringify({ reason }, null, 2)
  );
}

function getEnvAny(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  return "";
}

/**
 * Try to match whatever ./zohoauth expects.
 * Your runtime log showed it cares about:
 *  - OAUTH_DOMAIN
 *  - API_DOMAIN
 *  - CLIENT_ID
 *  - CLIENT_SECRET
 *  - REFRESH_TOKEN
 *
 * We support both "ZOHO_*" and the simpler names so you don't have to rename things everywhere.
 */
function getZohoConfigSnapshot() {
  const OAUTH_DOMAIN = getEnvAny(
    "ZOHO_OAUTH_DOMAIN",
    "OAUTH_DOMAIN",
    "ZCRM_OAUTH_DOMAIN"
  );

  const API_DOMAIN = getEnvAny(
    "ZCRM_API_DOMAIN",
    "ZOHO_API_DOMAIN",
    "API_DOMAIN"
  );

  const CLIENT_ID = getEnvAny("ZOHO_CLIENT_ID", "CLIENT_ID");
  const CLIENT_SECRET = getEnvAny("ZOHO_CLIENT_SECRET", "CLIENT_SECRET");
  const REFRESH_TOKEN = getEnvAny("ZOHO_REFRESH_TOKEN", "REFRESH_TOKEN");

  // Optional override used by your previous code
  const ZOHO_BASE_URL = getEnvAny("ZOHO_BASE_URL");

  return {
    OAUTH_DOMAIN,
    API_DOMAIN,
    CLIENT_ID,
    CLIENT_SECRET,
    REFRESH_TOKEN,
    ZOHO_BASE_URL,
  };
}

function hasZohoConfig() {
  const cfg = getZohoConfigSnapshot();
  return !!(
    cfg.CLIENT_ID &&
    cfg.CLIENT_SECRET &&
    cfg.REFRESH_TOKEN &&
    (cfg.API_DOMAIN || cfg.ZOHO_BASE_URL)
  );
}

class ZohoNotConfiguredError extends Error {
  constructor(message = "Zoho is not configured") {
    super(message);
    this.name = "ZohoNotConfiguredError";
  }
}

/**
 * Lazy-load zohoauth so missing env vars won't crash require-time.
 * Returns { refreshZohoToken, API_DOMAIN } or throws.
 */
function loadZohoAuth() {
  try {
    // eslint-disable-next-line global-require
    const auth = require("./zohoauth");
    if (!auth || typeof auth.refreshZohoToken !== "function") {
      throw new Error("zohoauth missing refreshZohoToken()");
    }
    return auth;
  } catch (e) {
    throw new ZohoNotConfiguredError(
      `Zoho auth not available: ${e.message || String(e)}`
    );
  }
}

// ─────────────────────────────────────────────
// Core request helper
// ─────────────────────────────────────────────

async function zohoRequest(path, method = "get", payload = null) {
  if (!hasZohoConfig()) {
    const snap = getZohoConfigSnapshot();
    warnZohoDisabledOnce({
      missing: {
        CLIENT_ID: !snap.CLIENT_ID,
        CLIENT_SECRET: !snap.CLIENT_SECRET,
        REFRESH_TOKEN: !snap.REFRESH_TOKEN,
        API_DOMAIN_or_ZOHO_BASE_URL: !(snap.API_DOMAIN || snap.ZOHO_BASE_URL),
      },
    });
    throw new ZohoNotConfiguredError("Zoho env vars missing");
  }

  const { refreshZohoToken, API_DOMAIN } = loadZohoAuth();
  const snap = getZohoConfigSnapshot();

  // Prefer explicit override, then zohoauth's API_DOMAIN, then Zoho default.
  const base =
    snap.ZOHO_BASE_URL || API_DOMAIN || snap.API_DOMAIN || "https://www.zohoapis.com";

  const token = await refreshZohoToken();
  const url = `${base}/crm/${ZOHO_API_VERSION}${path}`;

  const config = {
    method,
    url,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
  };

  if (payload) config.data = payload;

  try {
    const resp = await axios(config);
    return resp.data;
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;

    console.error(
      "❌ Zoho request error",
      JSON.stringify({ path, method, status, data }, null, 2)
    );
    throw err;
  }
}

// ─────────────────────────────────────────────
// Leads helpers (existing behavior preserved)
// ─────────────────────────────────────────────

async function createLead(leadData) {
  try {
    const resp = await zohoRequest("/Leads", "post", {
      data: [leadData],
      trigger: ["approval", "workflow", "blueprint"],
    });
    return resp.data?.[0] || null;
  } catch (e) {
    if (e && e.name === "ZohoNotConfiguredError") return null;
    throw e;
  }
}

async function findLeadByEmail(email) {
  try {
    const resp = await zohoRequest(
      `/Leads/search?criteria=${encodeURIComponent(`(Email:equals:${email})`)}`
    );
    return resp.data?.[0] || null;
  } catch (e) {
    if (e && e.name === "ZohoNotConfiguredError") return null;
    throw e;
  }
}

async function findLeadByAccessCode(code) {
  try {
    const resp = await zohoRequest(
      `/Leads/search?criteria=${encodeURIComponent(
        `(Access_Code:equals:${code})`
      )}`
    );
    return resp.data?.[0] || null;
  } catch (e) {
    if (e && e.name === "ZohoNotConfiguredError") return null;
    throw e;
  }
}

// ─────────────────────────────────────────────
// Orders helper (existing)
// ─────────────────────────────────────────────

async function getOrderStatus(orderNumber) {
  try {
    const resp = await zohoRequest(
      `/Orders/search?criteria=${encodeURIComponent(
        `(Order_Number:equals:${orderNumber})`
      )}`
    );
    return resp.data?.[0] || null;
  } catch (e) {
    if (e && e.name === "ZohoNotConfiguredError") return null;
    throw e;
  }
}

// ─────────────────────────────────────────────
// Contacts: Shopper ID–based helpers
// ─────────────────────────────────────────────

async function findContactByShopperId(shopperId) {
  if (!shopperId) return null;

  try {
    const criteria = encodeURIComponent(
      `(${SHOPPER_ID_FIELD}:equals:${shopperId})`
    );

    const resp = await zohoRequest(
      `/${CONTACTS_MODULE}/search?criteria=${criteria}`
    );

    return resp.data?.[0] || null;
  } catch (e) {
    if (e && e.name === "ZohoNotConfiguredError") return null;
    throw e;
  }
}

async function upsertContactByShopperId(shopperId, contactFields = {}) {
  if (!shopperId) {
    throw new Error("upsertContactByShopperId: shopperId is required");
  }

  // If Zoho isn't configured locally, don't crash the app.
  if (!hasZohoConfig()) {
    warnZohoDisabledOnce("Missing Zoho env vars; upsert skipped");
    return null;
  }

  let existing = null;
  try {
    existing = await findContactByShopperId(shopperId);
  } catch (err) {
    console.error(
      "⚠️ Zoho findContactByShopperId failed",
      JSON.stringify({ shopperId, message: err.message }, null, 2)
    );
  }

  const isUpdate = !!(existing && existing.id);

  const basePayload = {
    ...contactFields,
    [SHOPPER_ID_FIELD]: shopperId,
  };

  if (!isUpdate) {
    const hasLastName =
      basePayload.Last_Name != null &&
      String(basePayload.Last_Name).trim() !== "";
    if (!hasLastName) basePayload.Last_Name = DEFAULT_CONTACT_LAST_NAME;
  }

  const path = isUpdate
    ? `/${CONTACTS_MODULE}/${existing.id}`
    : `/${CONTACTS_MODULE}`;
  const method = isUpdate ? "put" : "post";

  const payload = { data: [basePayload], trigger: ["workflow"] };

  const resp = await zohoRequest(path, method, payload);

  console.log(
    "🔍 Zoho upsertContactByShopperId response",
    JSON.stringify(
      {
        shopperId,
        op: isUpdate ? "update" : "create",
        payload: basePayload,
        response: resp,
      },
      null,
      2
    )
  );

  return resp.data?.[0] || null;
}

module.exports = {
  createLead,
  findLeadByEmail,
  getOrderStatus,
  findLeadByAccessCode,

  findContactByShopperId,
  upsertContactByShopperId,
};
