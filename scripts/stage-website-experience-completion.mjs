import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXPECTED_STORE = 'mysnoozepodtest.myshopify.com';
const EXPECTED_API_VERSION = '2025-10';
const LAMBDA_FUNCTION = 'snoozer-backend';
const AWS_REGION = 'us-east-1';
const APPLY = process.argv.includes('--apply');
const PUBLISHED_THEME_ID = '139460542525';
const UNPUBLISHED_THEME_ID = '139216420925';
const EXPECTED_THEME_NAME = 'snoozer-ai/main';
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\website-experience-completion';
const READBACK_PATH = path.join(ROOT, 'docs', 'website-experience', 'WEBSITE_EXPERIENCE_SHOPIFY_READBACK.json');
const WARRANTY_SIGNATURE = '<!-- mysnoozepod-warranty-support-structure-v1 -->';

const themeAssets = [
  'sections/snoozepod-footer-navigation.liquid',
  'sections/snoozepod-mattress-showcase.liquid',
  'sections/snoozepod-meet-snoozer.liquid',
  'sections/snoozer-landing-booking.liquid',
  'sections/header.liquid',
  'sections/footer-group.json',
  'templates/index.json',
  'templates/collection.snoozepod-v1.json',
  'templates/product.snoozepod-v1.json',
  'templates/page.landing-booking.json',
];

const desiredPageTemplates = new Map([
  ['book-a-snooze-session', 'landing-booking'],
  ['snooze-assessment', 'landing-assessment'],
]);

const warrantyPage = {
  title: 'Warranty Support',
  handle: 'warranty-support',
  templateSuffix: '',
  isPublished: true,
  body: `${WARRANTY_SIGNATURE}\n<h2>Product-specific warranty support</h2>\n<p>Warranty coverage and service requirements vary by product and manufacturer. Review the verified warranty information shown with the product, retain your order information, and contact MySnoozePod for help identifying the correct support path.</p>\n<h2>Before requesting support</h2>\n<ul>\n<li>Have your order number and product model available.</li>\n<li>Keep manufacturer labels and law tags attached where applicable.</li>\n<li>Photograph the product and the concern before moving or disposing of it.</li>\n</ul>\n<p><a href="/pages/contact-us">Contact MySnoozePod for warranty and order support</a>.</p>`,
};

function fail(message) { throw new Error(message); }
function sha256(value) { return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex'); }
function stripJsonHeader(value) { return String(value || '').replace(/^\/\*[\s\S]*?\*\//, '').trim(); }
function normalizedAssetValue(key, value) {
  if (!key.endsWith('.json')) return String(value || '').replace(/\r\n/g, '\n');
  return JSON.stringify(JSON.parse(stripJsonHeader(value)));
}
function assetsMatch(key, current, desired) {
  if (typeof current !== 'string') return false;
  try { return normalizedAssetValue(key, current) === normalizedAssetValue(key, desired); } catch { return false; }
}
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
  if (variables.SHOPIFY_DOMAIN !== EXPECTED_STORE) fail(`Refusing unexpected Shopify store ${variables.SHOPIFY_DOMAIN || 'missing'}.`);
  const apiVersion = variables.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected Admin API version ${apiVersion}.`);
  if (!variables.SHOPIFY_ADMIN_TOKEN) fail('SHOPIFY_ADMIN_TOKEN is unavailable from the existing development configuration.');
  return { shop: variables.SHOPIFY_DOMAIN, token: variables.SHOPIFY_ADMIN_TOKEN, apiVersion };
}

const connection = readConnection();
const restEndpoint = `https://${connection.shop}/admin/api/${connection.apiVersion}`;
const graphqlEndpoint = `${restEndpoint}/graphql.json`;

async function graphql(query, variables = {}) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(graphqlEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': connection.token },
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json().catch(() => null);
    const errors = payload?.errors?.map((error) => error.message) || [];
    if ((response.status === 429 || (errors.length && errors.every((message) => /throttled/i.test(message)))) && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
      continue;
    }
    if (!response.ok || !payload || errors.length) fail(`Shopify GraphQL failed: ${(errors.length ? errors : [`HTTP ${response.status}`]).join(' | ')}`);
    return payload.data;
  }
  fail('Shopify GraphQL remained throttled after bounded retries.');
}

async function shopify(pathname, options = {}) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${restEndpoint}${pathname}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': connection.token, ...(options.headers || {}) },
    });
    if (response.status === 429 && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
      continue;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) fail(`Shopify request failed for ${pathname}: HTTP ${response.status}. ${payload ? JSON.stringify(payload) : 'No JSON response.'}`);
    return payload;
  }
  fail(`Shopify request remained throttled for ${pathname}.`);
}

async function readAsset(themeId, key) {
  const params = new URLSearchParams({ 'asset[key]': key });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${restEndpoint}/themes/${themeId}/assets.json?${params}`, { headers: { 'X-Shopify-Access-Token': connection.token } });
    if (response.status === 404) return null;
    if (response.status === 429 && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
      continue;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.asset) fail(`Could not read ${key} from theme ${themeId}: HTTP ${response.status}.`);
    return payload.asset;
  }
  fail(`Could not read ${key} from theme ${themeId} after bounded retries.`);
}

async function writeAsset(themeId, key, value) {
  await shopify(`/themes/${themeId}/assets.json`, { method: 'PUT', body: JSON.stringify({ asset: { key, value } }) });
}

const PAGES_QUERY = `query WebsiteExperiencePages { pages(first: 250) { nodes { id title handle body isPublished templateSuffix updatedAt } } }`;
const PAGE_CREATE = `mutation CreateWebsiteExperiencePage($page: PageCreateInput!) { pageCreate(page: $page) { page { id title handle body isPublished templateSuffix } userErrors { field message code } } }`;
const PAGE_UPDATE = `mutation UpdateWebsiteExperiencePage($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id title handle body isPublished templateSuffix } userErrors { field message code } } }`;

for (const key of themeAssets) {
  if (!fs.existsSync(path.join(ROOT, ...key.split('/')))) fail(`Missing local theme asset ${key}.`);
}

const desiredAssets = new Map(themeAssets.map((key) => [key, fs.readFileSync(path.join(ROOT, ...key.split('/')), 'utf8')]));
const themesPayload = await shopify('/themes.json?fields=id,name,role,updated_at');
const themes = themesPayload.themes || [];
const publishedTheme = themes.find((theme) => String(theme.id) === PUBLISHED_THEME_ID);
const unpublishedTheme = themes.find((theme) => String(theme.id) === UNPUBLISHED_THEME_ID);
if (!publishedTheme || publishedTheme.role !== 'main' || publishedTheme.name !== EXPECTED_THEME_NAME) fail('Published theme identity, role, or name mismatch.');
if (!unpublishedTheme || unpublishedTheme.role !== 'unpublished' || unpublishedTheme.name !== EXPECTED_THEME_NAME) fail('Unpublished theme identity, role, or name mismatch.');

const beforePagesData = await graphql(PAGES_QUERY);
const beforePages = beforePagesData.pages.nodes;
const beforePagesByHandle = new Map(beforePages.map((page) => [page.handle, page]));
for (const handle of desiredPageTemplates.keys()) {
  if (!beforePagesByHandle.has(handle)) fail(`Required page ${handle} does not exist.`);
}

const publishedBefore = new Map();
const unpublishedBefore = new Map();
for (const key of themeAssets) {
  publishedBefore.set(key, await readAsset(PUBLISHED_THEME_ID, key));
  unpublishedBefore.set(key, await readAsset(UNPUBLISHED_THEME_ID, key));
}

const assetPlan = Array.from(desiredAssets, ([key, value]) => ({
  key,
  action: assetsMatch(key, unpublishedBefore.get(key)?.value, value) ? 'unchanged' : unpublishedBefore.get(key) ? 'update' : 'create',
}));
const templatePlan = Array.from(desiredPageTemplates, ([handle, templateSuffix]) => {
  const page = beforePagesByHandle.get(handle);
  return { handle, id: page.id, currentTemplateSuffix: page.templateSuffix || '', templateSuffix, action: page.templateSuffix === templateSuffix ? 'unchanged' : 'update' };
});
const existingWarranty = beforePagesByHandle.get(warrantyPage.handle);
const warrantyPlan = !existingWarranty
  ? { action: 'create', handle: warrantyPage.handle }
  : existingWarranty.body.includes(WARRANTY_SIGNATURE)
    ? { action: existingWarranty.body === warrantyPage.body && existingWarranty.title === warrantyPage.title && existingWarranty.isPublished ? 'unchanged' : 'update', handle: warrantyPage.handle, id: existingWarranty.id }
    : { action: 'preserve-existing', handle: warrantyPage.handle, id: existingWarranty.id };

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'plan',
  store: connection.shop,
  themes: { published: publishedTheme, unpublished: unpublishedTheme },
  targetRule: 'Only the unpublished theme receives asset writes; the published theme is hash-verified unchanged.',
  assetPlan,
  templatePlan,
  warrantyPlan,
  previewUrl: `https://${connection.shop}/?preview_theme_id=${UNPUBLISHED_THEME_ID}`,
}, null, 2));

if (!APPLY) {
  console.log('Plan only: no Shopify state changed. Re-run with --apply after reviewing the bounded targets.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(BACKUP_ROOT, stamp);
fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(path.join(backupDir, 'pages-before.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), pages: beforePages }, null, 2)}\n`);
fs.writeFileSync(path.join(backupDir, 'published-theme-before.json'), `${JSON.stringify({ theme: publishedTheme, assets: Array.from(publishedBefore, ([key, asset]) => ({ key, exists: Boolean(asset), sha256: asset?.value ? sha256(asset.value) : null })) }, null, 2)}\n`);
for (const [key, asset] of unpublishedBefore) {
  if (!asset?.value) continue;
  const backupPath = path.join(backupDir, 'unpublished-theme', ...key.split('/'));
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, asset.value, 'utf8');
}

for (const [key, value] of desiredAssets) {
  if (!assetsMatch(key, unpublishedBefore.get(key)?.value, value)) await writeAsset(UNPUBLISHED_THEME_ID, key, value);
}

for (const [handle, templateSuffix] of desiredPageTemplates) {
  const current = beforePagesByHandle.get(handle);
  if (current.templateSuffix === templateSuffix) continue;
  const data = await graphql(PAGE_UPDATE, { id: current.id, page: { templateSuffix } });
  requireNoUserErrors(data.pageUpdate.userErrors, `Could not assign ${handle} to ${templateSuffix}`);
}

if (warrantyPlan.action === 'create') {
  const data = await graphql(PAGE_CREATE, { page: warrantyPage });
  requireNoUserErrors(data.pageCreate.userErrors, 'Could not create warranty-support');
} else if (warrantyPlan.action === 'update') {
  const data = await graphql(PAGE_UPDATE, { id: warrantyPlan.id, page: warrantyPage });
  requireNoUserErrors(data.pageUpdate.userErrors, 'Could not update managed warranty-support');
}

const verifiedAssets = [];
for (const [key, desired] of desiredAssets) {
  const actual = await readAsset(UNPUBLISHED_THEME_ID, key);
  if (!assetsMatch(key, actual?.value, desired)) fail(`${key} failed unpublished-theme readback.`);
  verifiedAssets.push({ key, sha256: sha256(actual.value) });
}

const publishedAfter = new Map();
for (const key of themeAssets) {
  const actual = await readAsset(PUBLISHED_THEME_ID, key);
  publishedAfter.set(key, actual);
  const before = publishedBefore.get(key);
  if (Boolean(before) !== Boolean(actual) || (before?.value && sha256(before.value) !== sha256(actual.value))) fail(`Published theme changed unexpectedly for ${key}.`);
}

const afterPagesData = await graphql(PAGES_QUERY);
const afterPagesByHandle = new Map(afterPagesData.pages.nodes.map((page) => [page.handle, page]));
const verifiedPageTemplates = Array.from(desiredPageTemplates, ([handle, templateSuffix]) => {
  const page = afterPagesByHandle.get(handle);
  if (!page || page.templateSuffix !== templateSuffix) fail(`${handle} template readback failed.`);
  return { id: page.id, handle, isPublished: page.isPublished, templateSuffix: page.templateSuffix, url: `https://mysnoozepod.com/pages/${handle}` };
});
const verifiedWarranty = afterPagesByHandle.get(warrantyPage.handle);
if (!verifiedWarranty || !verifiedWarranty.isPublished) fail('Warranty support page is missing or unpublished after apply.');

const shopReview = await shopify('/shop.json?fields=id,name,domain,myshopify_domain,currency,enabled_presentment_currencies,taxes_included,weight_unit,checkout_api_supported');
const readback = {
  generatedAt: new Date().toISOString(),
  store: connection.shop,
  backupDir,
  previewUrl: `https://${connection.shop}/?preview_theme_id=${UNPUBLISHED_THEME_ID}`,
  publishedTheme: { id: PUBLISHED_THEME_ID, name: publishedTheme.name, role: publishedTheme.role, unchangedAssetsVerified: themeAssets.length },
  unpublishedTheme: { id: UNPUBLISHED_THEME_ID, name: unpublishedTheme.name, role: unpublishedTheme.role, verifiedAssets },
  pages: { templateAssignments: verifiedPageTemplates, warrantySupport: { id: verifiedWarranty.id, handle: verifiedWarranty.handle, isPublished: verifiedWarranty.isPublished, managed: verifiedWarranty.body.includes(WARRANTY_SIGNATURE), url: 'https://mysnoozepod.com/pages/warranty-support' } },
  checkoutReview: { shop: shopReview.shop, note: 'Read-only native checkout settings snapshot. Payment, tax, shipping, and fulfillment settings were not changed.' },
};
fs.mkdirSync(path.dirname(READBACK_PATH), { recursive: true });
fs.writeFileSync(READBACK_PATH, `${JSON.stringify(readback, null, 2)}\n`, 'utf8');

console.log(`Verified ${verifiedAssets.length} assets on unpublished theme ${UNPUBLISHED_THEME_ID}.`);
console.log(`Verified ${themeAssets.length} corresponding published-theme assets unchanged.`);
console.log(`Verified booking/assessment template assignments and warranty support structure.`);
console.log(`Backup: ${backupDir}`);
console.log(`Readback: ${path.relative(ROOT, READBACK_PATH)}`);
