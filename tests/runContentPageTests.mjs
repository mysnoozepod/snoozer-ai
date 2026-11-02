import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { contentPages } from '../content/shopify-content-pages.mjs';
import { contentPageImageGroups, contentPageImages } from '../content/content-page-images.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const READBACK = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'content-pages', 'CONTENT_PAGES_SHOPIFY_READBACK.json'), 'utf8'));
const MAIN_PAGE = fs.readFileSync(path.join(ROOT, 'sections', 'main-page.liquid'), 'utf8');

assert.equal(contentPages.length, 50, 'exactly 50 content pages are defined');
assert.equal(new Set(contentPages.map((item) => item.handle)).size, 50, 'all handles are unique');
assert.deepEqual(READBACK.summary, { expected: 50, verified: 50, published: 50 }, 'Shopify readback verifies all 50 published pages');
assert.equal(contentPageImageGroups.length, 10, 'the editorial image library has ten topic-specific image groups');
assert.equal(contentPageImages.size, 50, 'all 50 content pages have an editorial image assignment');

const handles = new Set(contentPages.map((item) => item.handle));
const readbackByHandle = new Map(READBACK.pages.map((item) => [item.handle, item]));
for (const item of contentPages) {
  assert(!/BEDGEAR|0\.0|1\.0|2\.0|3\.0/i.test(JSON.stringify(item)), `${item.handle} is manufacturer-neutral and has no numeric comfort scale`);
  assert(item.sections.length >= 4, `${item.handle} has at least four educational sections`);
  assert(item.considerations.length >= 4, `${item.handle} has a practical consideration checklist`);
  assert(item.faqs.length >= 3, `${item.handle} has at least three FAQs`);
  assert(item.related.length >= 3, `${item.handle} has at least three internal links`);
  for (const related of item.related) assert(handles.has(related), `${item.handle} related link ${related} resolves in the manifest`);
  const readback = readbackByHandle.get(item.handle);
  assert(readback, `${item.handle} exists in Shopify readback`);
  assert.equal(readback.isPublished, true, `${item.handle} is published`);
  assert.equal(readback.templateSuffix, null, `${item.handle} uses the live default page template`);
  assert.equal(readback.url, `https://mysnoozepod.com/pages/${item.handle}`, `${item.handle} has the canonical URL`);
  const image = contentPageImages.get(item.handle);
  assert(image, `${item.handle} has an editorial image mapping`);
  assert(MAIN_PAGE.includes(`'${item.handle}'`), `${item.handle} is mapped in main-page.liquid`);
  assert(MAIN_PAGE.includes(`'${image.asset}'`), `${item.handle} uses the expected theme image asset`);
}

for (const group of contentPageImageGroups) {
  const imagePath = path.join(ROOT, 'assets', group.asset);
  assert(fs.existsSync(imagePath), `${group.asset} exists locally`);
  const bytes = fs.readFileSync(imagePath);
  assert(bytes.length > 100_000, `${group.asset} is a substantive editorial image`);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${group.asset} is a valid PNG asset`);
  assert(group.alt.length >= 30, `${group.asset} has meaningful alternative text`);
}

const imageReadbackPath = path.join(ROOT, 'docs', 'content-pages', 'CONTENT_PAGE_IMAGES_SHOPIFY_READBACK.json');
if (fs.existsSync(imageReadbackPath)) {
  const imageReadback = JSON.parse(fs.readFileSync(imageReadbackPath, 'utf8'));
  assert.deepEqual(imageReadback.summary, { themes: 2, imagesPerTheme: 10, mappedPages: 50 }, 'Shopify image readback verifies both target themes');
}

async function verifyLivePage(item) {
  let response;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    response = await fetch(`https://mysnoozepod.com/pages/${item.handle}`, { redirect: 'manual' });
    if (response.status !== 429) break;
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  if (response.status === 200) {
    const html = await response.text();
    assert(html.includes(item.title.replaceAll('&', '&amp;')) || html.includes(item.title), `${item.handle} renders its title`);
    assert(html.includes('mysnoozepod-logo-sharp.png'), `${item.handle} renders the sharp logo asset`);
    assert(html.includes(contentPageImages.get(item.handle).asset), `${item.handle} renders its assigned editorial image`);
    assert(!/BEDGEAR|0\.0|1\.0|2\.0|3\.0/i.test(html), `${item.handle} live HTML remains manufacturer-neutral and has no numeric comfort scale`);
  } else {
    assert([301, 302, 303, 307, 308].includes(response.status), `${item.handle} is reachable through the protected storefront`);
    assert.equal(new URL(response.headers.get('location'), 'https://mysnoozepod.com').pathname, '/password', `${item.handle} respects the existing storefront password gate`);
  }
}

for (const item of contentPages) await verifyLivePage(item);

console.log('Content pages: PASS (50 published Shopify pages, 50 image mappings, 10 editorial assets, protected storefront routes, internal links, neutral comfort language, and sharp-logo contract).');
