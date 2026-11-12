import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PRODUCT_METAFIELD_DEFINITIONS } from '../content/product-knowledge-contract.mjs';
import { MATTRESS_CUSTOMER_NAMING } from '../content/mattress-customer-naming.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const json = (relative) => JSON.parse(read(relative).replace(/^\s*\/\*[\s\S]*?\*\//, ''));
const mattressSnippet = read('snippets/snoozepod-mattress-product-information.liquid');
const genericSnippet = read('snippets/snoozepod-product-knowledge.liquid');
const informationSection = read('sections/snoozepod-product-information-v1.liquid');
const feelSnippet = read('snippets/snoozepod-product-feel.liquid');
const hero = read('sections/snoozepod-product-hero.liquid');
const cta = read('sections/snoozepod-product-cta.liquid');
const related = read('sections/related-products.liquid');
const variantCss = read('assets/component-product-variant-picker.css');
const template = json('templates/product.snoozepod-v1.json');
const inventory = json('docs/product-knowledge/PRODUCT_KNOWLEDGE_INVENTORY.json');

let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions += 1; };

const feelDefinition = PRODUCT_METAFIELD_DEFINITIONS.find((entry) => entry.namespace === 'custom' && entry.key === 'feel_label');
check(feelDefinition?.type === 'single_line_text_field', 'feel is a structured Shopify product field');
check(feelDefinition.validations[0]?.value === '["Plush","Medium Plush","Medium Firm","Firm"]', 'feel choices are constrained to the four approved values');

const sectionNames = [...mattressSnippet.matchAll(/data-mattress-information-section="([^"]+)"/g)].map((match) => match[1]);
check(sectionNames.join('|') === 'product-details|sleep-trial|delivery|warranty|feel', 'mattress information sections have the approved order');
for (const heading of ['Construction', 'Features &amp; Benefits', 'Showroom Location']) {
  check(mattressSnippet.includes(`>${heading}<`), `Product Details implements ${heading}`);
}
check(mattressSnippet.includes("pages['90-day-sleep-trial']") && mattressSnippet.includes("pages['shipping-policy']"), 'approved Shopify policy pages are reused');
check(mattressSnippet.includes('snoozepod_technical.warranty_information'), 'product warranty uses the existing verified warranty field');
check(mattressSnippet.includes('custom.showroom_representation'), 'showroom placement uses the existing structured field');
check(!/\b(?:S7|H6|M3|M5)\b/.test(mattressSnippet), 'product-specific model values are not hardcoded in the theme');
check(!mattressSnippet.includes("Manufacturer's Model Name") && !mattressSnippet.includes('manufacturer_model'), 'internal mattress manufacturer/model identity is not rendered to customers');
check(informationSection.includes("product_category == 'mattress'") && informationSection.includes("render 'snoozepod-mattress-product-information'"), 'mattresses use the dedicated five-section renderer');
check(informationSection.includes("render 'snoozepod-product-knowledge'") && genericSnippet.includes("when 'adjustable_base'"), 'non-mattress category rendering is preserved');

check(!feelSnippet.includes('feel_position_raw') && feelSnippet.includes("when 'Plush'") && feelSnippet.includes("when 'Firm'"), 'feel indicator derives safely from the controlled value');
check(template.sections.hero.block_order.indexOf('feel') === template.sections.hero.block_order.indexOf('price') + 1, 'verified feel sits next to price');
check(template.sections['final-cta'].settings.primary_label === 'Book a Snooze Session', 'booking is the primary lower CTA');
check(template.sections['final-cta'].settings.secondary_label === 'Ask Snoozer', 'Ask Snoozer is the secondary lower CTA');
check(cta.includes('data-snoozer-source="product-final-cta"'), 'secondary Ask Snoozer remains wired to the existing integration');

check(variantCss.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'), 'mobile pill options use a two-column layout');
check(hero.includes('scroll-snap-type: inline mandatory') && hero.includes('min-width: 100%'), 'mobile gallery presents one swipeable primary image at a time');
check(related.includes('overflow-x: auto') && related.includes('scroll-snap-align: start'), 'mobile related products use a swipeable carousel');

check(MATTRESS_CUSTOMER_NAMING.every((product) => /^\d+"/.test(product.title) && /^\d+"/.test(product.menuTitle)), 'all customer-facing mattress names use inch-symbol formatting');
check(MATTRESS_CUSTOMER_NAMING.every((product) => product.mediaAlts.every((alt) => !/\b\d+[ -]inch\b/i.test(alt))), 'mattress image alt text uses inch-symbol formatting');
check(inventory.products.length === 43 && inventory.products.every((product) => product.templateSuffix === 'snoozepod-v1'), 'all 43 products retain Product Page v1');
for (const type of ['Mattress', 'Adjustable Base', 'Pillow', 'Sheet Set']) {
  check(inventory.products.some((product) => product.productType === type), `inventory retains a representative ${type}`);
}

console.log(`PASS product page refinement v2: ${assertions} assertions.`);
