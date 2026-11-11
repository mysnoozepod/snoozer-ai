import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { MATTRESS_CUSTOMER_NAMING, replaceCustomerFacingMattressNames } from '../content/mattress-customer-naming.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXPECTED_STORE = 'mysnoozepodtest.myshopify.com';
const EXPECTED_API_VERSION = '2025-10';
const LAMBDA_FUNCTION = 'snoozer-backend';
const AWS_REGION = 'us-east-1';
const APPLY = process.argv.includes('--apply');
const PUBLISHED_THEME_ID = '139460542525';
const UNPUBLISHED_THEME_ID = '139216420925';
const EXPECTED_THEME_NAME = 'snoozer-ai/main';
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\mattress-customer-naming';
const READBACK_PATH = path.join(ROOT, 'docs', 'catalog', 'MATTRESS_CUSTOMER_NAMING_SHOPIFY_READBACK.json');
const PRODUCT_COPY_PATTERN = /<div\s+data-mysnoozepod-(?:bedgear|mattress)-product-copy="[^"]+">[\s\S]*?<\/div>/i;
const BRAND_PATTERN = /<div\s+data-mysnoozepod-bedgear-boilerplate="[^"]+">[\s\S]*?<\/div>/i;

const themeAssets = [
  'assets/component-product-variant-picker.css',
  'assets/component-snoozepod-commerce-v1.css',
  'assets/snoozepod-dual-comfort.js',
  'snippets/card-product.liquid',
  'snippets/cart-drawer.liquid',
  'sections/cart-notification-product.liquid',
  'sections/main-cart-items.liquid',
  'sections/predictive-search.liquid',
  'sections/related-products.liquid',
  'sections/snoozepod-product-cta.liquid',
  'sections/snoozepod-product-hero.liquid',
  'sections/snoozepod-product-information-v1.liquid',
  'sections/snoozepod-collection-navigation-v1.liquid',
  'snippets/snoozepod-mattress-product-information.liquid',
  'snippets/snoozepod-product-feel.liquid',
  'templates/index.json',
  'templates/product.snoozepod-v1.json',
  'templates/collection.snoozepod-v1.json',
];

function fail(message) { throw new Error(message); }
function sha256(value) { return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex'); }
function normalizeHtml(value) { return String(value || '').trim().replace(/>\s+</g, '><'); }
function stripJsonHeader(value) { return String(value || '').replace(/^\/\*[\s\S]*?\*\//, '').trim(); }
function normalizeAsset(key, value) {
  if (!key.endsWith('.json')) return String(value || '').replace(/\r\n/g, '\n');
  return JSON.stringify(JSON.parse(stripJsonHeader(value)));
}
function assetMatches(key, current, desired) {
  try { return normalizeAsset(key, current) === normalizeAsset(key, desired); } catch { return false; }
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
  const values = JSON.parse(raw);
  const apiVersion = values.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;
  if (values.SHOPIFY_DOMAIN !== EXPECTED_STORE) fail(`Refusing unexpected store ${values.SHOPIFY_DOMAIN || 'missing'}.`);
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected Admin API version ${apiVersion}.`);
  if (!values.SHOPIFY_ADMIN_TOKEN) fail('SHOPIFY_ADMIN_TOKEN is unavailable from the existing development configuration.');
  return { shop: values.SHOPIFY_DOMAIN, token: values.SHOPIFY_ADMIN_TOKEN, apiVersion };
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
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await fetch(`${restEndpoint}/themes/${themeId}/assets.json?${params}`, { headers: { 'X-Shopify-Access-Token': connection.token } });
    if (response.status === 404) return null;
    if (response.status === 429 && attempt < 6) {
      const retryAfter = Number(response.headers.get('retry-after') || 1);
      await new Promise((resolve) => setTimeout(resolve, Math.max(800, retryAfter * 1000) * (attempt + 1)));
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

const INSPECT = `query MattressCustomerNamingInspection {
  products(first: 100) {
    nodes {
      id legacyResourceId title handle status vendor productType templateSuffix descriptionHtml tags updatedAt
      seo { title description }
      media(first: 50) { nodes { id alt mediaContentType status } }
      variants(first: 100) { nodes { id legacyResourceId title sku price inventoryQuantity selectedOptions { name value } } }
      metafields(first: 100) { nodes { id namespace key type value compareDigest } }
    }
  }
  pages(first: 250) { nodes { id title handle body isPublished updatedAt } }
  menus(first: 50) {
    nodes { id title handle items { id title type url resourceId items { id title type url resourceId items { id title type url resourceId } } } }
  }
  urlRedirects(first: 250) { nodes { id path target } }
}`;

const PRODUCT_UPDATE = `mutation UpdateMattressCustomerName($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { id title handle status vendor productType templateSuffix descriptionHtml tags seo { title description } }
    userErrors { field message }
  }
}`;
const MEDIA_UPDATE = `mutation UpdateMattressMediaAlt($productId: ID!, $media: [UpdateMediaInput!]!) {
  productUpdateMedia(productId: $productId, media: $media) { media { id alt status } mediaUserErrors { field message } }
}`;
const PAGE_UPDATE = `mutation UpdateMattressPageReferences($id: ID!, $page: PageUpdateInput!) {
  pageUpdate(id: $id, page: $page) { page { id handle body } userErrors { field message } }
}`;
const MENU_UPDATE = `mutation UpdateMattressMenuNames($id: ID!, $title: String!, $handle: String, $items: [MenuItemUpdateInput!]!) {
  menuUpdate(id: $id, title: $title, handle: $handle, items: $items) { menu { id handle title } userErrors { field message } }
}`;

function commerceFingerprint(products) {
  return products.map((product) => ({
    id: product.id,
    status: product.status,
    vendor: product.vendor,
    productType: product.productType,
    templateSuffix: product.templateSuffix,
    tags: [...product.tags].sort(),
    variants: product.variants.nodes.map((variant) => ({
      id: variant.id, title: variant.title, sku: variant.sku, price: variant.price,
      inventoryQuantity: variant.inventoryQuantity, selectedOptions: variant.selectedOptions,
    })),
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function desiredDescription(product, contract) {
  const remainder = String(product.descriptionHtml || '').replace(PRODUCT_COPY_PATTERN, '').replace(BRAND_PATTERN, '').trim();
  return `${contract.descriptionHtml}${remainder}`;
}

function menuItemInput(item, productContractsById) {
  const contract = productContractsById.get(item.resourceId);
  const transformed = {
    title: contract ? contract.menuTitle : item.title,
    type: item.type,
  };
  if (item.resourceId) transformed.resourceId = item.resourceId;
  else if (item.url) transformed.url = replaceCustomerFacingMattressNames(item.url);
  if (item.items?.length) transformed.items = item.items.map((child) => menuItemInput(child, productContractsById));
  return transformed;
}

function normalizedMenuItems(items) {
  return items.map((item) => ({
    title: item.title,
    type: item.type,
    destination: item.resourceId || item.url || '',
    items: normalizedMenuItems(item.items || []),
  }));
}

for (const key of themeAssets) if (!fs.existsSync(path.join(ROOT, ...key.split('/')))) fail(`Missing local theme asset ${key}.`);

const themesPayload = await shopify('/themes.json?fields=id,name,role,updated_at');
const publishedTheme = themesPayload.themes.find((theme) => String(theme.id) === PUBLISHED_THEME_ID);
const unpublishedTheme = themesPayload.themes.find((theme) => String(theme.id) === UNPUBLISHED_THEME_ID);
if (!publishedTheme || publishedTheme.role !== 'main' || publishedTheme.name !== EXPECTED_THEME_NAME) fail('Published theme identity mismatch.');
if (!unpublishedTheme || unpublishedTheme.role !== 'unpublished' || unpublishedTheme.name !== EXPECTED_THEME_NAME) fail('Unpublished theme identity mismatch.');

const before = await graphql(INSPECT);
if (before.products.nodes.length !== 43) fail(`Expected 43 products, found ${before.products.nodes.length}.`);
const byHandle = new Map(before.products.nodes.map((product) => [product.handle, product]));
const productPlans = MATTRESS_CUSTOMER_NAMING.map((contract) => {
  const product = byHandle.get(contract.handle) || byHandle.get(contract.oldHandle);
  if (!product) fail(`Missing mattress ${contract.oldHandle} / ${contract.handle}.`);
  if (product.vendor !== 'BEDGEAR' || product.productType !== 'Mattress') fail(`Unexpected product identity for ${product.handle}.`);
  if (product.media.nodes.length !== contract.mediaAlts.length) fail(`${product.handle} has ${product.media.nodes.length} media items; expected ${contract.mediaAlts.length}.`);
  const descriptionHtml = desiredDescription(product, contract);
  const comfortOptions = contract.comfortOptions ? JSON.stringify({
    customerFacingComfortLabels: contract.comfortOptions,
    requestedSelectionMode: 'independent_left_right',
    verificationStatus: 'PENDING_APPROVED_COMPLETE_CONFIGURATION_MAP',
  }) : null;
  const currentComfortOptions = product.metafields.nodes.find((entry) => entry.namespace === 'custom' && entry.key === 'comfort_options');
  const currentFeelLabel = product.metafields.nodes.find((entry) => entry.namespace === 'custom' && entry.key === 'feel_label');
  const media = product.media.nodes.map((entry, index) => ({ id: entry.id, currentAlt: entry.alt || '', alt: contract.mediaAlts[index] }));
  const updateInput = { id: product.id };
  if (product.title !== contract.title) updateInput.title = contract.title;
  if (product.handle !== contract.handle) Object.assign(updateInput, { handle: contract.handle, redirectNewHandle: true });
  if (normalizeHtml(product.descriptionHtml) !== normalizeHtml(descriptionHtml)) updateInput.descriptionHtml = descriptionHtml;
  const metafields = [];
  if (comfortOptions && currentComfortOptions?.value !== comfortOptions) metafields.push({ namespace: 'custom', key: 'comfort_options', type: 'json', value: comfortOptions });
  if (contract.feelLabel && currentFeelLabel?.value !== contract.feelLabel) metafields.push({ namespace: 'custom', key: 'feel_label', type: 'single_line_text_field', value: contract.feelLabel });
  if (metafields.length) updateInput.metafields = metafields;
  return {
    contract, product, descriptionHtml, comfortOptions, media, updateInput,
    productAction: Object.keys(updateInput).length > 1 ? 'update' : 'unchanged',
    mediaAction: media.some((entry) => entry.currentAlt !== entry.alt) ? 'update' : 'unchanged',
  };
});

const targetIds = new Set(productPlans.map((entry) => entry.product.id));
if (targetIds.size !== 4) fail('Mattress product IDs are not unique.');
for (const contract of MATTRESS_CUSTOMER_NAMING) {
  const conflict = byHandle.get(contract.handle);
  if (conflict && !targetIds.has(conflict.id)) fail(`Target handle ${contract.handle} belongs to another product.`);
}

const productContractsById = new Map(productPlans.map((entry) => [entry.product.id, entry.contract]));
const pagePlans = before.pages.nodes.map((page) => ({ page, body: replaceCustomerFacingMattressNames(page.body) }))
  .filter((entry) => entry.body !== entry.page.body);
const menuPlans = before.menus.nodes.map((menu) => {
  const items = menu.items.map((item) => menuItemInput(item, productContractsById));
  return { menu, items, action: JSON.stringify(normalizedMenuItems(menu.items)) === JSON.stringify(normalizedMenuItems(items)) ? 'unchanged' : 'update' };
});

const localAssets = new Map(themeAssets.map((key) => [key, fs.readFileSync(path.join(ROOT, ...key.split('/')), 'utf8')]));
const publishedBefore = new Map();
const unpublishedBefore = new Map();
for (const key of themeAssets) {
  publishedBefore.set(key, await readAsset(PUBLISHED_THEME_ID, key));
  unpublishedBefore.set(key, await readAsset(UNPUBLISHED_THEME_ID, key));
}
const assetPlan = themeAssets.map((key) => ({ key, action: assetMatches(key, unpublishedBefore.get(key)?.value, localAssets.get(key)) ? 'unchanged' : 'update' }));

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'plan',
  store: connection.shop,
  products: productPlans.map((entry) => ({
    id: entry.product.id, fromHandle: entry.product.handle, handle: entry.contract.handle, title: entry.contract.title,
    productAction: entry.productAction, mediaAction: entry.mediaAction,
  })),
  pages: pagePlans.map((entry) => entry.page.handle),
  menus: menuPlans.filter((entry) => entry.action === 'update').map((entry) => entry.menu.handle),
  theme: { published: publishedTheme, unpublished: unpublishedTheme, assets: assetPlan },
  comfortLabels: ['Soft', 'Medium Soft', 'Medium Firm', 'Firm'],
  previewUrl: `https://${connection.shop}/?preview_theme_id=${UNPUBLISHED_THEME_ID}`,
}, null, 2));

if (!APPLY) {
  console.log('Plan only: no Shopify state changed. Re-run with --apply after reviewing the bounded plan.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(BACKUP_ROOT, stamp);
fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(path.join(backupDir, 'shopify-before.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), products: productPlans.map((entry) => entry.product), pages: pagePlans.map((entry) => entry.page), menus: before.menus.nodes, redirects: before.urlRedirects.nodes }, null, 2)}\n`);
for (const [key, asset] of unpublishedBefore) {
  if (!asset?.value) continue;
  const backupPath = path.join(backupDir, 'unpublished-theme', ...key.split('/'));
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, asset.value, 'utf8');
}
fs.writeFileSync(path.join(backupDir, 'published-theme-hashes.json'), `${JSON.stringify({ theme: publishedTheme, assets: themeAssets.map((key) => ({ key, sha256: sha256(publishedBefore.get(key)?.value) })) }, null, 2)}\n`);

const beforeFingerprint = commerceFingerprint(before.products.nodes);
for (const entry of productPlans) {
  if (entry.productAction === 'update') {
    const data = await graphql(PRODUCT_UPDATE, { product: entry.updateInput });
    requireNoUserErrors(data.productUpdate.userErrors, `Could not update ${entry.product.handle}`);
  }
  if (entry.mediaAction === 'update') {
    const data = await graphql(MEDIA_UPDATE, { productId: entry.product.id, media: entry.media.map(({ id, alt }) => ({ id, alt })) });
    requireNoUserErrors(data.productUpdateMedia.mediaUserErrors, `Could not update media for ${entry.product.handle}`);
  }
}

for (const entry of pagePlans) {
  const data = await graphql(PAGE_UPDATE, { id: entry.page.id, page: { body: entry.body } });
  requireNoUserErrors(data.pageUpdate.userErrors, `Could not update page ${entry.page.handle}`);
}

for (const entry of menuPlans) {
  if (entry.action !== 'update') continue;
  const data = await graphql(MENU_UPDATE, { id: entry.menu.id, title: entry.menu.title, handle: entry.menu.handle, items: entry.items });
  requireNoUserErrors(data.menuUpdate.userErrors, `Could not update menu ${entry.menu.handle}`);
}

for (const { key, action } of assetPlan) if (action === 'update') await writeAsset(UNPUBLISHED_THEME_ID, key, localAssets.get(key));

const after = await graphql(INSPECT);
const afterByHandle = new Map(after.products.nodes.map((product) => [product.handle, product]));
for (const contract of MATTRESS_CUSTOMER_NAMING) {
  const product = afterByHandle.get(contract.handle);
  if (!product || product.title !== contract.title) fail(`Product readback failed for ${contract.handle}.`);
  const feelLabel = product.metafields.nodes.find((entry) => entry.namespace === 'custom' && entry.key === 'feel_label')?.value || null;
  if (feelLabel !== (contract.feelLabel || null)) fail(`Verified feel readback failed for ${contract.handle}.`);
  if (/\b(?:BEDGEAR|S7|H6|M3|M5)\b/i.test(product.descriptionHtml)) fail(`Customer-facing mattress description still exposes a manufacturer/model name for ${contract.handle}.`);
  if (product.media.nodes.some((media) => /\b(?:BEDGEAR|S7|H6|M3|M5)\b/i.test(media.alt || ''))) fail(`Mattress media alt text still exposes a manufacturer/model name for ${contract.handle}.`);
  const redirect = after.urlRedirects.nodes.find((entry) => entry.path === `/products/${contract.oldHandle}`);
  if (!redirect || redirect.target !== `/products/${contract.handle}`) fail(`Missing old-handle redirect for ${contract.oldHandle}.`);
}
if (JSON.stringify(beforeFingerprint) !== JSON.stringify(commerceFingerprint(after.products.nodes))) fail('Commerce fingerprint changed outside approved title/handle/description/media/metafield fields.');

for (const page of after.pages.nodes) {
  if (/\b(?:BEDGEAR\s+)?(?:S7|H6|M3|M5)\b/.test(page.body) || /\/products\/bedgear-(?:s7|h6|m3|m5)/.test(page.body)) fail(`Page ${page.handle} retains an old mattress customer name.`);
}
for (const menu of after.menus.nodes) {
  const serialized = JSON.stringify(menu.items);
  if (/"title":"(?:S7|H6|M3|M5)"/.test(serialized) || /\/products\/bedgear-(?:s7|h6|m3|m5)/.test(serialized)) fail(`Menu ${menu.handle} retains an old mattress customer name.`);
}

const publishedAfter = new Map();
const unpublishedAfter = new Map();
for (const key of themeAssets) {
  publishedAfter.set(key, await readAsset(PUBLISHED_THEME_ID, key));
  unpublishedAfter.set(key, await readAsset(UNPUBLISHED_THEME_ID, key));
  if (sha256(publishedAfter.get(key)?.value) !== sha256(publishedBefore.get(key)?.value)) fail(`Published theme asset changed: ${key}.`);
  if (!assetMatches(key, unpublishedAfter.get(key)?.value, localAssets.get(key))) fail(`Unpublished theme asset mismatch: ${key}.`);
}

const readback = {
  generatedAt: new Date().toISOString(), store: connection.shop, backupDir,
  previewUrl: `https://${connection.shop}/?preview_theme_id=${UNPUBLISHED_THEME_ID}`,
  summary: {
    products: 4, pagesUpdated: pagePlans.length, menusUpdated: menuPlans.filter((entry) => entry.action === 'update').length,
    themeAssetsUpdated: assetPlan.filter((entry) => entry.action === 'update').length,
    publishedThemeUnchanged: true, commerceFingerprintPreserved: true,
  },
  products: MATTRESS_CUSTOMER_NAMING.map((contract) => {
    const product = afterByHandle.get(contract.handle);
    const redirect = after.urlRedirects.nodes.find((entry) => entry.path === `/products/${contract.oldHandle}`);
    return { id: product.id, title: product.title, handle: product.handle, status: product.status, media: product.media.nodes, redirect };
  }),
  menus: after.menus.nodes,
  pagesUpdated: pagePlans.map((entry) => entry.page.handle),
  theme: { published: publishedTheme, unpublished: unpublishedTheme, assets: themeAssets.map((key) => ({ key, publishedSha256: sha256(publishedAfter.get(key)?.value), unpublishedSha256: sha256(unpublishedAfter.get(key)?.value) })) },
};
fs.mkdirSync(path.dirname(READBACK_PATH), { recursive: true });
fs.writeFileSync(READBACK_PATH, `${JSON.stringify(readback, null, 2)}\n`);
console.log(`Verified customer-facing mattress names and comfort labels. Backup: ${backupDir}`);
console.log(`Readback: ${path.relative(ROOT, READBACK_PATH)}`);
