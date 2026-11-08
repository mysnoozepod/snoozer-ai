import fs from 'node:fs';
import path from 'node:path';
import { mainMenuContract } from '../content/content-navigation.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const INPUT = path.join(ROOT, 'docs', 'catalog', 'catalog-shopping-restructure-before.json');
const OUTPUT = path.join(ROOT, 'docs', 'catalog', 'CATALOG_SHOPPING_RESTRUCTURE_MANIFEST.json');

function fail(message) {
  throw new Error(message);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function typeTag(productType) {
  return `type:${productType.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
}

const before = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
if (before.summary.products !== 43 || before.summary.draftProducts !== 43 || before.summary.variants !== 274) {
  fail('Expected the verified 43-product / 274-variant Draft catalog.');
}
if (before.summary.taggedProducts !== 0 || before.summary.automatedCollections !== 0 || before.summary.manualCollections !== 18) {
  fail('The before snapshot does not match the expected untagged 18-manual-collection baseline.');
}

const customerHandleMigrations = {
  'bedgear-s7-12-memory-foam': '12-inch-memory-foam-mattress',
  'bedgear-h6-12-hybrid': '12-inch-hybrid-mattress',
  'bedgear-m3-12-dual-comfort': '12-inch-dual-comfort-mattress',
  'bedgear-m5-14-dual-comfort': '14-inch-dual-comfort-mattress',
};
const customerTitles = {
  '12-inch-memory-foam-mattress': '12" Memory Foam Mattress',
  '12-inch-hybrid-mattress': '12" Hybrid Mattress',
  '12-inch-dual-comfort-mattress': '12" Dual Comfort Mattress',
  '14-inch-dual-comfort-mattress': '14" Dual Comfort Mattress',
};
const baselineProducts = before.products.nodes.map((product) => {
  const handle = customerHandleMigrations[product.handle] || product.handle;
  return { ...product, handle, title: customerTitles[handle] || product.title };
});

const groups = {
  mattresses: [
    '12-inch-memory-foam-mattress',
    '12-inch-hybrid-mattress',
    '12-inch-dual-comfort-mattress',
    '14-inch-dual-comfort-mattress',
  ],
  s7: ['12-inch-memory-foam-mattress'],
  h6: ['12-inch-hybrid-mattress'],
  m3: ['12-inch-dual-comfort-mattress'],
  m5: ['14-inch-dual-comfort-mattress'],
  'adjustable-bases': ['flex-l-adjustable-base', 'flex-lsx-adjustable-base', 'flex-sh-adjustable-base'],
  'flex-l': ['flex-l-adjustable-base'],
  'flex-lsx': ['flex-lsx-adjustable-base'],
  'flex-sh': ['flex-sh-adjustable-base'],
  pillows: [
    'bamboo-charcoal-pillow-cooling-cover',
    'carboncool-omniphase-pillow',
    'convolution-pillow',
    'gel-convolution-pillow',
    'gel-dough-z-gel-pillow',
    'gelled-microfiber-pillow',
    'hexcurve-omniphase-pillow',
    'ice-cloud-omniphase-pillow',
    'quilted-convolution-hyperchill-pillow',
    'shoulder-zoned-gel-activedough-pillow',
    'weekender-gel-memory-foam-pillow',
    'zoned-activedough-bamboo-charcoal-pillow',
    'zoned-dough-bamboo-charcoal-pillow',
    'zoned-gel-activedough-pillow',
    'zoned-gel-dough-pillow',
    'zoned-talalay-latex-pillow',
  ],
  'zoned-pillows': [
    'shoulder-zoned-gel-activedough-pillow',
    'zoned-activedough-bamboo-charcoal-pillow',
    'zoned-dough-bamboo-charcoal-pillow',
    'zoned-gel-dough-pillow',
  ],
  'filled-pillows': [
    'convolution-pillow',
    'gel-convolution-pillow',
    'gelled-microfiber-pillow',
    'quilted-convolution-hyperchill-pillow',
  ],
  'foam-pillows': [
    'bamboo-charcoal-pillow-cooling-cover',
    'hexcurve-omniphase-pillow',
    'weekender-gel-memory-foam-pillow',
    'zoned-talalay-latex-pillow',
  ],
  'temperature-regulating-pillows': [
    'carboncool-omniphase-pillow',
    'gel-dough-z-gel-pillow',
    'ice-cloud-omniphase-pillow',
    'zoned-gel-activedough-pillow',
  ],
  sheets: ['cotton-sheet-set', 'dri-tec-sheet-set', 'ver-tex-sheet-set'],
  'sheet-sets': ['cotton-sheet-set', 'dri-tec-sheet-set', 'ver-tex-sheet-set'],
  'mattress-protectors': ['dri-tec-mattress-protector', 'stretchwick-mattress-encasement', 'ver-tex-mattress-protector'],
  comforters: ['light-weight-comforter', 'medium-weight-comforter', 'ultra-weight-comforter'],
  'cooling-bedding': ['cooling-performance-throw', 'light-grey-racetrack-duvet-sham-set', 'solid-white-duvet-sham-set'],
  'mattress-toppers': ['malouf-2-5-inch-gel-memory-foam-topper', 'react-pro-performance-topper'],
  'bedroom-furniture': [
    'blackwell-designer-headboard',
    'carlisle-upholstered-headboard',
    'eastman-upholstered-platform-base',
    'hennessy-upholstered-headboard',
    'scoresby-designer-headboard',
    'watson-upholstered-platform-base',
  ],
  furniture: [
    'blackwell-designer-headboard',
    'carlisle-upholstered-headboard',
    'eastman-upholstered-platform-base',
    'hennessy-upholstered-headboard',
    'scoresby-designer-headboard',
    'watson-upholstered-platform-base',
  ],
  headboards: [
    'blackwell-designer-headboard',
    'carlisle-upholstered-headboard',
    'hennessy-upholstered-headboard',
    'scoresby-designer-headboard',
  ],
  'platform-bases': ['eastman-upholstered-platform-base', 'watson-upholstered-platform-base'],
};

groups.bedding = uniqueSorted([
  ...groups.sheets,
  ...groups['mattress-protectors'],
  ...groups.comforters,
  ...groups['cooling-bedding'],
  ...groups['mattress-toppers'],
]);

const expectedHandles = new Set(baselineProducts.map((product) => product.handle));
for (const [group, handles] of Object.entries(groups)) {
  for (const handle of handles) if (!expectedHandles.has(handle)) fail(`Unknown product ${handle} in ${group}.`);
}

const categoryByCollection = {
  mattresses: 'mattresses',
  s7: 'mattresses',
  h6: 'mattresses',
  m3: 'mattresses',
  m5: 'mattresses',
  'adjustable-bases': 'adjustable-bases',
  'flex-l': 'adjustable-bases',
  'flex-lsx': 'adjustable-bases',
  'flex-sh': 'adjustable-bases',
  pillows: 'pillows',
  'zoned-pillows': 'pillows',
  'filled-pillows': 'pillows',
  'foam-pillows': 'pillows',
  'temperature-regulating-pillows': 'pillows',
  bedding: 'bedding',
  sheets: 'bedding',
  'sheet-sets': 'bedding',
  'mattress-protectors': 'bedding',
  comforters: 'bedding',
  'cooling-bedding': 'bedding',
  'mattress-toppers': 'bedding',
  'bedroom-furniture': 'bedroom-furniture',
  furniture: 'bedroom-furniture',
  headboards: 'bedroom-furniture',
  'platform-bases': 'bedroom-furniture',
};

const subcategoryTags = {
  s7: 'subcategory:s7',
  h6: 'subcategory:h6',
  m3: 'subcategory:m3',
  m5: 'subcategory:m5',
  'flex-l': 'subcategory:flex-l',
  'flex-lsx': 'subcategory:flex-lsx',
  'flex-sh': 'subcategory:flex-sh',
  'zoned-pillows': 'subcategory:zoned',
  'filled-pillows': 'subcategory:filled',
  'foam-pillows': 'subcategory:foam',
  'temperature-regulating-pillows': 'subcategory:temperature-regulating',
  sheets: 'subcategory:sheets',
  'mattress-protectors': 'subcategory:mattress-protectors',
  comforters: 'subcategory:comforters',
  'cooling-bedding': 'subcategory:cooling-bedding',
  'mattress-toppers': 'subcategory:mattress-toppers',
  headboards: 'subcategory:headboards',
  'platform-bases': 'subcategory:platform-bases',
};

const verifiedAttributeTags = {
  '12-inch-memory-foam-mattress': ['comfort:memory-foam', 'material:memory-foam', 'feature:foam-construction'],
  '12-inch-hybrid-mattress': ['comfort:hybrid', 'feature:hybrid-construction'],
  '12-inch-dual-comfort-mattress': ['comfort:dual-comfort', 'feature:dual-comfort', 'feature:independent-side-comfort', 'feature:modular-comfort'],
  '14-inch-dual-comfort-mattress': ['comfort:dual-comfort', 'feature:dual-comfort', 'feature:independent-side-comfort', 'feature:modular-comfort'],
  'flex-l-adjustable-base': ['feature:adjustable'],
  'flex-lsx-adjustable-base': ['feature:adjustable'],
  'flex-sh-adjustable-base': ['feature:adjustable', 'feature:split-head'],
  'bamboo-charcoal-pillow-cooling-cover': ['comfort:cooling', 'material:bamboo-charcoal', 'material:foam', 'feature:cooling-cover'],
  'carboncool-omniphase-pillow': ['comfort:temperature-regulating', 'comfort:cooling', 'feature:carboncool', 'feature:omniphase'],
  'convolution-pillow': ['feature:convolution', 'feature:filled'],
  'gel-convolution-pillow': ['material:gel', 'feature:convolution', 'feature:filled'],
  'gel-dough-z-gel-pillow': ['comfort:cooling', 'material:dough-foam', 'material:gel'],
  'gelled-microfiber-pillow': ['material:gel', 'material:microfiber', 'feature:filled'],
  'hexcurve-omniphase-pillow': ['comfort:temperature-regulating', 'material:foam', 'feature:hexcurve', 'feature:omniphase'],
  'ice-cloud-omniphase-pillow': ['comfort:temperature-regulating', 'comfort:cooling', 'feature:omniphase'],
  'quilted-convolution-hyperchill-pillow': ['comfort:cooling', 'feature:convolution', 'feature:filled', 'feature:hyperchill', 'feature:quilted'],
  'shoulder-zoned-gel-activedough-pillow': ['material:activedough', 'material:gel', 'feature:shoulder-cutout', 'feature:zoned'],
  'weekender-gel-memory-foam-pillow': ['material:gel-memory-foam', 'material:memory-foam'],
  'zoned-activedough-bamboo-charcoal-pillow': ['material:activedough', 'material:bamboo-charcoal', 'feature:zoned'],
  'zoned-dough-bamboo-charcoal-pillow': ['material:bamboo-charcoal', 'material:dough-foam', 'feature:zoned'],
  'zoned-gel-activedough-pillow': ['comfort:cooling', 'material:activedough', 'material:gel', 'feature:zoned'],
  'zoned-gel-dough-pillow': ['material:dough-foam', 'material:gel', 'feature:zoned'],
  'zoned-talalay-latex-pillow': ['material:talalay-latex', 'feature:zoned'],
  'cotton-sheet-set': ['material:cotton'],
  'dri-tec-sheet-set': ['feature:dri-tec'],
  'ver-tex-sheet-set': ['feature:ver-tex'],
  'dri-tec-mattress-protector': ['feature:dri-tec', 'feature:mattress-protection'],
  'stretchwick-mattress-encasement': ['feature:mattress-protection', 'feature:six-sided-encasement'],
  'ver-tex-mattress-protector': ['feature:ver-tex', 'feature:mattress-protection'],
  'light-weight-comforter': ['comfort:light-weight'],
  'medium-weight-comforter': ['comfort:medium-weight'],
  'ultra-weight-comforter': ['comfort:ultra-weight'],
  'cooling-performance-throw': ['comfort:cooling', 'feature:performance-throw'],
  'light-grey-racetrack-duvet-sham-set': ['feature:duvet-sham-set', 'feature:racetrack'],
  'solid-white-duvet-sham-set': ['feature:duvet-sham-set'],
  'malouf-2-5-inch-gel-memory-foam-topper': ['material:gel-memory-foam', 'material:memory-foam'],
  'react-pro-performance-topper': ['feature:performance-topper'],
  'blackwell-designer-headboard': ['feature:upholstered'],
  'carlisle-upholstered-headboard': ['feature:upholstered'],
  'hennessy-upholstered-headboard': ['feature:upholstered'],
  'scoresby-designer-headboard': ['feature:upholstered'],
  'eastman-upholstered-platform-base': ['feature:upholstered'],
  'watson-upholstered-platform-base': ['feature:upholstered'],
};

const membershipsByProduct = new Map(baselineProducts.map((product) => [product.handle, []]));
for (const [collectionHandle, handles] of Object.entries(groups)) {
  for (const handle of handles) membershipsByProduct.get(handle).push(collectionHandle);
}

const products = baselineProducts.map((product) => {
  const memberships = uniqueSorted(membershipsByProduct.get(product.handle));
  const categories = uniqueSorted(memberships.map((handle) => categoryByCollection[handle]));
  if (categories.length !== 1) fail(`${product.handle} resolves to ${categories.length} categories.`);
  const tags = uniqueSorted([
    `category:${categories[0]}`,
    typeTag(product.productType),
    ...memberships.map((handle) => `collection:${handle}`),
    ...memberships.map((handle) => subcategoryTags[handle]),
    ...(verifiedAttributeTags[product.handle] || []),
  ]);
  return {
    id: product.id,
    legacyResourceId: product.legacyResourceId,
    handle: product.handle,
    title: product.title,
    status: product.status,
    productType: product.productType,
    currentTemplateSuffix: product.templateSuffix,
    desiredTemplateSuffix: product.productType === 'Mattress' ? 'snoozepod-v1' : product.templateSuffix,
    memberships,
    tags,
  };
});

const currentCollections = new Map(before.collections.nodes.map((collection) => [collection.handle, collection]));
const newCollectionTitles = {
  s7: 'S7 Mattresses',
  h6: 'H6 Mattresses',
  m3: 'M3 Dual Comfort Mattresses',
  m5: 'M5 Dual Comfort Mattresses',
  'flex-l': 'Flex L Adjustable Bases',
  'flex-lsx': 'Flex LSX Adjustable Bases',
  'flex-sh': 'Flex SH Adjustable Bases',
};
const imageFallbackCollections = {
  s7: 'mattresses',
  h6: 'mattresses',
  m3: 'mattresses',
  m5: 'mattresses',
  'flex-l': 'adjustable-bases',
  'flex-lsx': 'adjustable-bases',
  'flex-sh': 'adjustable-bases',
};
const collections = Object.entries(groups).map(([handle, expectedProducts]) => {
  const current = currentCollections.get(handle);
  const sourceProduct = baselineProducts.find((product) => expectedProducts.includes(product.handle) && product.media.nodes.length);
  const fallbackCollection = currentCollections.get(imageFallbackCollections[handle]);
  return {
    handle,
    title: current?.title || newCollectionTitles[handle] || fail(`Missing title for ${handle}.`),
    descriptionHtml: current?.descriptionHtml || '',
    templateSuffix: current?.templateSuffix || 'snoozepod-v1',
    sortOrder: current?.sortOrder || 'BEST_SELLING',
    image: current?.image || sourceProduct?.media.nodes.find((media) => media.status === 'READY')?.image || fallbackCollection?.image || null,
    ruleTag: `collection:${handle}`,
    expectedProducts: uniqueSorted(expectedProducts),
    replacesManualCollectionId: current?.id || null,
  };
});

const menu = mainMenuContract;

const manifest = {
  schemaVersion: '1.0',
  generatedAt: new Date().toISOString(),
  shop: before.shop,
  catalogBaseline: { products: 43, variants: 274, draftProducts: 43, manualCollections: 18 },
  taxonomy: {
    namespaces: {
      category: 'Top-level merchandising department.',
      subcategory: 'Customer-facing subcategory or named product family.',
      type: 'Normalized Shopify product type.',
      collection: 'Exact automated-collection membership driver.',
      comfort: 'Verified comfort characteristic.',
      material: 'Verified named material or construction material.',
      feature: 'Verified functional or construction feature.',
    },
    matchingRule: 'Every automated collection uses one exact TAG EQUALS collection:<handle> rule.',
  },
  products,
  collections,
  categoryNavigation: Object.fromEntries([
    ...['mattresses', 's7', 'h6', 'm3', 'm5'].map((handle) => [handle, ['s7', 'h6', 'm3', 'm5']]),
    ...['adjustable-bases', 'flex-l', 'flex-lsx', 'flex-sh'].map((handle) => [handle, ['flex-l', 'flex-lsx', 'flex-sh']]),
    ...['pillows', 'zoned-pillows', 'filled-pillows', 'foam-pillows', 'temperature-regulating-pillows']
      .map((handle) => [handle, ['zoned-pillows', 'filled-pillows', 'foam-pillows', 'temperature-regulating-pillows']]),
    ...['bedding', 'sheets', 'sheet-sets', 'mattress-protectors', 'comforters', 'cooling-bedding', 'mattress-toppers']
      .map((handle) => [handle, ['sheets', 'mattress-protectors', 'comforters', 'cooling-bedding', 'mattress-toppers']]),
    ...['bedroom-furniture', 'furniture', 'headboards', 'platform-bases']
      .map((handle) => [handle, ['headboards', 'platform-bases']]),
  ]),
  menu,
  dualComfort: {
    productHandles: ['12-inch-dual-comfort-mattress', '14-inch-dual-comfort-mattress'],
    values: ['Soft', 'Medium Soft', 'Medium Firm', 'Firm'],
    mappingSource: 'Variant metafields custom.left_comfort and custom.right_comfort when both are verified and attached to an orderable variant.',
    currentOrderableMappings: 0,
    failClosed: true,
  },
};

fs.writeFileSync(OUTPUT, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  products: products.length,
  collections: collections.length,
  existingCollectionsReplaced: collections.filter((collection) => collection.replacesManualCollectionId).length,
  newCollections: collections.filter((collection) => !collection.replacesManualCollectionId).map((collection) => collection.handle),
  averageTagsPerProduct: Number((products.reduce((sum, product) => sum + product.tags.length, 0) / products.length).toFixed(2)),
  dualComfortOrderableMappings: manifest.dualComfort.currentOrderableMappings,
}, null, 2));
console.log(`Wrote ${path.relative(ROOT, OUTPUT)}.`);
