import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const READBACK = path.join(ROOT, 'docs', 'product-knowledge', 'PRODUCT_KNOWLEDGE_SHOPIFY_READBACK.json');
const OUTPUT = path.join(ROOT, 'docs', 'product-knowledge', 'PRODUCT_KNOWLEDGE_FEED.v1.json');

function fail(message) { throw new Error(message); }

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
      variants: product.commerce.variants,
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
};

fs.writeFileSync(OUTPUT, `${JSON.stringify(feed, null, 2)}\n`);
console.log(JSON.stringify({ output: path.relative(ROOT, OUTPUT), products: products.length, variants: products.reduce((count, product) => count + product.commerce.variants.length, 0) }, null, 2));
