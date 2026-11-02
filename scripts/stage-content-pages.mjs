import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { contentPages } from '../content/shopify-content-pages.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXPECTED_STORE = 'mysnoozepodtest.myshopify.com';
const EXPECTED_API_VERSION = '2025-10';
const LAMBDA_FUNCTION = 'snoozer-backend';
const AWS_REGION = 'us-east-1';
const APPLY = process.argv.includes('--apply');
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\content-pages';
const READBACK_PATH = path.join(ROOT, 'docs', 'content-pages', 'CONTENT_PAGES_SHOPIFY_READBACK.json');
const SIGNATURE_PREFIX = '<!-- mysnoozepod-content-v1';

function fail(message) { throw new Error(message); }
function sha256(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
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
    if ((response.status === 429 || (errors.length > 0 && errors.every((message) => /throttled/i.test(message)))) && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      continue;
    }
    if (!response.ok || !payload || errors.length) {
      fail(`Shopify Admin GraphQL failed: ${(errors.length ? errors : [`HTTP ${response.status}`]).join(' | ')}`);
    }
    return payload.data;
  }
  fail('Shopify Admin GraphQL remained throttled after bounded retries.');
}

const PAGE_QUERY = `query ContentPageInventory {
  pages(first: 250, sortKey: TITLE) {
    nodes { id title handle body isPublished templateSuffix createdAt updatedAt }
  }
}`;
const PAGE_CREATE = `mutation CreateContentPage($page: PageCreateInput!) {
  pageCreate(page: $page) { page { id title handle isPublished body templateSuffix } userErrors { field message code } }
}`;
const PAGE_UPDATE = `mutation UpdateContentPage($id: ID!, $page: PageUpdateInput!) {
  pageUpdate(id: $id, page: $page) { page { id title handle isPublished body templateSuffix } userErrors { field message code } }
}`;

function requireNoUserErrors(errors, label) {
  if (errors?.length) fail(`${label}: ${errors.map((error) => `${error.field || 'input'}: ${error.message}`).join(' | ')}`);
}

const titleByHandle = new Map(contentPages.map((item) => [item.handle, item.title]));

function helpCopy(category) {
  if (category === 'The SnoozePod Experience') return 'A Snooze Session turns these ideas into a focused showroom plan. You can compare the relevant choices, ask questions, and leave with a clear next step without being pushed into a premature purchase.';
  if (category === 'Dual Comfort and Couples') return 'A private Snooze Session gives both sleepers time to test independently and then review the shared configuration together. MySnoozePod keeps unsupported combinations unavailable until the exact order can be verified.';
  if (category === 'Adjustable Bases and Compatibility') return 'MySnoozePod can help you compare useful base functions and verify the mattress, size, geometry, furniture, and room requirements before an order is placed.';
  if (category === 'Pillows, Protection, and Bedding') return 'During a Snooze Session, these layers can be considered with the mattress instead of as disconnected add-ons. The goal is a coordinated system in which every selected item has a reason.';
  return 'A Snooze Session lets you compare these ideas on real sleep surfaces. MySnoozePod focuses on what you feel, what is verified, and what the next decision should be.';
}

function comparisonCopy(category) {
  if (category === 'The SnoozePod Experience') return 'Use the visit or planning process to answer one question at a time. Write down what you already know, what you noticed during testing, and what still needs verification. A clear next step is more valuable than collecting a long list of products.';
  if (category === 'Dual Comfort and Couples') return 'Have each sleeper describe comfort, pressure, movement, and temperature separately before discussing the shared setup. Then compare the two results alongside the exact mattress size, side orientation, base geometry, and bedding requirements.';
  if (category === 'Adjustable Bases and Compatibility') return 'Compare the flat position first, then test the movements and controls you expect to use. Notice clearance, noise, ease of control, partner movement, and whether the mattress follows the base without resistance or bunching.';
  if (category === 'Pillows, Protection, and Bedding') return 'Evaluate the item as part of the bed rather than in isolation. Notice fit, stretch, temperature, movement, care requirements, and whether it supports or changes the comfort you selected underneath it.';
  return 'Use the same sleep positions and the same questions on each candidate. Notice pressure, stability, movement, temperature, and ease of repositioning, then describe the difference in your own words before looking at marketing labels.';
}

function decisionCopy(item) {
  return 'This guide is a starting point, not a substitute for physical testing or verified product information. Separate personal preference from compatibility facts, and keep any unknown price, configuration, warranty, or fulfillment detail unresolved until it is confirmed.';
}

function useGuideCopy(item) {
  return 'Read the sections that match your immediate question, then turn them into two or three things to observe during a Snooze Session. You do not need to memorize terminology. Use the guide to make a more informed comparison and recognize which questions deserve a verified answer before purchase.';
}

function renderBody(item) {
  const sections = item.sections.map(([heading, copy]) => `<h2>${escapeHtml(heading)}</h2>\n<p>${escapeHtml(copy)}</p>`).join('\n');
  const considerations = item.considerations.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('');
  const faqs = item.faqs.map(([question, answer]) => `<h3>${escapeHtml(question)}</h3>\n<p>${escapeHtml(answer)}</p>`).join('\n');
  const related = item.related.map((handle) => {
    const title = titleByHandle.get(handle);
    if (!title) fail(`${item.handle} references unknown related page ${handle}.`);
    return `<li><a href="/pages/${escapeHtml(handle)}">${escapeHtml(title)}</a></li>`;
  }).join('');
  const content = `<p><strong>${escapeHtml(item.category)}</strong></p>
<p class="lead">${escapeHtml(item.lead)}</p>
<h2>How to use this guide</h2>
<p>${escapeHtml(useGuideCopy(item))}</p>
${sections}
<h2>A practical way to compare</h2>
<p>${escapeHtml(comparisonCopy(item.category))}</p>
<h2>What to consider</h2>
<ul>${considerations}</ul>
<h2>Keep the decision clear</h2>
<p>${escapeHtml(decisionCopy(item))}</p>
<h2>How MySnoozePod helps</h2>
<p>${escapeHtml(helpCopy(item.category))}</p>
<p><a href="/pages/book-a-snooze-session"><strong>Book a Snooze Session</strong></a> &nbsp; | &nbsp; <a href="#" data-snoozer-trigger data-snoozer-context="${escapeHtml(item.title)}">Ask Snoozer</a></p>
<h2>Frequently asked questions</h2>
${faqs}
<h2>Related guides</h2>
<ul>${related}</ul>`;
  return `${SIGNATURE_PREFIX} sha256=${sha256(content)} -->\n${content}`;
}

const desired = contentPages.map((item) => ({ ...item, body: renderBody(item) }));
const handles = desired.map((item) => item.handle);
if (new Set(handles).size !== handles.length) fail('Content page handles must be unique.');
for (const item of desired) {
  const textWords = item.body.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  if (textWords < 350) fail(`${item.handle} is too short at ${textWords} words.`);
  if (/BEDGEAR|0\.0|1\.0|2\.0|3\.0/i.test(item.body)) fail(`${item.handle} contains prohibited manufacturer or numeric comfort language.`);
}

const beforeData = await graphql(PAGE_QUERY);
const beforePages = beforeData.pages.nodes;
const beforeByHandle = new Map(beforePages.map((item) => [item.handle, item]));
const conflicts = desired.filter((item) => {
  const existing = beforeByHandle.get(item.handle);
  return existing && !existing.body.includes(SIGNATURE_PREFIX);
});
if (conflicts.length) fail(`Refusing to overwrite non-managed existing pages: ${conflicts.map((item) => item.handle).join(', ')}.`);

const plan = desired.map((item) => {
  const existing = beforeByHandle.get(item.handle);
  if (!existing) return { handle: item.handle, title: item.title, action: 'create' };
  const marker = item.body.slice(0, item.body.indexOf('-->') + 3);
  const matches = existing.title === item.title && existing.body.includes(marker) && existing.isPublished && !existing.templateSuffix;
  return { handle: item.handle, title: item.title, action: matches ? 'unchanged' : 'update', id: existing.id };
});

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'plan',
  store: connection.shop,
  expectedPages: desired.length,
  existingStorePages: beforePages.length,
  createCount: plan.filter((item) => item.action === 'create').length,
  updateCount: plan.filter((item) => item.action === 'update').length,
  unchangedCount: plan.filter((item) => item.action === 'unchanged').length,
  plan,
}, null, 2));

if (!APPLY) {
  console.log('Plan only: no Shopify pages were changed. Re-run with --apply after reviewing the plan.');
} else {
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(BACKUP_ROOT, stamp);
fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(path.join(backupDir, 'pages-before.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), shop: connection.shop, pages: beforePages }, null, 2)}\n`, 'utf8');

for (const item of desired) {
  const planned = plan.find((entry) => entry.handle === item.handle);
  if (planned.action === 'unchanged') continue;
  const input = { title: item.title, handle: item.handle, body: item.body, isPublished: true, templateSuffix: null };
  if (planned.action === 'create') {
    const data = await graphql(PAGE_CREATE, { page: input });
    requireNoUserErrors(data.pageCreate.userErrors, `Could not create ${item.handle}`);
  } else {
    const data = await graphql(PAGE_UPDATE, { id: planned.id, page: input });
    requireNoUserErrors(data.pageUpdate.userErrors, `Could not update ${item.handle}`);
  }
}

const afterData = await graphql(PAGE_QUERY);
const afterByHandle = new Map(afterData.pages.nodes.map((item) => [item.handle, item]));
const readbackPages = desired.map((expected) => {
  const actual = afterByHandle.get(expected.handle);
  if (!actual) fail(`Readback is missing ${expected.handle}.`);
  const marker = expected.body.slice(0, expected.body.indexOf('-->') + 3);
  if (actual.title !== expected.title || !actual.body.includes(marker) || !actual.isPublished || actual.templateSuffix) {
    fail(`Readback mismatch for ${expected.handle}.`);
  }
  return {
    id: actual.id,
    title: actual.title,
    handle: actual.handle,
    isPublished: actual.isPublished,
    templateSuffix: actual.templateSuffix,
    bodySha256: sha256(actual.body),
    url: `https://mysnoozepod.com/pages/${actual.handle}`,
  };
});

const readback = {
  generatedAt: new Date().toISOString(),
  shop: connection.shop,
  backupDir,
  summary: { expected: desired.length, verified: readbackPages.length, published: readbackPages.filter((item) => item.isPublished).length },
  pages: readbackPages,
};
fs.mkdirSync(path.dirname(READBACK_PATH), { recursive: true });
fs.writeFileSync(READBACK_PATH, `${JSON.stringify(readback, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(readback.summary, null, 2));
console.log(`Backup: ${backupDir}`);
console.log(`Readback: ${path.relative(ROOT, READBACK_PATH)}`);
}
