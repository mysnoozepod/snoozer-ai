#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath).replace(/^\/\*[\s\S]*?\*\/\s*/, ''));
}

const index = readJson('templates/index.json');
const cart = readJson('templates/cart.json');
const header = read('sections/header.liquid');
const assessmentSection = read('sections/snoozer-landing-assessment.liquid');
const assessmentScript = read('assets/snooze-assessment.js');
const pairing = read('sections/snoozepod-pod-pairing.liquid');

const homepageHero = Object.values(index.sections).find((section) => section.type === 'snooze-hero');
assert.ok(homepageHero, 'Homepage booking hero must remain present.');
assert.equal(homepageHero.settings.secondary_cta_label, '');
assert.equal(homepageHero.settings.secondary_cta_link, '');
const legacyShelf = Object.entries(index.sections).find(([, section]) => JSON.stringify(section).includes('10-all-foam-mattress'));
assert.ok(legacyShelf, 'The inactive historical shelf remains traceable until Shopify-managed template reconciliation.');
assert.equal(legacyShelf[1].disabled, true, 'The legacy hardcoded mattress shelf must remain explicitly disabled.');
assert.ok(index.order.includes(legacyShelf[0]), 'Shopify requires every retained section ID in the template order.');

const cartGuidance = Object.values(cart.sections).find((section) => section.type === 'snoozer-cart-guidance-cards');
assert.ok(cartGuidance, 'Cart guidance must remain present.');
assert.equal(cartGuidance.settings.card_1_cta_link, '/pages/snooze-assessment');
assert.equal(cartGuidance.settings.card_2_cta_link, '/pages/book-a-snooze-session');

const environment = Object.values(index.sections).find((section) => section.type === 'snoozepod-environment');
assert.ok(environment, 'Homepage collection navigation must remain present.');
assert.ok(Object.values(environment.blocks).some((block) => block.settings.collection === 'adjustable-bases'));
assert.ok(!Object.values(environment.blocks).some((block) => block.settings.collection === 'bases'));
const environmentSection = read('sections/snoozepod-environment.liquid');
assert.match(environmentSection, /linked_collection\.featured_image/);
assert.match(environmentSection, /routes\.collections_url \| append: '\/' \| append: linked_collection\.handle/);

assert.match(header, /collections\['mattresses'\]/);
assert.match(header, /snoozer_mattresses_collection\.products_count > 0/);
assert.match(header, /if snoozer_mattresses_url != blank/);
assert.doesNotMatch(header, /assign snoozer_mattresses_url = '\/collections\/mattresses'/);

assert.match(assessmentSection, /collections\['adjustable-bases'\]/);
assert.match(assessmentSection, /collections\['pillows'\]/);
assert.match(assessmentSection, /collections\['bedding'\]/);
assert.doesNotMatch(assessmentSection, /12-dual-comfort-hybrid|14-hybrid|10-all-foam-mattress|12-all-foam-mattress/);
assert.match(assessmentScript, /mattresses: normalizeText\(root\.getAttribute\("data-mattresses-url"\)\),/);
assert.doesNotMatch(assessmentScript, /mattresses: normalizeText\(root\.getAttribute\("data-mattresses-url"\)\) \|\|/);
assert.match(assessmentScript, /if \(!href\) return null;/);
assert.match(assessmentScript, /if \(primary && primary\.href\)/);

assert.match(pairing, /\/collections\/adjustable-bases/);
assert.match(pairing, /\/collections\/mattress-protectors/);
assert.doesNotMatch(pairing, /\/products\/(premium-motion-adjustable-base|storage-base|platform-base|dri-tec-mattress-protector|ver-tex-mattress-protector)/);

console.log('Storefront route contract: PASS (booking/cart routes valid; collection shells remain browsable; unpublished mattress and legacy product links fail closed).');
