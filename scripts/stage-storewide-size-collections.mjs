import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'docs', 'storewide-shop-by-size', 'STOREWIDE_SIZE_COLLECTIONS_MANIFEST.json');
const INVENTORY_PATH = path.join(ROOT, 'docs', 'catalog', 'catalog-shopping-restructure-current-inspection.json');
const READBACK_PATH = path.join(ROOT, 'docs', 'storewide-shop-by-size', 'SHOPIFY_READBACK.json');
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\storewide-shop-by-size';
const EXPECTED_STORE = 'mysnoozepodtest.myshopify.com';
const EXPECTED_API_VERSION = '2025-10';
const PUBLISHED_THEME_ID = '139460542525';
const UNPUBLISHED_THEME_ID = '139216420925';
const EXPECTED_THEME_NAME = 'snoozer-ai/main';
const APPLY = process.argv.includes('--apply');
const THEME_ASSETS = [
  'assets/snoozepod-size-collection-map.js',
  'assets/snoozepod-shop-by-size.js',
  'sections/main-collection-product-grid.liquid',
  'snippets/card-product.liquid',
];

function fail(message) { throw new Error(message); }
function sorted(values) { return [...values].sort((a, b) => a.localeCompare(b)); }
function sha256(value) { return crypto.createHash('sha256').update(String(value || '').replace(/\r\n/g, '\n'), 'utf8').digest('hex'); }
function normalizedHtml(value) { return String(value || '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
function noErrors(errors, label) { if (errors?.length) fail(`${label}: ${errors.map((error) => error.message).join(' | ')}`); }

function connection() {
  const raw = execFileSync('aws', [
    'lambda', 'get-function-configuration', '--function-name', 'snoozer-backend', '--region', 'us-east-1',
    '--query', 'Environment.Variables.{SHOPIFY_DOMAIN:SHOPIFY_DOMAIN,SHOPIFY_ADMIN_TOKEN:SHOPIFY_ADMIN_TOKEN,SHOPIFY_ADMIN_API_VERSION:SHOPIFY_ADMIN_API_VERSION}',
    '--output', 'json', '--no-cli-pager',
  ], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', AWS_PAGER: '' } });
  const value = JSON.parse(raw);
  const apiVersion = value.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;
  if (value.SHOPIFY_DOMAIN !== EXPECTED_STORE || apiVersion !== EXPECTED_API_VERSION || !value.SHOPIFY_ADMIN_TOKEN) fail('Existing Shopify development connection does not match the authorized boundary.');
  return { shop: value.SHOPIFY_DOMAIN, token: value.SHOPIFY_ADMIN_TOKEN, apiVersion };
}

const shopify = connection();
const graphqlEndpoint = `https://${shopify.shop}/admin/api/${shopify.apiVersion}/graphql.json`;
const restEndpoint = `https://${shopify.shop}/admin/api/${shopify.apiVersion}`;

async function graphql(query, variables = {}) {
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await fetch(graphqlEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': shopify.token }, body: JSON.stringify({ query, variables }) });
    const body = await response.json().catch(() => null);
    const errors = body?.errors?.map((error) => error.message) || [];
    if ((response.status === 429 || errors.some((message) => /throttled/i.test(message))) && attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      continue;
    }
    if (!response.ok || !body || errors.length) fail(`Shopify GraphQL failed: ${errors.join(' | ') || `HTTP ${response.status}`}`);
    return body.data;
  }
  fail('Shopify GraphQL remained throttled.');
}

async function rest(pathname, options = {}) {
  const response = await fetch(`${restEndpoint}${pathname}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': shopify.token, ...(options.headers || {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) fail(`Shopify REST failed for ${pathname}: HTTP ${response.status}.`);
  return body;
}

const INSPECT = `query StorewideSizeInspection {
  products(first: 100) { nodes { id handle title status vendor productType tags variants(first: 100) { nodes { id title sku price availableForSale selectedOptions { name value } } } } }
  collections(first: 250) { nodes { id handle title descriptionHtml templateSuffix ruleSet { appliedDisjunctively rules { column relation condition } } products(first: 100) { nodes { handle } } resourcePublicationsV2(first: 50) { nodes { isPublished publication { id name } } } } }
  menus(first: 50) { nodes { id title handle items { id title type url resourceId items { id title type url resourceId items { id title type url resourceId } } } } }
  publications(first: 50) { nodes { id name } }
}`;
const PRODUCT_UPDATE = `mutation ($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id handle status tags } userErrors { field message } } }`;
const COLLECTION_CREATE = `mutation ($input: CollectionInput!) { collectionCreate(input: $input) { collection { id handle } userErrors { field message } } }`;
const COLLECTION_UPDATE = `mutation ($input: CollectionInput!) { collectionUpdate(input: $input) { collection { id handle templateSuffix } userErrors { field message } } }`;
const PUBLISH = `mutation ($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`;
const MENU_UPDATE = `mutation ($id: ID!, $title: String!, $handle: String, $items: [MenuItemUpdateInput!]!) { menuUpdate(id: $id, title: $title, handle: $handle, items: $items) { menu { id handle } userErrors { field message } } }`;

function rulesMatch(actual, expected) {
  const left = (actual?.ruleSet?.rules || []).map((rule) => `${rule.column}|${rule.relation}|${rule.condition}`).sort();
  const right = expected.rules.map((rule) => `${rule.column}|${rule.relation}|${rule.condition}`).sort();
  return actual?.ruleSet?.appliedDisjunctively === false && JSON.stringify(left) === JSON.stringify(right);
}

function currentVariantSignature(product) {
  return { handle: product.handle, title: product.title, status: product.status, vendor: product.vendor, productType: product.productType, variants: product.variants.nodes.map((variant) => ({ id: variant.id, title: variant.title, sku: variant.sku, price: variant.price, availableForSale: variant.availableForSale, selectedOptions: variant.selectedOptions })) };
}

function assertCatalogBoundary(catalog, inventory) {
  const variants = catalog.products.nodes.reduce((count, product) => count + product.variants.nodes.length, 0);
  if (catalog.products.nodes.length !== 43 || variants !== 274) fail(`Catalog boundary changed: ${catalog.products.nodes.length} products / ${variants} variants.`);
  const baseline = new Map(inventory.products.nodes.map((product) => [product.handle, currentVariantSignature(product)]));
  for (const product of catalog.products.nodes) {
    if (JSON.stringify(currentVariantSignature(product)) !== JSON.stringify(baseline.get(product.handle))) fail(`Catalog identity, status, SKU, price, availability, or options drifted for ${product.handle}.`);
  }
}

function desiredDescription(expected) {
  if (expected.handle === 'shop-by-size') return '<p>Find products by the exact sizes and configurations currently available in our Shopify catalog.</p>';
  if (expected.categoryKey) return `<p>Explore ${expected.title.toLowerCase()} currently available in our Shopify catalog, with exact variant options and pricing.</p>`;
  return `<p>Explore products currently available in ${expected.sizeLabel}, with exact variant options and pricing.</p>`;
}

function collectionInput(expected) {
  return { title: expected.title, handle: expected.handle, descriptionHtml: desiredDescription(expected), templateSuffix: expected.templateSuffix, sortOrder: 'BEST_SELLING', ruleSet: { appliedDisjunctively: false, rules: expected.rules } };
}

function menuItemInput(item) {
  const result = { title: item.title, type: item.type };
  if (item.resourceId) result.resourceId = item.resourceId;
  if (item.url) result.url = item.url;
  if (item.items?.length) result.items = item.items.map(menuItemInput);
  return result;
}

function desiredMenuItems(menu, collections) {
  const links = ['twin', 'twin-xl', 'full', 'queen', 'king', 'california-king'].map((slug) => {
    const collection = collections.get(`shop-by-size-${slug}`);
    if (!collection) fail(`Navigation collection shop-by-size-${slug} is missing.`);
    return { title: collection.title.replace(/^Shop /, ''), type: 'COLLECTION', resourceId: collection.id };
  });
  const master = collections.get('shop-by-size');
  if (!master) fail('Master Shop by Size collection is missing.');
  const shopBySize = { title: 'Shop by Size', type: 'COLLECTION', resourceId: master.id, items: links };
  const existing = menu.items.filter((item) => item.title !== 'Shop by Size').map(menuItemInput);
  const mattressIndex = existing.findIndex((item) => item.title === 'Mattresses');
  existing.splice(mattressIndex === -1 ? 0 : mattressIndex + 1, 0, shopBySize);
  return existing;
}

async function readAsset(themeId, key) {
  const params = new URLSearchParams({ 'asset[key]': key });
  try { return (await rest(`/themes/${themeId}/assets.json?${params}`)).asset || null; }
  catch (error) { if (/HTTP 404/.test(error.message)) return null; throw error; }
}

async function readAssetUntilMatch(themeId, key, expected) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const asset = await readAsset(themeId, key);
    if (asset?.value && sha256(asset.value) === sha256(expected)) return asset;
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  return null;
}

async function backup(catalog, manifest, themes) {
  const dir = path.join(BACKUP_ROOT, new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'shopify-before.json'), `${JSON.stringify({ capturedAt: new Date().toISOString(), catalog, themes }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const themeId of [UNPUBLISHED_THEME_ID, PUBLISHED_THEME_ID]) {
    for (const key of THEME_ASSETS) {
      const asset = await readAsset(themeId, key);
      if (!asset?.value) continue;
      const file = path.join(dir, themeId, ...key.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, asset.value, 'utf8');
    }
  }
  fs.writeFileSync(path.join(dir, 'RECOVERY.md'), `# Storewide Shop by Size recovery\n\nRestore the captured product tags, main menu, and theme assets from shopify-before.json and the theme folders. Delete only collections listed in manifest.json if a rollback is required. No credentials are stored here.\n`);
  return dir;
}

async function settleMembership(manifest) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const catalog = await graphql(INSPECT);
    const collections = new Map(catalog.collections.nodes.map((item) => [item.handle, item]));
    const unresolved = manifest.collections.filter((expected) => {
      const actual = collections.get(expected.handle);
      return JSON.stringify(sorted(actual?.products.nodes.map((product) => product.handle) || [])) !== JSON.stringify(sorted(expected.productHandles));
    });
    if (!unresolved.length) return catalog;
    if (attempt === 19) fail(`Collection membership did not settle: ${unresolved.map((item) => item.handle).join(', ')}.`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function stageTheme(themes, backupDirectory) {
  const published = themes.find((theme) => String(theme.id) === PUBLISHED_THEME_ID);
  const unpublished = themes.find((theme) => String(theme.id) === UNPUBLISHED_THEME_ID);
  if (!published || published.role !== 'main' || published.name !== EXPECTED_THEME_NAME || !unpublished || unpublished.role !== 'unpublished' || unpublished.name !== EXPECTED_THEME_NAME) fail('Theme identity changed.');
  const publishedBefore = new Map();
  for (const key of THEME_ASSETS) publishedBefore.set(key, await readAsset(PUBLISHED_THEME_ID, key));
  for (const key of THEME_ASSETS) {
    const value = fs.readFileSync(path.join(ROOT, ...key.split('/')), 'utf8');
    const current = await readAsset(UNPUBLISHED_THEME_ID, key);
    if (!current?.value || sha256(current.value) !== sha256(value)) await rest(`/themes/${UNPUBLISHED_THEME_ID}/assets.json`, { method: 'PUT', body: JSON.stringify({ asset: { key, value } }) });
    const readback = await readAssetUntilMatch(UNPUBLISHED_THEME_ID, key, value);
    if (!readback?.value || sha256(readback.value) !== sha256(value)) fail(`Unpublished theme readback failed for ${key}.`);
    const publishedAfter = await readAsset(PUBLISHED_THEME_ID, key);
    if (Boolean(publishedBefore.get(key)) !== Boolean(publishedAfter) || (publishedAfter?.value && sha256(publishedAfter.value) !== sha256(publishedBefore.get(key).value))) fail(`Published theme changed unexpectedly for ${key}.`);
  }
  return { backupDirectory, publishedThemeUnchanged: true, targetThemeId: UNPUBLISHED_THEME_ID, assets: THEME_ASSETS };
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
if (manifest.summary.collections !== 70 || manifest.summary.storewideSizes !== 14 || manifest.summary.categories !== 9) fail('Generated manifest boundary changed.');
const before = await graphql(INSPECT);
assertCatalogBoundary(before, inventory);
const themes = (await rest('/themes.json?fields=id,name,role,updated_at')).themes || [];
const collectionsBefore = new Map(before.collections.nodes.map((item) => [item.handle, item]));
const productUpdates = manifest.products.filter((expected) => {
  const actual = before.products.nodes.find((item) => item.id === expected.productId);
  return JSON.stringify(sorted(actual.tags)) !== JSON.stringify(sorted(expected.desiredTags));
});
const collectionCreates = manifest.collections.filter((expected) => {
  const existing = collectionsBefore.get(expected.handle);
  if (existing && !rulesMatch(existing, expected)) fail(`Collection handle ${expected.handle} is occupied by a conflicting collection.`);
  return !existing;
});
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'plan', store: shopify.shop, products: 43, variants: 274, productTagUpdates: productUpdates.length, collectionCreates: collectionCreates.length, totalManagedCollections: manifest.collections.length, navigation: 'main-menu / Shop by Size', targetTheme: UNPUBLISHED_THEME_ID, publishedTheme: `${PUBLISHED_THEME_ID} unchanged` }, null, 2));

if (!APPLY) process.exit(0);

const backupDirectory = await backup(before, manifest, themes);
for (const expected of productUpdates) {
  const current = before.products.nodes.find((item) => item.id === expected.productId);
  const data = await graphql(PRODUCT_UPDATE, { product: { id: current.id, tags: expected.desiredTags } });
  noErrors(data.productUpdate.userErrors, `Could not tag ${expected.handle}`);
  if (data.productUpdate.product.status !== current.status) fail(`${expected.handle} status changed unexpectedly.`);
}
for (const expected of collectionCreates) {
  const data = await graphql(COLLECTION_CREATE, { input: collectionInput(expected) });
  noErrors(data.collectionCreate.userErrors, `Could not create ${expected.handle}`);
}
let settled = await settleMembership(manifest);
const onlineStore = settled.publications.nodes.find((item) => item.name === 'Online Store');
if (!onlineStore) fail('Online Store publication is unavailable.');
let collections = new Map(settled.collections.nodes.map((item) => [item.handle, item]));
for (const expected of manifest.collections) {
  const actual = collections.get(expected.handle);
  if (actual.templateSuffix !== expected.templateSuffix || normalizedHtml(actual.descriptionHtml) !== normalizedHtml(desiredDescription(expected))) {
    const update = await graphql(COLLECTION_UPDATE, { input: { id: actual.id, templateSuffix: expected.templateSuffix, descriptionHtml: desiredDescription(expected) } });
    noErrors(update.collectionUpdate.userErrors, `Could not set presentation for ${expected.handle}`);
  }
  if (!actual.resourcePublicationsV2.nodes.some((publication) => publication.publication.id === onlineStore.id && publication.isPublished)) {
    const publish = await graphql(PUBLISH, { id: actual.id, input: [{ publicationId: onlineStore.id }] });
    noErrors(publish.publishablePublish.userErrors, `Could not publish ${expected.handle} to Online Store`);
  }
}
settled = await graphql(INSPECT);
collections = new Map(settled.collections.nodes.map((item) => [item.handle, item]));
const menu = settled.menus.nodes.find((item) => item.handle === 'main-menu');
if (!menu) fail('Main menu is unavailable.');
const menuUpdate = await graphql(MENU_UPDATE, { id: menu.id, title: menu.title, handle: menu.handle, items: desiredMenuItems(menu, collections) });
noErrors(menuUpdate.menuUpdate.userErrors, 'Could not update Shop by Size navigation');
const theme = await stageTheme(themes, backupDirectory);
const final = await settleMembership(manifest);
assertCatalogBoundary(final, inventory);
const finalCollections = new Map(final.collections.nodes.map((item) => [item.handle, item]));
for (const expected of manifest.collections) {
  const actual = finalCollections.get(expected.handle);
  if (!actual || !rulesMatch(actual, expected) || actual.templateSuffix !== expected.templateSuffix || normalizedHtml(actual.descriptionHtml) !== normalizedHtml(desiredDescription(expected))) fail(`${expected.handle} failed final rules/presentation verification.`);
  if (JSON.stringify(sorted(actual.products.nodes.map((product) => product.handle))) !== JSON.stringify(sorted(expected.productHandles))) fail(`${expected.handle} failed final membership verification.`);
}
const finalMenu = final.menus.nodes.find((item) => item.handle === 'main-menu');
const shopBySizeItem = finalMenu.items.find((item) => item.title === 'Shop by Size');
if (!shopBySizeItem || shopBySizeItem.items.length !== 6) fail('Shop by Size navigation failed readback.');
const readback = { schemaVersion: '1.0.0', verifiedAt: new Date().toISOString(), store: shopify.shop, backupDirectory, summary: manifest.summary, productStatusesPreserved: true, collections: manifest.collections.map((expected) => ({ handle: expected.handle, title: expected.title, sizeLabel: expected.sizeLabel, categoryKey: expected.categoryKey, products: sorted(finalCollections.get(expected.handle).products.nodes.map((product) => product.handle)), rules: finalCollections.get(expected.handle).ruleSet.rules })), navigation: shopBySizeItem, theme, previewUrl: `https://${shopify.shop}/collections/shop-by-size?preview_theme_id=${UNPUBLISHED_THEME_ID}` };
fs.writeFileSync(READBACK_PATH, `${JSON.stringify(readback, null, 2)}\n`);
console.log(JSON.stringify({ result: 'Storewide Shop by Size staged and verified.', backupDirectory, collections: manifest.collections.length, navigationChildren: shopBySizeItem.items.length, previewUrl: readback.previewUrl, publishedThemeUnchanged: true }, null, 2));
