import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const json = (relative) => JSON.parse(read(relative).replace(/^\s*\/\*[\s\S]*?\*\//, '').trim());
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions += 1; };

const home = json('templates/index.json');
const activeHomeOrder = home.order.filter((sectionId) => !home.sections[sectionId].disabled);
check(activeHomeOrder.join('|') === 'image_with_text_hVQzdT|value-strip|mattress-showcase|snoozepod_final_build_cta_K8nqLs|snoozepod_environment_GYx7gN', 'homepage has one focused discovery sequence');
check(home.sections['meet-snoozer'].disabled && home.sections['guided-shopping'].disabled && home.sections.snoozepod_trust_strip_F6kqDr.disabled, 'homepage defers repeated guidance and trust sections');
check(home.sections.snoozepod_final_build_cta_K8nqLs.settings.primary_link === '/pages/sleep-systems', 'homepage guides shoppers into real Sleep Systems');

const header = read('sections/header.liquid');
check(!header.includes('{{ ask_snoozer_desktop }}') && !header.includes('{{ ask_snoozer_mobile }}'), 'header does not render dormant Snoozer controls');

const cart = json('templates/cart.json');
check(cart.order.join('|') === 'cart-items|cart-footer', 'cart contains only commerce-critical sections');
check(!JSON.stringify(cart).toLowerCase().includes('snoozer'), 'cart defers Snoozer guidance');
check(read('sections/main-cart-items.liquid').includes('>Your Cart<'), 'cart uses a direct customer-facing heading');

for (const file of ['templates/product.json', 'templates/product.snoozepod-v1.json', 'templates/product.main.json', 'templates/product.product-support-item.json']) {
  const template = json(file);
  const finalCta = template.sections['final-cta'];
  check(finalCta.settings.primary_label === 'Book a Snooze Session' && finalCta.settings.primary_link === '/pages/book-a-snooze-session', `${file} keeps one approved booking action`);
  check(finalCta.settings.show_secondary === false, `${file} removes the duplicate secondary CTA`);
}

const productV1 = json('templates/product.snoozepod-v1.json');
check(!productV1.sections.hero.block_order.includes('snoozer'), 'Product Page v1 defers Snoozer UI');
check(productV1.sections.hero.block_order.indexOf('buy_buttons') === productV1.sections.hero.block_order.indexOf('variant_picker') + 1, 'Add to Cart remains immediately after variant selection');
check(json('templates/product.main.json').sections.guide.disabled === true, 'legacy product guidance remains recoverable but inactive');

const contentPage = read('sections/main-page.liquid');
check(!contentPage.includes('href="#"') && !contentPage.includes('data-snoozer-trigger'), 'content pages contain no dead Snoozer placeholder');
check(contentPage.includes('Browse all sleep guides'), 'content pages keep one useful onward path');

const systems = read('assets/snoozepod-curated-bundles.js');
for (const control of ['data-system-size', 'data-system-base', 'data-system-comfort="left"', 'data-system-comfort="right"']) {
  check(systems.includes(control), `Sleep Systems preserves ${control}`);
}
check(systems.includes('Mattress on display: Pod 1') && systems.includes('Mattress on display: Pods 5 & 6'), 'Sleep Systems uses accurate model-level Pod language');

const collectionGrid = read('sections/main-collection-product-grid.liquid');
check(collectionGrid.includes('Shop this size by category'), 'storewide size collections expose category shortcuts above the products');
check(collectionGrid.includes('category_collection.products_count > 0'), 'empty size/category shortcuts remain hidden');
check(collectionGrid.includes('data-collection-handle="mattresses"') && collectionGrid.includes('width: 100%'), 'mobile mattress cards use a premium single-column layout');

check(!read('snippets/snoozepod-mattress-product-information.liquid').includes('Showroom Location'), 'product details do not repeat the hero Pod badge');
check(read('layout/theme.liquid').includes('MySnoozePod | Mattresses, Sleep Systems &amp; Private Showroom'), 'homepage has a descriptive browser title');
check(read('sections/snoozepod-footer-navigation.liquid').includes("request.page_type == 'cart'"), 'cart suppresses the repeated footer booking banner');

console.log(`PASS storefront polish pass 1: ${assertions} assertions.`);
