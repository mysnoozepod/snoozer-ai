import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'omnia-journey/package.json'));
const { chromium } = require('playwright');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const header = read('sections/header.liquid');
const layout = read('layout/theme.liquid');
const settings = JSON.parse(read('config/settings_schema.json'));
const handle = '12-inch-dual-comfort-mattress';
const booking = '/pages/book-a-snooze-session';
const origin = 'https://mysnoozepod.test';
const executablePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const screenshotDir = process.argv.includes('--screenshots') ? fs.mkdtempSync(path.join(os.tmpdir(), 'snoozer-preview-')) : null;

assert.equal(settings.flatMap((group) => group.settings || []).find((setting) => setting.id === 'website_ask_snoozer_enabled')?.default, false);
assert.match(layout, /if settings\.website_ask_snoozer_enabled[\s\S]+render 'website-ask-snoozer'/);
assert.doesNotMatch(header, /__mysnoozepodSnoozerTriggerBound|capture ask_snoozer_(?:desktop|mobile)/);

const icon = read('snippets/website-ask-snoozer-icon.liquid');
const renderIcon = (value) => value.replace("{% render 'website-ask-snoozer-icon' %}", icon);
const triggerMarkup = renderIcon(header.match(/<button[^>]*data-website-snoozer-trigger[^>]*>[\s\S]*?<\/button>/)[0]);
const headerStyles = header.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/{%-?[\s\S]*?-?%}/g, '');
const client = read('assets/website-ask-snoozer.js');

function renderPage(pathname) {
  const isProduct = pathname.startsWith('/products/');
  const panel = renderIcon(read('snippets/website-ask-snoozer.liquid'))
    .replace('{{ request.page_type | escape }}', isProduct ? 'product' : 'index')
    .replace('{{ product.handle | escape }}', isProduct ? handle : '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      html { font-size: 62.5%; box-sizing: border-box; }
      *, *::before, *::after { box-sizing: inherit; }
      body { margin: 0; color: #0b1b42; display: grid; grid-template-columns: 100%; font: 400 16px/1.5 Inter, Arial, sans-serif; }
      [hidden] { display: none !important; }
      .visually-hidden { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); overflow: hidden; }
      .announcement { background: #0b1b42; color: white; padding: 1rem; text-align: center; font-weight: 650; }
      .header-wrapper { background: #f2f5fa; padding: 0 4%; }
      .header__nav-row { padding: 1.4rem 0; justify-content: space-evenly; font-weight: 650; }
      .header__nav-row a, .header__main-toggle { color: inherit; }
      .hero-fixture { background: #0b1b42; color: #fff; padding: clamp(3rem, 6vw, 8rem); min-height: 56vh; }
      .hero-fixture h1 { font-size: clamp(3.5rem, 5vw, 7rem); line-height: 1.05; margin: 0 0 2rem; max-width: 60rem; }
      .below { min-height: 90vh; padding: 4rem; background: #f7f9fb; }
      .shopify-section-group-footer-group { background: #0b1b42; color: #fff; padding: 2rem; }
      @media (max-width: 989px) { .header__nav-row { display: none !important; } }
      ${headerStyles}
      ${read('assets/website-ask-snoozer.css')}
    </style></head><body>
    <div class="announcement">Book a private Snooze Session in our showroom or virtually. Book now →</div>
    <div class="section-header"><div class="header-wrapper"><header class="header"><div class="header__main header__main--ask-snoozer">
      <button class="header__main-toggle" aria-label="Menu">☰</button>
      <div class="header__branding"><a href="/" class="header__heading-logo-wrapper"><img width="2172" height="724" alt="MySnoozePod.com" class="header__heading-logo" src="/test-logo.png"></a></div>
      <div class="header__icons"><div class="header__action-group">${triggerMarkup}
        <a href="/account" class="header__icon header__icon--account" aria-label="Account">♙</a>
        <a href="/cart" class="header__icon header__icon--cart" aria-label="Cart">▢</a>
      </div></div>
    </div><nav class="header__nav-row">Sleep Systems · Mattresses · Adjustable Bases · Sleep Essentials · Bedroom Furniture · Our Showroom</nav></header></div></div>
    <main id="MainContent"><section class="hero-fixture"><h1>${isProduct ? '12-inch Dual Comfort Mattress' : 'A Private Way To Find Better Sleep'}</h1><p>Compare mattresses and complete sleep systems with clear, personal guidance.</p></section><section class="below"><h2>Keep exploring</h2></section></main>
    <footer class="shopify-section-group-footer-group">MySnoozePod</footer>
    ${panel}<script>window.MySnoozePod = { apiBase: '/api' };</script><script>${client}</script></body></html>`;
}

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(7000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const requests = [];
let failureMode = '';
let releaseReply;
await context.route(`${origin}/**`, async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/test-logo.png') return route.fulfill({ path: path.join(root, 'assets/mysnoozepod-logo-sharp.png') });
  if (url.pathname !== '/api/ask-snoozer') return route.fulfill({ contentType: 'text/html', body: renderPage(url.pathname) });
  const payload = route.request().postDataJSON();
  requests.push(payload);
  if (releaseReply) await releaseReply;
  if (failureMode === 'unavailable') return route.fulfill({ status: 503, json: { ok: false } });
  const isBooking = payload.message.includes('book');
  return route.fulfill({ json: {
    ok: true, status: 'answered', sessionId: payload.sessionId,
    metadata: { answerSourceKey: failureMode === 'legacy' ? 'conversation-core.v1.2' : 'website-assessment.v1' },
    reply: isBooking ? 'You can choose a time for a Snooze Session.'
      : 'You can have Soft and Firm on one shared mattress. A split setup helps if you want independent elevation.',
    actions: isBooking ? [{ type: 'navigate', target: booking, label: 'Book a Snooze Session' }]
      : [
        { type: 'navigate', target: `/products/${handle}?variant=44128362561597`, label: 'View Queen Dual Comfort' },
        { type: 'navigate', target: '//example.invalid/unsafe', label: 'Unsafe link' },
        { type: 'add_to_cart', target: `/products/${handle}`, label: 'Unapproved cart action' },
      ],
    products: [],
  } });
});

const trigger = page.getByRole('button', { name: 'Ask Snoozer', exact: true });
const panel = page.getByRole('dialog', { name: 'Ask Snoozer' });
const input = page.getByRole('textbox', { name: 'Message for Snoozer' });
const send = page.getByRole('button', { name: 'Send' });
const turns = page.locator('.website-snoozer__turn');
const close = page.getByRole('button', { name: 'Close Ask Snoozer' });
const status = panel.getByRole('status');

async function noOverflow() {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
}

try {
  await page.goto(origin);
  assert.equal(await page.locator('#WebsiteAskSnoozer').count(), 1);
  assert.equal(await trigger.count(), 1);
  const fullWidth = (await page.locator('#MainContent').boundingBox()).width;
  await trigger.click();
  await panel.waitFor();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await panel.evaluate((element) => element.matches(':modal')), false);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Close Ask Snoozer');
  const dock = await panel.boundingBox();
  const main = await page.locator('#MainContent').boundingBox();
  const headerBox = await page.locator('.header-wrapper').boundingBox();
  assert(Math.abs(dock.x - main.width) <= 1, 'The dock must sit beside the storefront.');
  assert.equal(dock.y, Math.round(headerBox.y + headerBox.height));
  assert(main.width < fullWidth);
  assert(await page.getByRole('link', { name: 'Cart', exact: true }).isVisible());
  assert.equal(await panel.getByRole('link', { name: 'Book a Snooze Session' }).getAttribute('href'), booking);
  assert.equal(requests.length, 0);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'desktop-ask-snoozer.png') });
  await page.keyboard.press('Escape');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'website-snoozer-trigger');
  assert.equal((await page.locator('#MainContent').boundingBox()).width, fullWidth);

  await page.goto(`${origin}/products/${handle}`);
  await trigger.click();
  await panel.getByRole('button', { name: 'Ask a product question' }).click();
  await input.fill('Do we need a split bed for Soft and Firm?');
  let resolveReply;
  releaseReply = new Promise((resolve) => { resolveReply = resolve; });
  await send.click();
  await status.filter({ hasText: 'Snoozer is thinking…' }).waitFor();
  assert(await send.isDisabled());
  await panel.locator('form').evaluate((form) => form.requestSubmit());
  resolveReply();
  await panel.getByRole('link', { name: 'View Queen Dual Comfort' }).waitFor();
  releaseReply = undefined;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].source, 'website');
  assert.deepEqual(requests[0].page, { pageType: 'product', route: `/products/${handle}`, productHandle: handle });
  assert.match(requests[0].sessionId, /^website_[a-f0-9-]{36}$/i);
  assert.equal(await panel.getByRole('link', { name: 'View Queen Dual Comfort' }).getAttribute('href'), `/products/${handle}?variant=44128362561597`);
  assert.equal(await panel.getByText('Unsafe link').count(), 0);
  assert.equal(await panel.getByText('Unapproved cart action').count(), 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await panel.locator('form').waitFor();
  assert.equal(await panel.evaluate((element) => element.matches(':modal')), true);
  assert.equal(Math.round((await panel.boundingBox()).width), 390);
  assert.equal(Math.round((await panel.boundingBox()).height), 844);
  assert.equal(await turns.count(), 2);
  await noOverflow();
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'mobile-ask-snoozer.png') });
  await close.click();
  await page.evaluate(() => window.scrollTo(0, 330));
  await page.evaluate(() => document.querySelector('[data-website-snoozer-trigger]').click());
  await close.click();
  assert.equal(await page.evaluate(() => window.scrollY), 330, 'Mobile Back must restore the shopping position.');
  await trigger.click();
  assert.equal(await turns.count(), 2);

  failureMode = 'legacy';
  await input.fill('I would like to book.');
  await send.click();
  await status.filter({ hasText: /Your question is still here/ }).waitFor();
  assert.equal(await input.inputValue(), 'I would like to book.');
  assert.equal(await turns.count(), 2);
  failureMode = 'unavailable';
  await send.click();
  await status.filter({ hasText: /Your question is still here/ }).waitFor();
  assert.equal(await input.inputValue(), 'I would like to book.');
  assert.equal(await turns.count(), 2);
  failureMode = '';
  await send.click();
  await panel.getByRole('link', { name: 'Book a Snooze Session' }).waitFor();
  assert.equal(await turns.count(), 4);
  assert.equal(requests.length, 4);
  assert(requests.every((payload) => payload.sessionId === requests[0].sessionId));
  assert.equal(await panel.getByRole('link', { name: 'Book a Snooze Session' }).getAttribute('href'), booking);

  await page.goto(origin);
  await trigger.click();
  assert.equal(await turns.count(), 4, 'Same-tab navigation must keep the conversation.');
  await page.setViewportSize({ width: 320, height: 640 });
  await noOverflow();
  await close.click();
  await noOverflow();
  await page.setViewportSize({ width: 990, height: 800 });
  await trigger.click();
  await noOverflow();
  assert.equal(await panel.evaluate((element) => element.matches(':modal')), false);
  await close.click();

  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await trigger.click();
  await panel.getByRole('button', { name: 'Find my sleep setup' }).click();
  await panel.getByRole('link', { name: 'View Queen Dual Comfort' }).waitFor();
  assert.equal(requests.at(-1).message, 'Help me find my sleep setup.');
  assert.notEqual(requests.at(-1).sessionId, requests[0].sessionId);
  assert.deepEqual(errors, []);
  if (screenshotDir) console.log(`Browser fixture screenshots: ${screenshotDir}`);
  console.log('PASS Ask Snoozer browser fixture: desktop dock, mobile dialog and Back, focus, guest continuity, three starter actions, variant links, and failure recovery.');
} catch (error) {
  console.error('Browser errors:', errors, 'Requests:', requests.length, 'Panel:', await page.locator('#WebsiteAskSnoozer').innerText());
  throw error;
} finally {
  await browser.close();
}
