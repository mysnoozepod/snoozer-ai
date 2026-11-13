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
const LIVE_THEME_ID = '139216420925';
const RECOVERY_THEME_ID = '139460542525';
const EXPECTED_THEME_NAME = 'snoozer-ai/main';
const APPLY = process.argv.includes('--apply');
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\storefront-polish-pass-1';
const READBACK_PATH = path.join(ROOT, 'docs', 'storefront-polish-pass-1', 'SHOPIFY_READBACK.json');

const themeAssets = [
  'assets/component-cart.css',
  'assets/snoozepod-curated-bundles.js',
  'layout/theme.liquid',
  'locales/en.default.json',
  'sections/header.liquid',
  'sections/main-cart-footer.liquid',
  'sections/main-cart-items.liquid',
  'sections/main-collection-product-grid.liquid',
  'sections/main-page.liquid',
  'sections/snoozepod-footer-navigation.liquid',
  'snippets/snoozepod-mattress-product-information.liquid',
  'templates/cart.json',
  'templates/index.json',
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
    if (!response.ok || !payload) {
      const detail = payload?.errors ? ` ${JSON.stringify(payload.errors)}` : '';
      fail(`Shopify request failed for ${pathname}: HTTP ${response.status}.${detail}`);
    }
    return payload;
  }
  fail(`Shopify request remained throttled for ${pathname}.`);
}

async function readAsset(themeId, key) {
  const params = new URLSearchParams({ 'asset[key]': key });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${endpoint}/themes/${themeId}/assets.json?${params}`, {
      headers: { 'X-Shopify-Access-Token': connection.token },
    });
    if (response.status === 429 && attempt < 5) {
      const retryAfter = Number(response.headers.get('retry-after')) || (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }
    if (response.status === 404) return null;
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.asset) fail(`Could not read ${key} from theme ${themeId}: HTTP ${response.status}.`);
    return payload.asset;
  }
  fail(`Could not read ${key} from theme ${themeId}: repeated HTTP 429 responses.`);
}

async function writeAsset(themeId, key, value) {
  try {
    await shopify(`/themes/${themeId}/assets.json`, {
      method: 'PUT',
      body: JSON.stringify({ asset: { key, value } }),
    });
  } catch (error) {
    fail(`Could not write ${key} to theme ${themeId}. ${error.message}`);
  }
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
const liveTheme = themes.find((theme) => String(theme.id) === LIVE_THEME_ID);
const recoveryTheme = themes.find((theme) => String(theme.id) === RECOVERY_THEME_ID);
if (!liveTheme || liveTheme.name !== EXPECTED_THEME_NAME || liveTheme.role !== 'main') fail('Live theme identity mismatch.');
if (!recoveryTheme || recoveryTheme.name !== EXPECTED_THEME_NAME || recoveryTheme.role !== 'unpublished') fail('Recovery theme identity mismatch.');

const beforeLive = new Map();
const beforeRecovery = new Map();
for (const key of themeAssets) {
  beforeLive.set(key, await readAsset(LIVE_THEME_ID, key));
  beforeRecovery.set(key, await readAsset(RECOVERY_THEME_ID, key));
}

const plan = themeAssets.map((key) => ({
  key,
  action: assetsMatch(key, beforeLive.get(key)?.value, desired.get(key)) ? 'unchanged' : beforeLive.get(key) ? 'update' : 'create',
}));

console.log(JSON.stringify({
  apply: APPLY,
  store: connection.shop,
  liveTheme: { id: LIVE_THEME_ID, name: liveTheme.name, role: liveTheme.role },
  recoveryTheme: { id: RECOVERY_THEME_ID, name: recoveryTheme.name, role: recoveryTheme.role, action: 'verify-unchanged' },
  plan,
}, null, 2));
if (!APPLY) process.exit(0);

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(BACKUP_ROOT, timestamp);
for (const [themeId, role, assets] of [
  [LIVE_THEME_ID, 'main', beforeLive],
  [RECOVERY_THEME_ID, 'unpublished', beforeRecovery],
]) {
  const themeDir = path.join(backupDir, `${themeId}-${role}`);
  for (const key of themeAssets) {
    const asset = assets.get(key);
    if (!asset?.value) continue;
    const destination = path.join(themeDir, ...key.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, asset.value, 'utf8');
  }
}
fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(path.join(backupDir, 'manifest.json'), `${JSON.stringify({
  createdAt: new Date().toISOString(),
  store: connection.shop,
  recoveryMethod: `Restore the main-theme files to theme ${LIVE_THEME_ID} through the Shopify Theme Asset API. Theme ${RECOVERY_THEME_ID} was backed up and intentionally left unchanged.`,
  liveTheme: { id: LIVE_THEME_ID, name: liveTheme.name, role: liveTheme.role },
  recoveryTheme: { id: RECOVERY_THEME_ID, name: recoveryTheme.name, role: recoveryTheme.role },
  plan,
}, null, 2)}\n`);

const written = [];
try {
  for (const assetPlan of plan) {
    if (assetPlan.action === 'unchanged') continue;
    await writeAsset(LIVE_THEME_ID, assetPlan.key, desired.get(assetPlan.key));
    written.push(assetPlan.key);
  }
} catch (error) {
  for (const key of written.reverse()) {
    const original = beforeLive.get(key);
    if (original?.value) await writeAsset(LIVE_THEME_ID, key, original.value);
    else await deleteAsset(LIVE_THEME_ID, key);
  }
  throw error;
}

const verified = [];
for (const key of themeAssets) {
  const actualLive = await readAsset(LIVE_THEME_ID, key);
  if (!assetsMatch(key, actualLive?.value, desired.get(key))) fail(`Live-theme readback mismatch for ${key}.`);
  verified.push({ themeId: LIVE_THEME_ID, role: 'main', key, sha256: sha256(normalizeAsset(key, actualLive.value)) });

  const actualRecovery = await readAsset(RECOVERY_THEME_ID, key);
  const beforeValue = beforeRecovery.get(key)?.value;
  if (sha256(actualRecovery?.value) !== sha256(beforeValue)) fail(`Recovery theme changed unexpectedly for ${key}.`);
}

fs.mkdirSync(path.dirname(READBACK_PATH), { recursive: true });
fs.writeFileSync(READBACK_PATH, `${JSON.stringify({
  completedAt: new Date().toISOString(),
  store: connection.shop,
  backupDir,
  baselineCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
  liveTheme: { id: LIVE_THEME_ID, name: liveTheme.name, role: liveTheme.role },
  recoveryTheme: { id: RECOVERY_THEME_ID, name: recoveryTheme.name, role: recoveryTheme.role, verifiedUnchanged: true },
  changedAssets: plan.filter((asset) => asset.action !== 'unchanged'),
  verified,
}, null, 2)}\n`);

console.log(`Backed up both theme states to ${backupDir}.`);
console.log(`Updated ${written.length} live-theme assets and verified ${verified.length} readbacks.`);
console.log(`Verified recovery theme ${RECOVERY_THEME_ID} remained unchanged.`);
