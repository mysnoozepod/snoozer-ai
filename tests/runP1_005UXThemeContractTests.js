'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assertions = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
  assertions.push(message);
}

function parseTemplate(relativePath) {
  const source = read(relativePath).replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '');
  return JSON.parse(source);
}

function parseSectionSchema(relativePath) {
  const source = read(relativePath);
  const match = source.match(/{% schema %}([\s\S]*?){% endschema %}/);
  assert(Boolean(match), `${relativePath} exposes a section schema`);
  return JSON.parse(match[1]);
}

function displayedPrice(fixture, variantId) {
  const variant = fixture.product.variants.find((candidate) => candidate.id === variantId);
  return variant ? variant.price : null;
}

function feelVisible(label, position) {
  return Boolean(label && Number.isFinite(Number(position)) && Number(position) >= 0 && Number(position) <= 100);
}

const fixture = JSON.parse(read('tests/fixtures/p1-005ux-theme-contract.fixture.json'));
const productTemplate = parseTemplate('templates/product.json');
const productV1Template = parseTemplate('templates/product.snoozepod-v1.json');
const collectionTemplate = parseTemplate('templates/collection.snoozepod-v1.json');
const podBuilderTemplate = parseTemplate('templates/product.pod-builder.json');
const productPodBuilderTemplate = parseTemplate('templates/product.product-pod-builder.json');

const productHero = read('sections/snoozepod-product-hero.liquid');
const productInformation = read('sections/snoozepod-product-information-v1.liquid');
const collectionHero = read('sections/snoozepod-collection-hero.liquid');
const collectionNavigation = read('sections/snoozepod-collection-navigation-v1.liquid');
const collectionGrid = read('sections/main-collection-product-grid.liquid');
const cardProduct = read('snippets/card-product.liquid');
const feelSnippet = read('snippets/snoozepod-product-feel.liquid');
const showroomSnippet = read('snippets/snoozepod-showroom-location.liquid');
const podBuilderHero = read('sections/snoozepod-pod-builder-hero.liquid');

parseSectionSchema('sections/snoozepod-product-hero.liquid');
parseSectionSchema('sections/snoozepod-product-information-v1.liquid');
parseSectionSchema('sections/snoozepod-collection-hero.liquid');
parseSectionSchema('sections/snoozepod-collection-navigation-v1.liquid');
parseSectionSchema('sections/main-collection-product-grid.liquid');

assert(fixture.renderingStatus === 'SIMULATED_NOT_SHOPIFY_RENDERING', 'fixture is explicitly labeled as simulated rendering');
assert(fixture.product.status === 'DRAFT', 'fixture preserves the real product DRAFT state');
assert(fixture.product.id === '8099363094589', 'fixture uses the verified Shopify product ID');
assert(fixture.product.variants.length === 2, 'fixture contains exactly the Queen and King variants');
assert(displayedPrice(fixture, '44049793777725') === '59.99', 'Queen selection resolves the verified reference price');
assert(displayedPrice(fixture, '44049793810493') === '69.99', 'King selection resolves the verified reference price');
assert(displayedPrice(fixture, 'missing') === null, 'unknown variants fail closed instead of showing a guessed price');
assert(feelVisible(fixture.product.feelLabel, fixture.product.feelPosition) === false, 'the draft pillow hides Product Feel when verified data is absent');
assert(feelVisible('Medium', 50) === true, 'a complete verified feel value can render');
assert(feelVisible('Medium', 101) === false, 'out-of-range feel data fails closed');

for (const template of [productTemplate, productV1Template]) {
  const hero = template.sections.hero;
  assert(hero.type === 'snoozepod-product-hero', 'Product Page v1 uses the reusable product hero');
  assert(hero.block_order.indexOf('booking') < hero.block_order.indexOf('buy_buttons'), 'booking remains primary before Add to Cart');
  assert(hero.block_order.includes('feel'), 'Product Page v1 includes the verified Product Feel block');
  assert(hero.block_order.includes('snoozer'), 'Product Page v1 includes Ask Snoozer');
  assert(hero.block_order.includes('showroom'), 'Product Page v1 supports structured showroom location');
  assert(template.sections.information.type === 'snoozepod-product-information-v1', 'Product Page v1 uses reusable information accordions');
}

assert(productHero.includes("render 'product-media-gallery'"), 'product hero preserves native gallery and thumbnails');
assert(productHero.includes("render 'product-variant-picker'"), 'product hero preserves native variant selectors');
assert(productHero.includes("render 'buy-buttons'"), 'product hero preserves native Shopify cart form');
assert(productHero.includes('use_variant: true'), 'product price is variant-aware');
assert(productHero.includes('data-snoozer-product-handle'), 'product Snoozer trigger carries current product identity');
assert(productHero.includes('/pages/book-a-snooze-session'), 'product booking action uses the approved route');
assert(feelSnippet.includes('role="progressbar"'), 'Product Feel exposes an accessible progressbar');
assert(feelSnippet.includes('feel_position >= 0 and feel_position <= 100'), 'Product Feel validates its numeric range');
assert(showroomSnippet.includes("showroom_state == 'READY'"), 'showroom location renders only when structured data is READY');
assert(productInformation.includes('<details'), 'product information uses keyboard-native expandable details');
assert(productInformation.includes('shop.shipping_policy.url'), 'delivery section can reuse the authoritative Shopify shipping policy');
assert(productInformation.includes('shop.refund_policy.url'), 'returns section can reuse the authoritative Shopify return policy');

assert(collectionTemplate.order.join('|') === 'hero|category-navigation|guided-shopping|product-grid|closing', 'Collection Page v1 follows the approved guided section sequence');
assert(collectionTemplate.sections['guided-shopping'].type === 'snoozepod-guided-shopping-links', 'Collection Page v1 connects contextual tools before the product grid');
assert(collectionTemplate.sections['category-navigation'].blocks.pillows.settings.collection === 'pillows', 'collection preview uses the real Pillows collection');
assert(collectionTemplate.sections['category-navigation'].blocks.sheets.settings.collection === 'sheets', 'collection preview uses the canonical Sheets collection');
assert(collectionTemplate.sections['category-navigation'].blocks['bedroom-furniture'].settings.collection === 'bedroom-furniture', 'collection preview uses the canonical Bedroom Furniture collection');
assert(collectionTemplate.sections['product-grid'].settings.enable_filtering === true, 'Collection Page v1 enables Shopify filters');
assert(collectionTemplate.sections['product-grid'].settings.enable_sorting === true, 'Collection Page v1 enables Shopify sorting');
assert(collectionTemplate.sections['product-grid'].settings.filter_type === 'drawer', 'Collection Page v1 uses collapsible filters');
assert(collectionTemplate.sections['product-grid'].settings.columns_mobile === '2', 'Collection Page v1 requests a two-column mobile grid');
assert(collectionTemplate.sections['product-grid'].settings.show_snoozepod_card_details === true, 'Collection Page v1 enables enhanced product cards');
assert(collectionHero.includes('collection.description'), 'collection hero prefers Shopify collection content over invented category copy');
assert(collectionHero.includes('data-snoozer-collection-handle'), 'collection Snoozer trigger carries current collection identity');
assert(collectionNavigation.includes('collection.metafields.custom.category_navigation.value'), 'category navigation supports per-collection real Shopify mappings');
assert(collectionGrid.includes('show_snoozepod_details: section.settings.show_snoozepod_card_details'), 'collection grid passes the Product Card v1 contract');
assert(cardProduct.includes("render 'snoozepod-card-details'"), 'product cards render verified v1 details when enabled');
assert(cardProduct.includes("render 'price', product: card_product"), 'product cards keep Shopify price authority');

for (const builderTemplate of [podBuilderTemplate, productPodBuilderTemplate]) {
  assert(builderTemplate.sections.hero.type === 'snoozepod-pod-builder-hero', 'mattress template preserves the existing Pod Builder hero');
  assert(builderTemplate.sections.information.type === 'snoozepod-product-information-v1', 'mattress template gains the shared information structure without replacing the builder');
}
assert(podBuilderHero.includes("render 'snoozepod-guided-pod-builder-core'"), 'shared inline Pod Builder core remains mounted');
assert(podBuilderHero.includes('data-snoozer-source="pod-builder-product-v1"'), 'mattress experience gains contextual Ask Snoozer access');
assert(podBuilderHero.includes("render 'snoozepod-product-feel'"), 'mattress experience can show verified Product Feel');

console.log(`P1-005UX theme contract: PASS (${assertions.length} assertions)`);
