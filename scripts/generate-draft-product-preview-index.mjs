import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const EXPECTED_STORE = 'mysnoozepodtest.myshopify.com';
const EXPECTED_API_VERSION = '2025-10';
const EXPECTED_THEME_ID = '139216420925';
const LAMBDA_FUNCTION = 'snoozer-backend';
const AWS_REGION = 'us-east-1';
const OUTPUT_ROOT = path.resolve(
  'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\draft-product-previews',
);
const OUTPUT = path.join(OUTPUT_ROOT, 'latest', 'index.html');

function fail(message) {
  throw new Error(message);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function readConnection() {
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
  const values = JSON.parse(raw);
  const shop = values.SHOPIFY_DOMAIN;
  const token = values.SHOPIFY_ADMIN_TOKEN;
  const apiVersion = values.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;
  if (shop !== EXPECTED_STORE) fail(`Refusing unexpected Shopify store: ${shop || 'missing'}.`);
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected Admin API version: ${apiVersion}.`);
  if (!token) fail('SHOPIFY_ADMIN_TOKEN is unavailable from the existing development configuration.');
  return { shop, token, apiVersion };
}

const connection = readConnection();
const endpoint = `https://${connection.shop}/admin/api/${connection.apiVersion}/graphql.json`;

async function graphql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': connection.token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.errors) {
    fail((payload?.errors || [{ message: `HTTP ${response.status}` }]).map((error) => error.message).join(' | '));
  }
  return payload.data;
}

const QUERY = `
  query DraftProductPreviewIndex {
    products(first: 250, sortKey: TITLE) {
      nodes {
        id
        title
        handle
        status
        productType
        templateSuffix
        onlineStorePreviewUrl
        onlineStoreUrl
      }
    }
  }
`;

const data = await graphql(QUERY);
const products = data.products.nodes;
if (products.length !== 43) fail(`Expected 43 products, found ${products.length}.`);

const nonDraft = products.filter((product) => product.status !== 'DRAFT');
if (nonDraft.length) fail(`Refusing to continue because ${nonDraft.length} product(s) are not Draft.`);

const wrongTemplate = products.filter((product) => product.templateSuffix !== 'snoozepod-v1');
if (wrongTemplate.length) {
  fail(`Expected every product to use snoozepod-v1; ${wrongTemplate.length} product(s) differ.`);
}

const previews = products.map((product) => {
  if (!product.onlineStorePreviewUrl) fail(`Shopify returned no preview URL for ${product.handle}.`);
  if (product.onlineStoreUrl) fail(`Expected no public Online Store URL for Draft product ${product.handle}.`);

  const source = new URL(product.onlineStorePreviewUrl);
  const previewKey = source.searchParams.get('preview_key');
  const bypassToken = source.searchParams.get('_bt');
  if (!previewKey || !bypassToken) fail(`Preview URL is missing required temporary parameters for ${product.handle}.`);

  const preview = new URL(`/products/${product.handle}`, `https://${connection.shop}`);
  preview.searchParams.set('preview_theme_id', EXPECTED_THEME_ID);
  preview.searchParams.set('preview_key', previewKey);
  preview.searchParams.set('_bt', bypassToken);

  return { ...product, previewUrl: preview.toString() };
});

const generatedAt = new Date();
const rows = previews
  .map(
    (product) => `
      <tr>
        <td><a href="${escapeHtml(product.previewUrl)}" target="_blank" rel="noreferrer">${escapeHtml(product.title)}</a></td>
        <td><code>${escapeHtml(product.handle)}</code></td>
        <td>${escapeHtml(product.productType || 'Unspecified')}</td>
        <td>${escapeHtml(product.status)}</td>
        <td><code>${escapeHtml(product.templateSuffix)}</code></td>
      </tr>`,
  )
  .join('');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>MySnoozePod Draft Product Previews</title>
    <style>
      :root { color-scheme: light; font-family: system-ui, sans-serif; }
      body { margin: 0 auto; max-width: 1200px; padding: 32px 20px 64px; color: #17213a; }
      h1 { margin-bottom: 8px; }
      .notice { background: #f1f5ff; border-left: 4px solid #4866c7; margin: 20px 0; padding: 14px 16px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border-bottom: 1px solid #dfe4ee; padding: 12px 10px; text-align: left; vertical-align: top; }
      th { background: #f7f8fb; position: sticky; top: 0; }
      a { color: #294fa3; font-weight: 650; }
      code { overflow-wrap: anywhere; }
      @media (max-width: 760px) {
        th:nth-child(3), td:nth-child(3), th:nth-child(5), td:nth-child(5) { display: none; }
      }
    </style>
  </head>
  <body>
    <h1>MySnoozePod actual Draft product pages</h1>
    <p>Generated ${escapeHtml(generatedAt.toLocaleString('en-US', { timeZone: 'America/New_York' }))} ET for unpublished theme <code>${EXPECTED_THEME_ID}</code>.</p>
    <div class="notice">
      These are real Shopify Draft-product previews, not fixtures. Shopify preview tokens are temporary. If a link expires, rerun <code>node scripts/generate-draft-product-preview-index.mjs</code>. Nothing here publishes a product or theme.
    </div>
    <table>
      <thead><tr><th>Product page</th><th>Handle</th><th>Product type</th><th>Status</th><th>Template</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>
`;

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, html, { encoding: 'utf8', mode: 0o600 });
console.log(`Generated ${previews.length} real Draft-product preview links.`);
console.log(`Private index: ${OUTPUT}`);
console.log('No product or theme publication occurred.');
