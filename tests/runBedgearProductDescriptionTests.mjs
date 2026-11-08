import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  bedgearBrandDescriptionHtml,
  bedgearBrandParagraphs,
  bedgearDescriptionSource,
  bedgearOfficialProductCopy,
  bedgearOfficialProductDescriptionHtml,
  bedgearProductHandles,
  mattressCustomerFacingHandles,
} from '../content/bedgear-brand-description.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const readbackPath = path.join(ROOT, 'docs', 'catalog', 'BEDGEAR_PRODUCT_DESCRIPTIONS_SHOPIFY_READBACK.json');

assert.equal(bedgearProductHandles.length, 20, 'the approved BEDGEAR catalog contains exactly 20 products');
assert.equal(new Set(bedgearProductHandles).size, 20, 'BEDGEAR handles are unique');
assert.equal(mattressCustomerFacingHandles.length, 4, 'four mattress handles use customer-facing product-led naming');
for (const handle of mattressCustomerFacingHandles) {
  const html = bedgearOfficialProductDescriptionHtml(handle);
  assert.doesNotMatch(html, /\b(?:BEDGEAR|S7|H6|M3|M5)\b/i, `${handle} customer-facing copy omits manufacturer and model names`);
}
assert.equal(bedgearBrandParagraphs.length, 5, 'the January 2026 boilerplate preserves all five source paragraphs');
assert.match(bedgearBrandDescriptionHtml, /<h3>About BEDGEAR<\/h3>/, 'copy is labeled as brand information');
assert.match(bedgearBrandDescriptionHtml, /data-mysnoozepod-bedgear-boilerplate="2026-01"/, 'copy has an idempotent source marker');
assert.match(bedgearBrandDescriptionHtml, /One Size Does Not Fit All®/, 'registered brand language is preserved');
assert.match(bedgearBrandDescriptionHtml, /Wake Ready®/, 'official brand language is preserved');
assert.equal(bedgearDescriptionSource.sharedUrl, 'https://bedgear.pxm.pattern.com/share/RWlH0Qhcsk');
assert.equal(Object.keys(bedgearOfficialProductCopy).length, 18, '18 exact current BEDGEAR product pages have model-level source matches');
assert.equal(new Set(Object.values(bedgearOfficialProductCopy).map((copy) => copy.sourceUrl)).size, 16, 'official source URLs are retained for auditability');
for (const [handle, copy] of Object.entries(bedgearOfficialProductCopy)) {
  assert(bedgearProductHandles.includes(handle), `${handle} must be an approved BEDGEAR product`);
  assert.match(copy.sourceUrl, /^https:\/\/bedgear\.com\/products\//, `${handle} must use an official BEDGEAR product source`);
  assert.match(bedgearOfficialProductDescriptionHtml(handle), /Product Overview/, `${handle} must render product-level copy`);
}

if (fs.existsSync(readbackPath)) {
  const readback = JSON.parse(fs.readFileSync(readbackPath, 'utf8'));
  assert.equal(readback.summary.catalogProducts, 43, 'the complete catalog remains present');
  assert.equal(readback.summary.bedgearProducts, 20, 'all and only BEDGEAR products are targeted');
  assert.equal(readback.summary.descriptionsVerified, 20, 'all BEDGEAR descriptions are verified');
  assert.equal(Object.values(readback.summary.productStatusCounts).reduce((sum, count) => sum + count, 0), 43, 'all product statuses are accounted for');
  assert.equal(readback.products.length, 20);
  assert(readback.products.every((product) => product.vendor === 'BEDGEAR'));
  assert(readback.products.every((product) => ['DRAFT', 'ACTIVE'].includes(product.status)));
  assert(readback.products.every((product) => product.containsOfficialBedgearBoilerplate));
  assert.equal(readback.products.filter((product) => product.containsOfficialProductCopy).length, 18, 'all exact official matches have product-specific copy');
}

console.log('BEDGEAR product descriptions: PASS (20 exact targets, 18 official product-page matches, and brand boilerplate).');

