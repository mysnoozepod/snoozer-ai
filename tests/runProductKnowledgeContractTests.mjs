import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CONTENT_STATUSES,
  PRODUCT_KNOWLEDGE_SCHEMA_VERSION,
  PRODUCT_METAFIELD_DEFINITIONS,
  VARIANT_METAFIELD_DEFINITIONS,
  contractForProduct,
} from '../content/product-knowledge-contract.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const inventory = readJson('docs/product-knowledge/PRODUCT_KNOWLEDGE_INVENTORY.json');
const readback = readJson('docs/product-knowledge/PRODUCT_KNOWLEDGE_SHOPIFY_READBACK.json');
const fixture = readJson('tests/fixtures/product-knowledge-categories.v1.json');
const feed = readJson('docs/product-knowledge/PRODUCT_KNOWLEDGE_FEED.v1.json');
const schema = readJson('schemas/product-knowledge.v1.schema.json');
const section = fs.readFileSync(path.join(ROOT, 'sections', 'snoozepod-product-information-v1.liquid'), 'utf8');
const snippet = fs.readFileSync(path.join(ROOT, 'snippets', 'snoozepod-product-knowledge.liquid'), 'utf8');

let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions += 1; };

check(PRODUCT_KNOWLEDGE_SCHEMA_VERSION === '1.0.0', 'schema version is frozen');
check(inventory.summary.productCount === 43 && inventory.summary.variantCount === 274, 'audit covers the complete catalog');
check(inventory.summary.metafieldValueCount >= 1280, 'all pre-existing metafield values remain preserved in the current inventory');
check(inventory.summary.productDefinitionCount >= 82 && inventory.summary.variantDefinitionCount === 4, 'current Shopify definition inventory includes the complete contract');
check(PRODUCT_METAFIELD_DEFINITIONS.length === 80 && VARIANT_METAFIELD_DEFINITIONS.length === 4, 'definition contract is exact');
check(new Set([...PRODUCT_METAFIELD_DEFINITIONS, ...VARIANT_METAFIELD_DEFINITIONS].map((entry) => `${entry.ownerType}:${entry.namespace}.${entry.key}`)).size === 84, 'definitions are unique');
check(PRODUCT_METAFIELD_DEFINITIONS.filter((entry) => entry.pin).length === 14, 'the owner workflow and universal writing surface are pinned');
check(CONTENT_STATUSES.join('|') === 'NOT_STARTED|DRAFT|READY_FOR_REVIEW|APPROVED', 'owner workflow states are exact');

const mapped = inventory.products.map((product) => contractForProduct({ ...product, variants: product.variants }));
const expectedCounts = { mattress: 4, adjustable_base: 3, pillow: 16, sheets_bedding: 3, mattress_protection: 3, comforter_duvet_accessory: 6, mattress_topper: 2, bedroom_furniture: 6 };
for (const [contract, count] of Object.entries(expectedCounts)) check(mapped.filter((value) => value === contract).length === count, `${contract} maps ${count} products`);
check(readback.summary.products === 43 && readback.summary.variants === 274, 'Shopify readback covers every product and variant');
check(readback.summary.nativeCommerceFingerprintPreserved === true, 'native commerce fingerprint was preserved');
check(readback.summary.contractDefinitionCount === 84, 'all contract definitions exist');
check(readback.summary.pinnedProductDefinitionCount === 14, 'the owner workflow and writing fields are pinned in Shopify');
check(readback.summary.preservedConflicts === 0, 'no existing merchant values conflicted with initialization');
check(readback.summary.ownerContentStatuses.NOT_STARTED === 43, 'all products start in an explicit owner workflow state');
check(readback.summary.ownerContentStatuses.APPROVED === 0, 'no manufacturer copy was auto-approved as owner content');
check(readback.theme.publishedAssetsUnchanged === 10, 'published theme assets were verified unchanged');
check(readback.products.every((product) => product.schemaVersion === '1.0.0'), 'every product carries the schema version');
check(readback.products.every((product) => product.technical.provenance?.sources?.length >= 2), 'every product has technical provenance');
check(readback.products.every((product) => !product.content.approved && Object.keys(product.content.fields).length === 0), 'unapproved owner content is excluded');
check(readback.products.every((product) => product.commerce.status === 'ACTIVE'), 'actual pre-existing Shopify product status is preserved');
check(readback.products.flatMap((product) => product.commerce.variants).length === 274, 'variant identity count is preserved');
check(fixture.products.length === 8 && new Set(fixture.products.map((product) => product.categoryContract)).size === 8, 'representative fixture covers every category');
check(feed.schemaVersion === '1.0.0' && feed.products.length === 43, 'normalized feed is versioned and complete');
check(feed.bundles.length === 17, 'normalized feed exposes every owner-approved system option and curated bedding set');
check(feed.bundles.every((bundle) => bundle.sizes.every((size) => size.sourceSize && size.componentQuantities.length === bundle.components.length)), 'bundle retrieval data preserves source variants and configuration quantities');
check(feed.bundles.every((bundle) => bundle.components.length >= 2 && bundle.sizes.length >= 1), 'bundle retrieval data preserves component and size relationships');
check(feed.products.every((product) => product.commerce.authority === 'Shopify live query required'), 'dynamic commerce stays Shopify-authoritative');
check(feed.products.every((product) => product.compatibility.rule.startsWith('Unknown or missing')), 'unknown compatibility fails closed');
check(schema.$id.endsWith('product-knowledge.v1.schema.json'), 'JSON schema has a durable identifier');
check(section.includes("render 'snoozepod-product-knowledge'"), 'Product Page v1 invokes the shared renderer');
check(snippet.includes("content_status == 'APPROVED'"), 'owner content has an approval gate');
check(snippet.includes('has_category_content') && snippet.includes("when 'mattress'") && snippet.includes("when 'pillow'") && snippet.includes("when 'bedroom_furniture'"), 'category-specific rendering is present');
check(snippet.includes('Unknown') === false, 'storefront does not inject filler for unknown fields');
check(snippet.includes('purchasable_configurations'), 'purchasable mattress configurations remain explicit');
check(snippet.includes('metafield_tag'), 'rich text uses Shopify-safe metafield rendering');

console.log(`PASS product knowledge architecture: ${assertions} assertions.`);
