#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

const header = read('sections/header.liquid');
assert.match(header, /function getSnoozerPageContext\(trigger\)/);
assert.match(header, /data-snoozer-product-id/);
assert.match(header, /selectedVariantInput/);
assert.match(header, /activeSnoozerContext/);
assert.match(header, /shopifyProductId: pageContext\.shopifyProductId \|\| undefined/);
assert.match(header, /productHandle: currentProductHandle \|\| undefined/);
assert.match(header, /selectedVariantId: pageContext\.selectedVariantId \|\| undefined/);
assert.match(header, /productType: pageContext\.productType \|\| undefined/);
assert.match(header, /collectionHandle: pageContext\.collectionHandle \|\| undefined/);
assert.match(header, /openVisibleShell\(trigger\.getAttribute\('data-snoozer-source'\), triggerContext\)/);

const productHero = read('sections/snoozepod-product-hero.liquid');
assert.match(productHero, /data-product-id="{{ product\.id }}"/);
assert.match(productHero, /data-product-handle="{{ product\.handle \| escape }}"/);
assert.match(productHero, /data-product-type="{{ product\.type \| escape }}"/);
assert.match(productHero, /data-snoozer-variant-id="{{ product\.selected_or_first_available_variant\.id }}"/);

const builderHero = read('sections/snoozepod-pod-builder-hero.liquid');
assert.match(builderHero, /data-snoozer-product-id="{{ product\.id }}"/);
assert.match(builderHero, /data-snoozer-product-type="{{ product\.type \| escape }}"/);

const collectionHero = read('sections/snoozepod-collection-hero.liquid');
const collectionCta = read('sections/snoozepod-collection-cta.liquid');
assert.match(collectionHero, /data-snoozer-collection-handle="{{ collection\.handle \| escape }}"/);
assert.match(collectionCta, /data-snoozer-collection-handle="{{ collection\.handle \| escape }}"/);

console.log('Ask Snoozer context contract: PASS (product, variant, type, collection, and source context).');
