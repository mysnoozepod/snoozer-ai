import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  root,
  'docs',
  'sleep-system-cart-acceptance',
  'LIVE_CART_ACCEPTANCE.json',
);
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));

assert.equal(evidence.schema, 'mysnoozepod.sleep-system-live-cart-acceptance.v1');
assert.equal(evidence.themeId, '139216420925');
assert.equal(evidence.scope.checkoutEntered, false);
assert.equal(evidence.scope.orderCreated, false);
assert.equal(evidence.scope.initialCartPreserved, true);
assert.deepEqual(evidence.scope.consoleWarningsOrErrors, []);
assert.equal(evidence.cases.length, 4);

const expected = new Map([
  ['Standard', { itemDelta: 2, quantity: 1, total: 239899 }],
  ['Dual Comfort', { itemDelta: 2, quantity: 1, total: 449800 }],
  ['Split Head', { itemDelta: 2, quantity: 1, total: 449800 }],
  ['Split King', { itemDelta: 4, quantity: 2, total: 1069798 }],
]);

for (const cartCase of evidence.cases) {
  const contract = expected.get(cartCase.name);
  assert.ok(contract, `unexpected case: ${cartCase.name}`);
  assert.equal(cartCase.pass, true, `${cartCase.name} did not pass`);
  assert.match(cartCase.operationId, /^[0-9a-f-]{36}$/i);
  assert.equal(cartCase.addedLines.length, 2);
  assert.equal(cartCase.itemCountDelta, contract.itemDelta);
  assert.equal(cartCase.afterItemCount - cartCase.beforeItemCount, contract.itemDelta);
  assert.equal(cartCase.uiTotalCents, contract.total);
  assert.equal(cartCase.totalDeltaCents, contract.total);
  assert.equal(cartCase.afterTotalCents - cartCase.beforeTotalCents, contract.total);
  assert.equal(
    cartCase.addedLines.reduce((sum, line) => sum + line.finalLinePriceCents, 0),
    contract.total,
  );
  assert.deepEqual(
    new Set(cartCase.addedLines.map((line) => line.role)),
    new Set(['mattress', 'adjustable-base']),
  );
  for (const line of cartCase.addedLines) {
    assert.equal(line.quantity, contract.quantity);
    assert.equal(line.finalLinePriceCents, line.unitPriceCents * line.quantity);
    assert.ok(line.variantId > 0);
    assert.ok(line.productId > 0);
    assert.ok(line.sku);
    assert.equal(line.selectedSize, cartCase.selection.size);
  }
}

const dual = evidence.cases.find((cartCase) => cartCase.name === 'Dual Comfort');
const dualMattress = dual.addedLines.find((line) => line.role === 'mattress');
assert.equal(dualMattress.leftComfort, 'Medium Soft');
assert.equal(dualMattress.rightComfort, 'Firm');

const splitHead = evidence.cases.find((cartCase) => cartCase.name === 'Split Head');
assert.equal(splitHead.selection.baseLocked, true);
assert.equal(splitHead.selection.base, 'Flex SH Adjustable Base');
assert.ok(splitHead.addedLines.every((line) => line.variantTitle === 'Split Head Queen'));

const splitKing = evidence.cases.find((cartCase) => cartCase.name === 'Split King');
assert.ok(splitKing.addedLines.every((line) => line.variantTitle === 'Twin XL'));
assert.equal(splitKing.addedLines.find((line) => line.role === 'mattress').leftComfort, 'Soft');
assert.equal(splitKing.addedLines.find((line) => line.role === 'mattress').rightComfort, 'Medium Firm');

assert.equal(evidence.finalCart.baselineItemStillPresent, true);
assert.equal(evidence.finalCart.itemCount, evidence.baseline.itemCount + 10);
assert.equal(evidence.overallPass, true);

console.log('Sleep System live cart acceptance: 4/4 cases passed; 10 requested units reconciled.');
