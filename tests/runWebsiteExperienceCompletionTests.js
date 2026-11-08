const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let assertions = 0;

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function json(relativePath) {
  return JSON.parse(read(relativePath).replace(/^\/\*[\s\S]*?\*\//, '').trim());
}

function check(condition, message) {
  assert.ok(condition, message);
  assertions += 1;
}

function checkSchema(relativePath) {
  const source = read(relativePath);
  const match = source.match(/{% schema %}([\s\S]*?){% endschema %}/);
  check(Boolean(match), `${relativePath} must include a schema.`);
  JSON.parse(match[1]);
  assertions += 1;
}

const home = json('templates/index.json');
const homeOrder = home.order;
check(home.sections.image_with_text_hVQzdT.settings.primary_cta_link === 'shopify://pages/book-a-snooze-session', 'Homepage hero must lead to booking.');
check(home.sections.image_with_text_hVQzdT.settings.secondary_cta_link === 'shopify://collections/mattresses', 'Homepage secondary CTA must lead to mattresses.');
check(homeOrder.indexOf('image_with_text_wUxjfL') < homeOrder.indexOf('mattress-showcase'), 'Snooze Session experience must precede mattress browsing.');
check(homeOrder.indexOf('mattress-showcase') < homeOrder.indexOf('guided-shopping'), 'Mattress browsing must precede optional tools.');
check(homeOrder.indexOf('meet-snoozer') < homeOrder.indexOf('guided-shopping'), 'Meet Snoozer must precede optional tools.');
check(home.sections['mattress-showcase'].block_order.length === 4, 'Homepage must expose the four mattress models.');
check(new Set(Object.values(home.sections['mattress-showcase'].blocks).map((block) => block.settings.product)).size === 4, 'Homepage mattress cards must point to four distinct products.');

const header = read('sections/header.liquid');
check(header.includes('class="header__book-link"'), 'Header must include a prominent booking link.');
check(header.includes('header__guest-checkin'), 'Header must preserve mobile guest check-in access.');
check(header.includes('data-snooze-checkin-form'), 'Snooze Code check-in behavior must remain connected.');
check(header.includes('data-snoozer-source="header-desktop"') && header.includes('data-snoozer-source="header-mobile"'), 'Ask Snoozer must remain available on desktop and mobile.');

const collection = json('templates/collection.snoozepod-v1.json');
check(collection.order.indexOf('product-grid') < collection.order.indexOf('guided-shopping'), 'Collection product grid must precede guided tools.');
check(collection.sections['product-grid'].settings.enable_filtering === true, 'Collection filtering must remain enabled.');
check(collection.sections['product-grid'].settings.enable_sorting === true, 'Collection sorting must remain enabled.');
check(collection.sections['product-grid'].settings.quick_add === 'none', 'Collection cards must continue to lead to full product pages.');

const product = json('templates/product.snoozepod-v1.json');
const productBlockOrder = product.sections.hero.block_order;
check(productBlockOrder.indexOf('booking') < productBlockOrder.indexOf('buy_buttons'), 'Product booking CTA must precede Add to Cart.');
check(product.order.includes('related'), 'Product template must include related products.');
check(!read('templates/product.snoozepod-v1.json').toLowerCase().includes('pod builder'), 'Product template must not reintroduce the retired Pod Builder.');
const productHero = read('sections/snoozepod-product-hero.liquid');
check(productHero.includes('Left Side Comfort') && productHero.includes('Right Side Comfort'), 'Dual Comfort must preserve independent left/right controls.');
check(productHero.includes('data-orderable="false"'), 'Unresolved Dual Comfort configurations must fail closed.');
check(productHero.includes('data-dual-comfort-mappings'), 'Dual Comfort must resolve through verified variant mappings.');

const bookingTemplate = json('templates/page.landing-booking.json');
const bookingSection = read('sections/snoozer-landing-booking.liquid');
check(/optional and never required/i.test(bookingTemplate.sections.main.settings.hero_helper_text), 'Booking page must state that the assessment is optional.');
check(bookingSection.indexOf('Book directly') < bookingSection.indexOf('<p class="section-label">Optional</p>'), 'Direct booking must render before the optional assessment.');
check(bookingSection.includes('CalendlyInlineWidgetBooking') && bookingSection.includes('CalendlyInlineWidgetMini'), 'Both booking and optional assessment Calendly widgets must remain mounted.');

const cart = json('templates/cart.json');
const cartSource = read('templates/cart.json').toLowerCase();
check(cart.order[0] === 'cart-items' && cart.order[1] === 'cart-footer', 'Cart must preserve the standard Shopify items-to-checkout order.');
check(!cartSource.includes('pod builder') && !cartSource.includes('bundle'), 'Cart must not contain retired bundle-purchasing language.');

const footer = json('sections/footer-group.json');
check(footer.order.indexOf('experience-navigation') < footer.order.indexOf('newsletter'), 'Booking and footer navigation must render above Stay In The Loop.');
const footerNavigation = read('sections/snoozepod-footer-navigation.liquid');
check(footerNavigation.includes('Shop') && footerNavigation.includes('Visit &amp; Guidance') && footerNavigation.includes('Customer Support'), 'Footer must be grouped by shopping, visit, and support.');
check(footerNavigation.includes('/pages/warranty-support'), 'Footer must expose warranty support.');

checkSchema('sections/snoozepod-mattress-showcase.liquid');
checkSchema('sections/snoozepod-meet-snoozer.liquid');
checkSchema('sections/snoozepod-footer-navigation.liquid');

console.log(`PASS website experience completion: ${assertions} assertions.`);
