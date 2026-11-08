import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  bedgearBrandDescriptionHtml,
  bedgearDescriptionSource,
  bedgearOfficialProductCopy,
  bedgearOfficialProductDescriptionHtml,
  bedgearProductHandles,
  mattressCustomerFacingHandles,
} from '../content/bedgear-brand-description.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const READBACK_PATH = path.join(ROOT, 'docs', 'catalog', 'BEDGEAR_PRODUCT_DESCRIPTIONS_SHOPIFY_READBACK.json');
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\bedgear-product-descriptions';
const EXPECTED_STORE = 'mysnoozepodtest.myshopify.com';
const EXPECTED_API_VERSION = '2025-10';
const LAMBDA_FUNCTION = 'snoozer-backend';
const AWS_REGION = 'us-east-1';
const APPLY = process.argv.includes('--apply');
const MARKER_PATTERN = /<div[^>]*data-mysnoozepod-bedgear-boilerplate=["'][^"']+["'][^>]*>[\s\S]*?<\/div>/i;
const PRODUCT_COPY_PATTERN = /<div[^>]*data-mysnoozepod-(?:bedgear|mattress)-product-copy=["'][^"']+["'][^>]*>[\s\S]*?<\/div>/i;

function fail(message) { throw new Error(message); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function requireNoUserErrors(errors, label) {
  if (errors?.length) fail(`${label}: ${errors.map((error) => `${error.field || 'input'}: ${error.message}`).join(' | ')}`);
}

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
  if (shop !== EXPECTED_STORE) fail(`Refusing unexpected Shopify store ${shop || 'missing'}.`);
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected Admin API version ${apiVersion}.`);
  if (!token) fail('SHOPIFY_ADMIN_TOKEN is unavailable from the existing development configuration.');
  return { shop, token, apiVersion };
}

const connection = readConnection();
const endpoint = `https://${connection.shop}/admin/api/${connection.apiVersion}/graphql.json`;

async function graphql(query, variables = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': connection.token },
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json().catch(() => null);
    const errors = payload?.errors?.map((error) => error.message) || [];
    if (errors.length && errors.every((message) => /throttled/i.test(message)) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      continue;
    }
    if (!response.ok || !payload || errors.length) {
      fail(`Shopify Admin GraphQL failed: ${(errors.length ? errors : [`HTTP ${response.status}`]).join(' | ')}`);
    }
    return payload.data;
  }
  fail('Shopify Admin GraphQL remained throttled after bounded retries.');
}

const INSPECT = `query BedgearDescriptionInspection {
  products(first: 250) {
    nodes {
      id legacyResourceId title handle status vendor productType descriptionHtml tags templateSuffix
      variants(first: 100) { nodes { id legacyResourceId title sku price selectedOptions { name value } } }
    }
  }
}`;

const PRODUCT_UPDATE = `mutation UpdateBedgearDescription($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { id handle status vendor descriptionHtml }
    userErrors { field message }
  }
}`;

function immutableFingerprint(product) {
  return sha256(JSON.stringify({
    id: product.id,
    legacyResourceId: product.legacyResourceId,
    handle: product.handle,
    status: product.status,
    vendor: product.vendor,
    productType: product.productType,
    tags: [...product.tags].sort(),
    templateSuffix: product.templateSuffix,
    variants: product.variants.nodes.map((variant) => ({
      id: variant.id,
      legacyResourceId: variant.legacyResourceId,
      title: variant.title,
      sku: variant.sku,
      price: variant.price,
      selectedOptions: variant.selectedOptions,
    })),
  }));
}

function normalizeHtml(value) {
  return String(value || '').trim().replace(/>\s+</g, '><');
}

function expectedDescription(currentHtml, handle) {
  const current = String(currentHtml || '').trim();
  const officialHtml = bedgearOfficialProductDescriptionHtml(handle);
  let expected = current;
  if (officialHtml) {
    if (PRODUCT_COPY_PATTERN.test(expected)) {
      const existingOfficialBlock = expected.match(PRODUCT_COPY_PATTERN)?.[0] || '';
      if (normalizeHtml(existingOfficialBlock) !== normalizeHtml(officialHtml)) {
        expected = expected.replace(PRODUCT_COPY_PATTERN, officialHtml);
      }
    } else {
      expected = `${officialHtml}${expected}`;
    }
  }
  if (mattressCustomerFacingHandles.includes(handle)) {
    return expected.replace(MARKER_PATTERN, '');
  }
  if (!expected) return bedgearBrandDescriptionHtml;
  if (MARKER_PATTERN.test(expected)) {
    const existingBlock = expected.match(MARKER_PATTERN)?.[0] || '';
    if (normalizeHtml(existingBlock) === normalizeHtml(bedgearBrandDescriptionHtml)) return expected;
    return expected.replace(MARKER_PATTERN, bedgearBrandDescriptionHtml);
  }
  return `${expected}${bedgearBrandDescriptionHtml}`;
}

function buildPlan(products) {
  if (products.length !== 43) fail(`Expected the preserved 43-product catalog, found ${products.length}.`);
  const byHandle = new Map(products.map((product) => [product.handle, product]));
  const expectedHandles = new Set(bedgearProductHandles);
  const actualBedgearHandles = products
    .filter((product) => String(product.vendor).trim().toUpperCase() === 'BEDGEAR')
    .map((product) => product.handle)
    .sort();
  const expectedSorted = [...expectedHandles].sort();
  if (JSON.stringify(actualBedgearHandles) !== JSON.stringify(expectedSorted)) {
    fail(`BEDGEAR vendor set does not match the approved 20-product mapping. Actual: ${actualBedgearHandles.join(', ')}`);
  }

  const changes = [];
  const unchanged = [];
  for (const handle of bedgearProductHandles) {
    const product = byHandle.get(handle);
    if (!product) fail(`Missing expected BEDGEAR product ${handle}.`);
    if (!['DRAFT', 'ACTIVE'].includes(product.status)) fail(`Refusing unexpected ${product.status} status for BEDGEAR product ${handle}.`);
    const descriptionHtml = expectedDescription(product.descriptionHtml, handle);
    const record = {
      id: product.id,
      handle,
      title: product.title,
      status: product.status,
      action: descriptionHtml === String(product.descriptionHtml || '').trim() ? 'unchanged' : product.descriptionHtml ? 'append-or-refresh' : 'create',
      previousLength: String(product.descriptionHtml || '').length,
      expectedLength: descriptionHtml.length,
      descriptionHtml,
    };
    (record.action === 'unchanged' ? unchanged : changes).push(record);
  }
  return { changes, unchanged };
}

function summary(plan) {
  return {
    mode: APPLY ? 'apply' : 'plan',
    store: connection.shop,
    source: bedgearDescriptionSource,
    matchedProducts: bedgearProductHandles.length,
    officialProductMatches: Object.keys(bedgearOfficialProductCopy).length,
    create: plan.changes.filter((item) => item.action === 'create').length,
    appendOrRefresh: plan.changes.filter((item) => item.action === 'append-or-refresh').length,
    unchanged: plan.unchanged.length,
    products: [...plan.changes, ...plan.unchanged].map(({ descriptionHtml, ...item }) => item),
  };
}

const beforeData = await graphql(INSPECT);
const beforeProducts = beforeData.products.nodes;
const beforeFingerprints = new Map(beforeProducts.map((product) => [product.handle, immutableFingerprint(product)]));
const plan = buildPlan(beforeProducts);
console.log(JSON.stringify(summary(plan), null, 2));

if (!APPLY) {
  console.log('Plan only: no Shopify products were changed. Re-run with --apply after reviewing the exact targets.');
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(BACKUP_ROOT, timestamp);
fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(path.join(backupDir, 'before.json'), JSON.stringify({
  capturedAt: new Date().toISOString(),
  store: connection.shop,
  source: bedgearDescriptionSource,
  products: beforeProducts.filter((product) => bedgearProductHandles.includes(product.handle)).map((product) => ({
    id: product.id,
    handle: product.handle,
    title: product.title,
    status: product.status,
    vendor: product.vendor,
    descriptionHtml: product.descriptionHtml,
  })),
}, null, 2));

for (const item of plan.changes) {
  const data = await graphql(PRODUCT_UPDATE, { product: { id: item.id, descriptionHtml: item.descriptionHtml } });
  requireNoUserErrors(data.productUpdate.userErrors, `Update ${item.handle}`);
}

const afterData = await graphql(INSPECT);
const afterProducts = afterData.products.nodes;
const afterPlan = buildPlan(afterProducts);
if (afterPlan.changes.length) fail(`Post-write verification found ${afterPlan.changes.length} remaining description changes.`);
for (const product of afterProducts) {
  if (beforeFingerprints.get(product.handle) !== immutableFingerprint(product)) {
    fail(`Immutable catalog fields changed unexpectedly for ${product.handle}.`);
  }
}

const readback = {
  generatedAt: new Date().toISOString(),
  store: connection.shop,
  backupDir,
  source: bedgearDescriptionSource,
  summary: {
    catalogProducts: afterProducts.length,
    bedgearProducts: bedgearProductHandles.length,
    descriptionsVerified: afterPlan.unchanged.length,
    productStatusCounts: Object.fromEntries(
      [...new Set(afterProducts.map((product) => product.status))]
        .sort()
        .map((status) => [status, afterProducts.filter((product) => product.status === status).length]),
    ),
  },
  products: afterProducts
    .filter((product) => bedgearProductHandles.includes(product.handle))
    .map((product) => ({
      id: product.id,
      handle: product.handle,
      title: product.title,
      status: product.status,
      vendor: product.vendor,
      descriptionLength: product.descriptionHtml.length,
      descriptionSha256: sha256(product.descriptionHtml),
      containsOfficialBedgearBoilerplate: /data-mysnoozepod-bedgear-boilerplate/i.test(product.descriptionHtml),
      containsOfficialProductCopy: /data-mysnoozepod-bedgear-product-copy/i.test(product.descriptionHtml),
      officialSourceUrl: bedgearOfficialProductCopy[product.handle]?.sourceUrl || null,
    }))
    .sort((a, b) => a.handle.localeCompare(b.handle)),
};
fs.writeFileSync(READBACK_PATH, JSON.stringify(readback, null, 2));
console.log(`Verified ${readback.summary.descriptionsVerified} BEDGEAR descriptions. Backup: ${backupDir}`);

