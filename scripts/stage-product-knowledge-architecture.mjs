import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  CONTENT_STATUSES,
  PRODUCT_KNOWLEDGE_SCHEMA_VERSION,
  PRODUCT_METAFIELD_DEFINITIONS,
  VARIANT_METAFIELD_DEFINITIONS,
  contractForProduct,
  initialKnowledgeFields,
} from '../content/product-knowledge-contract.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const APPLY = process.argv.includes('--apply');
const EXPECTED_STORE = 'mysnoozepodtest.myshopify.com';
const EXPECTED_API_VERSION = '2025-10';
const LAMBDA_FUNCTION = 'snoozer-backend';
const AWS_REGION = 'us-east-1';
const PUBLISHED_THEME_ID = '139460542525';
const UNPUBLISHED_THEME_ID = '139216420925';
const EXPECTED_THEME_NAME = 'snoozer-ai/main';
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\product-knowledge-architecture';
const READBACK_PATH = path.join(ROOT, 'docs', 'product-knowledge', 'PRODUCT_KNOWLEDGE_SHOPIFY_READBACK.json');
const FIXTURE_PATH = path.join(ROOT, 'tests', 'fixtures', 'product-knowledge-categories.v1.json');
const THEME_ASSETS = [
  'sections/snoozepod-product-information-v1.liquid',
  'snippets/snoozepod-product-knowledge.liquid',
];

function fail(message) { throw new Error(message); }
function sha256(value) { return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex'); }
function requireNoErrors(errors, label) {
  if (errors?.length) fail(`${label}: ${errors.map((error) => `${error.field || 'input'}: ${error.message}`).join(' | ')}`);
}

function connection() {
  const raw = execFileSync('aws', [
    'lambda', 'get-function-configuration', '--function-name', LAMBDA_FUNCTION, '--region', AWS_REGION,
    '--query', 'Environment.Variables.{SHOPIFY_DOMAIN:SHOPIFY_DOMAIN,SHOPIFY_ADMIN_TOKEN:SHOPIFY_ADMIN_TOKEN,SHOPIFY_ADMIN_API_VERSION:SHOPIFY_ADMIN_API_VERSION}',
    '--output', 'json', '--no-cli-pager',
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024, env: { ...process.env, PYTHONUTF8: '1', AWS_PAGER: '' } });
  const values = JSON.parse(raw);
  const apiVersion = values.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;
  if (values.SHOPIFY_DOMAIN !== EXPECTED_STORE) fail(`Refusing unexpected Shopify store ${values.SHOPIFY_DOMAIN || 'missing'}.`);
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected Admin API version ${apiVersion}.`);
  if (!values.SHOPIFY_ADMIN_TOKEN) fail('SHOPIFY_ADMIN_TOKEN is unavailable from the existing development configuration.');
  return { shop: values.SHOPIFY_DOMAIN, token: values.SHOPIFY_ADMIN_TOKEN, apiVersion };
}

const shopifyConnection = connection();
const baseEndpoint = `https://${shopifyConnection.shop}/admin/api/${shopifyConnection.apiVersion}`;

async function graphql(query, variables = {}) {
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await fetch(`${baseEndpoint}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': shopifyConnection.token },
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json().catch(() => null);
    const errors = payload?.errors?.map((error) => error.message) || [];
    if ((response.status === 429 || errors.some((message) => /throttled/i.test(message))) && attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
      continue;
    }
    if (!response.ok || !payload || errors.length) fail(`Shopify Admin GraphQL failed: ${(errors.length ? errors : [`HTTP ${response.status}`]).join(' | ')}`);
    return payload.data;
  }
  fail('Shopify Admin GraphQL remained throttled after bounded retries.');
}

async function rest(pathname, options = {}) {
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await fetch(`${baseEndpoint}${pathname}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': shopifyConnection.token, ...(options.headers || {}) },
    });
    if (response.status === 429 && attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
      continue;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) fail(`Shopify REST request failed for ${pathname}: HTTP ${response.status}.`);
    return payload;
  }
  fail(`Shopify REST request remained throttled for ${pathname}.`);
}

async function readAsset(themeId, key) {
  const params = new URLSearchParams({ 'asset[key]': key });
  const response = await fetch(`${baseEndpoint}/themes/${themeId}/assets.json?${params}`, {
    headers: { 'X-Shopify-Access-Token': shopifyConnection.token },
  });
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.asset) fail(`Could not read ${key} from theme ${themeId}: HTTP ${response.status}.`);
  return payload.asset;
}

async function writeAsset(themeId, key, value) {
  await rest(`/themes/${themeId}/assets.json`, { method: 'PUT', body: JSON.stringify({ asset: { key, value } }) });
}

const CATALOG_QUERY = `
  query ProductKnowledgeCatalog {
    products(first: 100, sortKey: TITLE) {
      nodes {
        id legacyResourceId title handle status vendor productType templateSuffix descriptionHtml tags updatedAt
        category { id name fullName }
        collections(first: 50) { nodes { id handle title } }
        media(first: 1) { nodes { id mediaContentType status alt } }
        variants(first: 250) {
          nodes {
            id legacyResourceId title sku barcode price updatedAt
            selectedOptions { name value }
            inventoryPolicy inventoryQuantity
            inventoryItem { id tracked requiresShipping }
          }
        }
      }
    }
    productDefinitions: metafieldDefinitions(first: 250, ownerType: PRODUCT) {
      nodes { id name namespace key description ownerType pinnedPosition type { name } validations { name value } }
    }
    variantDefinitions: metafieldDefinitions(first: 250, ownerType: PRODUCTVARIANT) {
      nodes { id name namespace key description ownerType pinnedPosition type { name } validations { name value } }
    }
  }
`;

const OWNER_FIELDS_QUERY = `
  query ProductKnowledgeFields($ids: [ID!]!) {
    nodes(ids: $ids) {
      id
      ... on Product { metafields(first: 100) { nodes { id namespace key type value compareDigest updatedAt definition { id } } } }
      ... on ProductVariant { metafields(first: 100) { nodes { id namespace key type value compareDigest updatedAt definition { id } } } }
    }
  }
`;

const DEFINITION_CREATE = `
  mutation CreateProductKnowledgeDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id name namespace key ownerType pinnedPosition type { name } }
      userErrors { field message code }
    }
  }
`;

const DEFINITION_PIN = `
  mutation PinProductKnowledgeDefinition($definitionId: ID!) {
    metafieldDefinitionPin(definitionId: $definitionId) {
      pinnedDefinition { id namespace key pinnedPosition }
      userErrors { field message code }
    }
  }
`;

const DEFINITION_UNPIN = `
  mutation UnpinProductKnowledgeDefinition($definitionId: ID!) {
    metafieldDefinitionUnpin(definitionId: $definitionId) {
      unpinnedDefinition { id namespace key pinnedPosition }
      userErrors { field message code }
    }
  }
`;

const METAFIELDS_SET = `
  mutation SetProductKnowledgeFields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id ownerType namespace key type value compareDigest updatedAt }
      userErrors { field message code elementIndex }
    }
  }
`;

async function hydrate(catalog) {
  const owners = catalog.products.nodes.flatMap((product) => [product, ...product.variants.nodes]);
  const byId = new Map(owners.map((owner) => [owner.id, owner]));
  for (let offset = 0; offset < owners.length; offset += 10) {
    const ids = owners.slice(offset, offset + 10).map((owner) => owner.id);
    const data = await graphql(OWNER_FIELDS_QUERY, { ids });
    for (const node of data.nodes) {
      if (!node) fail('Shopify returned a missing owner during product-knowledge hydration.');
      byId.get(node.id).metafields = node.metafields.nodes;
    }
  }
  return catalog;
}

function nativeFingerprint(products) {
  return sha256(JSON.stringify(products.map((product) => ({
    id: product.id,
    title: product.title,
    handle: product.handle,
    status: product.status,
    vendor: product.vendor,
    productType: product.productType,
    templateSuffix: product.templateSuffix,
    descriptionHtml: product.descriptionHtml,
    tags: [...product.tags].sort(),
    category: product.category,
    collections: product.collections.nodes.map((collection) => collection.id).sort(),
    media: product.media.nodes.map((media) => ({ id: media.id, type: media.mediaContentType, status: media.status, alt: media.alt })),
    variants: product.variants.nodes.map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku,
      barcode: variant.barcode,
      price: variant.price,
      options: variant.selectedOptions,
      inventoryPolicy: variant.inventoryPolicy,
      inventoryQuantity: variant.inventoryQuantity,
      inventoryItem: variant.inventoryItem,
    })),
  }))));
}

function keyFor(namespace, key, ownerType) { return `${ownerType}:${namespace}.${key}`; }
function fieldMap(owner) { return new Map((owner.metafields || []).map((field) => [`${field.namespace}.${field.key}`, field])); }

function preparePlan(catalog) {
  const products = catalog.products.nodes;
  if (products.length !== 43) fail(`Expected 43 products, received ${products.length}.`);
  if (products.reduce((count, product) => count + product.variants.nodes.length, 0) !== 274) fail('Variant count changed from the verified 274-record baseline.');
  const allDefinitions = [...PRODUCT_METAFIELD_DEFINITIONS, ...VARIANT_METAFIELD_DEFINITIONS];
  const currentDefinitions = [...catalog.productDefinitions.nodes, ...catalog.variantDefinitions.nodes];
  const currentDefinitionMap = new Map(currentDefinitions.map((entry) => [keyFor(entry.namespace, entry.key, entry.ownerType), entry]));
  const missingDefinitions = [];
  const pinDefinitions = [];
  const unpinDefinitions = [];
  for (const wanted of allDefinitions) {
    const current = currentDefinitionMap.get(keyFor(wanted.namespace, wanted.key, wanted.ownerType));
    if (!current) {
      missingDefinitions.push(wanted);
      continue;
    }
    if (current.type.name !== wanted.type) fail(`Definition type conflict for ${wanted.ownerType} ${wanted.namespace}.${wanted.key}.`);
    if (wanted.pin && current.pinnedPosition == null) pinDefinitions.push(current);
    if (!wanted.pin && current.pinnedPosition != null) unpinDefinitions.push(current);
  }

  const writes = [];
  const preservedConflicts = [];
  const assignments = {};
  for (const product of products) {
    const contract = contractForProduct({ ...product, variants: product.variants.nodes });
    assignments[product.handle] = contract;
    const existingMap = fieldMap(product);
    const ownerStatus = existingMap.get('custom.owner_content_status');
    if (!ownerStatus) fail(`${product.handle} is missing the existing custom.owner_content_status contract field.`);
    if (ownerStatus.value === 'PENDING') {
      writes.push({ ownerId: product.id, namespace: 'custom', key: 'owner_content_status', type: ownerStatus.type, value: 'NOT_STARTED', compareDigest: ownerStatus.compareDigest, reason: 'legacy-status-migration' });
    } else if (!CONTENT_STATUSES.includes(ownerStatus.value)) {
      fail(`${product.handle} has unsupported owner content status ${ownerStatus.value}.`);
    }

    const normalizedProduct = { ...product, variants: product.variants.nodes };
    for (const wanted of initialKnowledgeFields(normalizedProduct)) {
      const current = existingMap.get(`${wanted.namespace}.${wanted.key}`);
      if (!current) {
        writes.push({ ownerId: product.id, ...wanted, compareDigest: null, reason: 'initial-verified-contract' });
      } else if (current.type !== wanted.type || current.value !== wanted.value) {
        preservedConflicts.push({ handle: product.handle, field: `${wanted.namespace}.${wanted.key}`, currentType: current.type, desiredType: wanted.type, reason: 'Existing merchant or prior value preserved; no automatic overwrite.' });
      }
    }
  }
  return { allDefinitions, missingDefinitions, pinDefinitions, unpinDefinitions, writes, preservedConflicts, assignments };
}

function definitionInput(entry) {
  const input = {
    namespace: entry.namespace,
    key: entry.key,
    name: entry.name,
    description: entry.description,
    type: entry.type,
    ownerType: entry.ownerType,
  };
  if (entry.validations.length) input.validations = entry.validations;
  return input;
}

async function setMetafields(fields) {
  for (let offset = 0; offset < fields.length; offset += 25) {
    const batch = fields.slice(offset, offset + 25).map(({ reason, ...field }) => field);
    const data = await graphql(METAFIELDS_SET, { metafields: batch });
    requireNoErrors(data.metafieldsSet.userErrors, 'Could not set product-knowledge metafields');
    if (data.metafieldsSet.metafields.length !== batch.length) fail('Shopify returned an incomplete product-knowledge metafield batch.');
  }
}

function normalizedProduct(product) {
  const metafields = Object.fromEntries((product.metafields || []).map((entry) => [`${entry.namespace}.${entry.key}`, { type: entry.type, value: entry.value, updatedAt: entry.updatedAt }]));
  const approved = metafields['custom.owner_content_status']?.value === 'APPROVED';
  const ownerContent = Object.fromEntries(Object.entries(metafields).filter(([key]) => key.startsWith('snoozepod_content.')));
  return {
    shopifyProductId: product.id,
    handle: product.handle,
    title: product.title,
    model: metafields['custom.model']?.value || null,
    categoryContract: metafields['custom.product_contract']?.value || null,
    productType: product.productType,
    vendor: product.vendor,
    content: { status: metafields['custom.owner_content_status']?.value || null, approved, fields: approved ? ownerContent : {} },
    technical: {
      status: metafields['custom.technical_content_status']?.value || null,
      provenance: metafields['custom.technical_source'] ? JSON.parse(metafields['custom.technical_source'].value) : null,
      fields: Object.fromEntries(Object.entries(metafields).filter(([key]) => key.startsWith('snoozepod_') && !key.startsWith('snoozepod_content.'))),
    },
    commerce: {
      status: product.status,
      variants: product.variants.nodes.map((variant) => ({
        shopifyVariantId: variant.id,
        sku: variant.sku,
        price: variant.price,
        options: Object.fromEntries(variant.selectedOptions.map((option) => [option.name, option.value])),
        contract: Object.fromEntries((variant.metafields || []).map((entry) => [`${entry.namespace}.${entry.key}`, entry.value])),
      })),
    },
    compatibility: { source: 'Exact variant fields and verified product compatibility metafields only; unknown is not compatible.' },
    schemaVersion: metafields['custom.product_knowledge_schema_version']?.value || null,
    shopifyUpdatedAt: product.updatedAt,
  };
}

for (const key of THEME_ASSETS) {
  if (!fs.existsSync(path.join(ROOT, ...key.split('/')))) fail(`Missing local theme asset ${key}.`);
}

const themesPayload = await rest('/themes.json?fields=id,name,role,updated_at');
const publishedTheme = themesPayload.themes.find((theme) => String(theme.id) === PUBLISHED_THEME_ID);
const unpublishedTheme = themesPayload.themes.find((theme) => String(theme.id) === UNPUBLISHED_THEME_ID);
if (!publishedTheme || publishedTheme.name !== EXPECTED_THEME_NAME || publishedTheme.role !== 'main') fail('Published theme identity changed.');
if (!unpublishedTheme || unpublishedTheme.name !== EXPECTED_THEME_NAME || unpublishedTheme.role !== 'unpublished') fail('Unpublished theme identity changed.');

const desiredAssets = new Map(THEME_ASSETS.map((key) => [key, fs.readFileSync(path.join(ROOT, ...key.split('/')), 'utf8')]));
const publishedAssetsBefore = new Map();
const unpublishedAssetsBefore = new Map();
for (const key of THEME_ASSETS) {
  publishedAssetsBefore.set(key, await readAsset(PUBLISHED_THEME_ID, key));
  unpublishedAssetsBefore.set(key, await readAsset(UNPUBLISHED_THEME_ID, key));
}

const before = await hydrate(await graphql(CATALOG_QUERY));
const fingerprintBefore = nativeFingerprint(before.products.nodes);
const plan = preparePlan(before);
const themePlan = [...desiredAssets].map(([key, value]) => ({ key, action: unpublishedAssetsBefore.get(key)?.value === value ? 'unchanged' : unpublishedAssetsBefore.get(key) ? 'update' : 'create' }));
console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'plan',
  store: shopifyConnection.shop,
  apiVersion: shopifyConnection.apiVersion,
  schemaVersion: PRODUCT_KNOWLEDGE_SCHEMA_VERSION,
  products: before.products.nodes.length,
  variants: before.products.nodes.reduce((count, product) => count + product.variants.nodes.length, 0),
  categoryAssignments: Object.entries(plan.assignments).reduce((groups, [handle, contract]) => {
    groups[contract] ||= [];
    groups[contract].push(handle);
    return groups;
  }, {}),
  definitions: { desiredProduct: PRODUCT_METAFIELD_DEFINITIONS.length, desiredVariant: VARIANT_METAFIELD_DEFINITIONS.length, missing: plan.missingDefinitions.length, pinsNeeded: plan.pinDefinitions.length, unpinsNeeded: plan.unpinDefinitions.length },
  metafields: { writes: plan.writes.length, legacyStatusMigrations: plan.writes.filter((field) => field.reason === 'legacy-status-migration').length, preservedConflicts: plan.preservedConflicts.length },
  theme: { published: publishedTheme, unpublished: unpublishedTheme, assets: themePlan },
  previewUrl: `https://${shopifyConnection.shop}/?preview_theme_id=${UNPUBLISHED_THEME_ID}`,
}, null, 2));

if (!APPLY) {
  console.log('Plan only: no Shopify state changed. Re-run with --apply after reviewing the exact bounded plan.');
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDirectory = path.join(BACKUP_ROOT, timestamp);
fs.mkdirSync(backupDirectory, { recursive: true });
fs.writeFileSync(path.join(backupDirectory, 'catalog-before.json'), `${JSON.stringify({ capturedAt: new Date().toISOString(), catalog: before }, null, 2)}\n`);
for (const [key, asset] of unpublishedAssetsBefore) {
  if (!asset?.value) continue;
  const output = path.join(backupDirectory, 'unpublished-theme', ...key.split('/'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, asset.value, 'utf8');
}
fs.writeFileSync(path.join(backupDirectory, 'published-theme-hashes-before.json'), `${JSON.stringify(Object.fromEntries([...publishedAssetsBefore].map(([key, asset]) => [key, asset?.value ? sha256(asset.value) : null])), null, 2)}\n`);

const statusMigrations = plan.writes.filter((field) => field.reason === 'legacy-status-migration');
await setMetafields(statusMigrations);

const createdDefinitions = [];
for (const wanted of plan.missingDefinitions) {
  const data = await graphql(DEFINITION_CREATE, { definition: definitionInput(wanted) });
  requireNoErrors(data.metafieldDefinitionCreate.userErrors, `Could not create definition ${wanted.namespace}.${wanted.key}`);
  if (!data.metafieldDefinitionCreate.createdDefinition) fail(`Shopify did not return created definition ${wanted.namespace}.${wanted.key}.`);
  createdDefinitions.push({ ...data.metafieldDefinitionCreate.createdDefinition, desiredPin: wanted.pin });
}

const definitionsToPin = [
  ...plan.pinDefinitions.map((entry) => ({ id: entry.id, namespace: entry.namespace, key: entry.key })),
  ...createdDefinitions.filter((entry) => entry.desiredPin),
];
for (const entry of plan.unpinDefinitions) {
  const data = await graphql(DEFINITION_UNPIN, { definitionId: entry.id });
  requireNoErrors(data.metafieldDefinitionUnpin.userErrors, `Could not unpin definition ${entry.namespace}.${entry.key}`);
}
for (const entry of definitionsToPin) {
  const data = await graphql(DEFINITION_PIN, { definitionId: entry.id });
  requireNoErrors(data.metafieldDefinitionPin.userErrors, `Could not pin definition ${entry.namespace}.${entry.key}`);
}

await setMetafields(plan.writes.filter((field) => field.reason !== 'legacy-status-migration'));

for (const [key, value] of desiredAssets) {
  if (unpublishedAssetsBefore.get(key)?.value !== value) await writeAsset(UNPUBLISHED_THEME_ID, key, value);
}

const after = await hydrate(await graphql(CATALOG_QUERY));
const fingerprintAfter = nativeFingerprint(after.products.nodes);
if (fingerprintAfter !== fingerprintBefore) fail('Native product, variant, collection, price, inventory, media, or template data changed unexpectedly.');

const afterPlan = preparePlan(after);
if (afterPlan.missingDefinitions.length || afterPlan.pinDefinitions.length || afterPlan.unpinDefinitions.length || afterPlan.writes.length) fail(`Product-knowledge readback is not idempotent: ${afterPlan.missingDefinitions.length} definitions, ${afterPlan.pinDefinitions.length} pins, ${afterPlan.unpinDefinitions.length} unpins, and ${afterPlan.writes.length} fields remain.`);
if (afterPlan.preservedConflicts.length !== plan.preservedConflicts.length) fail('Product-knowledge conflict set changed unexpectedly.');
for (const product of after.products.nodes) {
  const status = fieldMap(product).get('custom.owner_content_status')?.value;
  if (!CONTENT_STATUSES.includes(status)) fail(`${product.handle} failed content workflow readback.`);
  if (fieldMap(product).get('custom.product_knowledge_schema_version')?.value !== PRODUCT_KNOWLEDGE_SCHEMA_VERSION) fail(`${product.handle} failed schema-version readback.`);
}

const themeReadback = [];
for (const [key, value] of desiredAssets) {
  const actual = await readAsset(UNPUBLISHED_THEME_ID, key);
  if (!actual || actual.value !== value) fail(`${key} failed unpublished-theme readback.`);
  themeReadback.push({ key, sha256: sha256(actual.value) });
  const publishedAfter = await readAsset(PUBLISHED_THEME_ID, key);
  const publishedBefore = publishedAssetsBefore.get(key);
  if (Boolean(publishedAfter) !== Boolean(publishedBefore) || (publishedBefore?.value && sha256(publishedAfter.value) !== sha256(publishedBefore.value))) fail(`Published theme changed unexpectedly for ${key}.`);
}

const normalized = after.products.nodes.map(normalizedProduct);
const categoryRepresentatives = Object.values(Object.fromEntries(normalized.map((product) => [product.categoryContract, product])));
const fixture = {
  schemaVersion: PRODUCT_KNOWLEDGE_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  fixtureType: 'representative-category-contracts',
  products: categoryRepresentatives,
};
fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);

const readback = {
  schemaVersion: PRODUCT_KNOWLEDGE_SCHEMA_VERSION,
  verifiedAt: new Date().toISOString(),
  store: shopifyConnection.shop,
  apiVersion: shopifyConnection.apiVersion,
  backupDirectory,
  previewUrl: `https://${shopifyConnection.shop}/?preview_theme_id=${UNPUBLISHED_THEME_ID}`,
  summary: {
    products: normalized.length,
    variants: normalized.reduce((count, product) => count + product.commerce.variants.length, 0),
    productDefinitions: after.productDefinitions.nodes.length,
    variantDefinitions: after.variantDefinitions.nodes.length,
    contractDefinitionCount: PRODUCT_METAFIELD_DEFINITIONS.length + VARIANT_METAFIELD_DEFINITIONS.length,
    createdDefinitionsThisRun: createdDefinitions.length,
    pinChanges: definitionsToPin.length,
    unpinChanges: plan.unpinDefinitions.length,
    pinnedProductDefinitionCount: after.productDefinitions.nodes.filter((definition) => definition.pinnedPosition != null).length,
    preservedConflicts: afterPlan.preservedConflicts.length,
    ownerContentStatuses: Object.fromEntries(CONTENT_STATUSES.map((status) => [status, normalized.filter((product) => product.content.status === status).length])),
    nativeCommerceFingerprintPreserved: fingerprintAfter === fingerprintBefore,
  },
  categoryAssignments: plan.assignments,
  definitions: { product: after.productDefinitions.nodes, productVariant: after.variantDefinitions.nodes, metaobjectsCreated: [] },
  theme: { publishedThemeId: PUBLISHED_THEME_ID, publishedAssetsUnchanged: THEME_ASSETS.length, unpublishedThemeId: UNPUBLISHED_THEME_ID, assets: themeReadback },
  preservedConflicts: afterPlan.preservedConflicts,
  products: normalized,
};
fs.mkdirSync(path.dirname(READBACK_PATH), { recursive: true });
fs.writeFileSync(READBACK_PATH, `${JSON.stringify(readback, null, 2)}\n`);
console.log(JSON.stringify({
  result: 'Product knowledge architecture applied and verified.',
  backupDirectory,
  readback: path.relative(ROOT, READBACK_PATH),
  fixture: path.relative(ROOT, FIXTURE_PATH),
  products: readback.summary.products,
  variants: readback.summary.variants,
  definitionsCreatedThisRun: readback.summary.createdDefinitionsThisRun,
  previewUrl: readback.previewUrl,
}, null, 2));
