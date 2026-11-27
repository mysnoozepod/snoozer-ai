#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

const { buildConversationEnvelope } = require('../services/askSnoozerModelCore');
const { websiteManifest } = require('../services/askSnoozerWebsiteAssessment');
const handle = '12-inch-dual-comfort-mattress';
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
console.log('Ask Snoozer context contract: PASS (website source validation and retained Shopify product metadata).');
