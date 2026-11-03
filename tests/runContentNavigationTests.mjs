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
}

console.log('Content navigation: PASS (50 guides, six hub groups, seven primary destinations, contextual guide links, footer discovery, and pre-newsletter conversion placement).');
