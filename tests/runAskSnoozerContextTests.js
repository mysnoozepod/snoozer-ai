#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

const header = read('sections/header.liquid');
const panel = read('snippets/website-ask-snoozer.liquid');
const client = read('assets/website-ask-snoozer.js');
const { buildConversationEnvelope } = require('../services/askSnoozerModelCore');
const { websiteManifest } = require('../services/askSnoozerWebsiteAssessment');
const handle = '12-inch-dual-comfort-mattress';
assert.match(header, /data-website-snoozer-trigger aria-controls="WebsiteAskSnoozer"/);
assert.match(panel, /data-product-handle="{{ product\.handle \| escape }}"/);
assert.match(client, /productHandle: panel\.dataset\.productHandle/);
assert.match(client, /source: 'website',[^\n]+page: currentPage\(\)/);
const website = { websiteAssessment: true, manifest: websiteManifest };
const envelope = buildConversationEnvelope({ ...website, websiteProductHandle: handle });
assert.deepEqual(envelope.websitePage, { productHandle: handle });
assert.deepEqual(envelope.conversationState.preferences, [], 'A page view must not create a shopper preference.');
assert.equal(buildConversationEnvelope({ ...website, websiteProductHandle: '12-dual-comfort-hybrid' }).websitePage, undefined);
assert.equal(buildConversationEnvelope({ ...website, websiteProductHandle: handle, websiteAssessment: false }).websitePage, undefined);

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

console.log('Ask Snoozer context contract: PASS (website source, verified product reference, and legacy section metadata).');
