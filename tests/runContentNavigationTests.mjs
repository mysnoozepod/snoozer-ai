import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { contentPages } from '../content/shopify-content-pages.mjs';
import { footerMenuContract, guideGroups, guideHub, mainMenuContract } from '../content/content-navigation.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const MAIN_PAGE = fs.readFileSync(path.join(ROOT, 'sections', 'main-page.liquid'), 'utf8');
const PAGE_STAGER = fs.readFileSync(path.join(ROOT, 'scripts', 'stage-content-pages.mjs'), 'utf8');

assert.equal(contentPages.length, 50, 'the education library retains exactly 50 guides');
assert.equal(guideGroups.length, 6, 'the hub organizes the guides into six useful groups');
assert.equal(guideGroups.flatMap((group) => group.pages).length, 50, 'all 50 guides appear in the hub');
assert.equal(new Set(guideGroups.flatMap((group) => group.pages.map((page) => page.handle))).size, 50, 'every guide appears in the hub exactly once');

assert.equal(mainMenuContract.items.length, 7, 'desktop navigation keeps seven top-level destinations');
assert(!mainMenuContract.items.some((item) => item.title === 'Home'), 'the redundant Home item is removed because the logo retains the home route');
assert(mainMenuContract.items.some((item) => item.title === 'Guides & Tools' && item.url.endsWith('/pages/sleep-tools')), 'Guides & Tools is a primary navigation destination');
assert(mainMenuContract.items.find((item) => item.title === 'Mattresses').items.some((item) => item.title === 'Mattress Buying Guides'), 'mattress guides appear beside mattress shopping');
assert(mainMenuContract.items.find((item) => item.title === 'Adjustable Bases').items.some((item) => item.title === 'Adjustable Base Guides'), 'base guides appear beside adjustable-base shopping');
const productDestinations = new Map(
  ['Mattresses', 'Adjustable Bases']
    .flatMap((title) => mainMenuContract.items.find((item) => item.title === title).items)
    .filter((item) => item.type === 'PRODUCT')
    .map((item) => [item.title, item.product]),
);
assert.deepEqual(Object.fromEntries(productDestinations), {
  S7: 'bedgear-s7-12-memory-foam',
  H6: 'bedgear-h6-12-hybrid',
  M3: 'bedgear-m3-12-dual-comfort',
  M5: 'bedgear-m5-14-dual-comfort',
  'Flex L': 'flex-l-adjustable-base',
  'Flex LSX': 'flex-lsx-adjustable-base',
  'Flex SH': 'flex-sh-adjustable-base',
}, 'all model-level menu items route directly to products');
assert(mainMenuContract.items.find((item) => item.title === 'Sleep Essentials').items.some((item) => item.title === 'Bedding Guides'), 'bedding guides appear beside sleep essentials');
assert(mainMenuContract.items.find((item) => item.title === 'Your Showroom Visit').items.some((item) => item.title === 'How the Showroom Works'), 'showroom education appears in the visit menu');
assert(footerMenuContract.items.some((item) => item.url.endsWith('/pages/sleep-guides')), 'the guide hub is present in the footer navigation');

assert(MAIN_PAGE.includes('content-guide-directory'), 'the guide hub has a responsive directory treatment');
assert(MAIN_PAGE.includes('content-guide-conversion'), 'content pages have a dedicated conversion band');
assert(MAIN_PAGE.includes('Book a Snooze Session'), 'the conversion band retains the primary booking action');
assert(MAIN_PAGE.includes('data-snoozer-trigger'), 'the conversion band retains contextual Ask Snoozer access');
assert(MAIN_PAGE.indexOf('content-guide-conversion') < MAIN_PAGE.lastIndexOf('</section>'), 'content assets render inside main content before the global newsletter/footer group');
assert(!PAGE_STAGER.includes('<p><a href="/pages/book-a-snooze-session"><strong>'), 'the old unstyled inline CTA is removed from managed page bodies');
assert.equal(guideHub.handle, 'sleep-guides', 'the hub uses the canonical /pages/sleep-guides route');

const readbackPath = path.join(ROOT, 'docs', 'content-pages', 'CONTENT_NAVIGATION_SHOPIFY_READBACK.json');
if (fs.existsSync(readbackPath)) {
  const readback = JSON.parse(fs.readFileSync(readbackPath, 'utf8'));
  assert.deepEqual(readback.summary, {
    publishedGuidePages: 50,
    publishedHubPages: 1,
    verifiedMenus: 2,
    mainMenuItems: 72,
    footerMenuItems: 12,
  }, 'Shopify readback verifies both strategic navigation menus');
  const actualMainItems = readback.menus.find((menu) => menu.handle === 'main-menu').items.flatMap((item) => [item, ...(item.items || [])]);
  const actualModelLinks = Object.fromEntries(actualMainItems.filter((item) => ['S7', 'H6', 'M3', 'M5', 'Flex L', 'Flex LSX', 'Flex SH'].includes(item.title)).map((item) => [item.title, { type: item.type, url: item.url }]));
  assert.deepEqual(actualModelLinks, {
    S7: { type: 'PRODUCT', url: '/products/bedgear-s7-12-memory-foam' },
    H6: { type: 'PRODUCT', url: '/products/bedgear-h6-12-hybrid' },
    M3: { type: 'PRODUCT', url: '/products/bedgear-m3-12-dual-comfort' },
    M5: { type: 'PRODUCT', url: '/products/bedgear-m5-14-dual-comfort' },
    'Flex L': { type: 'PRODUCT', url: '/products/flex-l-adjustable-base' },
    'Flex LSX': { type: 'PRODUCT', url: '/products/flex-lsx-adjustable-base' },
    'Flex SH': { type: 'PRODUCT', url: '/products/flex-sh-adjustable-base' },
  }, 'Shopify readback verifies direct product routes for all seven model links');
}

const cleanupReadbackPath = path.join(ROOT, 'docs', 'catalog', 'SINGLE_PRODUCT_COLLECTION_CLEANUP_READBACK.json');
if (fs.existsSync(cleanupReadbackPath)) {
  const cleanup = JSON.parse(fs.readFileSync(cleanupReadbackPath, 'utf8'));
  assert.equal(cleanup.collections.length, 7, 'seven obsolete single-product storefront collections are tracked');
  assert(cleanup.collections.every((collection) => collection.onlineStorePublished === false), 'obsolete single-product collections are unpublished from Online Store');
}

console.log('Content navigation: PASS (50 guides, six hub groups, seven primary destinations, contextual guide links, footer discovery, and pre-newsletter conversion placement).');
