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
const SHOPPER_ID_FIELD =
  process.env.ZOHO_CONTACT_KEY_FIELD || "Snoozer_Shopper_ID";
const DEFAULT_CONTACT_LAST_NAME =
  process.env.ZOHO_DEFAULT_CONTACT_LAST_NAME || "Snooze Guest";

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

async function zohoRequest(path, method = "get", payload = null) {
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
    console.error(
      JSON.stringify({
        source: "zoho.request",
        event: "failed",
        method,
        path,
        status: err?.response?.status || null,
        code: extractZohoResponseCode(responseData),
        message: extractZohoResponseMessage(responseData, err.message),
      })
    );
    throw err;
  }
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
      `/Leads/search?criteria=${encodeURIComponent(
        `(Access_Code:equals:${code})`
      )}`
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
      `/Orders/search?criteria=${encodeURIComponent(
        `(Order_Number:equals:${orderNumber})`
      )}`
    );
    return response.data?.[0] || null;
  } catch (error) {
    if (error && error.name === "ZohoNotConfiguredError") return null;
    throw error;
  }
}

async function findContactByShopperId(shopperId) {
  if (!shopperId) return null;

  try {
    const criteria = encodeURIComponent(
      `(${SHOPPER_ID_FIELD}:equals:${shopperId})`
    );
    const response = await zohoRequest(
      `/${CONTACTS_MODULE}/search?criteria=${criteria}`
    );
    return response.data?.[0] || null;
  } catch (error) {
    if (error && error.name === "ZohoNotConfiguredError") return null;
    throw error;
  }
}

async function upsertContactByShopperId(shopperId, contactFields = {}) {
  if (!shopperId) {
    throw new Error("upsertContactByShopperId: shopperId is required");
  }

  const status = logZohoConfigStatus("zoho.contact.upsert");
  if (!status.enabled) {
    return null;
  }

  console.log(
    JSON.stringify({
      source: "zoho.contact.upsert",
      event: "attempt",
      shopperId,
    })
  );

  let existing = null;
  try {
    existing = await findContactByShopperId(shopperId);
  } catch (error) {
    console.error(
      JSON.stringify({
        source: "zoho.contact.lookup",
        event: "failed",
        shopperId,
        message: error.message,
      })
    );
  }

  const isUpdate = Boolean(existing && existing.id);
  const basePayload = {
    ...contactFields,
    [SHOPPER_ID_FIELD]: shopperId,
  };

  if (!isUpdate) {
    const hasLastName =
      basePayload.Last_Name != null &&
      String(basePayload.Last_Name).trim() !== "";
    if (!hasLastName) {
      basePayload.Last_Name = DEFAULT_CONTACT_LAST_NAME;
    }
  }

  const path = isUpdate
    ? `/${CONTACTS_MODULE}/${existing.id}`
    : `/${CONTACTS_MODULE}`;
  const method = isUpdate ? "put" : "post";
  const payload = {
    data: [basePayload],
    trigger: ["workflow"],
  };

  const response = await zohoRequest(path, method, payload);
  const result = response.data?.[0] || null;

  console.log(
    JSON.stringify({
      source: "zoho.contact.upsert",
      event: "succeeded",
      shopperId,
      operation: isUpdate ? "update" : "create",
      code: result?.code || null,
      contactId: result?.details?.id || null,
    })
  );

  return result;
}

module.exports = {
  createLead,
  findContactByShopperId,
  findLeadByAccessCode,
  findLeadByEmail,
  getOrderStatus,
  getZohoConfigSnapshot,
  hasZohoConfig,
  resolveZohoConfig,
  upsertContactByShopperId,
};
