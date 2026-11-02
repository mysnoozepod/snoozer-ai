import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "docs", "p1-007", "SHOPIFY_MEDIA_INVENTORY.json");
const EXPECTED_STORE = "mysnoozepodtest.myshopify.com";
const EXPECTED_API_VERSION = "2025-10";
const LAMBDA_FUNCTION = "snoozer-backend";
const AWS_REGION = "us-east-1";

function fail(message) {
  throw new Error(message);
}

function readShopifyConnection() {
  const raw = execFileSync(
    "aws",
    [
      "lambda",
      "get-function-configuration",
      "--function-name",
      LAMBDA_FUNCTION,
      "--region",
      AWS_REGION,
      "--query",
      "Environment.Variables.{SHOPIFY_DOMAIN:SHOPIFY_DOMAIN,SHOPIFY_ADMIN_TOKEN:SHOPIFY_ADMIN_TOKEN,SHOPIFY_ADMIN_API_VERSION:SHOPIFY_ADMIN_API_VERSION}",
      "--output",
      "json",
      "--no-cli-pager",
    ],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: "1", AWS_PAGER: "" },
    },
  );
  const variables = JSON.parse(raw);
  const shop = variables.SHOPIFY_DOMAIN;
  const token = variables.SHOPIFY_ADMIN_TOKEN;
  const apiVersion = variables.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;

  if (shop !== EXPECTED_STORE) fail(`Refusing unexpected Shopify store: ${shop || "missing"}.`);
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected Admin API version: ${apiVersion}.`);
  if (!token) fail("SHOPIFY_ADMIN_TOKEN is unavailable from the existing development configuration.");
  return { shop, token, apiVersion };
}

const connection = readShopifyConnection();
const endpoint = `https://${connection.shop}/admin/api/${connection.apiVersion}/graphql.json`;

async function graphql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": connection.token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.errors) {
    const errors = payload?.errors?.map((error) => error.message) || [`HTTP ${response.status}`];
    fail(`Shopify Admin GraphQL failed: ${errors.join(" | ")}`);
  }
  return payload.data;
}

const QUERY = `
  query P1007MediaInventory {
    products(first: 250, sortKey: TITLE) {
      nodes {
        id
        legacyResourceId
        title
        handle
        status
        vendor
        productType
        updatedAt
        media(first: 100) {
          nodes {
            id
            alt
            mediaContentType
            status
            ... on MediaImage {
              image { id url altText width height }
            }
          }
        }
        variants(first: 250) {
          nodes {
            id
            legacyResourceId
            title
            sku
            selectedOptions { name value }
            image { id url altText width height }
          }
        }
      }
    }
    collections(first: 250, sortKey: TITLE) {
      nodes {
        id
        legacyResourceId
        title
        handle
        updatedAt
        image { id url altText width height }
        productsCount { count }
      }
    }
  }
`;

const data = await graphql(QUERY);
const inventory = {
  generatedAt: new Date().toISOString(),
  shop: connection.shop,
  apiVersion: connection.apiVersion,
  summary: {
    products: data.products.nodes.length,
    draftProducts: data.products.nodes.filter((product) => product.status === "DRAFT").length,
    productMedia: data.products.nodes.reduce((sum, product) => sum + product.media.nodes.length, 0),
    variants: data.products.nodes.reduce((sum, product) => sum + product.variants.nodes.length, 0),
    variantsWithMedia: data.products.nodes.reduce(
      (sum, product) => sum + product.variants.nodes.filter((variant) => variant.image).length,
      0,
    ),
    collections: data.collections.nodes.length,
    collectionsWithImages: data.collections.nodes.filter((collection) => collection.image).length,
  },
  products: data.products.nodes,
  collections: data.collections.nodes,
};

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
console.log(JSON.stringify(inventory.summary, null, 2));
console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}.`);
