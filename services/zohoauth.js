const axios = require("axios");

const EXPIRY_SKEW_SEC = Number(process.env.ZOHO_TOKEN_EXPIRY_SKEW_SEC || 90);

const ZOHO_ENV_ALIASES = {
  clientId: ["ZCRM_CLIENT_ID", "CLIENT_ID", "ZOHO_CLIENT_ID"],
  clientSecret: ["ZCRM_CLIENT_SECRET", "CLIENT_SECRET", "ZOHO_CLIENT_SECRET"],
  refreshToken: ["ZCRM_REFRESH_TOKEN", "REFRESH_TOKEN", "ZOHO_REFRESH_TOKEN"],
  oauthDomain: ["ZCRM_OAUTH_DOMAIN", "OAUTH_DOMAIN", "ZOHO_OAUTH_DOMAIN"],
  apiDomain: ["ZCRM_API_DOMAIN", "API_DOMAIN", "ZOHO_API_DOMAIN"],
  crmBase: ["ZOHO_CRM_BASE", "ZOHO_BASE_URL"],
};

let cachedToken = null;
let cachedTokenExpMs = 0;
let inflightRefresh = null;
let lastZohoConfigLogSignature = "";

function trimToString(value) {
  return String(value == null ? "" : value).trim();
}

function getEnvAny(...keys) {
  for (const key of keys) {
    const value = trimToString(process.env[key]);
    if (value) {
      return {
        value,
        key,
      };
    }
  }

  return {
    value: "",
    key: null,
  };
}

function normalizeBaseUrl(value) {
  return trimToString(value).replace(/\/+$/, "");
}

function joinUrl(base, suffix) {
  const left = normalizeBaseUrl(base);
  const right = String(suffix || "").replace(/^\/+/, "");
  return right ? `${left}/${right}` : left;
}

function detectAliasSet(resolvedEnvNames = {}) {
  const used = Object.values(resolvedEnvNames).filter(Boolean);
  if (!used.length) return "none";

  const allPreferred = used.every(
    (name) => name === "ZOHO_CRM_BASE" || name.startsWith("ZCRM_")
  );
  if (allPreferred) return "preferred";

  const allLegacy = used.every(
    (name) => !name.startsWith("ZCRM_") && name !== "ZOHO_CRM_BASE"
  );
  if (allLegacy) return "legacy";

  return "mixed";
}

function resolveZohoConfig() {
  const clientId = getEnvAny(...ZOHO_ENV_ALIASES.clientId);
  const clientSecret = getEnvAny(...ZOHO_ENV_ALIASES.clientSecret);
  const refreshToken = getEnvAny(...ZOHO_ENV_ALIASES.refreshToken);
  const oauthDomain = getEnvAny(...ZOHO_ENV_ALIASES.oauthDomain);
  const apiDomain = getEnvAny(...ZOHO_ENV_ALIASES.apiDomain);
  const crmBase = getEnvAny(...ZOHO_ENV_ALIASES.crmBase);

  const config = {
    clientId: clientId.value,
    clientSecret: clientSecret.value,
    refreshToken: refreshToken.value,
    oauthDomain: normalizeBaseUrl(oauthDomain.value),
    apiDomain: normalizeBaseUrl(apiDomain.value),
    crmBase: normalizeBaseUrl(crmBase.value),
    resolvedEnvNames: {
      clientId: clientId.key,
      clientSecret: clientSecret.key,
      refreshToken: refreshToken.key,
      oauthDomain: oauthDomain.key,
      apiDomain: apiDomain.key,
      crmBase: crmBase.key,
    },
  };

  return config;
}

function getZohoApiBase(input) {
  const config = input && input.config ? input.config : input;
  const explicitBase = normalizeBaseUrl(config?.crmBase);
  if (explicitBase) return explicitBase;

  const apiDomain = normalizeBaseUrl(config?.apiDomain);
  if (apiDomain) return apiDomain;

  return "https://www.zohoapis.com";
}

function getZohoConfigStatus() {
  const config = resolveZohoConfig();
  const missingRequiredKeys = [];

  if (!config.clientId) missingRequiredKeys.push("ZCRM_CLIENT_ID");
  if (!config.clientSecret) missingRequiredKeys.push("ZCRM_CLIENT_SECRET");
  if (!config.refreshToken) missingRequiredKeys.push("ZCRM_REFRESH_TOKEN");
  if (!config.oauthDomain) missingRequiredKeys.push("ZCRM_OAUTH_DOMAIN");
  if (!config.crmBase && !config.apiDomain) {
    missingRequiredKeys.push("ZOHO_CRM_BASE|ZCRM_API_DOMAIN");
  }

  return {
    enabled: missingRequiredKeys.length === 0,
    missingRequiredKeys,
    resolvedEnvNames: config.resolvedEnvNames,
    aliasSet: detectAliasSet(config.resolvedEnvNames),
    config,
  };
}

function logZohoConfigStatus(scope = "zoho") {
  const status = getZohoConfigStatus();
  const signature = JSON.stringify({
    enabled: status.enabled,
    missingRequiredKeys: status.missingRequiredKeys,
    resolvedEnvNames: status.resolvedEnvNames,
    aliasSet: status.aliasSet,
  });

  if (signature !== lastZohoConfigLogSignature) {
    lastZohoConfigLogSignature = signature;
    console.log(
      JSON.stringify({
        source: "zoho.config",
        scope,
        enabled: status.enabled,
        missingRequiredKeys: status.missingRequiredKeys,
        resolvedEnvNames: status.resolvedEnvNames,
        aliasSet: status.aliasSet,
      })
    );
  }

  return status;
}

function nowMs() {
  return Date.now();
}

function isTokenValid() {
  if (!cachedToken) return false;
  if (!cachedTokenExpMs) return false;
  return nowMs() < cachedTokenExpMs;
}

async function refreshZohoToken() {
  const status = logZohoConfigStatus("zoho.auth");

  if (!status.enabled) {
    const error = new Error("Zoho config incomplete");
    error.code = "ZOHO_CONFIG_INCOMPLETE";
    error.missingRequiredKeys = status.missingRequiredKeys.slice();
    throw error;
  }

  if (isTokenValid()) return cachedToken;
  if (inflightRefresh) return inflightRefresh;

  inflightRefresh = (async () => {
    try {
      const tokenUrl = joinUrl(status.config.oauthDomain, "/oauth/v2/token");

      console.log(
        JSON.stringify({
          source: "zoho.auth",
          event: "refresh_attempt",
        })
      );

      const res = await axios.post(tokenUrl, null, {
        params: {
          refresh_token: status.config.refreshToken,
          client_id: status.config.clientId,
          client_secret: status.config.clientSecret,
          grant_type: "refresh_token",
        },
        timeout: 12_000,
      });

      const data = res?.data || {};
      const token = trimToString(data.access_token);
      if (!token) {
        throw new Error("Zoho token refresh: no access_token in response");
      }

      const expiresInSec = Number(data.expires_in || 3600);
      cachedTokenExpMs =
        nowMs() + Math.max(0, expiresInSec - EXPIRY_SKEW_SEC) * 1000;
      cachedToken = token;

      console.log(
        JSON.stringify({
          source: "zoho.auth",
          event: "refresh_success",
          expiresInSec,
          cachedUntil: new Date(cachedTokenExpMs).toISOString(),
        })
      );

      return cachedToken;
    } catch (err) {
      cachedToken = null;
      cachedTokenExpMs = 0;

      const responseCode =
        err?.response?.data?.data?.[0]?.code ||
        err?.response?.data?.code ||
        null;
      const responseMessage =
        err?.response?.data?.data?.[0]?.message ||
        err?.response?.data?.message ||
        err.message;

      console.error(
        JSON.stringify({
          source: "zoho.auth",
          event: "refresh_failed",
          status: err?.response?.status || null,
          code: responseCode,
          message: responseMessage,
        })
      );

      throw err;
    } finally {
      inflightRefresh = null;
    }
  })();

  return inflightRefresh;
}

module.exports = {
  getZohoApiBase,
  getZohoConfigStatus,
  logZohoConfigStatus,
  refreshZohoToken,
  resolveZohoConfig,
};

Object.defineProperty(module.exports, "API_DOMAIN", {
  enumerable: true,
  get() {
    return resolveZohoConfig().apiDomain || "";
  },
});
