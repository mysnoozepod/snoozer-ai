#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPodBuilderModule } = require('./loadPodBuilderModule');

const builder = loadPodBuilderModule();

function variant(id, title, available = true) {
  const values = title.split(' / ');
  return {
    id,
    title,
    option1: values[0],
    option2: values[1] || null,
    available,
    price: 10000,
  };
}

const catalogs = {
  base: [],
  protection: [
    {
      kind: 'product',
      key: 'protector',
      title: 'Protector',
      variants: [variant(11, 'Queen'), variant(12, 'King')],
    },
  ],
  pillow: [
    {
      kind: 'product',
      key: 'pillow-a',
      title: 'Pillow A',
      variants: [variant(21, 'Queen'), variant(22, 'King')],
    },
    {
      kind: 'product',
      key: 'pillow-b',
      title: 'Pillow B',
      variants: [variant(23, 'Queen / High'), variant(24, 'Queen / Low')],
    },
  ],
  bedding: [
    {
      kind: 'product',
      key: 'sheets',
      title: 'Sheets',
      variants: [variant(31, 'Queen / White'), variant(32, 'King / White')],
    },
  ],
};

const state = { size: 'Queen', protection: '', pillow: '', bedding: '' };
const sizeOptions = [{ key: 'Queen', title: 'Queen', kind: 'size' }];

const pillowOptions = builder.getStepOptions('pillow', state, catalogs, sizeOptions);
const realPillows = pillowOptions.filter((option) => option.kind === 'product');
assert.equal(realPillows.length, 4, 'All eligible pillow variants must be exposed, not only the first collection item.');
assert.deepEqual(realPillows.map((option) => option.key), [
  'pillow-a::21',
  'pillow-a::22',
  'pillow-b::23',
  'pillow-b::24',
]);
assert.equal(pillowOptions.at(-1).key, 'skip_pillow');
assert.equal(builder.resolveAddonVariant(realPillows[3], ''), realPillows[3].variants[0]);

const protectionOptions = builder.getStepOptions('protection', state, catalogs, sizeOptions);
const realProtection = protectionOptions.filter((option) => option.kind === 'product');
assert.deepEqual(realProtection.map((option) => option.key), ['protector::11']);
assert.equal(builder.resolveAddonVariant(realProtection[0], 'Queen').id, 11);

const beddingOptions = builder.getStepOptions('bedding', state, catalogs, sizeOptions);
assert.deepEqual(
  beddingOptions.filter((option) => option.kind === 'product').map((option) => option.key),
  ['sheets::31'],
  'Bedding choices must filter to an exact size variant.',
);

assert.equal(
  builder.resolveAddonVariant({ kind: 'product', variants: [variant(41, 'King')] }, 'Queen'),
  null,
  'A missing size match must fail closed instead of falling back to the first variant.',
);
assert.equal(
  builder.resolveAddonVariant({ kind: 'product', variants: [variant(42, 'Queen / White'), variant(43, 'Queen / Grey')] }, 'Queen'),
  null,
  'An ambiguous same-size match must fail closed instead of selecting an arbitrary color.',
);
assert.equal(
  builder.resolveAddonVariant({ kind: 'product', variants: [variant(44, 'Queen'), variant(45, 'King')] }, ''),
  null,
  'A multi-variant product without an explicit choice must not select the first variant.',
);

const liquidPath = path.resolve(__dirname, '..', 'snippets', 'snoozepod-guided-pod-builder-core.liquid');
const liquid = fs.readFileSync(liquidPath, 'utf8');
assert.match(liquid, /base_collection_handles = 'adjustable-bases'/);
assert.match(liquid, /pillow_collection_handles = 'pillows'/);
assert.doesNotMatch(liquid, /adjustable-bases,bases/);
assert.doesNotMatch(liquid, /shoulder-pillows,zoned-pillows,gel-dough-pillows,latex-pillows,filled-pillows,pillows/);
assert.doesNotMatch(liquid, /protector_handles =/);
assert.match(liquid, /publication_readiness == 'READY'/);
assert.match(liquid, /product_builder_roles contains 'pillow'/);

const jsPath = path.resolve(__dirname, '..', 'assets', 'snoozepod-pod-builder.js');
const js = fs.readFileSync(jsPath, 'utf8');
assert.doesNotMatch(js, /ADDON_STEP_LIMITS/);
assert.doesNotMatch(js, /return firstAvailableVariant\(variants\)/);

const sectionPath = path.resolve(__dirname, '..', 'sections', 'snoozepod-guided-pod-builder.liquid');
const section = fs.readFileSync(sectionPath, 'utf8');
assert.match(section, /render 'snoozepod-guided-pod-builder-core'/);

console.log('Pod Builder discovery contract: PASS (all eligible choices, exact variants, fail-closed matching).');
