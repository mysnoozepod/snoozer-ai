#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'docs', 'catalog', 'MALOUF_FURNITURE_TOPPER_MANIFEST.json');

const colors = [
  ['Oat', 'OA'],
  ['Charcoal', 'CH'],
  ['Stone', 'ST'],
];

const sizeCodes = {
  Queen: 'QQ',
  King: 'KK',
  'California King': 'CK',
  'King/California King': 'KK',
};

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function contract(geometry, key) {
  return {
    sleep_geometry: geometry,
    price_verification_status: 'HISTORICAL_REFERENCE',
    fulfillment_readiness: 'PENDING',
    compatibility_key: key,
  };
}

function furnitureProduct({ title, handle, productType, assortmentStatus = 'APPROVED', suffix, sizes, page, collections }) {
  const geometry = productType === 'Platform Base' ? 'standard' : 'not_applicable';
  const variants = [];
  for (const [size, price] of sizes) {
    for (const [color, colorCode] of colors) {
      const sku = `${colorCode}${sizeCodes[size]}_${suffix}`;
      variants.push({
        options: { Size: size, Color: color },
        sku,
        referencePrice: price,
        shopifyVariantId: null,
        source: {
          document: 'MALOUF-PriceList-26.3-MAP.pdf',
          pdfPage: page,
          printedPage: page * 2 - 1,
          evidence: 'The page defines OA/Oat, CH/Charcoal, and ST/Stone color SKU prefixes and prints the ST size SKU examples.',
        },
        contract: contract(geometry, `${handle}-${slug(size)}-${slug(color)}`),
      });
    }
  }
  return {
    title,
    handle,
    manufacturer: 'Malouf',
    productType,
    assortmentStatus,
    publicationReadiness: 'BLOCKED',
    shopifyStatus: 'DRAFT',
    shopifyProductId: null,
    collections,
    contract: {
      assortment_status: assortmentStatus,
      publication_readiness: 'BLOCKED',
      builder_roles: [],
      owner_content_status: 'PENDING',
    },
    variants,
  };
}

function topperProduct() {
  const rows = [
    ['Twin', 'IS25TT45GT', '124.99'],
    ['Twin XL', 'IS25TX45GT', '134.99'],
    ['Full', 'IS25FF45GT', '159.99'],
    ['Queen', 'IS25QQ45GT', '179.99'],
    ['King', 'IS25KK45GT', '199.99'],
    ['California King', 'IS25CK45GT', '214.99'],
  ];
  const handle = 'malouf-2-5-inch-gel-memory-foam-topper';
  return {
    title: '2.5-Inch Gel Memory Foam Topper',
    handle,
    manufacturer: 'Malouf',
    productType: 'Mattress Topper',
    assortmentStatus: 'SELECTED',
    publicationReadiness: 'BLOCKED',
    shopifyStatus: 'DRAFT',
    shopifyProductId: null,
    collections: ['mattress-toppers'],
    contract: {
      assortment_status: 'SELECTED',
      publication_readiness: 'BLOCKED',
      builder_roles: [],
      owner_content_status: 'PENDING',
    },
    variants: rows.map(([size, sku, price]) => ({
      options: { Size: size },
      sku,
      referencePrice: price,
      shopifyVariantId: null,
      source: {
        document: 'MALOUF-PriceList-26.3-MAP.pdf',
        pdfPage: 74,
        printedPage: 147,
      },
      contract: contract('standard', `${handle}-${slug(size)}`),
    })),
  };
}

const products = [
  furnitureProduct({
    title: 'Hennessy Upholstered Headboard', handle: 'hennessy-upholstered-headboard', productType: 'Headboard', suffix: 'HENNHB', page: 28,
    sizes: [['Queen', '359.99'], ['King/California King', '449.99']], collections: ['furniture', 'headboards'],
  }),
  furnitureProduct({
    title: 'Carlisle Upholstered Headboard', handle: 'carlisle-upholstered-headboard', productType: 'Headboard', suffix: 'CARLHB', page: 28,
    sizes: [['Queen', '359.99'], ['King/California King', '449.99']], collections: ['furniture', 'headboards'],
  }),
  furnitureProduct({
    title: 'Scoresby Designer Headboard', handle: 'scoresby-designer-headboard', productType: 'Headboard', suffix: 'SCORHB', page: 29,
    sizes: [['Queen', '389.99'], ['King/California King', '479.99']], collections: ['furniture', 'headboards'],
  }),
  furnitureProduct({
    title: 'Blackwell Designer Headboard', handle: 'blackwell-designer-headboard', productType: 'Headboard', suffix: 'BLWBHB', page: 29,
    sizes: [['Queen', '449.99'], ['King/California King', '529.99']], collections: ['furniture', 'headboards'],
  }),
  furnitureProduct({
    title: 'Eastman Upholstered Platform Base', handle: 'eastman-upholstered-platform-base', productType: 'Platform Base', suffix: 'EASTPL', page: 30,
    sizes: [['Queen', '529.99'], ['King', '599.99'], ['California King', '599.99']], collections: ['furniture', 'platform-bases'],
  }),
  furnitureProduct({
    title: 'Watson Upholstered Platform Base', handle: 'watson-upholstered-platform-base', productType: 'Platform Base', suffix: 'WATSPL', page: 31,
    sizes: [['Queen', '829.99'], ['King', '979.99'], ['California King', '979.99']], collections: ['furniture', 'platform-bases'],
  }),
  topperProduct(),
];

const manifest = {
  schemaVersion: '1.0',
  updatedAt: '2026-10-31',
  shopifyStore: 'mysnoozepodtest',
  publicationRule: 'DRAFT_ONLY_UNTIL_OWNER_RELEASE_GATE',
  priceRule: 'MALOUF_26_3_MAP_IS_HISTORICAL_DRAFT_REFERENCE_NOT_LIVE_AUTHORIZATION',
  readbackFile: 'docs/catalog/malouf-furniture-topper-shopify-readback.json',
  expectedProductCount: products.length,
  expectedVariantCount: products.flatMap((product) => product.variants).length,
  collections: [
    { title: 'Furniture', handle: 'furniture', shopifyCollectionId: null, role: 'customer_facing_category' },
    { title: 'Headboards', handle: 'headboards', shopifyCollectionId: null, role: 'merchandising_group' },
    { title: 'Platform Bases', handle: 'platform-bases', shopifyCollectionId: null, role: 'merchandising_group' },
    { title: 'Mattress Toppers', handle: 'mattress-toppers', shopifyCollectionId: '302102872125', role: 'merchandising_group' },
  ],
  products,
  unresolvedCompatibility: [
    'The source verifies Malouf base compatibility claims only; compatibility with the approved BEDGEAR adjustable-base families remains pending manufacturer or owner verification.',
    'Furniture clearance, freight, fulfillment, returns, live pricing, showroom samples, and customer-facing content remain pending.',
  ],
};

fs.writeFileSync(OUTPUT, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${path.relative(ROOT, OUTPUT)} (${manifest.expectedProductCount} products, ${manifest.expectedVariantCount} variants).`);
