import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { customerFilterContract, guidedShoppingPages, organizationTagPrefixes } from '../content/guided-shopping.mjs';
import { footerMenuContract, mainMenuContract } from '../content/content-navigation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const loadJson = (relativePath) => JSON.parse(read(relativePath).replace(/^\/\*[\s\S]*?\*\//, '').trim());

assert.equal(guidedShoppingPages.length, 10, 'expected the tools hub plus nine focused tools');
assert.equal(new Set(guidedShoppingPages.map((page) => page.handle)).size, 10, 'tool handles must be unique');
assert.equal(new Set(guidedShoppingPages.map((page) => page.templateSuffix)).size, 10, 'tool templates must be unique');

for (const page of guidedShoppingPages) {
  const templatePath = `templates/page.${page.templateSuffix}.json`;
  assert.ok(fs.existsSync(path.join(ROOT, templatePath)), `${templatePath} should exist`);
  const template = loadJson(templatePath);
  assert.equal(template.sections.main.type, 'snoozepod-guided-tools', `${page.handle} should use the shared tool section`);
  assert.equal(template.sections.main.settings.tool_type, page.toolType, `${page.handle} should use the correct tool type`);
}

const section = read('sections/snoozepod-guided-tools.liquid');
assert.match(section, /aria-live="polite"/, 'tool results should use an accessible live region');
assert.match(section, /data-guided-catalog/, 'tools should consume the Shopify-rendered catalog');
assert.match(section, /collections\['mattresses'\]\.products/, 'the builder catalog should come from Shopify collections');
assert.match(section, /metafields\.custom\.compatibility_status/, 'compatibility evidence should come from Shopify metafields');

const script = read('assets/snoozepod-guided-tools.js');
assert.match(script, /mysnoozepod\.guided-plan\.v1/, 'tools should preserve the current plan');
assert.match(script, /Pending product-level verification/, 'unknown compatibility should remain pending');
assert.match(script, /No accessory or unverified configuration was automatically added to cart/, 'builder should explain its fail-closed behavior');
assert.doesNotMatch(script, /cart\/add|routes\.cart_add|\/cart\/change/, 'planning tools must not bypass standard product/cart verification');

const builderFields = read('snippets/snoozepod-tool-fields-builder.liquid');
for (const role of ['base', 'protection', 'pillows', 'bedding']) assert.match(builderFields, new RegExp(`${role}\\|`, 'i'), `builder should expose optional ${role}`);
for (const comfort of ['Soft', 'Medium Soft', 'Medium Firm', 'Firm']) {
  assert.match(read('snippets/snoozepod-tool-fields-dual-comfort.liquid'), new RegExp(comfort), `dual comfort should expose ${comfort}`);
}

assert.equal(customerFilterContract.length, 10, 'customer filter contract should stay focused');
assert.deepEqual(organizationTagPrefixes, ['collection', 'category', 'subcategory', 'type', 'feature', 'material', 'comfort']);
assert.ok(customerFilterContract.every((filter) => filter.authority), 'every customer filter needs a source of truth');

const homepage = loadJson('templates/index.json');
assert.equal(homepage.sections['guided-shopping'].type, 'snoozepod-guided-shopping-links');
assert.ok(homepage.order.indexOf('guided-shopping') > homepage.order.indexOf('value-strip'), 'homepage tools should follow the trust strip');
assert.ok(homepage.order.indexOf('guided-shopping') < homepage.order.indexOf('snoozepod_environment_GYx7gN'), 'homepage tools should lead into category shopping');

const collection = loadJson('templates/collection.snoozepod-v1.json');
assert.equal(collection.sections['guided-shopping'].type, 'snoozepod-guided-shopping-links');
assert.ok(collection.order.indexOf('guided-shopping') < collection.order.indexOf('product-grid'), 'collection guidance should precede the product grid');
assert.equal(collection.sections['product-grid'].settings.enable_filtering, true, 'native Shopify filters should remain enabled');

const linksSection = read('sections/snoozepod-guided-shopping-links.liquid');
assert.match(linksSection, /comfort-memory-foam/, 'mattress quick filters should use exact namespaced tag handles');
assert.match(linksSection, /Pillow Finder/, 'collection guidance should expose the pillow finder');
assert.match(linksSection, /Compatibility Checker/, 'collection guidance should expose compatibility checking');

const flatten = (items) => items.flatMap((item) => [item, ...flatten(item.items || [])]);
const mainItems = flatten(mainMenuContract.items);
const footerItems = flatten(footerMenuContract.items);
for (const page of guidedShoppingPages) {
  const route = `/pages/${page.handle}`;
  assert.ok(mainItems.some((item) => item.url?.endsWith(route)) || footerItems.some((item) => item.url?.endsWith(route)), `${page.handle} should be reachable from managed navigation`);
}
assert.ok(mainItems.some((item) => item.title === 'Guides & Tools'), 'main navigation should present Guides & Tools');

const readbackPath = path.join(ROOT, 'docs', 'guided-shopping', 'GUIDED_SHOPPING_SHOPIFY_READBACK.json');
if (fs.existsSync(readbackPath)) {
  const readback = JSON.parse(fs.readFileSync(readbackPath, 'utf8'));
  assert.equal(readback.summary.publishedToolPages, 10);
  assert.equal(readback.summary.verifiedThemes, 2);
  assert.equal(readback.summary.assetsPerTheme, 25);
}

console.log('Guided shopping: PASS (10 tool pages, shared Shopify data contract, homepage/collection routing, fail-closed compatibility, and accessible saved plans).');

