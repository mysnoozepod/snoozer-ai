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
const PUBLISHED_THEME_ID = '139460542525';
const UNPUBLISHED_THEME_ID = '139216420925';
const EXPECTED_THEME_NAME = 'snoozer-ai/main';
const APPLY = process.argv.includes('--apply');
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\storefront-polish';
const READBACK_PATH = path.join(ROOT, 'docs', 'storefront-polish', 'SHOPIFY_READBACK.json');

const themeAssets = [
  'assets/component-product-variant-picker.css',
  'assets/component-snoozepod-commerce-v1.css',
  'assets/snoozepod-dual-comfort.js',
  'config/settings_data.json',
  'layout/theme.liquid',
  'sections/announcement-bar.liquid',
  'sections/header.liquid',
  'sections/snoozepod-collection-hero.liquid',
  'sections/snoozepod-collection-navigation-v1.liquid',
  'sections/snoozepod-environment.liquid',
  'sections/snoozepod-mattress-showcase.liquid',
  'sections/snoozepod-meet-snoozer.liquid',
  'sections/snoozepod-product-hero.liquid',
  'sections/snoozer-landing-booking.liquid',
  'templates/collection.snoozepod-v1.json',
  'templates/index.json',
  'templates/page.landing-booking.json',
  'templates/product.json',
  'templates/product.main.json',
  'templates/product.product-support-item.json',
  'templates/product.snoozepod-v1.json',
];

function fail(message) { throw new Error(message); }
function sha256(value) { return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex'); }
function stripJsonHeader(value) { return String(value || '').replace(/^\/\*[\s\S]*?\*\//, '').trim(); }
function normalizeAsset(key, value) {
  if (!key.endsWith('.json')) return String(value || '').replace(/\r\n/g, '\n');
  return JSON.stringify(JSON.parse(stripJsonHeader(value)));
}
function assetsMatch(key, current, desired) {
  if (typeof current !== 'string') return false;
  try { return normalizeAsset(key, current) === normalizeAsset(key, desired); } catch { return false; }
}

function readConnection() {
  const raw = execFileSync('aws', [
    'lambda', 'get-function-configuration', '--function-name', LAMBDA_FUNCTION, '--region', AWS_REGION,
    '--query', 'Environment.Variables.{SHOPIFY_DOMAIN:SHOPIFY_DOMAIN,SHOPIFY_ADMIN_TOKEN:SHOPIFY_ADMIN_TOKEN,SHOPIFY_ADMIN_API_VERSION:SHOPIFY_ADMIN_API_VERSION}',
    '--output', 'json', '--no-cli-pager',
  ], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', AWS_PAGER: '' } });
  const values = JSON.parse(raw);
  if (values.SHOPIFY_DOMAIN !== EXPECTED_STORE) fail(`Refusing unexpected store ${values.SHOPIFY_DOMAIN || 'missing'}.`);
  const apiVersion = values.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected Admin API version ${apiVersion}.`);
  if (!values.SHOPIFY_ADMIN_TOKEN) fail('SHOPIFY_ADMIN_TOKEN is unavailable from the existing development configuration.');
  return { shop: values.SHOPIFY_DOMAIN, token: values.SHOPIFY_ADMIN_TOKEN, apiVersion };
}

const connection = readConnection();
const endpoint = `https://${connection.shop}/admin/api/${connection.apiVersion}`;

async function shopify(pathname, options = {}) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${endpoint}${pathname}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': connection.token, ...(options.headers || {}) },
    });
    if (response.status === 429 && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
      continue;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) fail(`Shopify request failed for ${pathname}: HTTP ${response.status}.`);
    return payload;
  }
  fail(`Shopify request remained throttled for ${pathname}.`);
}

async function readAsset(themeId, key) {
  const params = new URLSearchParams({ 'asset[key]': key });
  const response = await fetch(`${endpoint}/themes/${themeId}/assets.json?${params}`, {
    headers: { 'X-Shopify-Access-Token': connection.token },
  });
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.asset) fail(`Could not read ${key} from theme ${themeId}: HTTP ${response.status}.`);
  return payload.asset;
}

async function writeAsset(themeId, key, value) {
  await shopify(`/themes/${themeId}/assets.json`, {
    method: 'PUT',
    body: JSON.stringify({ asset: { key, value } }),
  });
}

async function deleteAsset(themeId, key) {
  const params = new URLSearchParams({ 'asset[key]': key });
  await shopify(`/themes/${themeId}/assets.json?${params}`, { method: 'DELETE' });
}

for (const key of themeAssets) {
  if (!fs.existsSync(path.join(ROOT, ...key.split('/')))) fail(`Missing local asset ${key}.`);
}

const desired = new Map(themeAssets.map((key) => [key, fs.readFileSync(path.join(ROOT, ...key.split('/')), 'utf8')]));
const themes = (await shopify('/themes.json?fields=id,name,role,updated_at')).themes || [];
const targets = [
  themes.find((theme) => String(theme.id) === PUBLISHED_THEME_ID),
  themes.find((theme) => String(theme.id) === UNPUBLISHED_THEME_ID),
];
if (!targets[0] || targets[0].name !== EXPECTED_THEME_NAME || targets[0].role !== 'main') fail('Published theme identity mismatch.');
if (!targets[1] || targets[1].name !== EXPECTED_THEME_NAME || targets[1].role !== 'unpublished') fail('Unpublished theme identity mismatch.');

const before = new Map();
for (const theme of targets) {
  const assets = new Map();
  for (const key of themeAssets) assets.set(key, await readAsset(theme.id, key));
  before.set(String(theme.id), assets);
}

const plan = targets.map((theme) => ({
  theme: { id: String(theme.id), name: theme.name, role: theme.role, updatedAt: theme.updated_at },
  assets: themeAssets.map((key) => ({
    key,
    action: assetsMatch(key, before.get(String(theme.id)).get(key)?.value, desired.get(key)) ? 'unchanged' : before.get(String(theme.id)).get(key) ? 'update' : 'create',
  })),
}));

console.log(JSON.stringify({ apply: APPLY, store: connection.shop, plan }, null, 2));
if (!APPLY) process.exit(0);

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(BACKUP_ROOT, timestamp);
fs.mkdirSync(backupDir, { recursive: true });
for (const theme of targets) {
  const themeDir = path.join(backupDir, `${theme.id}-${theme.role}`);
  fs.mkdirSync(themeDir, { recursive: true });
  for (const key of themeAssets) {
    const asset = before.get(String(theme.id)).get(key);
    if (!asset?.value) continue;
    const destination = path.join(themeDir, ...key.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, asset.value, 'utf8');
  }
}
fs.writeFileSync(path.join(backupDir, 'manifest.json'), `${JSON.stringify({
  createdAt: new Date().toISOString(),
  store: connection.shop,
  recoveryMethod: 'Restore these exact files to the matching theme IDs through the Shopify Theme Asset API.',
  themes: plan,
}, null, 2)}\n`);

const written = [];
try {
  for (const themePlan of plan) {
    for (const assetPlan of themePlan.assets) {
      if (assetPlan.action === 'unchanged') continue;
      await writeAsset(themePlan.theme.id, assetPlan.key, desired.get(assetPlan.key));
      written.push({ themeId: themePlan.theme.id, key: assetPlan.key });
    }
  }
} catch (error) {
  for (const item of written.reverse()) {
    const original = before.get(item.themeId).get(item.key);
    if (original?.value) await writeAsset(item.themeId, item.key, original.value);
    else await deleteAsset(item.themeId, item.key);
  }
  throw error;
}

const verified = [];
for (const theme of targets) {
  for (const key of themeAssets) {
    const actual = await readAsset(theme.id, key);
    if (!assetsMatch(key, actual?.value, desired.get(key))) fail(`Readback mismatch for theme ${theme.id} ${key}.`);
    verified.push({ themeId: String(theme.id), role: theme.role, key, sha256: sha256(normalizeAsset(key, actual.value)) });
  }
}

fs.mkdirSync(path.dirname(READBACK_PATH), { recursive: true });
fs.writeFileSync(READBACK_PATH, `${JSON.stringify({
  completedAt: new Date().toISOString(),
  store: connection.shop,
  backupDir,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
  themes: targets.map((theme) => ({ id: String(theme.id), name: theme.name, role: theme.role })),
  changedAssets: plan.flatMap((themePlan) => themePlan.assets.filter((asset) => asset.action !== 'unchanged').map((asset) => ({ themeId: themePlan.theme.id, role: themePlan.theme.role, key: asset.key, action: asset.action }))),
  verified,
}, null, 2)}\n`);

console.log(`Backed up both themes to ${backupDir}.`);
console.log(`Verified ${verified.length} theme-asset readbacks.`);
