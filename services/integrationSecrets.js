const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

const REGION = process.env.AWS_REGION || "us-east-1";
const DEFAULT_SECRET_TTL_MS = 5 * 60 * 1000;

const INTEGRATIONS = Object.freeze({
  openai: Object.freeze({
    pointerEnv: "OPENAI_SECRET_ID",
    credentialKeys: Object.freeze(["OPENAI_API_KEY"]),
  }),
  shopify: Object.freeze({
    pointerEnv: "SHOPIFY_SECRET_ID",
    credentialKeys: Object.freeze([
      "SHOPIFY_STOREFRONT_TOKEN",
      "SHOPIFY_ADMIN_TOKEN",
    ]),
  }),
  zoho: Object.freeze({
    pointerEnv: "ZOHO_SECRET_ID",
    credentialKeys: Object.freeze([
      "ZCRM_CLIENT_ID",
      "ZCRM_CLIENT_SECRET",
      "ZCRM_REFRESH_TOKEN",
    ]),
  }),
});

let secretsClient = new SecretsManagerClient({ region: REGION });
let now = () => Date.now();
const cache = new Map();
const inflight = new Map();

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function secretTtlMs() {
  const configured = Number(process.env.INTEGRATION_SECRET_TTL_MS);
  if (!Number.isFinite(configured)) return DEFAULT_SECRET_TTL_MS;
  return Math.max(1000, configured);
}

function getDefinition(integration) {
  const key = clean(integration).toLowerCase();
  const definition = INTEGRATIONS[key];
  if (!definition) {
    const error = new Error(`Unknown integration secret bundle: ${key || "missing"}`);
    error.code = "INTEGRATION_SECRET_UNKNOWN";
    throw error;
  }
  return { key, definition };
}

function getSecretId(integration) {
  const { definition } = getDefinition(integration);
  return clean(process.env[definition.pointerEnv]);
}

function decodeSecretPayload(response = {}) {
  if (typeof response.SecretString === "string") return response.SecretString;
  if (response.SecretBinary) {
    return Buffer.from(response.SecretBinary).toString("utf8");
  }
  return "";
}

function parseSecretBundle(response, integration) {
  const payload = decodeSecretPayload(response);
  if (!payload) {
    const error = new Error(`The ${integration} integration secret has no current value.`);
    error.code = "INTEGRATION_SECRET_EMPTY";
    throw error;
  }

  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Secret payload must be a JSON object");
    }
    return parsed;
  } catch (cause) {
    const error = new Error(`The ${integration} integration secret is not valid JSON.`);
    error.code = "INTEGRATION_SECRET_INVALID";
    throw error;
  }
}

function selectCredentialKeys(bundle, credentialKeys) {
  const selected = {};
  for (const key of credentialKeys) {
    selected[key] = clean(bundle?.[key]);
  }
  return selected;
}

async function getSecretBundle(integration, { forceRefresh = false } = {}) {
  const { key, definition } = getDefinition(integration);
  const secretId = getSecretId(key);
  if (!secretId) return null;

  const cacheKey = `${key}:${secretId}`;
  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached && now() - cached.loadedAt < secretTtlMs()) {
    return { ...cached.value };
  }

  if (!forceRefresh && inflight.has(cacheKey)) {
    return inflight.get(cacheKey);
  }

  const request = (async () => {
    try {
      const response = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: secretId })
      );
      const parsed = parseSecretBundle(response, key);
      const selected = selectCredentialKeys(parsed, definition.credentialKeys);
      cache.set(cacheKey, { value: selected, loadedAt: now() });
      return { ...selected };
    } catch (cause) {
      if (cause?.code && String(cause.code).startsWith("INTEGRATION_SECRET_")) {
        throw cause;
      }
      const error = new Error(`Unable to load the ${key} integration secret.`);
      error.code = "INTEGRATION_SECRET_UNAVAILABLE";
      error.integration = key;
      throw error;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, request);
  return request;
}

async function getIntegrationCredentials(integration) {
  const { key, definition } = getDefinition(integration);
  const secretId = getSecretId(key);
  if (secretId) return getSecretBundle(key);
  return selectCredentialKeys(process.env, definition.credentialKeys);
}

function getSecretPointerStatus(integration) {
  const { key, definition } = getDefinition(integration);
  const secretId = getSecretId(key);
  return {
    integration: key,
    pointerEnv: definition.pointerEnv,
    configured: Boolean(secretId),
    secretId: secretId || null,
  };
}

function resetForTests() {
  cache.clear();
  inflight.clear();
  now = () => Date.now();
}

function setSecretsClientForTests(client) {
  if (!client || typeof client.send !== "function") {
    throw new TypeError("Secrets Manager test client must implement send().");
  }
  secretsClient = client;
  cache.clear();
  inflight.clear();
}

function setNowForTests(nextNow) {
  if (typeof nextNow !== "function") throw new TypeError("Test clock must be a function.");
  now = nextNow;
}

module.exports = {
  DEFAULT_SECRET_TTL_MS,
  getIntegrationCredentials,
  getSecretBundle,
  getSecretId,
  getSecretPointerStatus,
  _resetForTests: resetForTests,
  _setNowForTests: setNowForTests,
  _setSecretsClientForTests: setSecretsClientForTests,
};
