import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const READBACK = path.join(ROOT, 'docs', 'product-knowledge', 'PRODUCT_KNOWLEDGE_SHOPIFY_READBACK.json');
const OUTPUT = path.join(ROOT, 'docs', 'product-knowledge', 'PRODUCT_KNOWLEDGE_FEED.v1.json');
const CURATED_BUNDLES = path.join(ROOT, 'docs', 'curated-bundles', 'CURATED_BUNDLE_MANIFEST.json');

function fail(message) { throw new Error(message); }

function standardizedSize(options) {
  const entry = Object.entries(options || {}).find(([name]) => name.trim().toLowerCase() === 'size');
  if (!entry) return null;
  return String(entry[1] || '')
    .trim()
    .replace(/^Cal King$/i, 'California King')
    .replace(/^Split Head Cal King$/i, 'Split Head California King')
    .replace(/^Split Cal King$/i, 'Split California King');
}

function shopSizeKeys(options) {
  const size = standardizedSize(options);
  if (!size || size.toLowerCase() === 'one size') return [];
  return [...new Set(size.replace(/\s*\(2pc\)$/i, '').replace(/Cal King/gi, 'California King').split('/').map((value) => value.trim()).filter(Boolean))];
}

const readback = JSON.parse(fs.readFileSync(READBACK, 'utf8'));
if (readback.schemaVersion !== '1.0.0') fail(`Unsupported product knowledge schema ${readback.schemaVersion}.`);
if (readback.products.length !== 43) fail(`Expected 43 products, received ${readback.products.length}.`);

const products = readback.products.map((product) => {
  if (product.content.approved !== (product.content.status === 'APPROVED')) fail(`${product.handle} content approval flag is inconsistent.`);
  if (!product.content.approved && Object.keys(product.content.fields).length) fail(`${product.handle} exposes unapproved owner content.`);
  return {
    shopifyProductId: product.shopifyProductId,
    handle: product.handle,
    title: product.title,
    model: product.model,
    feelLabel: product.feelLabel || null,
    categoryContract: product.categoryContract,
    productType: product.productType,
    vendor: product.vendor,
    content: product.content,
    technical: product.technical,
    commerce: {
      authority: 'Shopify live query required',
      status: product.commerce.status,
      variants: product.commerce.variants.map((variant) => ({
        shopifyVariantId: variant.shopifyVariantId,
        sku: variant.sku,
        price: variant.price,
        options: variant.options,
        standardizedSize: standardizedSize(variant.options),
        shopSizeKeys: shopSizeKeys(variant.options),
        contract: variant.contract,
      })),
    },
    compatibility: {
      source: product.compatibility.source,
      rule: 'Unknown or missing relationships remain unverified and must not be represented as compatible.',
    },
    schemaVersion: product.schemaVersion,
    lastUpdated: product.shopifyUpdatedAt,
  };
});

const feed = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  source: {
    system: 'Shopify',
    store: readback.store,
    rule: 'Shopify is authoritative. Approved owner content and verified technical facts may be cached; prices, availability, variants, cart, and checkout require live Shopify authority.',
  },
  products,
  bundles: fs.existsSync(CURATED_BUNDLES)
    ? JSON.parse(fs.readFileSync(CURATED_BUNDLES, 'utf8')).bundles.map((bundle) => ({
      id: bundle.id,
      name: bundle.name,
      category: bundle.category,
      contentStatus: bundle.contentStatus,
      purchaseStatus: bundle.purchaseStatus,
      compatibilityStatus: bundle.compatibilityStatus,
      curationBasis: bundle.curationBasis,
      showroomRelationship: bundle.showroomRelationship,
      components: bundle.components.map((component) => ({
        shopifyProductId: component.shopifyProductId,
        handle: component.handle,
        title: component.title,
        quantity: component.quantity,
      })),
      sizes: bundle.sizes.map((size) => ({
        label: size.label,
        geometry: size.geometry,
        sourceSize: size.sourceSize,
        componentQuantities: size.componentQuantities,
        minCombinedPrice: size.minCombinedPrice,
        maxCombinedPrice: size.maxCombinedPrice,
        componentVariants: size.componentVariants.map((variants) => variants.map((variant) => ({
          shopifyVariantId: variant.shopifyVariantId,
          sku: variant.sku,
          price: variant.price,
        }))),
      })),
    }))
    : [],
};

fs.writeFileSync(OUTPUT, `${JSON.stringify(feed, null, 2)}\n`);
console.log(JSON.stringify({ output: path.relative(ROOT, OUTPUT), products: products.length, variants: products.reduce((count, product) => count + product.commerce.variants.length, 0), bundles: feed.bundles.length }, null, 2));
