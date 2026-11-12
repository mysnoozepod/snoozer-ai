import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (file) => JSON.parse(read(file).replace(/^\/\*[\s\S]*?\*\//, '').trim());
let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };

const collection = json('templates/collection.snoozepod-v1.json');
const collectionBanner = read('sections/main-collection-banner.liquid');
const productHero = read('sections/snoozepod-product-hero.liquid');
const variantOptions = read('snippets/product-variant-options.liquid');
const buyButtons = read('snippets/buy-buttons.liquid');
const dualCss = read('assets/component-snoozepod-commerce-v1.css');
const dualJs = read('assets/snoozepod-dual-comfort.js');
const systems = read('sections/snoozepod-curated-bundles.liquid');
const systemsJs = read('assets/snoozepod-curated-bundles.js');
const showroom = read('snippets/snoozepod-showroom-location.liquid');
const mattressInformation = read('snippets/snoozepod-mattress-product-information.liquid');
const stager = read('scripts/stage-curated-bundles.mjs');

check(!collection.sections['guided-shopping'] && !collection.order.includes('guided-shopping'), 'unfinished Find Your Fit tools are absent from collections');
check(collectionBanner.includes("display_title = display_size | append: ' Size'") && collectionBanner.includes('Products currently available in'), 'storewide size collections use a concise non-redundant heading');

check(productHero.includes('exclude_system_mattress_sizes: true'), 'standard mattress PDPs request system-only size filtering');
check(variantOptions.includes("product.type == 'Mattress'") && variantOptions.includes("value contains 'Split'"), 'split mattress geometries are removed from standalone variant controls');
check(productHero.includes('/pages/sleep-systems') && productHero.includes('stay compatible'), 'standalone mattress pages direct split shoppers to Sleep Systems');
check(buyButtons.includes('selected_variant_override') && buyButtons.includes('value="{{ selected_variant.id }}"'), 'direct system-only URLs cannot leave an unsafe initial cart variant');

check(dualCss.includes('white-space: nowrap') && dualCss.includes('border-radius: 12px'), 'Dual Comfort choices use aligned premium tiles rather than wrapping pills');
check(dualCss.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'), 'Dual Comfort choices use a consistent two-column grid');
check(dualJs.includes('Your comfort: ${left} left · ${right} right'), 'Dual Comfort exposes a clear selected-pair summary');

check(systems.includes('data-system-path="standard"') && systems.includes('data-system-path="split_head"') && systems.includes('data-system-path="full_split"'), 'Sleep Systems begins with three intentional geometry paths');
check(systems.includes('Featured in Pods 2 &amp; 3'), 'Split Head is the signature featured system');
check(!systems.includes('data-bundle-grid="BEDDING_SET"') && !systems.includes('Exact component variants'), 'bedding catalog content no longer competes with system selection');
check(systemsJs.includes('SHOWROOM_LOCATIONS') && systemsJs.includes('Try it in Pods 5 & 6'), 'system cards connect every mattress to its showroom Pods');

for (const pod of ['Pod 1', 'Pod 2', 'Pod 3', 'Pod 4', 'Pod 5', 'Pod 6']) check(stager.includes(pod), `${pod} is recorded in the structured Shopify showroom contract`);
check(stager.includes("'dri-tec-sheet-set': 'BEDGEAR Dri-Tec sheets in Light Grey on a bed'") && stager.includes("'ver-tex-sheet-set': 'BEDGEAR Ver-Tex White sheets in a bedroom'"), 'text-heavy sheet graphics are replaced as lead media by existing clean photography');
check(!showroom.includes('showroom_data.locations') && !showroom.includes('location.comforts'), 'product badges render only the concise Pod location label');
check(!mattressInformation.includes('showroom_locations') && !mattressInformation.includes('location.mattressSize'), 'lower mattress details omit size, base, and comfort display clutter');
check(systemsJs.includes('data-system-comfort="left"') && systemsJs.includes('data-system-comfort="right"'), 'Dual Comfort Sleep Systems collect independent left and right preferences');
check(systemsJs.includes('"Left Side Comfort"') && systemsJs.includes('"Right Side Comfort"'), 'Sleep System cart lines preserve both Dual Comfort choices');
check(!mattressInformation.includes("Manufacturer's Model Name") && !mattressInformation.includes('manufacturer_model'), 'internal mattress model codes stay out of customer-facing details');

console.log(`PASS storefront strategy implementation: ${assertions} assertions.`);
