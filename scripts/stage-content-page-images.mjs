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
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\content-page-images';
const READBACK_PATH = path.join(ROOT, 'docs', 'content-pages', 'CONTENT_PAGE_IMAGES_SHOPIFY_READBACK.json');

const imageFiles = [
  'content-guide-showroom.png',
  'content-guide-virtual-session.png',
  'content-guide-sleep-system.png',
  'content-guide-comfort-comparison.png',
  'content-guide-dual-comfort.png',
  'content-guide-split-system.png',
  'content-guide-mattress-materials.png',
  'content-guide-cooling.png',
  'content-guide-adjustable-base.png',
  'content-guide-bedding-essentials.png',
];

function fail(message) { throw new Error(message); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

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
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected API version ${apiVersion}.`);
  if (!token) fail('SHOPIFY_ADMIN_TOKEN is unavailable from the existing development configuration.');
  return { shop, token, apiVersion };
}

const connection = readConnection();
const endpoint = `https://${connection.shop}/admin/api/${connection.apiVersion}`;

async function shopify(pathname, options = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${endpoint}${pathname}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': connection.token, ...(options.headers || {}) },
    });
    if (response.status === 429 && attempt < 4) {
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
  const response = await fetch(`${endpoint}/themes/${themeId}/assets.json?${params}`, {
    headers: { 'X-Shopify-Access-Token': connection.token },
  });
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.asset) fail(`Could not read ${key} from theme ${themeId}: HTTP ${response.status}.`);
  return payload.asset;
}

async function readBinary(asset) {
  if (!asset) return null;
  if (asset.attachment) return Buffer.from(asset.attachment, 'base64');
  if (asset.public_url) {
    const url = asset.public_url.startsWith('//') ? `https:${asset.public_url}` : asset.public_url;
    const response = await fetch(url);
    if (!response.ok) fail(`Could not download existing binary asset: HTTP ${response.status}.`);
    return Buffer.from(await response.arrayBuffer());
  }
  return null;
}

async function writeText(themeId, key, value) {
  await shopify(`/themes/${themeId}/assets.json`, { method: 'PUT', body: JSON.stringify({ asset: { key, value } }) });
}

async function writeBinary(themeId, key, buffer) {
  await shopify(`/themes/${themeId}/assets.json`, { method: 'PUT', body: JSON.stringify({ asset: { key, attachment: buffer.toString('base64') } }) });
}

const themesPayload = await shopify('/themes.json?fields=id,name,role,updated_at');
const themes = themesPayload.themes || [];
const published = themes.find((theme) => String(theme.id) === PUBLISHED_THEME_ID);
const unpublished = themes.find((theme) => String(theme.id) === UNPUBLISHED_THEME_ID);
if (!published || published.role !== 'main' || published.name !== EXPECTED_THEME_NAME) fail('Published theme identity or role mismatch.');
if (!unpublished || unpublished.role !== 'unpublished' || unpublished.name !== EXPECTED_THEME_NAME) fail('Unpublished theme identity or role mismatch.');

const desiredText = fs.readFileSync(path.join(ROOT, 'sections', 'main-page.liquid'), 'utf8');
const desiredImages = new Map(imageFiles.map((name) => {
  const localPath = path.join(ROOT, 'assets', name);
  if (!fs.existsSync(localPath)) fail(`Missing content image: ${localPath}.`);
  return [`assets/${name}`, fs.readFileSync(localPath)];
}));

const themeStates = [];
for (const theme of [published, unpublished]) {
  const textAsset = await readAsset(theme.id, 'sections/main-page.liquid');
  const images = new Map();
  for (const key of desiredImages.keys()) {
    const asset = await readAsset(theme.id, key);
    images.set(key, { asset, bytes: await readBinary(asset) });
  }
  themeStates.push({ theme, textAsset, images });
}

const plan = themeStates.flatMap((state) => {
  const entries = [{
    themeId: String(state.theme.id),
    role: state.theme.role,
    key: 'sections/main-page.liquid',
    action: state.textAsset?.value === desiredText ? 'unchanged' : state.textAsset ? 'update' : 'create',
  }];
  for (const [key, desired] of desiredImages) {
    const current = state.images.get(key);
    entries.push({
      themeId: String(state.theme.id),
      role: state.theme.role,
      key,
      action: current?.bytes && sha256(current.bytes) === sha256(desired) ? 'unchanged' : current?.asset ? 'update' : 'create',
    });
  }
  return entries;
});

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'plan',
  store: connection.shop,
  themes: [published, unpublished].map((theme) => ({ id: String(theme.id), name: theme.name, role: theme.role })),
  images: imageFiles.length,
  createCount: plan.filter((item) => item.action === 'create').length,
  updateCount: plan.filter((item) => item.action === 'update').length,
  unchangedCount: plan.filter((item) => item.action === 'unchanged').length,
  plan,
}, null, 2));

if (!APPLY) {
  console.log('Plan only: no theme assets were changed. Re-run with --apply after reviewing the exact themes and assets.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(BACKUP_ROOT, stamp);
fs.mkdirSync(backupDir, { recursive: true });
for (const state of themeStates) {
  const themeDir = path.join(backupDir, String(state.theme.id));
  fs.mkdirSync(themeDir, { recursive: true });
  fs.writeFileSync(path.join(themeDir, 'theme.json'), `${JSON.stringify(state.theme, null, 2)}\n`, 'utf8');
  if (state.textAsset?.value) fs.writeFileSync(path.join(themeDir, 'main-page.liquid'), state.textAsset.value, 'utf8');
  for (const [key, current] of state.images) {
    if (current.bytes) fs.writeFileSync(path.join(themeDir, path.basename(key)), current.bytes);
  }
}

for (const state of themeStates) {
  const themeId = state.theme.id;
  if (state.textAsset?.value !== desiredText) await writeText(themeId, 'sections/main-page.liquid', desiredText);
  for (const [key, desired] of desiredImages) {
    const current = state.images.get(key);
    if (!current?.bytes || sha256(current.bytes) !== sha256(desired)) await writeBinary(themeId, key, desired);
  }
}

const verifiedThemes = [];
for (const state of themeStates) {
  const themeId = state.theme.id;
  const actualText = await readAsset(themeId, 'sections/main-page.liquid');
  if (actualText?.value !== desiredText) fail(`main-page.liquid readback mismatch on theme ${themeId}.`);
  const verifiedImages = [];
  for (const [key, desired] of desiredImages) {
    const actualAsset = await readAsset(themeId, key);
    const actual = await readBinary(actualAsset);
    if (!actual || sha256(actual) !== sha256(desired)) fail(`${key} readback mismatch on theme ${themeId}.`);
    verifiedImages.push({ key, bytes: actual.length, sha256: sha256(actual), publicUrl: actualAsset.public_url || null });
  }
  verifiedThemes.push({ id: String(themeId), name: state.theme.name, role: state.theme.role, images: verifiedImages });
}

const readback = {
  generatedAt: new Date().toISOString(),
  store: connection.shop,
  summary: { themes: verifiedThemes.length, imagesPerTheme: imageFiles.length, mappedPages: 50 },
  themes: verifiedThemes,
  backup: backupDir,
};
fs.mkdirSync(path.dirname(READBACK_PATH), { recursive: true });
fs.writeFileSync(READBACK_PATH, `${JSON.stringify(readback, null, 2)}\n`, 'utf8');

console.log(`Verified ${imageFiles.length} content images and main-page.liquid on published theme ${PUBLISHED_THEME_ID} and unpublished theme ${UNPUBLISHED_THEME_ID}.`);
console.log(`Backup: ${backupDir}`);
console.log(`Readback: ${READBACK_PATH}`);
