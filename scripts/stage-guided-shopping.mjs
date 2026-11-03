import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { guidedShoppingPages } from '../content/guided-shopping.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXPECTED_STORE = 'mysnoozepodtest.myshopify.com';
const EXPECTED_API_VERSION = '2025-10';
const LAMBDA_FUNCTION = 'snoozer-backend';
const AWS_REGION = 'us-east-1';
const APPLY = process.argv.includes('--apply');
const PUBLISHED_THEME_ID = '139460542525';
const UNPUBLISHED_THEME_ID = '139216420925';
const EXPECTED_THEME_NAME = 'snoozer-ai/main';
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\guided-shopping';
const READBACK_PATH = path.join(ROOT, 'docs', 'guided-shopping', 'GUIDED_SHOPPING_SHOPIFY_READBACK.json');
const SIGNATURE = '<!-- mysnoozepod-guided-shopping-v1 -->';

const themeAssetPaths = [
  'assets/snoozepod-guided-tools.css',
  'assets/snoozepod-guided-tools.js',
  'sections/snoozepod-guided-tools.liquid',
  'sections/snoozepod-guided-shopping-links.liquid',
  'sections/snoozepod-collection-navigation-v1.liquid',
  'snippets/snoozepod-product-navigation-card.liquid',
  'snippets/snoozepod-tool-fields-builder.liquid',
  'snippets/snoozepod-tool-fields-mattress.liquid',
  'snippets/snoozepod-tool-fields-compatibility.liquid',
  'snippets/snoozepod-tool-fields-compare.liquid',
  'snippets/snoozepod-tool-fields-session.liquid',
  'snippets/snoozepod-tool-fields-dual-comfort.liquid',
  'snippets/snoozepod-tool-fields-pillow.liquid',
  'snippets/snoozepod-tool-fields-bedding.liquid',
  'snippets/snoozepod-tool-fields-room.liquid',
  'templates/page.sleep-tools.json',
  'templates/page.build-your-snoozepod.json',
  'templates/page.mattress-finder.json',
  'templates/page.compatibility-checker.json',
  'templates/page.compare-sleep-systems.json',
  'templates/page.snooze-session-planner.json',
  'templates/page.dual-comfort-planner.json',
  'templates/page.pillow-finder.json',
  'templates/page.cooling-bedding-finder.json',
  'templates/page.room-delivery-planner.json',
  'templates/index.json',
  'templates/collection.snoozepod-v1.json',
];

function fail(message) { throw new Error(message); }
function sha256(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function normalizedAssetValue(key, value) {
  if (!key.endsWith('.json')) return value;
  const withoutHeader = String(value || '').replace(/^\/\*[\s\S]*?\*\//, '').trim();
  return JSON.stringify(JSON.parse(withoutHeader));
}
function assetsMatch(key, current, desired) {
  if (typeof current !== 'string') return false;
  try {
    return normalizedAssetValue(key, current) === normalizedAssetValue(key, desired);
  } catch (_error) {
    return false;
  }
}
function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
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
  const variables = JSON.parse(raw);
  const shop = variables.SHOPIFY_DOMAIN;
  const token = variables.SHOPIFY_ADMIN_TOKEN;
  const apiVersion = variables.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;
  if (shop !== EXPECTED_STORE) fail(`Refusing unexpected Shopify store ${shop || 'missing'}.`);
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected Admin API version ${apiVersion}.`);
  if (!token) fail('SHOPIFY_ADMIN_TOKEN is unavailable from the existing development configuration.');
  return { shop, token, apiVersion };
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
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      continue;
    }
    if (!response.ok || !payload || errors.length) fail(`Shopify GraphQL failed: ${(errors.length ? errors : [`HTTP ${response.status}`]).join(' | ')}`);
    return payload.data;
  }
  fail('Shopify GraphQL remained throttled after bounded retries.');
}

async function shopify(pathname, options = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${restEndpoint}${pathname}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': connection.token, ...(options.headers || {}) },
    });
    if (response.status === 429 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
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
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${restEndpoint}/themes/${themeId}/assets.json?${params}`, {
      headers: { 'X-Shopify-Access-Token': connection.token },
    });
    if (response.status === 404) return null;
    if (response.status === 429 && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
      continue;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.asset) fail(`Could not read ${key} from theme ${themeId}: HTTP ${response.status}.`);
    return payload.asset;
  }
  fail(`Could not read ${key} from theme ${themeId} after bounded throttling retries.`);
}

async function writeTextAsset(themeId, key, value) {
  await shopify(`/themes/${themeId}/assets.json`, { method: 'PUT', body: JSON.stringify({ asset: { key, value } }) });
}

const PAGE_QUERY = `query GuidedShoppingPages { pages(first: 250) { nodes { id title handle body isPublished templateSuffix createdAt updatedAt } } }`;
const PAGE_CREATE = `mutation CreateGuidedPage($page: PageCreateInput!) { pageCreate(page: $page) { page { id title handle isPublished templateSuffix body } userErrors { field message code } } }`;
const PAGE_UPDATE = `mutation UpdateGuidedPage($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id title handle isPublished templateSuffix body } userErrors { field message code } } }`;

const desiredPages = guidedShoppingPages.map((page) => ({
  ...page,
  body: `${SIGNATURE}\n<p>${escapeHtml(page.summary)}</p>`,
}));

if (new Set(desiredPages.map((page) => page.handle)).size !== desiredPages.length) fail('Guided shopping page handles must be unique.');
for (const assetPath of themeAssetPaths) {
  if (!fs.existsSync(path.join(ROOT, ...assetPath.split('/')))) fail(`Missing guided-shopping theme asset ${assetPath}.`);
}

const themesPayload = await shopify('/themes.json?fields=id,name,role,updated_at');
const themes = themesPayload.themes || [];
const published = themes.find((theme) => String(theme.id) === PUBLISHED_THEME_ID);
const unpublished = themes.find((theme) => String(theme.id) === UNPUBLISHED_THEME_ID);
if (!published || published.role !== 'main' || published.name !== EXPECTED_THEME_NAME) fail('Published theme identity or role mismatch.');
if (!unpublished || unpublished.role !== 'unpublished' || unpublished.name !== EXPECTED_THEME_NAME) fail('Unpublished theme identity or role mismatch.');

const pageData = await graphql(PAGE_QUERY);
const beforePages = pageData.pages.nodes;
const beforeByHandle = new Map(beforePages.map((page) => [page.handle, page]));
const conflicts = desiredPages.filter((page) => beforeByHandle.has(page.handle) && !beforeByHandle.get(page.handle).body.includes(SIGNATURE));
if (conflicts.length) fail(`Refusing to overwrite non-managed pages: ${conflicts.map((page) => page.handle).join(', ')}.`);

const pagePlan = desiredPages.map((page) => {
  const current = beforeByHandle.get(page.handle);
  if (!current) return { handle: page.handle, title: page.title, action: 'create' };
  const matches = current.title === page.title && current.body === page.body && current.isPublished && current.templateSuffix === page.templateSuffix;
  return { handle: page.handle, title: page.title, id: current.id, action: matches ? 'unchanged' : 'update' };
});

const desiredAssets = new Map(themeAssetPaths.map((assetPath) => [assetPath, fs.readFileSync(path.join(ROOT, ...assetPath.split('/')), 'utf8')]));
const themeStates = [];
for (const theme of [published, unpublished]) {
  const assets = new Map();
  for (const key of desiredAssets.keys()) assets.set(key, await readAsset(theme.id, key));
  themeStates.push({ theme, assets });
}

const assetPlan = themeStates.flatMap((state) => Array.from(desiredAssets, ([key, value]) => {
  const current = state.assets.get(key);
  return { themeId: String(state.theme.id), role: state.theme.role, key, action: assetsMatch(key, current?.value, value) ? 'unchanged' : current ? 'update' : 'create' };
}));

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'plan',
  store: connection.shop,
  pages: {
    expected: desiredPages.length,
    create: pagePlan.filter((entry) => entry.action === 'create').length,
    update: pagePlan.filter((entry) => entry.action === 'update').length,
    unchanged: pagePlan.filter((entry) => entry.action === 'unchanged').length,
  },
  themes: [published, unpublished].map((theme) => ({ id: String(theme.id), name: theme.name, role: theme.role })),
  assets: {
    expectedPerTheme: desiredAssets.size,
    create: assetPlan.filter((entry) => entry.action === 'create').length,
    update: assetPlan.filter((entry) => entry.action === 'update').length,
    unchanged: assetPlan.filter((entry) => entry.action === 'unchanged').length,
  },
  pagePlan,
  assetPlan,
}, null, 2));

if (!APPLY) {
  console.log('Plan only: no pages or theme assets were changed. Re-run with --apply after reviewing the exact targets.');
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(BACKUP_ROOT, stamp);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, 'pages-before.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), pages: beforePages }, null, 2)}\n`, 'utf8');
  for (const state of themeStates) {
    const themeDir = path.join(backupDir, String(state.theme.id));
    fs.mkdirSync(themeDir, { recursive: true });
    fs.writeFileSync(path.join(themeDir, 'theme.json'), `${JSON.stringify(state.theme, null, 2)}\n`, 'utf8');
    for (const [key, asset] of state.assets) {
      if (!asset?.value) continue;
      const backupPath = path.join(themeDir, ...key.split('/'));
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.writeFileSync(backupPath, asset.value, 'utf8');
    }
  }

  for (const state of themeStates) {
    for (const [key, desired] of desiredAssets) {
      if (!assetsMatch(key, state.assets.get(key)?.value, desired)) await writeTextAsset(state.theme.id, key, desired);
    }
  }

  for (const page of desiredPages) {
    const planned = pagePlan.find((entry) => entry.handle === page.handle);
    if (planned.action === 'unchanged') continue;
    const input = { title: page.title, handle: page.handle, body: page.body, isPublished: true, templateSuffix: page.templateSuffix };
    if (planned.action === 'create') {
      const data = await graphql(PAGE_CREATE, { page: input });
      requireNoUserErrors(data.pageCreate.userErrors, `Could not create ${page.handle}`);
    } else {
      const data = await graphql(PAGE_UPDATE, { id: planned.id, page: input });
      requireNoUserErrors(data.pageUpdate.userErrors, `Could not update ${page.handle}`);
    }
  }

  const afterPagesData = await graphql(PAGE_QUERY);
  const afterByHandle = new Map(afterPagesData.pages.nodes.map((page) => [page.handle, page]));
  const verifiedPages = desiredPages.map((expected) => {
    const actual = afterByHandle.get(expected.handle);
    if (!actual || actual.title !== expected.title || actual.body !== expected.body || !actual.isPublished || actual.templateSuffix !== expected.templateSuffix) fail(`Page readback mismatch for ${expected.handle}.`);
    return { id: actual.id, title: actual.title, handle: actual.handle, isPublished: actual.isPublished, templateSuffix: actual.templateSuffix, bodySha256: sha256(actual.body), url: `https://mysnoozepod.com/pages/${actual.handle}` };
  });

  const verifiedThemes = [];
  for (const state of themeStates) {
    const verifiedAssets = [];
    for (const [key, desired] of desiredAssets) {
      const actual = await readAsset(state.theme.id, key);
      if (!assetsMatch(key, actual?.value, desired)) fail(`${key} readback mismatch on theme ${state.theme.id}.`);
      verifiedAssets.push({ key, sha256: sha256(actual.value) });
    }
    verifiedThemes.push({ id: String(state.theme.id), name: state.theme.name, role: state.theme.role, assets: verifiedAssets });
  }

  const readback = {
    generatedAt: new Date().toISOString(),
    store: connection.shop,
    backupDir,
    summary: { publishedToolPages: verifiedPages.length, verifiedThemes: verifiedThemes.length, assetsPerTheme: desiredAssets.size },
    pages: verifiedPages,
    themes: verifiedThemes,
  };
  fs.mkdirSync(path.dirname(READBACK_PATH), { recursive: true });
  fs.writeFileSync(READBACK_PATH, `${JSON.stringify(readback, null, 2)}\n`, 'utf8');
  console.log(`Verified ${verifiedPages.length} guided-shopping pages and ${desiredAssets.size} assets on both target themes.`);
  console.log(`Backup: ${backupDir}`);
  console.log(`Readback: ${path.relative(ROOT, READBACK_PATH)}`);
}

