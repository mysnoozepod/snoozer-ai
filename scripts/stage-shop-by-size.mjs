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
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\shop-by-size';
const READBACK_PATH = path.join(ROOT, 'docs', 'shop-by-size', 'SHOPIFY_READBACK.json');
const ASSETS = [
  'assets/snoozepod-shop-by-size.js',
  'sections/main-collection-product-grid.liquid',
  'snippets/card-product.liquid',
];

function fail(message) { throw new Error(message); }
function sha256(value) { return crypto.createHash('sha256').update(String(value || '').replace(/\r\n/g, '\n'), 'utf8').digest('hex'); }

function connection() {
  const raw = execFileSync('aws', [
    'lambda', 'get-function-configuration', '--function-name', LAMBDA_FUNCTION, '--region', AWS_REGION,
    '--query', 'Environment.Variables.{SHOPIFY_DOMAIN:SHOPIFY_DOMAIN,SHOPIFY_ADMIN_TOKEN:SHOPIFY_ADMIN_TOKEN,SHOPIFY_ADMIN_API_VERSION:SHOPIFY_ADMIN_API_VERSION}',
    '--output', 'json', '--no-cli-pager',
  ], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', AWS_PAGER: '' } });
  const values = JSON.parse(raw);
  const apiVersion = values.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;
  if (values.SHOPIFY_DOMAIN !== EXPECTED_STORE) fail(`Refusing unexpected store ${values.SHOPIFY_DOMAIN || 'missing'}.`);
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected API version ${apiVersion}.`);
  if (!values.SHOPIFY_ADMIN_TOKEN) fail('SHOPIFY_ADMIN_TOKEN is unavailable from the existing development configuration.');
  return { shop: values.SHOPIFY_DOMAIN, token: values.SHOPIFY_ADMIN_TOKEN, apiVersion };
}

const shopify = connection();
const endpoint = `https://${shopify.shop}/admin/api/${shopify.apiVersion}`;

async function request(pathname, options = {}) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${endpoint}${pathname}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': shopify.token, ...(options.headers || {}) },
    });
    if (response.status === 429 && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
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
  try {
    const payload = await request(`/themes/${themeId}/assets.json?${params}`);
    return payload.asset || null;
  } catch (error) {
    if (/HTTP 404/.test(error.message)) return null;
    throw error;
  }
}

async function writeAsset(themeId, key, value) {
  await request(`/themes/${themeId}/assets.json`, {
    method: 'PUT',
    body: JSON.stringify({ asset: { key, value } }),
  });
}

async function readAssetUntilMatch(themeId, key, expected) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const asset = await readAsset(themeId, key);
    if (asset?.value && sha256(asset.value) === sha256(expected)) return asset;
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return null;
}

const themes = (await request('/themes.json?fields=id,name,role,updated_at')).themes || [];
const published = themes.find((theme) => String(theme.id) === PUBLISHED_THEME_ID);
const unpublished = themes.find((theme) => String(theme.id) === UNPUBLISHED_THEME_ID);
if (!published || published.role !== 'main' || published.name !== EXPECTED_THEME_NAME) fail('Published theme identity changed.');
if (!unpublished || unpublished.role !== 'unpublished' || unpublished.name !== EXPECTED_THEME_NAME) fail('Unpublished theme identity changed.');

const desired = new Map(ASSETS.map((key) => {
  const file = path.join(ROOT, ...key.split('/'));
  if (!fs.existsSync(file)) fail(`Missing local asset ${key}.`);
  return [key, fs.readFileSync(file, 'utf8')];
}));
const current = new Map();
const publishedBefore = new Map();
for (const key of ASSETS) {
  current.set(key, await readAsset(UNPUBLISHED_THEME_ID, key));
  publishedBefore.set(key, await readAsset(PUBLISHED_THEME_ID, key));
}

const plan = ASSETS.map((key) => ({
  key,
  action: current.get(key)?.value && sha256(current.get(key).value) === sha256(desired.get(key))
    ? 'unchanged'
    : current.get(key) ? 'update' : 'create',
}));
console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'plan',
  store: shopify.shop,
  publishedTheme: { id: PUBLISHED_THEME_ID, name: published.name, role: published.role },
  targetTheme: { id: UNPUBLISHED_THEME_ID, name: unpublished.name, role: unpublished.role },
  plan,
  previewUrl: `https://${shopify.shop}/collections/mattresses?preview_theme_id=${UNPUBLISHED_THEME_ID}`,
}, null, 2));

if (!APPLY) {
  console.log('Plan only: no Shopify state changed. Re-run with --apply after reviewing the exact three-asset plan.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDirectory = path.join(BACKUP_ROOT, stamp);
for (const [themeId, assets] of [[UNPUBLISHED_THEME_ID, current], [PUBLISHED_THEME_ID, publishedBefore]]) {
  for (const [key, asset] of assets) {
    if (!asset?.value) continue;
    const file = path.join(backupDirectory, themeId, ...key.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, asset.value, 'utf8');
  }
}

for (const item of plan) {
  if (item.action !== 'unchanged') await writeAsset(UNPUBLISHED_THEME_ID, item.key, desired.get(item.key));
}

const readback = [];
for (const key of ASSETS) {
  const targetAfter = await readAssetUntilMatch(UNPUBLISHED_THEME_ID, key, desired.get(key));
  if (!targetAfter?.value || sha256(targetAfter.value) !== sha256(desired.get(key))) fail(`${key} failed unpublished-theme readback.`);
  const publishedAfter = await readAsset(PUBLISHED_THEME_ID, key);
  const before = publishedBefore.get(key);
  if (Boolean(before) !== Boolean(publishedAfter) || (before?.value && sha256(before.value) !== sha256(publishedAfter.value))) fail(`Published theme changed unexpectedly for ${key}.`);
  readback.push({ key, sha256: sha256(targetAfter.value) });
}

const result = {
  verifiedAt: new Date().toISOString(),
  store: shopify.shop,
  backupDirectory,
  publishedTheme: { id: PUBLISHED_THEME_ID, unchangedAssets: ASSETS.length },
  targetTheme: { id: UNPUBLISHED_THEME_ID, assets: readback },
  previewUrl: `https://${shopify.shop}/collections/mattresses?preview_theme_id=${UNPUBLISHED_THEME_ID}`,
};
fs.mkdirSync(path.dirname(READBACK_PATH), { recursive: true });
fs.writeFileSync(READBACK_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ result: 'Shop by Size staged and verified.', ...result }, null, 2));
