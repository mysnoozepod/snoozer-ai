const DEFAULT_SHOPIFY_API_VERSION = "2025-10";
const SHOPIFY_API_VERSION_PATTERN = /^\d{4}-(01|04|07|10)$/;

function resolveShopifyApiVersion(environmentName) {
  const configured = String(process.env[environmentName] || "").trim();
  const version = configured || DEFAULT_SHOPIFY_API_VERSION;

  if (!SHOPIFY_API_VERSION_PATTERN.test(version)) {
    const error = new Error(
      `${environmentName} must be an explicit Shopify API version in YYYY-MM quarterly format.`
    );
    error.code = "SHOPIFY_API_VERSION_INVALID";
    error.environmentName = environmentName;
    throw error;
  }

  return version;
}

const SHOPIFY_STOREFRONT_API_VERSION = resolveShopifyApiVersion(
  "SHOPIFY_STOREFRONT_API_VERSION"
);
const SHOPIFY_ADMIN_API_VERSION = resolveShopifyApiVersion("SHOPIFY_ADMIN_API_VERSION");

function normalizeShopifyDomain(domain) {
  return String(domain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function buildStorefrontGraphqlEndpoint(domain) {
  return `https://${normalizeShopifyDomain(domain)}/api/${SHOPIFY_STOREFRONT_API_VERSION}/graphql.json`;
}

function buildAdminApiBaseUrl(domain) {
  return `https://${normalizeShopifyDomain(domain)}/admin/api/${SHOPIFY_ADMIN_API_VERSION}`;
}

module.exports = {
  DEFAULT_SHOPIFY_API_VERSION,
  SHOPIFY_STOREFRONT_API_VERSION,
  SHOPIFY_ADMIN_API_VERSION,
  buildStorefrontGraphqlEndpoint,
  buildAdminApiBaseUrl,
};
