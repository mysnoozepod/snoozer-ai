import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const STORE = 'mysnoozepodtest.myshopify.com';
const API_VERSION = '2025-10';
const LIVE_THEME_ID = '139216420925';
const ROLLBACK_THEME_ID = '139460542525';
const EXPECTED_NAME = 'snoozer-ai/main';
const APPLY = process.argv.includes('--apply');
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\sleep-system-configurator-fix';
const READBACK_PATH = path.join(ROOT, 'docs', 'sleep-system-configurator', 'SHOPIFY_READBACK.json');
const ASSETS = [
  'assets/snoozepod-curated-bundles.js',
  'assets/snoozepod-curated-bundles.css',
  'snippets/snoozepod-showroom-location.liquid',
  'snippets/snoozepod-mattress-product-information.liquid',
];

function fail(message) { throw new Error(message); }
function digest(value) { return crypto.createHash('sha256').update(String(value || '').replace(/\r\n/g, '\n'), 'utf8').digest('hex'); }
function connection() {
  const raw = execFileSync('aws', ['lambda', 'get-function-configuration', '--function-name', 'snoozer-backend', '--region', 'us-east-1', '--query', 'Environment.Variables.{SHOPIFY_DOMAIN:SHOPIFY_DOMAIN,SHOPIFY_ADMIN_TOKEN:SHOPIFY_ADMIN_TOKEN,SHOPIFY_ADMIN_API_VERSION:SHOPIFY_ADMIN_API_VERSION}', '--output', 'json', '--no-cli-pager'], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', AWS_PAGER: '' } });
  const values = JSON.parse(raw);
  if (values.SHOPIFY_DOMAIN !== STORE || !values.SHOPIFY_ADMIN_TOKEN || (values.SHOPIFY_ADMIN_API_VERSION || API_VERSION) !== API_VERSION) fail('Existing Shopify connection does not match the authorized boundary.');
  return { token: values.SHOPIFY_ADMIN_TOKEN };
}

const shopify = connection();
const endpoint = `https://${STORE}/admin/api/${API_VERSION}`;
async function rest(pathname, options = {}) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${endpoint}${pathname}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': shopify.token, ...(options.headers || {}) } });
    if (response.status === 429 && attempt < 5) { await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1))); continue; }
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) fail(`Shopify REST failed: HTTP ${response.status}.`);
    return body;
  }
  fail('Shopify REST remained throttled.');
}
async function readAsset(themeId, key) {
  const body = await rest(`/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}`);
  return body.asset || null;
}
async function writeAsset(themeId, key, value) {
  await rest(`/themes/${themeId}/assets.json`, { method: 'PUT', body: JSON.stringify({ asset: { key, value } }) });
}
async function readUntilMatch(themeId, key, expected) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const asset = await readAsset(themeId, key);
    if (asset?.value && digest(asset.value) === digest(expected)) return asset;
    await new Promise((resolve) => setTimeout(resolve, 650 * (attempt + 1)));
  }
  return null;
}

for (const key of ASSETS) if (!fs.existsSync(path.join(ROOT, ...key.split('/')))) fail(`Missing local asset ${key}.`);
const themesBefore = (await rest('/themes.json?fields=id,name,role,updated_at')).themes || [];
const liveTheme = themesBefore.find((theme) => String(theme.id) === LIVE_THEME_ID);
const rollbackTheme = themesBefore.find((theme) => String(theme.id) === ROLLBACK_THEME_ID);
if (!liveTheme || liveTheme.name !== EXPECTED_NAME || liveTheme.role !== 'main') fail('Live theme identity changed.');
if (!rollbackTheme || rollbackTheme.name !== EXPECTED_NAME || rollbackTheme.role !== 'unpublished') fail('Rollback theme identity changed.');

const plan = [];
for (const key of ASSETS) {
  const current = await readAsset(LIVE_THEME_ID, key);
  const desired = fs.readFileSync(path.join(ROOT, ...key.split('/')), 'utf8');
  plan.push({ key, action: current?.value && digest(current.value) === digest(desired) ? 'unchanged' : current ? 'update' : 'create' });
}
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'plan', store: STORE, liveTheme: LIVE_THEME_ID, rollbackTheme: ROLLBACK_THEME_ID, assets: plan }, null, 2));
if (!APPLY) process.exit(0);

const backupDirectory = path.join(BACKUP_ROOT, new Date().toISOString().replace(/[:.]/g, '-'));
const rollbackBefore = new Map();
for (const themeId of [LIVE_THEME_ID, ROLLBACK_THEME_ID]) {
  for (const key of ASSETS) {
    const asset = await readAsset(themeId, key);
    if (themeId === ROLLBACK_THEME_ID) rollbackBefore.set(key, asset);
    if (!asset?.value) continue;
    const file = path.join(backupDirectory, themeId, ...key.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, asset.value, 'utf8');
  }
}
fs.writeFileSync(path.join(backupDirectory, 'themes-before.json'), `${JSON.stringify(themesBefore, null, 2)}\n`);
fs.writeFileSync(path.join(backupDirectory, 'RECOVERY.md'), `# Sleep System configurator recovery\n\nRestore the four captured assets from the ${LIVE_THEME_ID} folder to live theme ${LIVE_THEME_ID}. Theme ${ROLLBACK_THEME_ID} was read-only and must remain unchanged. No credentials are stored here.\n`);

for (const key of ASSETS) {
  const desired = fs.readFileSync(path.join(ROOT, ...key.split('/')), 'utf8');
  const current = await readAsset(LIVE_THEME_ID, key);
  if (!current?.value || digest(current.value) !== digest(desired)) await writeAsset(LIVE_THEME_ID, key, desired);
  if (!(await readUntilMatch(LIVE_THEME_ID, key, desired))) fail(`Live theme readback failed for ${key}.`);
  const rollbackAfter = await readAsset(ROLLBACK_THEME_ID, key);
  const rollbackPrior = rollbackBefore.get(key);
  if (Boolean(rollbackAfter?.value) !== Boolean(rollbackPrior?.value) || (rollbackAfter?.value && digest(rollbackAfter.value) !== digest(rollbackPrior.value))) fail(`Rollback theme changed for ${key}.`);
}

const themesAfter = (await rest('/themes.json?fields=id,name,role,updated_at')).themes || [];
if (themesAfter.find((theme) => String(theme.id) === LIVE_THEME_ID)?.role !== 'main' || themesAfter.find((theme) => String(theme.id) === ROLLBACK_THEME_ID)?.role !== 'unpublished') fail('Theme roles changed during asset staging.');
const readback = {
  schemaVersion: '1.0.0',
  verifiedAt: new Date().toISOString(),
  store: STORE,
  backupDirectory,
  liveTheme: { id: Number(LIVE_THEME_ID), role: 'main', name: EXPECTED_NAME },
  rollbackTheme: { id: Number(ROLLBACK_THEME_ID), role: 'unpublished', name: EXPECTED_NAME, unchanged: true },
  assets: ASSETS,
  catalogMutations: 0,
  previewUrl: 'https://mysnoozepod.com/pages/sleep-systems',
};
fs.mkdirSync(path.dirname(READBACK_PATH), { recursive: true });
fs.writeFileSync(READBACK_PATH, `${JSON.stringify(readback, null, 2)}\n`);
console.log(JSON.stringify({ result: 'Live Sleep System fix staged and verified.', backupDirectory, liveTheme: LIVE_THEME_ID, rollbackThemeUnchanged: true }, null, 2));
