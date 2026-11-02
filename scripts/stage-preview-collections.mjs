import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'docs', 'catalog', 'STOREFRONT_SKELETON_MANIFEST.json');
const EXPECTED_STORE = 'mysnoozepodtest.myshopify.com';
const EXPECTED_API_VERSION = '2025-10';
const LAMBDA_FUNCTION = 'snoozer-backend';
const AWS_REGION = 'us-east-1';
const APPLY = process.argv.includes('--apply');

function fail(message) { throw new Error(message); }

function readConnection() {
  const raw = execFileSync('aws', [
    'lambda', 'get-function-configuration', '--function-name', LAMBDA_FUNCTION, '--region', AWS_REGION,
    '--query', 'Environment.Variables.{SHOPIFY_DOMAIN:SHOPIFY_DOMAIN,SHOPIFY_ADMIN_TOKEN:SHOPIFY_ADMIN_TOKEN,SHOPIFY_ADMIN_API_VERSION:SHOPIFY_ADMIN_API_VERSION}',
    '--output', 'json', '--no-cli-pager',
  ], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', AWS_PAGER: '' } });
  const variables = JSON.parse(raw);
  const shop = variables.SHOPIFY_DOMAIN;
  const token = variables.SHOPIFY_ADMIN_TOKEN;
  const apiVersion = variables.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;
  if (shop !== EXPECTED_STORE) fail(`Refusing unexpected store ${shop || 'missing'}.`);
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected API version ${apiVersion}.`);
  if (!token) fail('Missing Shopify Admin token.');
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
  const errors = payload?.errors?.map((error) => error.message) || [];
  if (!response.ok || !payload || errors.length) fail(`Shopify GraphQL failed: ${errors.join(' | ') || `HTTP ${response.status}`}`);
  return payload.data;
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const expectedHandles = manifest.collections.map((collection) => collection.handle).sort();
const inspection = await graphql(`
  query PreviewCollectionPublicationInspection {
    publications(first: 50) { nodes { id name } }
    collections(first: 250) {
      nodes {
        id legacyResourceId handle title
        resourcePublicationsV2(first: 50) { nodes { isPublished publication { id name } } }
      }
    }
    products(first: 250) { nodes { handle status } }
  }
`);

const onlineStore = inspection.publications.nodes.find((publication) => publication.name === 'Online Store');
if (!onlineStore) fail('Online Store publication was not found.');
const collections = new Map(inspection.collections.nodes.map((collection) => [collection.handle, collection]));
const missingCollections = expectedHandles.filter((handle) => !collections.has(handle));
if (missingCollections.length) fail(`Missing expected collections: ${missingCollections.join(', ')}.`);
if (!inspection.products.nodes.every((product) => product.status === 'DRAFT')) fail('Refusing preview publication because not every catalog product is Draft.');

const pending = expectedHandles.filter((handle) => {
  const collection = collections.get(handle);
  return !collection.resourcePublicationsV2.nodes.some((resource) => resource.publication.id === onlineStore.id && resource.isPublished);
});

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'plan',
  store: connection.shop,
  publication: { id: onlineStore.id, name: onlineStore.name },
  expectedCollections: expectedHandles.length,
  alreadyPublished: expectedHandles.length - pending.length,
  pending,
  productBoundary: { count: inspection.products.nodes.length, statuses: [...new Set(inspection.products.nodes.map((product) => product.status))] },
}, null, 2));

if (!APPLY) {
  console.log('Plan only: no collection publication changed.');
} else {
for (const handle of pending) {
  const collection = collections.get(handle);
  const result = await graphql(`
    mutation PublishPreviewCollection($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) { userErrors { field message } }
    }
  `, { id: collection.id, input: [{ publicationId: onlineStore.id }] });
  const userErrors = result.publishablePublish.userErrors || [];
  if (userErrors.length) fail(`${handle}: ${userErrors.map((error) => error.message).join(' | ')}`);
  console.log(`Published collection shell ${handle} to the password-protected development Online Store.`);
}

const verify = await graphql(`
  query VerifyPreviewCollections {
    collections(first: 250) {
      nodes { handle resourcePublicationsV2(first: 50) { nodes { isPublished publication { id } } } }
    }
    products(first: 250) { nodes { status } }
  }
`);
const verified = new Map(verify.collections.nodes.map((collection) => [collection.handle, collection]));
const unresolved = expectedHandles.filter((handle) => !verified.get(handle)?.resourcePublicationsV2.nodes.some((resource) => resource.publication.id === onlineStore.id && resource.isPublished));
if (unresolved.length) fail(`Collection publication readback failed: ${unresolved.join(', ')}.`);
if (!verify.products.nodes.every((product) => product.status === 'DRAFT')) fail('Product Draft boundary changed unexpectedly.');
console.log(`Verified ${expectedHandles.length} collection shells on Online Store; all ${verify.products.nodes.length} products remain Draft.`);
}
