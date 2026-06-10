const axios = require("axios");
const {
  getZohoApiBase,
  getZohoConfigStatus,
  logZohoConfigStatus,
  refreshZohoToken,
  resolveZohoConfig,
} = require("./zohoauth");

const ZOHO_API_VERSION = process.env.ZOHO_API_VERSION || "v2";
const CONTACTS_MODULE = "Contacts";
const SHOPPER_ID_FIELD = process.env.ZOHO_CONTACT_KEY_FIELD || "Snoozer_Shopper_ID";
const DEFAULT_CONTACT_LAST_NAME =
  process.env.ZOHO_DEFAULT_CONTACT_LAST_NAME || "Snooze Guest";

let zohoRequestOverride = null;

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function cleanFields(fields = {}) {
  const next = {};

  for (const [key, value] of Object.entries(fields || {})) {
    if (!key) continue;

    if (value === true || value === false) {
      next[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      const cleaned = value.map((item) => cleanString(item)).filter(Boolean);
      if (cleaned.length) next[key] = cleaned;
      continue;
    }

    const cleaned = cleanString(value);
    if (cleaned) next[key] = cleaned;
  }

  return next;
}

function getZohoConfigSnapshot() {
  const status = getZohoConfigStatus();
  const config = status.config;

  return {
    OAUTH_DOMAIN: config.oauthDomain,
    API_DOMAIN: config.apiDomain,
    CLIENT_ID: config.clientId,
    CLIENT_SECRET: config.clientSecret,
    REFRESH_TOKEN: config.refreshToken,
    ZOHO_BASE_URL: config.crmBase,
    enabled: status.enabled,
    missingRequiredKeys: status.missingRequiredKeys.slice(),
    resolvedEnvNames: { ...status.resolvedEnvNames },
    aliasSet: status.aliasSet,
  };
}

function hasZohoConfig() {
  return getZohoConfigStatus().enabled;
}

class ZohoNotConfiguredError extends Error {
  constructor(message = "Zoho is not configured") {
    super(message);
    this.name = "ZohoNotConfiguredError";
  }
}

function buildZohoNotConfiguredError(status) {
  const error = new ZohoNotConfiguredError("Zoho env vars missing or incomplete");
  error.code = "ZOHO_CONFIG_INCOMPLETE";
  error.missingRequiredKeys = status?.missingRequiredKeys?.slice?.() || [];
  return error;
}

function extractZohoResponseCode(data) {
  return data?.data?.[0]?.code || data?.code || null;
}

function extractZohoResponseMessage(data, fallback = null) {
  return data?.data?.[0]?.message || data?.message || fallback;
}

function logZohoEvent(source, payload = {}) {
  console.log(JSON.stringify({ source, ...payload }));
}

function logZohoError(source, payload = {}) {
  console.error(JSON.stringify({ source, ...payload }));
}

async function liveZohoRequest(path, method = "get", payload = null) {
  const status = logZohoConfigStatus("zoho.request");
  if (!status.enabled) {
    throw buildZohoNotConfiguredError(status);
  }

  const base = getZohoApiBase(status.config);
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
    const response = await axios(config);
    return response.data;
  } catch (err) {
    const responseData = err?.response?.data;
    logZohoError("zoho.request.failed", {
      method,
      path,
      status: err?.response?.status || null,
      code: extractZohoResponseCode(responseData),
      message: extractZohoResponseMessage(responseData, err.message),
    });
    throw err;
  }
}

async function zohoRequest(path, method = "get", payload = null) {
  if (typeof zohoRequestOverride === "function") {
    return zohoRequestOverride(path, method, payload);
  }

  return liveZohoRequest(path, method, payload);
}

function isSearchNoRecordsError(error) {
  const status = Number(error?.response?.status || 0);
  const code = cleanString(extractZohoResponseCode(error?.response?.data)).toUpperCase();
  const message = cleanString(
    extractZohoResponseMessage(error?.response?.data, error?.message || "")
  ).toLowerCase();

  return (
    status === 204 ||
    code === "NO_CONTENT" ||
    message.includes("no records found") ||
    message.includes("no content") ||
    message.includes("record not found")
  );
}

function normalizeLookupContacts(response) {
  return Array.isArray(response?.data) ? response.data.filter(Boolean) : [];
}

async function createLead(leadData) {
  try {
    const response = await zohoRequest("/Leads", "post", {
      data: [leadData],
      trigger: ["approval", "workflow", "blueprint"],
    });
    return response.data?.[0] || null;
  } catch (error) {
    if (error && error.name === "ZohoNotConfiguredError") return null;
    throw error;
  }
}

async function findLeadByEmail(email) {
  try {
    const response = await zohoRequest(
      `/Leads/search?criteria=${encodeURIComponent(`(Email:equals:${email})`)}`
    );
    return response.data?.[0] || null;
  } catch (error) {
    if (error && error.name === "ZohoNotConfiguredError") return null;
    throw error;
  }
}

async function findLeadByAccessCode(code) {
  try {
    const response = await zohoRequest(
      `/Leads/search?criteria=${encodeURIComponent(`(Access_Code:equals:${code})`)}`
    );
    return response.data?.[0] || null;
  } catch (error) {
    if (error && error.name === "ZohoNotConfiguredError") return null;
    throw error;
  }
}

async function getOrderStatus(orderNumber) {
  try {
    const response = await zohoRequest(
      `/Orders/search?criteria=${encodeURIComponent(`(Order_Number:equals:${orderNumber})`)}`
    );
    return response.data?.[0] || null;
  } catch (error) {
    if (error && error.name === "ZohoNotConfiguredError") return null;
    throw error;
  }
}

async function lookupContactsByShopperId(shopperId) {
  const normalizedShopperId = cleanString(shopperId);
  if (!normalizedShopperId) {
    return {
      ok: false,
      skipped: true,
      reason: "SHOPPER_ID_REQUIRED",
      shopperId: null,
      matchCount: 0,
      items: [],
      contact: null,
      duplicateDetected: false,
    };
  }

  const status = logZohoConfigStatus("zoho.contact.lookup");
  if (!status.enabled) {
    return {
      ok: false,
      skipped: true,
      reason: "ZOHO_NOT_CONFIGURED",
      shopperId: normalizedShopperId,
      matchCount: 0,
      items: [],
      contact: null,
      duplicateDetected: false,
    };
  }

  logZohoEvent("zoho.contact.lookup.attempt", {
    shopperId: normalizedShopperId,
    keyField: SHOPPER_ID_FIELD,
  });

  try {
    const criteria = encodeURIComponent(`(${SHOPPER_ID_FIELD}:equals:${normalizedShopperId})`);
    const response = await zohoRequest(`/${CONTACTS_MODULE}/search?criteria=${criteria}`);
    const items = normalizeLookupContacts(response);
    const matchCount = items.length;
    const duplicateDetected = matchCount > 1;

    if (matchCount === 0) {
      logZohoEvent("zoho.contact.lookup.none", {
        shopperId: normalizedShopperId,
        keyField: SHOPPER_ID_FIELD,
      });
    } else if (matchCount === 1) {
      logZohoEvent("zoho.contact.lookup.one", {
        shopperId: normalizedShopperId,
        keyField: SHOPPER_ID_FIELD,
        contactId: items[0]?.id || null,
      });
    } else {
      logZohoEvent("zoho.contact.lookup.multiple", {
        shopperId: normalizedShopperId,
        keyField: SHOPPER_ID_FIELD,
        matchCount,
        contactIds: items.map((item) => item?.id).filter(Boolean),
      });
    }

    return {
      ok: true,
      skipped: false,
      reason: null,
      shopperId: normalizedShopperId,
      matchCount,
      items,
      contact: items[0] || null,
      duplicateDetected,
    };
  } catch (error) {
    if (error && error.name === "ZohoNotConfiguredError") {
      return {
        ok: false,
        skipped: true,
        reason: "ZOHO_NOT_CONFIGURED",
        shopperId: normalizedShopperId,
        matchCount: 0,
        items: [],
        contact: null,
        duplicateDetected: false,
      };
    }

    if (isSearchNoRecordsError(error)) {
      logZohoEvent("zoho.contact.lookup.none", {
        shopperId: normalizedShopperId,
        keyField: SHOPPER_ID_FIELD,
      });
      return {
        ok: true,
        skipped: false,
        reason: null,
        shopperId: normalizedShopperId,
        matchCount: 0,
        items: [],
        contact: null,
        duplicateDetected: false,
      };
    }

    logZohoError("zoho.contact.upsert.failed", {
      shopperId: normalizedShopperId,
      operation: "lookup",
      status: error?.response?.status || null,
      code: extractZohoResponseCode(error?.response?.data),
      message: extractZohoResponseMessage(error?.response?.data, error.message),
    });

    return {
      ok: false,
      skipped: true,
      reason: "ZOHO_LOOKUP_FAILED",
      shopperId: normalizedShopperId,
      matchCount: 0,
      items: [],
      contact: null,
      duplicateDetected: false,
      code: extractZohoResponseCode(error?.response?.data) || null,
    };
  }
}

async function findContactByShopperId(shopperId) {
  const lookup = await lookupContactsByShopperId(shopperId);
  if (!lookup.ok || lookup.skipped) return null;
  return lookup.contact || null;
}

async function upsertContactByShopperId(shopperId, contactFields = {}) {
  const normalizedShopperId = cleanString(shopperId);
  if (!normalizedShopperId) {
    throw new Error("upsertContactByShopperId: shopperId is required");
  }

  const status = logZohoConfigStatus("zoho.contact.upsert");
  if (!status.enabled) {
    logZohoEvent("zoho.contact.upsert.skipped", {
      shopperId: normalizedShopperId,
      reason: "ZOHO_NOT_CONFIGURED",
    });
    return {
      ok: false,
      skipped: true,
      reason: "ZOHO_NOT_CONFIGURED",
      operation: null,
      shopperId: normalizedShopperId,
      contactId: null,
      code: null,
    };
  }

  const lookup = await lookupContactsByShopperId(normalizedShopperId);
  if (!lookup.ok || lookup.skipped) {
    logZohoEvent("zoho.contact.upsert.skipped", {
      shopperId: normalizedShopperId,
      reason: lookup.reason || "ZOHO_LOOKUP_FAILED",
    });
    return {
      ok: false,
      skipped: true,
      reason: lookup.reason || "ZOHO_LOOKUP_FAILED",
      operation: null,
      shopperId: normalizedShopperId,
      contactId: null,
      code: lookup.code || null,
    };
  }

  const isUpdate = Boolean(lookup.contact?.id);
  const operation = isUpdate ? "update" : "create";
  const contactId = lookup.contact?.id || null;
  const basePayload = cleanFields({
    ...contactFields,
    [SHOPPER_ID_FIELD]: normalizedShopperId,
  });

  if (!isUpdate && !cleanString(basePayload.Last_Name)) {
    basePayload.Last_Name = DEFAULT_CONTACT_LAST_NAME;
  }

  if (lookup.duplicateDetected) {
    logZohoEvent("zoho.contact.duplicate_detected", {
      shopperId: normalizedShopperId,
      matchCount: lookup.matchCount,
      selectedContactId: contactId,
    });
  }

  if (lookup.duplicateDetected && !contactId) {
    logZohoEvent("zoho.contact.upsert.skipped", {
      shopperId: normalizedShopperId,
      reason: "DUPLICATE_CONTACT_AMBIGUOUS",
      matchCount: lookup.matchCount,
    });
    return {
      ok: false,
      skipped: true,
      reason: "DUPLICATE_CONTACT_AMBIGUOUS",
      operation,
      shopperId: normalizedShopperId,
      contactId: null,
      code: null,
      duplicateDetected: true,
      matchCount: lookup.matchCount,
    };
  }

  logZohoEvent(
    isUpdate ? "zoho.contact.update.attempt" : "zoho.contact.create.attempt",
    {
      shopperId: normalizedShopperId,
      contactId,
      keyField: SHOPPER_ID_FIELD,
      fields: Object.keys(basePayload),
    }
  );

  try {
    const response = await zohoRequest(
      isUpdate ? `/${CONTACTS_MODULE}/${contactId}` : `/${CONTACTS_MODULE}`,
      isUpdate ? "put" : "post",
      {
        data: [basePayload],
        trigger: ["workflow"],
      }
    );
    const result = response?.data?.[0] || null;

    logZohoEvent("zoho.contact.upsert.succeeded", {
      shopperId: normalizedShopperId,
      operation,
      contactId: result?.details?.id || contactId,
      code: result?.code || null,
      duplicateDetected: lookup.duplicateDetected,
      matchCount: lookup.matchCount,
    });

    return {
      ok: true,
      skipped: false,
      reason: null,
      operation,
      shopperId: normalizedShopperId,
      contactId: result?.details?.id || contactId || null,
      code: result?.code || null,
      duplicateDetected: lookup.duplicateDetected,
      matchCount: lookup.matchCount,
      result,
    };
  } catch (error) {
    logZohoError("zoho.contact.upsert.failed", {
      shopperId: normalizedShopperId,
      operation,
      contactId,
      status: error?.response?.status || null,
      code: extractZohoResponseCode(error?.response?.data),
      message: extractZohoResponseMessage(error?.response?.data, error.message),
    });
    return {
      ok: false,
      skipped: true,
      reason: "ZOHO_UPSERT_FAILED",
      operation,
      shopperId: normalizedShopperId,
      contactId,
      code: extractZohoResponseCode(error?.response?.data) || null,
    };
  }
}

function __setZohoRequestOverrideForTests(fn) {
  zohoRequestOverride = typeof fn === "function" ? fn : null;
}

module.exports = {
  __setZohoRequestOverrideForTests,
  createLead,
  findContactByShopperId,
  findLeadByAccessCode,
  findLeadByEmail,
  getOrderStatus,
  getZohoConfigSnapshot,
  hasZohoConfig,
  lookupContactsByShopperId,
  resolveZohoConfig,
  upsertContactByShopperId,
};
