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
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\sharp-logo';
const LOGO_SOURCE = path.join(ROOT, 'omnia-journey', 'src', 'assets', 'mysnoozepod-logo-welcome.png');
const LOGO_KEY = 'assets/mysnoozepod-logo-sharp.png';

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
    const response = await fetch(asset.public_url.startsWith('//') ? `https:${asset.public_url}` : asset.public_url);
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

if (!fs.existsSync(LOGO_SOURCE)) fail(`Missing sharp logo source: ${LOGO_SOURCE}.`);
const desiredLogo = fs.readFileSync(LOGO_SOURCE);
const desiredText = new Map([
  ['sections/header.liquid', fs.readFileSync(path.join(ROOT, 'sections', 'header.liquid'), 'utf8')],
  ['sections/main-password-header.liquid', fs.readFileSync(path.join(ROOT, 'sections', 'main-password-header.liquid'), 'utf8')],
]);

const themeStates = [];
for (const theme of [published, unpublished]) {
  const logoAsset = await readAsset(theme.id, LOGO_KEY);
  const logoBytes = await readBinary(logoAsset);
  const textAssets = new Map();
  for (const key of desiredText.keys()) textAssets.set(key, await readAsset(theme.id, key));
  themeStates.push({ theme, logoAsset, logoBytes, textAssets });
}

const plan = themeStates.flatMap((state) => {
  const entries = [{
    themeId: String(state.theme.id),
    role: state.theme.role,
    key: LOGO_KEY,
    action: state.logoBytes && sha256(state.logoBytes) === sha256(desiredLogo) ? 'unchanged' : state.logoAsset ? 'update' : 'create',
  }];
  for (const [key, desired] of desiredText) {
    const actual = state.textAssets.get(key);
    entries.push({
      themeId: String(state.theme.id),
      role: state.theme.role,
      key,
      action: actual?.value === desired ? 'unchanged' : actual ? 'update' : 'create',
    });
  }
  return entries;
});

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'plan',
  store: connection.shop,
  logoSource: path.relative(ROOT, LOGO_SOURCE),
  logoSha256: sha256(desiredLogo),
  themes: [published, unpublished].map((theme) => ({ id: String(theme.id), name: theme.name, role: theme.role })),
  createCount: plan.filter((item) => item.action === 'create').length,
  updateCount: plan.filter((item) => item.action === 'update').length,
  unchangedCount: plan.filter((item) => item.action === 'unchanged').length,
  plan,
}, null, 2));

if (!APPLY) {
  console.log('Plan only: no theme assets were changed. Re-run with --apply after reviewing the exact themes and assets.');
} else {
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(BACKUP_ROOT, stamp);
fs.mkdirSync(backupDir, { recursive: true });
for (const state of themeStates) {
  const themeDir = path.join(backupDir, String(state.theme.id));
  fs.mkdirSync(themeDir, { recursive: true });
  fs.writeFileSync(path.join(themeDir, 'theme.json'), `${JSON.stringify(state.theme, null, 2)}\n`, 'utf8');
  if (state.logoBytes) fs.writeFileSync(path.join(themeDir, 'mysnoozepod-logo-sharp.png'), state.logoBytes);
  for (const [key, asset] of state.textAssets) {
    if (asset?.value) fs.writeFileSync(path.join(themeDir, path.basename(key)), asset.value, 'utf8');
  }
}

for (const state of themeStates) {
  const themeId = state.theme.id;
  await writeBinary(themeId, LOGO_KEY, desiredLogo);
  for (const [key, value] of desiredText) await writeText(themeId, key, value);
}

for (const state of themeStates) {
  const themeId = state.theme.id;
  const logo = await readBinary(await readAsset(themeId, LOGO_KEY));
  if (!logo || sha256(logo) !== sha256(desiredLogo)) fail(`Logo readback mismatch on theme ${themeId}.`);
  for (const [key, value] of desiredText) {
    const actual = await readAsset(themeId, key);
    if (actual?.value !== value) fail(`${key} readback mismatch on theme ${themeId}.`);
  }
}

console.log(`Verified sharp logo and both logo-rendering sections on published theme ${PUBLISHED_THEME_ID} and unpublished theme ${UNPUBLISHED_THEME_ID}.`);
console.log(`Backup: ${backupDir}`);
}
