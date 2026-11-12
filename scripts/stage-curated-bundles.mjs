import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXPECTED_STORE = 'mysnoozepodtest.myshopify.com';
const EXPECTED_API_VERSION = '2025-10';
const PUBLISHED_THEME_ID = '139460542525';
const UNPUBLISHED_THEME_ID = '139216420925';
const EXPECTED_THEME_NAME = 'snoozer-ai/main';
const APPLY = process.argv.includes('--apply');
const SIGNATURE = '<!-- mysnoozepod-curated-bundles-v1 -->';
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\curated-bundles';
const READBACK_PATH = path.join(ROOT, 'docs', 'curated-bundles', 'SHOPIFY_READBACK.json');
const ASSETS = [
  'assets/snoozepod-pod-builder.js',
  'assets/snoozepod-curated-bundle-catalog.js',
  'assets/snoozepod-curated-bundles.js',
  'assets/snoozepod-curated-bundles.css',
  'assets/snoozepod-shop-by-size.js',
  'sections/snoozepod-curated-bundles.liquid',
  'sections/main-collection-product-grid.liquid',
  'sections/snoozepod-collection-navigation-v1.liquid',
  'templates/page.sleep-systems.json',
  'templates/collection.json',
  'templates/collection.main.json',
  'templates/collection.snoozepod.json',
  'templates/collection.snoozepod-v1.json',
];

function fail(message) { throw new Error(message); }
function sha256(value) { return crypto.createHash('sha256').update(String(value || '').replace(/\r\n/g, '\n'), 'utf8').digest('hex'); }
function assetDigest(key, value) {
  if (!key.endsWith('.json')) return sha256(value);
  try {
    const normalized = String(value || '').replace(/^\/\*[\s\S]*?\*\//, '').trim();
    return sha256(JSON.stringify(JSON.parse(normalized)));
  } catch (_error) {
    return sha256(value);
  }
}
function noErrors(errors, label) { if (errors?.length) fail(`${label}: ${errors.map((error) => error.message).join(' | ')}`); }
function connection() {
  const raw = execFileSync('aws', ['lambda', 'get-function-configuration', '--function-name', 'snoozer-backend', '--region', 'us-east-1', '--query', 'Environment.Variables.{SHOPIFY_DOMAIN:SHOPIFY_DOMAIN,SHOPIFY_ADMIN_TOKEN:SHOPIFY_ADMIN_TOKEN,SHOPIFY_ADMIN_API_VERSION:SHOPIFY_ADMIN_API_VERSION}', '--output', 'json', '--no-cli-pager'], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', AWS_PAGER: '' } });
  const values = JSON.parse(raw);
  const apiVersion = values.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;
  if (values.SHOPIFY_DOMAIN !== EXPECTED_STORE || apiVersion !== EXPECTED_API_VERSION || !values.SHOPIFY_ADMIN_TOKEN) fail('Existing Shopify development connection does not match the authorized boundary.');
  return { shop: values.SHOPIFY_DOMAIN, token: values.SHOPIFY_ADMIN_TOKEN, apiVersion };
}

const shopify = connection();
const restEndpoint = `https://${shopify.shop}/admin/api/${shopify.apiVersion}`;
const graphqlEndpoint = `${restEndpoint}/graphql.json`;

async function graphql(query, variables = {}) {
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await fetch(graphqlEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': shopify.token }, body: JSON.stringify({ query, variables }) });
    const body = await response.json().catch(() => null);
    const errors = body?.errors?.map((error) => error.message) || [];
    if ((response.status === 429 || errors.some((message) => /throttled/i.test(message))) && attempt < 6) { await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1))); continue; }
    if (!response.ok || !body || errors.length) fail(`Shopify GraphQL failed: ${errors.join(' | ') || `HTTP ${response.status}`}`);
    return body.data;
  }
  fail('Shopify GraphQL remained throttled.');
}
async function rest(pathname, options = {}) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${restEndpoint}${pathname}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': shopify.token, ...(options.headers || {}) } });
    if (response.status === 429 && attempt < 5) { await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1))); continue; }
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) fail(`Shopify REST failed for ${pathname}: HTTP ${response.status}.`);
    return body;
  }
  fail(`Shopify REST remained throttled for ${pathname}.`);
}

const INSPECT = `query CuratedBundleInspection {
  products(first: 100) { nodes { id handle status variants(first: 100) { nodes { id sku price availableForSale selectedOptions { name value } } } } }
  pages(first: 250) { nodes { id title handle body isPublished templateSuffix } }
  menus(first: 50) { nodes { id title handle items { id title type url resourceId items { id title type url resourceId items { id title type url resourceId } } } } }
}`;
const PAGE_CREATE = `mutation ($page: PageCreateInput!) { pageCreate(page: $page) { page { id handle title isPublished templateSuffix body } userErrors { field message } } }`;
const PAGE_UPDATE = `mutation ($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id handle title isPublished templateSuffix body } userErrors { field message } } }`;
const MENU_UPDATE = `mutation ($id: ID!, $title: String!, $handle: String, $items: [MenuItemUpdateInput!]!) { menuUpdate(id: $id, title: $title, handle: $handle, items: $items) { menu { id handle } userErrors { field message } } }`;

function menuInput(item) {
  const result = { title: item.title, type: item.type };
  if (item.resourceId) result.resourceId = item.resourceId;
  if (item.url) result.url = item.url;
  if (item.items?.length) result.items = item.items.map(menuInput);
  return result;
}
function desiredMenuItems(menu) {
  const sleepSystems = {
    title: 'Sleep Systems', type: 'HTTP', url: '/pages/sleep-systems', items: [
      { title: 'Sleep Systems', type: 'HTTP', url: '/pages/sleep-systems#sleep-systems' },
      { title: 'Bedding Sets', type: 'HTTP', url: '/pages/sleep-systems#bedding-sets' },
    ],
  };
  const items = menu.items.filter((item) => item.title !== 'Sleep Systems').map(menuInput);
  const mattressIndex = items.findIndex((item) => item.title === 'Mattresses');
  items.splice(mattressIndex < 0 ? 0 : mattressIndex + 1, 0, sleepSystems);
  return items;
}
async function readAsset(themeId, key) {
  const params = new URLSearchParams({ 'asset[key]': key });
  try { return (await rest(`/themes/${themeId}/assets.json?${params}`)).asset || null; }
  catch (error) { if (/HTTP 404/.test(error.message)) return null; throw error; }
}
async function writeAsset(themeId, key, value) {
  await rest(`/themes/${themeId}/assets.json`, { method: 'PUT', body: JSON.stringify({ asset: { key, value } }) });
}
async function readUntilMatch(themeId, key, expected) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const asset = await readAsset(themeId, key);
    if (asset?.value && assetDigest(key, asset.value) === assetDigest(key, expected)) return asset;
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  return null;
}

for (const key of ASSETS) if (!fs.existsSync(path.join(ROOT, ...key.split('/')))) fail(`Missing theme asset ${key}.`);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'curated-bundles', 'CURATED_BUNDLE_MANIFEST.json'), 'utf8'));
if (manifest.summary.bundles !== 17 || manifest.summary.stagedPurchasable !== 17 || manifest.summary.blockedPendingCompatibility !== 0) fail('Curated bundle manifest boundary changed.');
const before = await graphql(INSPECT);
const productCount = before.products.nodes.length;
const variantCount = before.products.nodes.reduce((count, product) => count + product.variants.nodes.length, 0);
if (productCount !== 43 || variantCount !== 274) fail(`Catalog boundary changed: ${productCount} products / ${variantCount} variants.`);
const pageBody = `${SIGNATURE}\n<p>Choose a mattress, size, and compatible adjustable base, or shop curated bedding sets built from existing Shopify products.</p>`;
const currentPage = before.pages.nodes.find((page) => page.handle === 'sleep-systems');
if (currentPage && !currentPage.body.includes(SIGNATURE)) fail('Refusing to overwrite the existing unmanaged sleep-systems page.');
const mainMenu = before.menus.nodes.find((menu) => menu.handle === 'main-menu');
if (!mainMenu) fail('Main menu is unavailable.');
const themes = (await rest('/themes.json?fields=id,name,role,updated_at')).themes || [];
const published = themes.find((theme) => String(theme.id) === PUBLISHED_THEME_ID);
const unpublished = themes.find((theme) => String(theme.id) === UNPUBLISHED_THEME_ID);
if (!published || published.role !== 'main' || published.name !== EXPECTED_THEME_NAME || !unpublished || unpublished.role !== 'unpublished' || unpublished.name !== EXPECTED_THEME_NAME) fail('Theme identity changed.');
const assetPlan = [];
for (const key of ASSETS) {
  const current = await readAsset(UNPUBLISHED_THEME_ID, key);
  const desired = fs.readFileSync(path.join(ROOT, ...key.split('/')), 'utf8');
  assetPlan.push({ key, action: current?.value && assetDigest(key, current.value) === assetDigest(key, desired) ? 'unchanged' : current ? 'update' : 'create' });
}
const pageMatches = currentPage && currentPage.title === 'Sleep Systems' && currentPage.body === pageBody && currentPage.isPublished && currentPage.templateSuffix === 'sleep-systems';
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'plan', store: shopify.shop, catalog: { products: productCount, variants: variantCount }, page: { handle: 'sleep-systems', action: pageMatches ? 'unchanged' : currentPage ? 'update' : 'create' }, navigation: 'main-menu / Sleep Systems', assets: assetPlan, targetTheme: UNPUBLISHED_THEME_ID, publishedTheme: `${PUBLISHED_THEME_ID} unchanged`, productsCreated: 0, discountsCreated: 0 }, null, 2));
if (!APPLY) process.exit(0);

const backupDirectory = path.join(BACKUP_ROOT, new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(backupDirectory, { recursive: true });
fs.writeFileSync(path.join(backupDirectory, 'shopify-before.json'), `${JSON.stringify({ capturedAt: new Date().toISOString(), pages: before.pages.nodes, mainMenu, themes, catalogFingerprint: before.products.nodes }, null, 2)}\n`);
const publishedBefore = new Map();
for (const themeId of [PUBLISHED_THEME_ID, UNPUBLISHED_THEME_ID]) {
  for (const key of ASSETS) {
    const asset = await readAsset(themeId, key);
    if (themeId === PUBLISHED_THEME_ID) publishedBefore.set(key, asset);
    if (!asset?.value) continue;
    const file = path.join(backupDirectory, themeId, ...key.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, asset.value, 'utf8');
  }
}
fs.writeFileSync(path.join(backupDirectory, 'RECOVERY.md'), '# Curated bundle staging recovery\n\nRestore the captured main menu and sleep-systems page from shopify-before.json. Restore only the unpublished-theme assets from the 139216420925 folder. No credentials are stored here.\n');

for (const key of ASSETS) {
  const desired = fs.readFileSync(path.join(ROOT, ...key.split('/')), 'utf8');
  const current = await readAsset(UNPUBLISHED_THEME_ID, key);
  if (!current?.value || assetDigest(key, current.value) !== assetDigest(key, desired)) await writeAsset(UNPUBLISHED_THEME_ID, key, desired);
  if (!(await readUntilMatch(UNPUBLISHED_THEME_ID, key, desired))) fail(`Unpublished theme readback failed for ${key}.`);
  const publishedAfter = await readAsset(PUBLISHED_THEME_ID, key);
  const publishedPrior = publishedBefore.get(key);
  if (Boolean(publishedAfter) !== Boolean(publishedPrior) || (publishedAfter?.value && assetDigest(key, publishedAfter.value) !== assetDigest(key, publishedPrior.value))) fail(`Published theme changed unexpectedly for ${key}.`);
}

const pageInput = { title: 'Sleep Systems', handle: 'sleep-systems', body: pageBody, isPublished: true, templateSuffix: 'sleep-systems' };
if (!pageMatches) {
  if (currentPage) { const data = await graphql(PAGE_UPDATE, { id: currentPage.id, page: pageInput }); noErrors(data.pageUpdate.userErrors, 'Could not update Sleep Systems page'); }
  else { const data = await graphql(PAGE_CREATE, { page: pageInput }); noErrors(data.pageCreate.userErrors, 'Could not create Sleep Systems page'); }
}
const menuData = await graphql(MENU_UPDATE, { id: mainMenu.id, title: mainMenu.title, handle: mainMenu.handle, items: desiredMenuItems(mainMenu) });
noErrors(menuData.menuUpdate.userErrors, 'Could not update Sleep Systems navigation');

const after = await graphql(INSPECT);
const actualPage = after.pages.nodes.find((page) => page.handle === 'sleep-systems');
if (!actualPage || actualPage.title !== 'Sleep Systems' || actualPage.body !== pageBody || !actualPage.isPublished || actualPage.templateSuffix !== 'sleep-systems') fail('Sleep Systems page failed readback.');
const actualMenu = after.menus.nodes.find((menu) => menu.handle === 'main-menu');
const sleepSystemsItem = actualMenu.items.find((item) => item.title === 'Sleep Systems');
if (!sleepSystemsItem || sleepSystemsItem.url !== '/pages/sleep-systems' || sleepSystemsItem.items.length !== 2) fail('Sleep Systems navigation failed readback.');
const actualProductCount = after.products.nodes.length;
const actualVariantCount = after.products.nodes.reduce((count, product) => count + product.variants.nodes.length, 0);
if (actualProductCount !== 43 || actualVariantCount !== 274) fail('Catalog count changed during staging.');
const readback = { schemaVersion: '1.0.0', verifiedAt: new Date().toISOString(), store: shopify.shop, backupDirectory, catalog: { products: actualProductCount, variants: actualVariantCount, productsCreated: 0 }, page: actualPage, navigation: sleepSystemsItem, bundleSummary: manifest.summary, theme: { targetThemeId: UNPUBLISHED_THEME_ID, publishedThemeId: PUBLISHED_THEME_ID, publishedThemeUnchanged: true, assets: ASSETS }, previewUrl: `https://${shopify.shop}/pages/sleep-systems?preview_theme_id=${UNPUBLISHED_THEME_ID}` };
fs.writeFileSync(READBACK_PATH, `${JSON.stringify(readback, null, 2)}\n`);
console.log(JSON.stringify({ result: 'Curated bundles staged and verified.', backupDirectory, previewUrl: readback.previewUrl, catalog: readback.catalog, publishedThemeUnchanged: true }, null, 2));
