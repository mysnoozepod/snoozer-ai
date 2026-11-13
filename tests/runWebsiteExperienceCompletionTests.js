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
check(home.sections.image_with_text_wUxjfL.disabled === true, 'The redundant homepage booking explainer must stay disabled while its editor-managed section remains recoverable.');
check(home.sections['guided-shopping'].disabled === true && home.sections['meet-snoozer'].disabled === true, 'Homepage must defer unfinished guidance surfaces until the backend phase.');
check(home.sections['mattress-showcase'].block_order.length === 4, 'Homepage must expose the four mattress models.');
check(new Set(Object.values(home.sections['mattress-showcase'].blocks).map((block) => block.settings.product)).size === 4, 'Homepage mattress cards must point to four distinct products.');

const header = read('sections/header.liquid');
check(!header.includes('class="header__book-link"'), 'Header must not duplicate the booking action already present in the announcement bar.');
check(!header.includes('header__guest-checkin') && !header.includes('data-snooze-checkin-form'), 'Header must not expose Check In on desktop or mobile.');
check(header.includes('.header__heading-logo { max-width: 18rem; }'), 'Mobile logo must use the enlarged 18rem presentation.');
check(!header.includes('{{ ask_snoozer_desktop }}') && !header.includes('{{ ask_snoozer_mobile }}'), 'Dormant Ask Snoozer markup must not render in the header.');

const collection = json('templates/collection.snoozepod-v1.json');
check(collection.order.join('|') === 'banner|product-grid|category-navigation', 'Collection pages must be title, products, then Shop by Category.');
check(!collection.sections['guided-shopping'], 'Unfinished Find Your Fit tools must stay out of collections and navigation.');
check(collection.order.indexOf('product-grid') < collection.order.indexOf('category-navigation'), 'Collection product grid must precede Shop by Category.');
check(!JSON.stringify(collection).toLowerCase().includes('snoozer'), 'Collection templates must not show an Ask Snoozer prompt.');
check(collection.sections['product-grid'].settings.enable_filtering === true, 'Collection filtering must remain enabled.');
check(collection.sections['product-grid'].settings.enable_sorting === true, 'Collection sorting must remain enabled.');
check(collection.sections['product-grid'].settings.quick_add === 'none', 'Collection cards must continue to lead to full product pages.');

const product = json('templates/product.snoozepod-v1.json');
const productBlockOrder = product.sections.hero.block_order;
check(!productBlockOrder.includes('booking'), 'Product booking CTA must stay out of the primary purchase controls.');
check(productBlockOrder.indexOf('buy_buttons') === productBlockOrder.indexOf('variant_picker') + 1, 'Add to Cart must be the focal action immediately after variant selection.');
check(productBlockOrder.indexOf('feel') === productBlockOrder.indexOf('price') + 1, 'Verified Feel must stay adjacent to price.');
check(product.order.includes('related'), 'Product template must include related products.');
check(product.order.at(-1) === 'final-cta', 'Product booking guidance must remain at the page tail.');
check(product.sections['final-cta'].settings.primary_label === 'Book a Snooze Session', 'Booking must be the primary page-tail action.');
check(product.sections['final-cta'].settings.show_secondary === false, 'Product page tail must keep one focused booking action.');
check(!read('templates/product.snoozepod-v1.json').toLowerCase().includes('pod builder'), 'Product template must not reintroduce the retired Pod Builder.');
const productHero = read('sections/snoozepod-product-hero.liquid');
check(productHero.includes('Left Side Comfort') && productHero.includes('Right Side Comfort'), 'Dual Comfort must preserve independent left/right controls.');
check(productHero.includes('data-orderable="false"'), 'Unresolved Dual Comfort configurations must fail closed.');
check(productHero.includes('data-dual-comfort-mappings'), 'Dual Comfort must resolve through verified variant mappings.');

const bookingTemplate = json('templates/page.landing-booking.json');
const bookingSection = read('sections/snoozer-landing-booking.liquid');
check(/optional and never required/i.test(bookingTemplate.sections.main.settings.hero_helper_text), 'Booking page must state that the assessment is optional.');
check(bookingSection.indexOf('Book directly') < bookingSection.indexOf('<p class="section-label">Optional</p>'), 'Direct booking must render before the optional assessment.');
check(bookingSection.includes('CalendlyInlineWidgetBooking') && !bookingSection.includes('CalendlyInlineWidgetMini'), 'Booking page must mount one primary scheduler only.');
check(bookingSection.includes('href="/pages/snooze-assessment"'), 'The optional assessment remains available as a secondary link.');

const cart = json('templates/cart.json');
const cartSource = read('templates/cart.json').toLowerCase();
check(cart.order[0] === 'cart-items' && cart.order[1] === 'cart-footer', 'Cart must preserve the standard Shopify items-to-checkout order.');
check(!cartSource.includes('pod builder') && !cartSource.includes('bundle'), 'Cart must not contain retired bundle-purchasing language.');

const footer = json('sections/footer-group.json');
check(footer.order.indexOf('experience-navigation') < footer.order.indexOf('newsletter'), 'Booking and footer navigation must render above Stay In The Loop.');
const footerNavigation = read('sections/snoozepod-footer-navigation.liquid');
check(footerNavigation.includes('Shop') && footerNavigation.includes('Visit &amp; Guidance') && footerNavigation.includes('Customer Support'), 'Footer must be grouped by shopping, visit, and support.');
check(footerNavigation.includes('/pages/warranty-support'), 'Footer must expose warranty support.');
check(footerNavigation.includes("request.page_type == 'product'") && footerNavigation.includes("request.page_type == 'collection'"), 'Product and collection pages must not repeat the global booking banner below their page-tail CTA.');
check(footerNavigation.includes("page.handle == 'book-a-snooze-session'"), 'The booking page must not repeat a self-referential booking banner.');

checkSchema('sections/snoozepod-mattress-showcase.liquid');
checkSchema('sections/snoozepod-meet-snoozer.liquid');
checkSchema('sections/snoozepod-footer-navigation.liquid');

console.log(`PASS website experience completion: ${assertions} assertions.`);
