import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { contentPages } from '../content/shopify-content-pages.mjs';
import { footerMenuContract, guideHub, mainMenuContract } from '../content/content-navigation.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXPECTED_STORE = 'mysnoozepodtest.myshopify.com';
const EXPECTED_API_VERSION = '2025-10';
const LAMBDA_FUNCTION = 'snoozer-backend';
const AWS_REGION = 'us-east-1';
const APPLY = process.argv.includes('--apply');
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\content-navigation';
const READBACK_PATH = path.join(ROOT, 'docs', 'content-pages', 'CONTENT_NAVIGATION_SHOPIFY_READBACK.json');

function fail(message) { throw new Error(message); }
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
const endpoint = `https://${connection.shop}/admin/api/${connection.apiVersion}/graphql.json`;

async function graphql(query, variables = {}) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(endpoint, {
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
    if (!response.ok || !payload || errors.length) fail(`Shopify Admin GraphQL failed: ${(errors.length ? errors : [`HTTP ${response.status}`]).join(' | ')}`);
    return payload.data;
  }
  fail('Shopify Admin GraphQL remained throttled after bounded retries.');
}

const INSPECT = `query ContentNavigationInspection {
  pages(first: 250) { nodes { id title handle isPublished } }
  products(first: 250) { nodes { id title handle status } }
  collections(first: 250) { nodes { id title handle } }
  menus(first: 50) {
    nodes {
      id title handle
      items { id title type url resourceId items { id title type url resourceId items { id title type url resourceId } } }
    }
  }
}`;

const MENU_UPDATE = `mutation UpdateContentNavigation($id: ID!, $title: String!, $handle: String, $items: [MenuItemUpdateInput!]!) {
  menuUpdate(id: $id, title: $title, handle: $handle, items: $items) {
    menu { id handle title }
    userErrors { field message }
  }
}`;

function resolveItems(items, collections, products) {
  return items.map((item) => {
    const resolved = { title: item.title, type: item.type };
    if (item.collection) {
      const collection = collections.get(item.collection);
      if (!collection) fail(`Navigation item ${item.title} references missing collection ${item.collection}.`);
      resolved.resourceId = collection.id;
    } else if (item.product) {
      const product = products.get(item.product);
      if (!product) fail(`Navigation item ${item.title} references missing product ${item.product}.`);
      if (product.status !== 'ACTIVE') fail(`Navigation item ${item.title} references non-active product ${item.product}.`);
      resolved.resourceId = product.id;
    } else if (item.url) {
      resolved.url = item.url;
    } else {
      fail(`Navigation item ${item.title} has no destination.`);
    }
    if (item.items?.length) resolved.items = resolveItems(item.items, collections, products);
    return resolved;
  });
}

function normalizedItem(item) {
  return {
    title: item.title,
    type: item.type,
    destination: ['COLLECTION', 'PRODUCT'].includes(item.type) ? item.resourceId : item.url,
    items: (item.items || []).map(normalizedItem),
  };
}

function normalizedMenu(menu) {
  return {
    title: menu.title,
    handle: menu.handle,
    items: (menu.items || []).map(normalizedItem),
  };
}

function desiredMenuShape(contract, resolvedItems) {
  return normalizedMenu({ title: contract.title, handle: contract.handle, items: resolvedItems });
}

function countItems(items) {
  return items.reduce((sum, item) => sum + 1 + countItems(item.items || []), 0);
}

function expectedPageHandles() {
  const handles = new Set([guideHub.handle, ...contentPages.map((page) => page.handle)]);
  const inspect = (items) => {
    for (const item of items) {
      const match = item.url?.match(/\/pages\/([^#?]+)/);
      if (match) handles.add(match[1]);
      inspect(item.items || []);
    }
  };
  inspect(mainMenuContract.items);
  inspect(footerMenuContract.items);
  return handles;
}

const before = await graphql(INSPECT);
const pages = new Map(before.pages.nodes.map((page) => [page.handle, page]));
const products = new Map(before.products.nodes.map((product) => [product.handle, product]));
const collections = new Map(before.collections.nodes.map((collection) => [collection.handle, collection]));
const menus = new Map(before.menus.nodes.map((menu) => [menu.handle, menu]));

for (const handle of expectedPageHandles()) {
  const page = pages.get(handle);
  if (!page || !page.isPublished) fail(`Required navigation page ${handle} is missing or unpublished.`);
}

const contracts = [mainMenuContract, footerMenuContract];
const plan = contracts.map((contract) => {
  const current = menus.get(contract.handle);
  if (!current) fail(`Required Shopify menu ${contract.handle} was not found.`);
  const resolvedItems = resolveItems(contract.items, collections, products);
  const desiredShape = desiredMenuShape(contract, resolvedItems);
  const currentShape = normalizedMenu(current);
  return {
    contract,
    current,
    resolvedItems,
    desiredShape,
    action: JSON.stringify(currentShape) === JSON.stringify(desiredShape) ? 'unchanged' : 'update',
  };
});

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'plan',
  store: connection.shop,
  guidePages: contentPages.length,
  hubPage: guideHub.handle,
  menus: plan.map((entry) => ({ handle: entry.contract.handle, id: entry.current.id, action: entry.action, totalItems: countItems(entry.contract.items) })),
}, null, 2));

if (!APPLY) {
  console.log('Plan only: no navigation was changed. Re-run with --apply after reviewing the exact menu targets.');
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(BACKUP_ROOT, stamp);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, 'menus-before.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), store: connection.shop, menus: before.menus.nodes }, null, 2)}\n`, 'utf8');

  for (const entry of plan) {
    if (entry.action === 'unchanged') continue;
    const data = await graphql(MENU_UPDATE, {
      id: entry.current.id,
      title: entry.contract.title,
      handle: entry.contract.handle,
      items: entry.resolvedItems,
    });
    requireNoUserErrors(data.menuUpdate.userErrors, `Could not update ${entry.contract.handle}`);
  }

  const after = await graphql(INSPECT);
  const afterMenus = new Map(after.menus.nodes.map((menu) => [menu.handle, menu]));
  const readbackMenus = [];
  for (const entry of plan) {
    const actual = afterMenus.get(entry.contract.handle);
    if (!actual || JSON.stringify(normalizedMenu(actual)) !== JSON.stringify(entry.desiredShape)) fail(`${entry.contract.handle} readback does not match the navigation contract.`);
    readbackMenus.push(actual);
  }

  const readback = {
    generatedAt: new Date().toISOString(),
    store: connection.shop,
    backupDir,
    summary: {
      publishedGuidePages: contentPages.length,
      publishedHubPages: 1,
      verifiedMenus: readbackMenus.length,
      mainMenuItems: countItems(mainMenuContract.items),
      footerMenuItems: countItems(footerMenuContract.items),
    },
    menus: readbackMenus,
  };
  fs.mkdirSync(path.dirname(READBACK_PATH), { recursive: true });
  fs.writeFileSync(READBACK_PATH, `${JSON.stringify(readback, null, 2)}\n`, 'utf8');

  console.log(`Verified ${contentPages.length} guide pages, the Sleep Guides hub, and both Shopify menus.`);
  console.log(`Backup: ${backupDir}`);
  console.log(`Readback: ${path.relative(ROOT, READBACK_PATH)}`);
}
