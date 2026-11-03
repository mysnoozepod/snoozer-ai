import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  bedgearBrandDescriptionHtml,
  bedgearBrandParagraphs,
  bedgearDescriptionSource,
  bedgearProductHandles,
} from '../content/bedgear-brand-description.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const readbackPath = path.join(ROOT, 'docs', 'catalog', 'BEDGEAR_PRODUCT_DESCRIPTIONS_SHOPIFY_READBACK.json');

assert.equal(bedgearProductHandles.length, 20, 'the approved BEDGEAR catalog contains exactly 20 products');
assert.equal(new Set(bedgearProductHandles).size, 20, 'BEDGEAR handles are unique');
assert.equal(bedgearBrandParagraphs.length, 5, 'the January 2026 boilerplate preserves all five source paragraphs');
assert.match(bedgearBrandDescriptionHtml, /<h3>About BEDGEAR<\/h3>/, 'copy is labeled as brand information');
assert.match(bedgearBrandDescriptionHtml, /data-mysnoozepod-bedgear-boilerplate="2026-01"/, 'copy has an idempotent source marker');
assert.match(bedgearBrandDescriptionHtml, /One Size Does Not Fit All®/, 'registered brand language is preserved');
assert.match(bedgearBrandDescriptionHtml, /Wake Ready®/, 'official brand language is preserved');
assert.equal(bedgearDescriptionSource.sharedUrl, 'https://bedgear.pxm.pattern.com/share/RWlH0Qhcsk');

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
}

console.log('BEDGEAR product descriptions: PASS (20 exact product targets and official January 2026 brand boilerplate).');

