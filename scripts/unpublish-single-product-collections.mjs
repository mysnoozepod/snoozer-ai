import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const APPLY = process.argv.includes('--apply');
const EXPECTED_STORE = 'mysnoozepodtest.myshopify.com';
const EXPECTED_API_VERSION = '2025-10';
const HANDLES = Object.freeze(['s7', 'h6', 'm3', 'm5', 'flex-l', 'flex-lsx', 'flex-sh']);
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\single-product-collection-cleanup';
const READBACK_PATH = path.join(ROOT, 'docs', 'catalog', 'SINGLE_PRODUCT_COLLECTION_CLEANUP_READBACK.json');

function fail(message) { throw new Error(message); }
function requireNoUserErrors(errors, label) {
  if (errors?.length) fail(`${label}: ${errors.map((error) => error.message).join(' | ')}`);
}

const variables = JSON.parse(execFileSync('aws', [
  'lambda', 'get-function-configuration', '--function-name', 'snoozer-backend', '--region', 'us-east-1',
  '--query', 'Environment.Variables.{SHOPIFY_DOMAIN:SHOPIFY_DOMAIN,SHOPIFY_ADMIN_TOKEN:SHOPIFY_ADMIN_TOKEN,SHOPIFY_ADMIN_API_VERSION:SHOPIFY_ADMIN_API_VERSION}',
  '--output', 'json', '--no-cli-pager',
], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', AWS_PAGER: '' } }));

if (variables.SHOPIFY_DOMAIN !== EXPECTED_STORE) fail(`Refusing unexpected store ${variables.SHOPIFY_DOMAIN || 'missing'}.`);
if ((variables.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION) !== EXPECTED_API_VERSION) fail('Unexpected Shopify API version.');
if (!variables.SHOPIFY_ADMIN_TOKEN) fail('Shopify Admin token is unavailable from the existing development configuration.');

const endpoint = `https://${EXPECTED_STORE}/admin/api/${EXPECTED_API_VERSION}/graphql.json`;
async function graphql(query, input = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': variables.SHOPIFY_ADMIN_TOKEN },
    body: JSON.stringify({ query, variables: input }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.errors?.length) fail(`Shopify GraphQL failed: ${JSON.stringify(payload?.errors || response.status)}.`);
  return payload.data;
}

const INSPECT = `query SingleProductCollectionCleanup {
  publications(first: 50) { nodes { id name } }
  collections(first: 250) {
    nodes {
      id handle title
      products(first: 10) { nodes { id handle title } }
      resourcePublicationsV2(first: 50) { nodes { isPublished publication { id name } } }
    }
  }
}`;
const UNPUBLISH = `mutation UnpublishSingleProductCollection($id: ID!, $input: [PublicationInput!]!) {
  publishableUnpublish(id: $id, input: $input) { userErrors { field message } }
}`;

function targets(data) {
  const onlineStore = data.publications.nodes.find((publication) => publication.name === 'Online Store');
  if (!onlineStore) fail('Online Store publication was not found.');
  const byHandle = new Map(data.collections.nodes.map((collection) => [collection.handle, collection]));
  return {
    onlineStore,
    collections: HANDLES.map((handle) => {
      const collection = byHandle.get(handle);
      if (!collection) fail(`Expected collection ${handle} was not found.`);
      if (collection.products.nodes.length !== 1) fail(`Refusing ${handle}: expected exactly one product, found ${collection.products.nodes.length}.`);
      return {
        ...collection,
        onlineStorePublished: collection.resourcePublicationsV2.nodes.some((entry) => entry.publication.id === onlineStore.id && entry.isPublished),
      };
    }),
  };
}

const before = await graphql(INSPECT);
const plan = targets(before);
console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'plan',
  store: EXPECTED_STORE,
  action: 'unpublish-from-online-store-without-deleting',
  collections: plan.collections.map((collection) => ({
    handle: collection.handle,
    product: collection.products.nodes[0].handle,
    action: collection.onlineStorePublished ? 'unpublish' : 'unchanged',
  })),
}, null, 2));

if (!APPLY) process.exit(0);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(BACKUP_ROOT, stamp);
fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(path.join(backupDir, 'before.json'), `${JSON.stringify({ capturedAt: new Date().toISOString(), store: EXPECTED_STORE, collections: plan.collections }, null, 2)}\n`);

for (const collection of plan.collections) {
  if (!collection.onlineStorePublished) continue;
  const result = await graphql(UNPUBLISH, { id: collection.id, input: [{ publicationId: plan.onlineStore.id }] });
  requireNoUserErrors(result.publishableUnpublish.userErrors, `Could not unpublish ${collection.handle}`);
}

const after = targets(await graphql(INSPECT));
if (after.collections.some((collection) => collection.onlineStorePublished)) fail('One or more single-product collections remain published to Online Store.');
const readback = {
  generatedAt: new Date().toISOString(),
  store: EXPECTED_STORE,
  backupDir,
  outcome: 'Seven single-product collections retained in Admin but unpublished from Online Store.',
  collections: after.collections.map((collection) => ({
    id: collection.id,
    handle: collection.handle,
    productHandle: collection.products.nodes[0].handle,
    onlineStorePublished: collection.onlineStorePublished,
  })),
};
fs.writeFileSync(READBACK_PATH, `${JSON.stringify(readback, null, 2)}\n`);
console.log(`Verified ${after.collections.length} single-product collections are unpublished. Backup: ${backupDir}`);
