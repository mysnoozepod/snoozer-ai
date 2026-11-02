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
const TARGET_THEME_ID = '139216420925';
const PUBLISHED_THEME_ID = '139460542525';
const EXPECTED_THEME_NAME = 'snoozer-ai/main';
const PRIVATE_BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify';
const APPLY = process.argv.includes('--apply');
const DEBUG = process.argv.includes('--debug');

const THEME_FILES = [
  'assets/component-snoozepod-commerce-v1.css',
  'assets/snooze-assessment.js',
  'assets/snoozepod-dual-comfort.js',
  'assets/snoozepod-pod-builder.css',
  'assets/snoozepod-pod-builder.js',
  'sections/footer-group.json',
  'sections/header-group.json',
  'sections/header.liquid',
  'sections/main-collection-product-grid.liquid',
  'sections/snoozepod-collection-cta.liquid',
  'sections/snoozepod-collection-hero.liquid',
  'sections/snoozepod-collection-navigation-v1.liquid',
  'sections/snoozepod-environment.liquid',
  'sections/snoozepod-guided-pod-builder.liquid',
  'sections/snoozepod-pod-builder-hero.liquid',
  'sections/snoozepod-pod-pairing.liquid',
  'sections/snoozepod-booking-cta.liquid',
  'sections/snoozepod-product-hero.liquid',
  'sections/snoozepod-product-information-v1.liquid',
  'sections/snoozepod-sleep-facts.liquid',
  'sections/snoozepod-trust-strip.liquid',
  'sections/snoozer-cart-guidance-cards.liquid',
  'sections/snoozer-cart-trust-strip.liquid',
  'sections/snoozer-landing-assessment.liquid',
  'snippets/card-product.liquid',
  'snippets/snoozepod-card-details.liquid',
  'snippets/snoozepod-collection-navigation-card.liquid',
  'snippets/snoozepod-guided-pod-builder-core.liquid',
  'snippets/snoozepod-product-feel.liquid',
  'snippets/snoozepod-showroom-location.liquid',
  'templates/cart.json',
  'templates/collection.snoozepod-v1.json',
  'templates/index.json',
  'templates/product.json',
  'templates/product.pod-builder.json',
  'templates/product.product-pod-builder.json',
  'templates/product.snoozepod-v1.json',
];

const REQUIRED_REMOTE_DEPENDENCIES = [
  'layout/theme.liquid',
  'sections/custom-liquid.liquid',
  'sections/footer.liquid',
  'sections/image-with-text.liquid',
  'sections/newsletter.liquid',
  'sections/snooze-hero.liquid',
  'sections/snoozepod-final-build-cta.liquid',
  'sections/snoozepod-trust-strip.liquid',
  'snippets/buy-buttons.liquid',
  'snippets/price.liquid',
  'snippets/product-media-gallery.liquid',
  'snippets/product-variant-picker.liquid',
];

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function contentHash(key, value) {
  if (key.endsWith('.json')) {
    const withoutLeadingComment = value.replace(/^\s*\/\*[\s\S]*?\*\//, '');
    return sha256(JSON.stringify(canonicalize(JSON.parse(withoutLeadingComment))));
  }
  return sha256(value.replace(/\r\n/g, '\n'));
}

function parseJsonAsset(value) {
  return canonicalize(JSON.parse(value.replace(/^\s*\/\*[\s\S]*?\*\//, '')));
}

function collectDiffs(left, right, currentPath = '$', diffs = []) {
  if (diffs.length >= 50) return diffs;
  if (JSON.stringify(left) === JSON.stringify(right)) return diffs;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) {
    diffs.push({ path: currentPath, local: left, remote: right });
    return diffs;
  }
  if (Array.isArray(left)) {
    const max = Math.max(left.length, right.length);
    for (let index = 0; index < max; index += 1) collectDiffs(left[index], right[index], `${currentPath}[${index}]`, diffs);
    return diffs;
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of [...keys].sort()) collectDiffs(left[key], right[key], `${currentPath}.${key}`, diffs);
  return diffs;
}

function readShopifyConnection() {
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
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: '1', AWS_PAGER: '' },
    },
  );
  const variables = JSON.parse(raw);
  const shop = variables.SHOPIFY_DOMAIN;
  const token = variables.SHOPIFY_ADMIN_TOKEN;
  const apiVersion = variables.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;
  if (shop !== EXPECTED_STORE) fail(`Refusing unexpected Shopify store: ${shop || 'missing'}.`);
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected Admin API version: ${apiVersion}.`);
  if (!token) fail('SHOPIFY_ADMIN_TOKEN is unavailable from the existing development configuration.');
  return { shop, token, apiVersion };
}

const connection = readShopifyConnection();
const endpoint = `https://${connection.shop}/admin/api/${connection.apiVersion}`;

async function shopify(pathname, options = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${endpoint}${pathname}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': connection.token,
        ...(options.headers || {}),
      },
    });
    if (response.status === 429 && attempt < 4) {
      const retryAfter = Number(response.headers.get('retry-after') || 1);
      await new Promise((resolve) => setTimeout(resolve, Math.max(500, retryAfter * 1000)));
      continue;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      fail(`Shopify Admin request failed for ${pathname}: HTTP ${response.status}${payload?.errors ? ` — ${JSON.stringify(payload.errors)}` : ''}`);
    }
    return payload;
  }
  fail(`Shopify Admin request remained throttled for ${pathname}.`);
}

async function readThemes() {
  const payload = await shopify('/themes.json?fields=id,name,role,created_at,updated_at');
  return payload.themes || [];
}

function validateTarget(themes) {
  const target = themes.find((theme) => String(theme.id) === TARGET_THEME_ID);
  const published = themes.find((theme) => String(theme.id) === PUBLISHED_THEME_ID);
  if (!target) fail(`Target theme ${TARGET_THEME_ID} does not exist.`);
  if (target.role !== 'unpublished') fail(`Refusing target theme role ${target.role}; expected unpublished.`);
  if (target.name !== EXPECTED_THEME_NAME) fail(`Refusing target theme name ${target.name}; expected ${EXPECTED_THEME_NAME}.`);
  if (!published || published.role !== 'main') fail(`Published theme ${PUBLISHED_THEME_ID} is not confirmed as role main.`);
  if (TARGET_THEME_ID === PUBLISHED_THEME_ID) fail('Target and published theme IDs must differ.');
  return { target, published };
}

async function readAsset(key) {
  const params = new URLSearchParams({ 'asset[key]': key });
  try {
    const payload = await shopify(`/themes/${TARGET_THEME_ID}/assets.json?${params}`);
    const asset = payload.asset;
    if (!asset) fail(`Missing asset response for ${key}.`);
    if (typeof asset.value !== 'string') fail(`Asset ${key} did not return text content.`);
    return asset.value;
  } catch (error) {
    if (/HTTP 404/.test(error.message)) return null;
    throw error;
  }
}

async function writeAsset(key, value) {
  await shopify(`/themes/${TARGET_THEME_ID}/assets.json`, {
    method: 'PUT',
    body: JSON.stringify({ asset: { key, value } }),
  });
}

async function deleteAsset(key) {
  const params = new URLSearchParams({ 'asset[key]': key });
  await shopify(`/themes/${TARGET_THEME_ID}/assets.json?${params}`, { method: 'DELETE' });
}

const themes = await readThemes();
const { target, published } = validateTarget(themes);
const inventoryPayload = await shopify(`/themes/${TARGET_THEME_ID}/assets.json`);
const remoteKeys = new Set((inventoryPayload.assets || []).map((asset) => asset.key));
const missingDependencies = REQUIRED_REMOTE_DEPENDENCIES.filter((key) => !remoteKeys.has(key));
if (missingDependencies.length) {
  fail(`Target theme is missing required baseline dependencies: ${missingDependencies.join(', ')}.`);
}
const localAssets = THEME_FILES.map((key) => {
  const absolutePath = path.join(ROOT, ...key.split('/'));
  if (!fs.existsSync(absolutePath)) fail(`Missing local theme file: ${key}.`);
  const value = fs.readFileSync(absolutePath, 'utf8');
  return { key, value, sha256: contentHash(key, value) };
});

const remoteAssets = new Map();
for (const local of localAssets) {
  const value = await readAsset(local.key);
  remoteAssets.set(local.key, value);
}

const plan = localAssets.map((local) => {
  const remote = remoteAssets.get(local.key);
  return {
    key: local.key,
    action: remote === null ? 'create' : contentHash(local.key, remote) === local.sha256 ? 'unchanged' : 'update',
    localSha256: local.sha256,
    remoteSha256: remote === null ? null : contentHash(local.key, remote),
  };
});

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'plan',
  store: connection.shop,
  targetTheme: { id: String(target.id), name: target.name, role: target.role, updatedAt: target.updated_at },
  publishedTheme: { id: String(published.id), name: published.name, role: published.role, updatedAt: published.updated_at },
  createCount: plan.filter((item) => item.action === 'create').length,
  updateCount: plan.filter((item) => item.action === 'update').length,
  unchangedCount: plan.filter((item) => item.action === 'unchanged').length,
  remoteAssetCount: remoteKeys.size,
  missingDependencies,
  assets: plan.map(({ key, action }) => ({ key, action })),
}, null, 2));

if (DEBUG) {
  for (const item of plan.filter((entry) => entry.action === 'update' && entry.key.endsWith('.json'))) {
    const local = localAssets.find((asset) => asset.key === item.key);
    const remote = remoteAssets.get(item.key);
    console.log(JSON.stringify({ key: item.key, semanticDiff: collectDiffs(parseJsonAsset(local.value), parseJsonAsset(remote)) }, null, 2));
  }
}

if (!APPLY) {
  console.log('Plan only: no theme assets were changed. Re-run with --apply after reviewing this exact target and plan.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(PRIVATE_BACKUP_ROOT, `theme-${TARGET_THEME_ID}`, `catalog-shopping-restructure-${stamp}`);
fs.mkdirSync(backupDir, { recursive: true });
const backupManifest = {
  schemaVersion: '1.0',
  capturedAt: new Date().toISOString(),
  store: connection.shop,
  theme: { id: String(target.id), name: target.name, role: target.role, updatedAt: target.updated_at },
  recoveryMethod: 'Restore these exact asset values through the Shopify Theme Asset API; assets marked absent did not exist before this upload.',
  assets: [],
};

for (const local of localAssets) {
  const remote = remoteAssets.get(local.key);
  const backupPath = path.join(backupDir, ...local.key.split('/'));
  if (remote !== null) {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, remote, 'utf8');
  }
  backupManifest.assets.push({
    key: local.key,
    existed: remote !== null,
    sha256: remote === null ? null : sha256(remote),
  });
}
fs.writeFileSync(path.join(backupDir, 'backup-manifest.json'), `${JSON.stringify(backupManifest, null, 2)}\n`, 'utf8');
console.log(`Backed up ${localAssets.length} target assets to ${backupDir}.`);

const changed = plan.filter((item) => item.action !== 'unchanged');
const written = [];
try {
  for (const item of changed) {
    const local = localAssets.find((asset) => asset.key === item.key);
    await writeAsset(local.key, local.value);
    written.push(local.key);
    console.log(`${item.action === 'create' ? 'Created' : 'Updated'} ${local.key}.`);
  }
} catch (error) {
  console.error(`Upload failed after ${written.length} writes; restoring written assets from the private backup.`);
  for (const key of written.reverse()) {
    const remote = remoteAssets.get(key);
    if (remote === null) await deleteAsset(key);
    else await writeAsset(key, remote);
  }
  throw error;
}

for (const item of changed) {
  const local = localAssets.find((asset) => asset.key === item.key);
  const remote = await readAsset(item.key);
  if (remote === null || contentHash(item.key, remote) !== local.sha256) fail(`Readback hash mismatch for ${item.key}.`);
}

const finalThemes = await readThemes();
const finalTarget = finalThemes.find((theme) => String(theme.id) === TARGET_THEME_ID);
const finalPublished = finalThemes.find((theme) => String(theme.id) === PUBLISHED_THEME_ID);
if (finalTarget?.role !== 'unpublished') fail('Target theme role changed unexpectedly.');
if (finalPublished?.role !== 'main') fail('Published theme role changed unexpectedly.');

console.log(`Verified ${changed.length} uploaded assets by SHA-256 readback.`);
console.log(`Published theme ${PUBLISHED_THEME_ID} remains role main.`);
console.log(`Preview URL: https://${connection.shop}/?preview_theme_id=${TARGET_THEME_ID}`);
