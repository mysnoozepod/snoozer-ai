import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET = path.join(ROOT, 'docs', 'catalog', 'catalog-shopping-restructure-before.json');
const BACKUP = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\catalog-shopping-restructure\\2026-11-02T02-22-44-076Z\\shopify-before.json';

const schemaSnapshot = JSON.parse(fs.readFileSync(TARGET, 'utf8'));
const backup = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
const catalog = backup.catalog;
const products = catalog.products.nodes;
const collections = catalog.collections.nodes;
const restored = {
  generatedAt: backup.capturedAt,
  shop: backup.store,
  apiVersion: '2025-10',
  summary: {
    products: products.length,
    draftProducts: products.filter((product) => product.status === 'DRAFT').length,
    taggedProducts: products.filter((product) => product.tags.length).length,
    variants: products.reduce((sum, product) => sum + product.variants.nodes.length, 0),
    collections: collections.length,
    automatedCollections: collections.filter((collection) => collection.ruleSet).length,
    manualCollections: collections.filter((collection) => !collection.ruleSet).length,
    menus: catalog.menus.nodes.length,
  },
  products: catalog.products,
  collections: catalog.collections,
  menus: catalog.menus,
  collectionRuleSetInput: schemaSnapshot.collectionRuleSetInput,
  collectionRuleInput: schemaSnapshot.collectionRuleInput,
  collectionDeleteInput: schemaSnapshot.collectionDeleteInput,
  collectionRuleColumn: schemaSnapshot.collectionRuleColumn,
  collectionRuleRelation: schemaSnapshot.collectionRuleRelation,
};

if (restored.summary.products !== 43 || restored.summary.draftProducts !== 43 || restored.summary.taggedProducts !== 0
  || restored.summary.variants !== 274 || restored.summary.manualCollections !== 18 || restored.summary.automatedCollections !== 0) {
  throw new Error(`Refusing invalid baseline restore: ${JSON.stringify(restored.summary)}`);
}
fs.writeFileSync(TARGET, `${JSON.stringify(restored, null, 2)}\n`, 'utf8');
console.log(`Restored immutable pre-migration baseline from ${BACKUP}.`);
