import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASELINE_OUTPUT = path.join(ROOT, 'docs', 'catalog', 'catalog-shopping-restructure-before.json');
const CURRENT_OUTPUT = path.join(ROOT, 'docs', 'catalog', 'catalog-shopping-restructure-current-inspection.json');
const CAPTURE_CURRENT = process.argv.includes('--current');
const OVERWRITE_BASELINE = process.argv.includes('--overwrite-baseline');
const OUTPUT = CAPTURE_CURRENT ? CURRENT_OUTPUT : BASELINE_OUTPUT;
const EXPECTED_STORE = 'mysnoozepodtest.myshopify.com';
const EXPECTED_API_VERSION = '2025-10';
const LAMBDA_FUNCTION = 'snoozer-backend';
const AWS_REGION = 'us-east-1';

if (!CAPTURE_CURRENT && fs.existsSync(BASELINE_OUTPUT) && !OVERWRITE_BASELINE) {
  throw new Error('The immutable before snapshot already exists. Use --current for a fresh read-only inspection or --overwrite-baseline only during a deliberate baseline reset.');
}

function fail(message) {
  throw new Error(message);
}

function readConnection() {
  const raw = execFileSync(
    'aws',
    [
      'lambda',
      'get-function-configuration',
      '--function-name',
      LAMBDA_FUNCTION,
      '--region',
      AWS_REGION,
      '--query',
      'Environment.Variables.{SHOPIFY_DOMAIN:SHOPIFY_DOMAIN,SHOPIFY_ADMIN_TOKEN:SHOPIFY_ADMIN_TOKEN,SHOPIFY_ADMIN_API_VERSION:SHOPIFY_ADMIN_API_VERSION}',
      '--output',
      'json',
      '--no-cli-pager',
    ],
    { encoding: 'utf8', maxBuffer: 1024 * 1024, env: { ...process.env, PYTHONUTF8: '1', AWS_PAGER: '' } },
  );
  const values = JSON.parse(raw);
  const shop = values.SHOPIFY_DOMAIN;
  const token = values.SHOPIFY_ADMIN_TOKEN;
  const apiVersion = values.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;
  if (shop !== EXPECTED_STORE) fail(`Refusing unexpected Shopify store: ${shop || 'missing'}.`);
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected Admin API version: ${apiVersion}.`);
  if (!token) fail('SHOPIFY_ADMIN_TOKEN is unavailable from the existing development configuration.');
  return { shop, token, apiVersion };
}

const connection = readConnection();
const endpoint = `https://${connection.shop}/admin/api/${connection.apiVersion}/graphql.json`;

async function graphql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': connection.token },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.errors) {
    fail((payload?.errors || [{ message: `HTTP ${response.status}` }]).map((error) => error.message).join(' | '));
  }
  return payload.data;
}

const QUERY = `
  query CatalogShoppingRestructureInventory {
    products(first: 250, sortKey: TITLE) {
      nodes {
        id
        legacyResourceId
        title
        handle
        status
        vendor
        productType
        templateSuffix
        tags
        onlineStorePreviewUrl
        onlineStoreUrl
        media(first: 100) { nodes { id alt status ... on MediaImage { image { url altText width height } } } }
        variants(first: 250) {
          nodes {
            id
            legacyResourceId
            title
            sku
            price
            availableForSale
            selectedOptions { name value }
          }
        }
        collections(first: 100) { nodes { id legacyResourceId title handle } }
      }
    }
    collections(first: 250, sortKey: TITLE) {
      nodes {
        id
        legacyResourceId
        title
        handle
        descriptionHtml
        templateSuffix
        sortOrder
        updatedAt
        image { url altText width height }
        ruleSet { appliedDisjunctively rules { column relation condition } }
        products(first: 250) { nodes { id legacyResourceId title handle } }
      }
    }
    menus(first: 50) {
      nodes {
        id
        title
        handle
        items { id title type url resourceId items { id title type url resourceId items { id title type url resourceId } } }
      }
    }
    collectionRuleSetInput: __type(name: "CollectionRuleSetInput") { inputFields { name type { kind name ofType { kind name } } } }
    collectionRuleInput: __type(name: "CollectionRuleInput") { inputFields { name type { kind name ofType { kind name } } } }
    collectionRuleColumn: __type(name: "CollectionRuleColumn") { enumValues { name } }
    collectionRuleRelation: __type(name: "CollectionRuleRelation") { enumValues { name } }
    collectionDeleteInput: __type(name: "CollectionDeleteInput") { inputFields { name type { kind name ofType { kind name } } } }
  }
`;

const data = await graphql(QUERY);
const safeProducts = data.products.nodes.map((product) => {
  const { onlineStorePreviewUrl, ...safeProduct } = product;
  return {
    ...safeProduct,
    hasOnlineStorePreviewUrl: Boolean(onlineStorePreviewUrl),
  };
});
const snapshot = {
  generatedAt: new Date().toISOString(),
  shop: connection.shop,
  apiVersion: connection.apiVersion,
  summary: {
    products: data.products.nodes.length,
    draftProducts: data.products.nodes.filter((product) => product.status === 'DRAFT').length,
    taggedProducts: data.products.nodes.filter((product) => product.tags.length).length,
    variants: data.products.nodes.reduce((sum, product) => sum + product.variants.nodes.length, 0),
    collections: data.collections.nodes.length,
    automatedCollections: data.collections.nodes.filter((collection) => collection.ruleSet).length,
    manualCollections: data.collections.nodes.filter((collection) => !collection.ruleSet).length,
    menus: data.menus.nodes.length,
  },
  ...data,
  products: {
    ...data.products,
    nodes: safeProducts,
  },
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(snapshot.summary, null, 2));
console.log(`Wrote ${path.relative(ROOT, OUTPUT)}.`);
