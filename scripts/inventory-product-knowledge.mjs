import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUTPUT = path.join(ROOT, 'docs', 'product-knowledge', 'PRODUCT_KNOWLEDGE_INVENTORY.json');
const EXPECTED_STORE = 'mysnoozepodtest.myshopify.com';
const EXPECTED_API_VERSION = '2025-10';
const LAMBDA_FUNCTION = 'snoozer-backend';
const AWS_REGION = 'us-east-1';

function fail(message) {
  throw new Error(message);
}

function connection() {
  const raw = execFileSync('aws', [
    'lambda', 'get-function-configuration',
    '--function-name', LAMBDA_FUNCTION,
    '--region', AWS_REGION,
    '--query', 'Environment.Variables.{SHOPIFY_DOMAIN:SHOPIFY_DOMAIN,SHOPIFY_ADMIN_TOKEN:SHOPIFY_ADMIN_TOKEN,SHOPIFY_ADMIN_API_VERSION:SHOPIFY_ADMIN_API_VERSION}',
    '--output', 'json',
    '--no-cli-pager',
  ], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: '1', AWS_PAGER: '' },
  });
  const values = JSON.parse(raw);
  const apiVersion = values.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;
  if (values.SHOPIFY_DOMAIN !== EXPECTED_STORE) fail(`Refusing unexpected Shopify store ${values.SHOPIFY_DOMAIN || 'missing'}.`);
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected Admin API version ${apiVersion}.`);
  if (!values.SHOPIFY_ADMIN_TOKEN) fail('SHOPIFY_ADMIN_TOKEN is unavailable from the existing development configuration.');
  return { shop: values.SHOPIFY_DOMAIN, token: values.SHOPIFY_ADMIN_TOKEN, apiVersion };
}

const shopify = connection();
const endpoint = `https://${shopify.shop}/admin/api/${shopify.apiVersion}/graphql.json`;

async function graphql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': shopify.token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.errors) {
    const errors = payload?.errors?.map((error) => error.message) || [`HTTP ${response.status}`];
    fail(`Shopify Admin GraphQL failed: ${errors.join(' | ')}`);
  }
  return payload.data;
}

const BASE_QUERY = `
  query ProductKnowledgeInventory {
    products(first: 100, sortKey: TITLE) {
      nodes {
        id legacyResourceId title handle status vendor productType templateSuffix
        descriptionHtml tags updatedAt
        category { id name fullName }
        collections(first: 50) { nodes { id handle title } }
        media(first: 1) { nodes { id } }
        variants(first: 250) {
          nodes {
            id legacyResourceId title sku barcode price updatedAt
            selectedOptions { name value }
            inventoryPolicy
            inventoryItem { tracked requiresShipping }
          }
        }
      }
    }
    productDefinitions: metafieldDefinitions(first: 250, ownerType: PRODUCT) {
      nodes {
        id name namespace key description ownerType pinnedPosition
        type { name }
        validations { name value }
      }
    }
    variantDefinitions: metafieldDefinitions(first: 250, ownerType: PRODUCTVARIANT) {
      nodes {
        id name namespace key description ownerType pinnedPosition
        type { name }
        validations { name value }
      }
    }
    metaobjectDefinitions(first: 250) {
      nodes {
        id name type description
        fieldDefinitions { key name description required type { name } validations { name value } }
      }
    }
  }
`;

const OWNER_FIELDS_QUERY = `
  query ProductKnowledgeOwnerFields($ids: [ID!]!) {
    nodes(ids: $ids) {
      id
      ... on Product {
        metafields(first: 100) {
          nodes { id namespace key type value compareDigest updatedAt definition { id } }
        }
      }
      ... on ProductVariant {
        metafields(first: 100) {
          nodes { id namespace key type value compareDigest updatedAt definition { id } }
        }
      }
    }
  }
`;

async function main() {
  const data = await graphql(BASE_QUERY);
  if (data.products.nodes.length !== 43) fail(`Expected 43 Shopify products, received ${data.products.nodes.length}.`);

  const owners = data.products.nodes.flatMap((product) => [product.id, ...product.variants.nodes.map((variant) => variant.id)]);
  const metafieldsByOwner = new Map();
  for (let offset = 0; offset < owners.length; offset += 10) {
    const batch = owners.slice(offset, offset + 10);
    const result = await graphql(OWNER_FIELDS_QUERY, { ids: batch });
    for (const node of result.nodes) {
      if (!node) fail('Shopify returned a missing owner while inventorying metafields.');
      metafieldsByOwner.set(node.id, node.metafields.nodes);
    }
  }

  const products = data.products.nodes.map((product) => ({
    ...product,
    metafields: metafieldsByOwner.get(product.id) || [],
    variants: product.variants.nodes.map((variant) => ({
      ...variant,
      metafields: metafieldsByOwner.get(variant.id) || [],
    })),
  }));
  const allMetafields = products.flatMap((product) => [
    ...product.metafields.map((field) => ({ ...field, ownerType: 'PRODUCT', ownerId: product.id, ownerHandle: product.handle })),
    ...product.variants.flatMap((variant) => variant.metafields.map((field) => ({
      ...field,
      ownerType: 'PRODUCTVARIANT',
      ownerId: variant.id,
      ownerHandle: product.handle,
      ownerSku: variant.sku,
    }))),
  ]);
  const namespaces = [...new Set(allMetafields.map((field) => field.namespace))].sort();
  const summary = {
    productCount: products.length,
    variantCount: products.reduce((count, product) => count + product.variants.length, 0),
    productDefinitionCount: data.productDefinitions.nodes.length,
    variantDefinitionCount: data.variantDefinitions.nodes.length,
    metaobjectDefinitionCount: data.metaobjectDefinitions.nodes.length,
    metafieldValueCount: allMetafields.length,
    productMetafieldValueCount: allMetafields.filter((field) => field.ownerType === 'PRODUCT').length,
    variantMetafieldValueCount: allMetafields.filter((field) => field.ownerType === 'PRODUCTVARIANT').length,
    namespaces,
    statuses: Object.fromEntries([...new Set(products.map((product) => product.status))].sort().map((status) => [status, products.filter((product) => product.status === status).length])),
  };

  const inventory = {
    schemaVersion: '1.0.0',
    capturedAt: new Date().toISOString(),
    store: shopify.shop,
    apiVersion: shopify.apiVersion,
    summary,
    definitions: {
      product: data.productDefinitions.nodes,
      productVariant: data.variantDefinitions.nodes,
      metaobject: data.metaobjectDefinitions.nodes,
    },
    products,
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(JSON.stringify({ output: path.relative(ROOT, OUTPUT), ...summary }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
