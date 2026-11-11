import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const INVENTORY = path.join(ROOT, 'docs', 'catalog', 'catalog-shopping-restructure-current-inspection.json');
const OUTPUT_DIR = path.join(ROOT, 'docs', 'storewide-shop-by-size');
const MANIFEST = path.join(OUTPUT_DIR, 'STOREWIDE_SIZE_COLLECTIONS_MANIFEST.json');
const THEME_MAP = path.join(ROOT, 'assets', 'snoozepod-size-collection-map.js');

const CATEGORY_CONTRACTS = [
  { key: 'mattresses', title: 'Mattresses', tag: 'collection:mattresses' },
  { key: 'adjustable-bases', title: 'Adjustable Bases', tag: 'collection:adjustable-bases' },
  { key: 'sheets', title: 'Sheets', tag: 'collection:sheets' },
  { key: 'comforters', title: 'Comforters & Duvets', tag: 'collection:comforters' },
  { key: 'cooling-bedding', title: 'Cooling & Bedding', tag: 'collection:cooling-bedding' },
  { key: 'mattress-protectors', title: 'Mattress Protectors', tag: 'collection:mattress-protectors' },
  { key: 'pillows', title: 'Pillows', tag: 'collection:pillows' },
  { key: 'mattress-toppers', title: 'Mattress Toppers', tag: 'collection:mattress-toppers' },
  { key: 'bedroom-furniture', title: 'Bedroom Furniture', tag: 'collection:bedroom-furniture' },
];

const DISPLAY_ORDER = [
  'Standard', 'Twin', 'Twin XL', 'Full', 'Full XL', 'Queen', 'King', 'California King', 'Texas King',
  'Split Head Queen', 'Split Head King', 'Split Head California King', 'Split King',
  'Split California King', 'Twin XL x 2',
];

function fail(message) { throw new Error(message); }
function slug(value) {
  return value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function normalizedLabel(value) {
  return String(value || '')
    .trim()
    .replace(/\s*\(2pc\)$/i, '')
    .replace(/Cal King/gi, 'California King')
    .replace(/\s+/g, ' ');
}
function shopSizeLabels(nativeValue) {
  const normalized = normalizedLabel(nativeValue);
  if (!normalized || normalized.toLowerCase() === 'one size') return [];
  return [...new Set(normalized.split('/').map((value) => value.trim()).filter(Boolean))];
}
function sortSizes(values) {
  return [...values].sort((left, right) => {
    const leftIndex = DISPLAY_ORDER.indexOf(left);
    const rightIndex = DISPLAY_ORDER.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    return left.localeCompare(right);
  });
}

if (!fs.existsSync(INVENTORY)) fail('Run inventory-catalog-shopping-restructure.mjs --current before building the size collection manifest.');
const inventory = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'));
if (inventory.summary.products !== 43 || inventory.summary.variants !== 274) fail('The verified 43-product / 274-variant catalog baseline changed.');

const categories = new Map(CATEGORY_CONTRACTS.map((entry) => [entry.key, { ...entry, sizes: new Map() }]));
const storewide = new Map();
const productPlans = [];
const excluded = [];

for (const product of inventory.products.nodes) {
  const category = CATEGORY_CONTRACTS.find((entry) => product.tags.includes(entry.tag));
  if (!category) fail(`${product.handle} does not match an applicable size category.`);
  const labels = new Set();
  const nativeSizes = new Set();
  for (const variant of product.variants.nodes) {
    if (!variant.availableForSale) continue;
    const sizeOption = variant.selectedOptions.find((option) => option.name.trim().toLowerCase() === 'size');
    if (!sizeOption) continue;
    nativeSizes.add(sizeOption.value);
    const mapped = shopSizeLabels(sizeOption.value);
    if (!mapped.length) excluded.push({ productHandle: product.handle, variantId: variant.id, nativeSize: sizeOption.value, reason: 'One Size does not narrow shopping.' });
    mapped.forEach((label) => labels.add(label));
  }
  if (!labels.size) continue;
  const sizeTags = sortSizes(labels).map((label) => `shop-size:${slug(label)}`);
  productPlans.push({
    productId: product.id,
    handle: product.handle,
    categoryKey: category.key,
    nativeSizes: sortSizes(nativeSizes),
    shopSizes: sortSizes(labels),
    addedTags: ['shop-by-size:true', ...sizeTags],
    desiredTags: [...new Set([...product.tags.filter((tag) => tag !== 'shop-by-size:true' && !tag.startsWith('shop-size:')), 'shop-by-size:true', ...sizeTags])].sort(),
  });
  for (const label of labels) {
    const categorySize = categories.get(category.key).sizes.get(label) || new Set();
    categorySize.add(product.handle);
    categories.get(category.key).sizes.set(label, categorySize);
    const allSize = storewide.get(label) || new Set();
    allSize.add(product.handle);
    storewide.set(label, allSize);
  }
}

function collectionRecord({ handle, title, sizeLabel = null, categoryKey = null, rules, productHandles }) {
  return {
    handle,
    title,
    sizeLabel,
    categoryKey,
    templateSuffix: 'snoozepod-v1',
    rules,
    productHandles: [...productHandles].sort(),
  };
}

const collections = [collectionRecord({
  handle: 'shop-by-size',
  title: 'Shop by Size',
  rules: [{ column: 'TAG', relation: 'EQUALS', condition: 'shop-by-size:true' }],
  productHandles: productPlans.map((product) => product.handle),
})];

const storewideSizes = sortSizes(storewide.keys());
for (const label of storewideSizes) {
  collections.push(collectionRecord({
    handle: `shop-by-size-${slug(label)}`,
    title: `Shop ${label}`,
    sizeLabel: label,
    rules: [{ column: 'TAG', relation: 'EQUALS', condition: `shop-size:${slug(label)}` }],
    productHandles: storewide.get(label),
  }));
}

const categoryOutput = [];
for (const contract of CATEGORY_CONTRACTS) {
  const category = categories.get(contract.key);
  const sizes = sortSizes(category.sizes.keys());
  if (!sizes.length) continue;
  const sizeRecords = [];
  for (const label of sizes) {
    const handle = `${contract.key}-size-${slug(label)}`;
    collections.push(collectionRecord({
      handle,
      title: `${label} ${contract.title}`,
      sizeLabel: label,
      categoryKey: contract.key,
      rules: [
        { column: 'TAG', relation: 'EQUALS', condition: contract.tag },
        { column: 'TAG', relation: 'EQUALS', condition: `shop-size:${slug(label)}` },
      ],
      productHandles: category.sizes.get(label),
    }));
    sizeRecords.push({ label, slug: slug(label), handle, productCount: category.sizes.get(label).size });
  }
  categoryOutput.push({ key: contract.key, title: contract.title, canonicalCollectionHandle: contract.key, sizes: sizeRecords });
}

if (collections.some((collection) => !collection.productHandles.length)) fail('The derived plan contains an empty collection.');
const handles = collections.map((collection) => collection.handle);
if (new Set(handles).size !== handles.length) fail('The derived plan contains duplicate collection handles.');

const themeMap = {
  schemaVersion: '1.0.0',
  masterCollectionHandle: 'shop-by-size',
  storewide: storewideSizes.map((label) => ({ label, slug: slug(label), handle: `shop-by-size-${slug(label)}`, productCount: storewide.get(label).size })),
  categories: categoryOutput,
};
const manifest = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  source: { store: inventory.shop, inventoryGeneratedAt: inventory.generatedAt, products: inventory.summary.products, variants: inventory.summary.variants, authority: 'Shopify availableForSale variants' },
  taxonomy: { productMarker: 'shop-by-size:true', sizeTagPrefix: 'shop-size:', oneSizeRule: 'Excluded because it does not narrow shopping.' },
  summary: { taggedProducts: productPlans.length, storewideSizes: storewideSizes.length, categories: categoryOutput.length, collections: collections.length, excludedOneSizeVariants: excluded.length },
  products: productPlans,
  categories: categoryOutput,
  collections,
  excluded,
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(THEME_MAP, `window.SnoozePodSizeCollections = ${JSON.stringify(themeMap, null, 2)};\n`);
console.log(JSON.stringify(manifest.summary, null, 2));
console.log(`Wrote ${path.relative(ROOT, MANIFEST)} and ${path.relative(ROOT, THEME_MAP)}.`);
