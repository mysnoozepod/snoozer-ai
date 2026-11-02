import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'docs', 'catalog', 'CATALOG_SHOPPING_RESTRUCTURE_MANIFEST.json');
const BASELINE_PATH = path.join(ROOT, 'docs', 'catalog', 'catalog-shopping-restructure-before.json');
const READBACK_PATH = path.join(ROOT, 'docs', 'catalog', 'catalog-shopping-restructure-shopify-readback.json');
const BACKUP_ROOT = 'C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups\\Shopify\\catalog-shopping-restructure';
const EXPECTED_STORE = 'mysnoozepodtest.myshopify.com';
const EXPECTED_API_VERSION = '2025-10';
const LAMBDA_FUNCTION = 'snoozer-backend';
const AWS_REGION = 'us-east-1';
const APPLY = process.argv.includes('--apply');
const MIGRATION_KEY = 'p1006a';

function fail(message) { throw new Error(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sorted(values) { return [...values].sort((a, b) => a.localeCompare(b)); }
function requireNoUserErrors(errors, label) {
  if (errors?.length) fail(`${label}: ${errors.map((error) => `${error.field || 'input'}: ${error.message}`).join(' | ')}`);
}

function readConnection() {
  const raw = execFileSync('aws', [
    'lambda', 'get-function-configuration', '--function-name', LAMBDA_FUNCTION, '--region', AWS_REGION,
    '--query', 'Environment.Variables.{SHOPIFY_DOMAIN:SHOPIFY_DOMAIN,SHOPIFY_ADMIN_TOKEN:SHOPIFY_ADMIN_TOKEN,SHOPIFY_ADMIN_API_VERSION:SHOPIFY_ADMIN_API_VERSION}',
    '--output', 'json', '--no-cli-pager',
  ], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', AWS_PAGER: '' } });
  const variables = JSON.parse(raw);
  const shop = variables.SHOPIFY_DOMAIN;
  const token = variables.SHOPIFY_ADMIN_TOKEN;
  const apiVersion = variables.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;
  if (shop !== EXPECTED_STORE) fail(`Refusing unexpected Shopify store ${shop || 'missing'}.`);
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected Admin API version ${apiVersion}.`);
  if (!token) fail('SHOPIFY_ADMIN_TOKEN is unavailable from the existing development configuration.');
  return { shop, token, apiVersion };
}

const connection = readConnection();
const endpoint = `https://${connection.shop}/admin/api/${connection.apiVersion}/graphql.json`;

async function graphql(query, variables = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': connection.token },
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json().catch(() => null);
    const errors = payload?.errors?.map((error) => error.message) || [];
    if (errors.length && errors.every((message) => /throttled/i.test(message)) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      continue;
    }
    if (!response.ok || !payload || errors.length) {
      fail(`Shopify Admin GraphQL failed: ${(errors.length ? errors : [`HTTP ${response.status}`]).join(' | ')}`);
    }
    return payload.data;
  }
  fail('Shopify Admin GraphQL remained throttled after bounded retries.');
}

const INSPECT = `
  query CatalogShoppingRestructureInspection {
    products(first: 250) {
      nodes {
        id legacyResourceId title handle status vendor productType templateSuffix tags
        media(first: 20) { nodes { id status alt mediaContentType ... on MediaImage { image { url altText width height } } } }
        variants(first: 100) { nodes { id legacyResourceId title sku price availableForSale selectedOptions { name value } } }
        collections(first: 50) { nodes { id handle title } }
      }
    }
    collections(first: 250) {
      nodes {
        id legacyResourceId title handle descriptionHtml templateSuffix sortOrder
        image { url altText width height }
        ruleSet { appliedDisjunctively rules { column relation condition } }
        categoryNavigation: metafield(namespace: "custom", key: "category_navigation") { id type value compareDigest }
        products(first: 100) { nodes { id handle title } }
        resourcePublicationsV2(first: 50) { nodes { isPublished publication { id name } } }
      }
    }
    menus(first: 50) { nodes { id title handle items { id title type url resourceId items { id title type url resourceId items { id title type url resourceId } } } } }
    publications(first: 50) { nodes { id name } }
  }
`;

const PRODUCT_UPDATE = `mutation UpdateCatalogProduct($product: ProductUpdateInput!) {
  productUpdate(product: $product) { product { id handle status tags templateSuffix } userErrors { field message } }
}`;
const COLLECTION_CREATE = `mutation CreateAutomatedCollection($input: CollectionInput!) {
  collectionCreate(input: $input) { collection { id handle title ruleSet { rules { column relation condition } } } userErrors { field message } }
}`;
const COLLECTION_UPDATE = `mutation UpdateAutomatedCollection($input: CollectionInput!) {
  collectionUpdate(input: $input) { collection { id handle title templateSuffix } userErrors { field message } }
}`;
const COLLECTION_DELETE = `mutation DeleteLegacyCollection($input: CollectionDeleteInput!) {
  collectionDelete(input: $input) { deletedCollectionId userErrors { field message } }
}`;
const MENU_UPDATE = `mutation UpdateCatalogMenu($id: ID!, $title: String!, $handle: String, $items: [MenuItemUpdateInput!]!) {
  menuUpdate(id: $id, title: $title, handle: $handle, items: $items) { menu { id handle } userErrors { field message } }
}`;
const METAFIELDS_SET = `mutation SetCatalogNavigation($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { metafields { id ownerType key value } userErrors { field message code elementIndex } }
}`;
const PUBLISH = `mutation PublishCatalogCollection($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) { userErrors { field message } }
}`;

function baselineProductShape(product) {
  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    status: product.status,
    vendor: product.vendor,
    productType: product.productType,
    variants: product.variants.nodes.map((variant) => ({
      id: variant.id, title: variant.title, sku: variant.sku, price: variant.price, selectedOptions: variant.selectedOptions,
    })),
    media: product.media.nodes.map((media) => ({ id: media.id, url: media.image?.url || null })),
  };
}

function assertImmutableCatalog(catalog, baseline) {
  if (catalog.products.nodes.length !== 43) fail(`Expected exactly 43 products, found ${catalog.products.nodes.length}.`);
  const actual = new Map(catalog.products.nodes.map((product) => [product.handle, product]));
  for (const expected of baseline.products.nodes) {
    const current = actual.get(expected.handle);
    if (!current) fail(`Missing product ${expected.handle}.`);
    if (JSON.stringify(baselineProductShape(current)) !== JSON.stringify(baselineProductShape(expected))) {
      fail(`Immutable identity, SKU, price, option, or media drift detected for ${expected.handle}.`);
    }
    if (current.status !== 'DRAFT') fail(`${current.handle} is not Draft; refusing catalog mutation.`);
  }
}

function ruleMatches(collection, ruleTag) {
  const rules = collection?.ruleSet?.rules || [];
  return collection?.ruleSet?.appliedDisjunctively === false && rules.length === 1
    && rules[0].column === 'TAG' && rules[0].relation === 'EQUALS' && rules[0].condition === ruleTag;
}

function tempHandle(handle) { return `auto-${MIGRATION_KEY}-${handle}`; }
function legacyHandle(handle) { return `legacy-${MIGRATION_KEY}-${handle}`; }

function resolveMenuItems(items, collectionsByHandle) {
  return items.map((item) => {
    const resolved = { title: item.title, type: item.type };
    if (item.collection) {
      const collection = collectionsByHandle.get(item.collection);
      if (!collection) fail(`Menu item ${item.title} references missing collection ${item.collection}.`);
      resolved.resourceId = collection.id;
    } else if (item.resourceId) {
      resolved.resourceId = item.resourceId;
    }
    if (item.url) resolved.url = item.url;
    if (item.items?.length) resolved.items = resolveMenuItems(item.items, collectionsByHandle);
    return resolved;
  });
}

function buildPlan(catalog, manifest) {
  const products = new Map(catalog.products.nodes.map((item) => [item.handle, item]));
  const collections = new Map(catalog.collections.nodes.map((item) => [item.handle, item]));
  const productUpdates = manifest.products.filter((expected) => {
    const actual = products.get(expected.handle);
    return JSON.stringify(sorted(actual.tags)) !== JSON.stringify(sorted(expected.tags)) || actual.templateSuffix !== expected.desiredTemplateSuffix;
  }).map((expected) => ({ handle: expected.handle, tags: expected.tags, templateSuffix: expected.desiredTemplateSuffix }));

  const collectionCreates = [];
  const collectionSwaps = [];
  for (const expected of manifest.collections) {
    const final = collections.get(expected.handle);
    const temp = collections.get(tempHandle(expected.handle));
    if (final && ruleMatches(final, expected.ruleTag)) continue;
    if (!expected.replacesManualCollectionId) {
      if (!final) collectionCreates.push({ ...expected, createHandle: expected.handle });
      else fail(`New collection handle ${expected.handle} is unexpectedly occupied by a nonmatching collection.`);
    } else {
      if (final && final.id !== expected.replacesManualCollectionId) fail(`${expected.handle} no longer matches the recorded manual collection ID.`);
      if (!temp) collectionCreates.push({ ...expected, createHandle: tempHandle(expected.handle) });
      collectionSwaps.push({ ...expected, legacyId: final?.id || expected.replacesManualCollectionId, automatedId: temp?.id || null });
    }
  }
  return { products, collections, productUpdates, collectionCreates, collectionSwaps };
}

function createInput(expected) {
  const input = {
    title: expected.title,
    handle: expected.createHandle,
    descriptionHtml: expected.descriptionHtml || '',
    templateSuffix: expected.templateSuffix || 'snoozepod-v1',
    sortOrder: expected.sortOrder || 'BEST_SELLING',
    ruleSet: { appliedDisjunctively: false, rules: [{ column: 'TAG', relation: 'EQUALS', condition: expected.ruleTag }] },
  };
  if (expected.image?.url) input.image = { src: expected.image.url, altText: expected.image.altText || expected.title };
  return input;
}

function backupCurrent(catalog, manifest) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(BACKUP_ROOT, stamp);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'shopify-before.json'), `${JSON.stringify({ store: connection.shop, capturedAt: new Date().toISOString(), catalog }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'migration-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'RECOVERY.md'), `# Catalog restructure recovery\n\nCaptured: ${new Date().toISOString()}\nStore: ${connection.shop}\n\nThe JSON snapshot records product tags/templates, product identity/SKU/price/media, collections/rules/memberships/images, menus, collection navigation metafields, and publication state. Recovery is a deliberate Admin API operation: restore product tags and template suffixes, recreate the recorded manual collections with their memberships and media, restore menus/metafields, then delete only the automated collection IDs created by this migration. Do not paste credentials into this directory; none are stored here.\n`);
  return dir;
}

async function waitForMembership(manifest, attempts = 16) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const catalog = await graphql(INSPECT);
    const byHandle = new Map(catalog.collections.nodes.map((collection) => [collection.handle, collection]));
    const unresolved = [];
    for (const expected of manifest.collections) {
      const final = byHandle.get(expected.handle);
      const collection = ruleMatches(final, expected.ruleTag) ? final : byHandle.get(tempHandle(expected.handle));
      const actual = sorted((collection?.products.nodes || []).map((product) => product.handle));
      if (JSON.stringify(actual) !== JSON.stringify(sorted(expected.expectedProducts))) unresolved.push(expected.handle);
    }
    if (!unresolved.length) return catalog;
    if (attempt === attempts - 1) fail(`Automated collection membership did not settle: ${unresolved.join(', ')}.`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function updateProducts(plan) {
  for (const expected of plan.productUpdates) {
    const actual = plan.products.get(expected.handle);
    const data = await graphql(PRODUCT_UPDATE, { product: { id: actual.id, tags: expected.tags, templateSuffix: expected.templateSuffix } });
    requireNoUserErrors(data.productUpdate.userErrors, `Could not tag ${expected.handle}`);
    if (data.productUpdate.product.status !== 'DRAFT') fail(`${expected.handle} did not remain Draft.`);
    console.log(`Tagged ${expected.handle} (${expected.tags.length} tags); template ${expected.templateSuffix}.`);
  }
}

async function createCollections(plan) {
  for (const expected of plan.collectionCreates) {
    const data = await graphql(COLLECTION_CREATE, { input: createInput(expected) });
    requireNoUserErrors(data.collectionCreate.userErrors, `Could not create ${expected.createHandle}`);
    console.log(`Created automated collection ${expected.createHandle} from ${expected.ruleTag}.`);
  }
}

async function swapCollections(manifest) {
  let catalog = await graphql(INSPECT);
  let byHandle = new Map(catalog.collections.nodes.map((item) => [item.handle, item]));
  for (const expected of manifest.collections.filter((item) => item.replacesManualCollectionId)) {
    const final = byHandle.get(expected.handle);
    if (final && ruleMatches(final, expected.ruleTag)) continue;
    const automated = byHandle.get(tempHandle(expected.handle));
    if (!automated) fail(`Missing staged automated collection ${tempHandle(expected.handle)}.`);
    if (final) {
      if (final.id !== expected.replacesManualCollectionId || final.ruleSet) fail(`Refusing unexpected ${expected.handle} swap target.`);
      const renamed = await graphql(COLLECTION_UPDATE, { input: { id: final.id, handle: legacyHandle(expected.handle) } });
      requireNoUserErrors(renamed.collectionUpdate.userErrors, `Could not archive manual ${expected.handle}`);
    }
    const promoted = await graphql(COLLECTION_UPDATE, { input: { id: automated.id, handle: expected.handle } });
    requireNoUserErrors(promoted.collectionUpdate.userErrors, `Could not promote automated ${expected.handle}`);
    console.log(`Promoted automated collection /collections/${expected.handle}.`);
    catalog = await graphql(INSPECT);
    byHandle = new Map(catalog.collections.nodes.map((item) => [item.handle, item]));
  }
}

async function updateNavigation(manifest) {
  const catalog = await graphql(INSPECT);
  const collections = new Map(catalog.collections.nodes.map((item) => [item.handle, item]));
  const menu = catalog.menus.nodes.find((item) => item.handle === manifest.menu.handle);
  if (!menu) fail('Main menu was not found.');
  const menuData = await graphql(MENU_UPDATE, {
    id: menu.id,
    title: manifest.menu.title,
    handle: manifest.menu.handle,
    items: resolveMenuItems(manifest.menu.items, collections),
  });
  requireNoUserErrors(menuData.menuUpdate.userErrors, 'Could not update main navigation');

  const metafields = Object.entries(manifest.categoryNavigation).map(([ownerHandle, children]) => {
    const owner = collections.get(ownerHandle);
    if (!owner) fail(`Missing navigation owner ${ownerHandle}.`);
    return {
      ownerId: owner.id,
      namespace: 'custom', key: 'category_navigation', type: 'list.collection_reference',
      value: JSON.stringify(children.map((handle) => collections.get(handle)?.id || fail(`Missing navigation child ${handle}.`))),
      compareDigest: owner.categoryNavigation?.compareDigest || null,
    };
  });
  const metafieldData = await graphql(METAFIELDS_SET, { metafields });
  requireNoUserErrors(metafieldData.metafieldsSet.userErrors, 'Could not update collection navigation');
  console.log(`Updated main navigation and ${metafields.length} collection navigation maps.`);
}

async function publishCollections(manifest) {
  const catalog = await graphql(INSPECT);
  const onlineStore = catalog.publications.nodes.find((item) => item.name === 'Online Store');
  if (!onlineStore) fail('Online Store publication was not found.');
  const collections = new Map(catalog.collections.nodes.map((item) => [item.handle, item]));
  for (const expected of manifest.collections) {
    const collection = collections.get(expected.handle);
    if (!collection) fail(`Missing final collection ${expected.handle}.`);
    const published = collection.resourcePublicationsV2.nodes.some((item) => item.publication.id === onlineStore.id && item.isPublished);
    if (!published) {
      const data = await graphql(PUBLISH, { id: collection.id, input: [{ publicationId: onlineStore.id }] });
      requireNoUserErrors(data.publishablePublish.userErrors, `Could not publish collection shell ${expected.handle}`);
    }
  }
  console.log(`Verified preview publication for ${manifest.collections.length} automated collection shells.`);
}

async function ensureCollectionPresentation(manifest) {
  const catalog = await graphql(INSPECT);
  const collections = new Map(catalog.collections.nodes.map((item) => [item.handle, item]));
  for (const expected of manifest.collections) {
    const actual = collections.get(expected.handle);
    if (!actual) fail(`Missing final collection ${expected.handle}.`);
    const needsImage = expected.image?.url && !actual.image?.url;
    const needsTemplate = actual.templateSuffix !== (expected.templateSuffix || 'snoozepod-v1');
    if (!needsImage && !needsTemplate) continue;
    const input = { id: actual.id };
    if (needsImage) input.image = { src: expected.image.url, altText: expected.image.altText || expected.title };
    if (needsTemplate) input.templateSuffix = expected.templateSuffix || 'snoozepod-v1';
    const data = await graphql(COLLECTION_UPDATE, { input });
    requireNoUserErrors(data.collectionUpdate.userErrors, `Could not restore presentation for ${expected.handle}`);
    console.log(`Restored collection presentation for ${expected.handle}.`);
  }
}

function verifyFinal(catalog, manifest, baseline) {
  assertImmutableCatalog(catalog, baseline);
  const products = new Map(catalog.products.nodes.map((item) => [item.handle, item]));
  const collections = new Map(catalog.collections.nodes.map((item) => [item.handle, item]));
  for (const expected of manifest.products) {
    const actual = products.get(expected.handle);
    if (JSON.stringify(sorted(actual.tags)) !== JSON.stringify(sorted(expected.tags))) fail(`${expected.handle} tags do not match the contract.`);
    if (actual.templateSuffix !== expected.desiredTemplateSuffix) fail(`${expected.handle} template is ${actual.templateSuffix}.`);
  }
  for (const expected of manifest.collections) {
    const actual = collections.get(expected.handle);
    if (!actual || !ruleMatches(actual, expected.ruleTag)) fail(`${expected.handle} is not the expected automated collection.`);
    const actualProducts = sorted(actual.products.nodes.map((product) => product.handle));
    if (JSON.stringify(actualProducts) !== JSON.stringify(sorted(expected.expectedProducts))) fail(`${expected.handle} membership mismatch.`);
    if (!actual.image?.url) fail(`${expected.handle} lost its collection image.`);
  }
  const legacy = catalog.collections.nodes.filter((item) => item.handle.startsWith(`legacy-${MIGRATION_KEY}-`));
  return { products, collections, legacy };
}

async function deleteLegacyCollections(legacy) {
  for (const collection of legacy) {
    const data = await graphql(COLLECTION_DELETE, { input: { id: collection.id } });
    requireNoUserErrors(data.collectionDelete.userErrors, `Could not delete archived manual collection ${collection.handle}`);
    console.log(`Deleted replaced manual collection ${collection.handle}.`);
  }
}

function writeReadback(catalog, manifest, backupDirectory) {
  const desired = new Set(manifest.collections.map((item) => item.handle));
  const payload = {
    schemaVersion: '1.0', verifiedAt: new Date().toISOString(), store: connection.shop, apiVersion: connection.apiVersion,
    backupDirectory,
    summary: {
      products: catalog.products.nodes.length,
      draftProducts: catalog.products.nodes.filter((item) => item.status === 'DRAFT').length,
      taggedProducts: catalog.products.nodes.filter((item) => item.tags.length).length,
      variants: catalog.products.nodes.reduce((sum, item) => sum + item.variants.nodes.length, 0),
      automatedCollections: catalog.collections.nodes.filter((item) => desired.has(item.handle) && item.ruleSet).length,
    },
    products: catalog.products.nodes.map((item) => ({ id: item.id, handle: item.handle, status: item.status, templateSuffix: item.templateSuffix, tags: sorted(item.tags), collections: sorted(item.collections.nodes.map((collection) => collection.handle)) })).sort((a, b) => a.handle.localeCompare(b.handle)),
    collections: catalog.collections.nodes.filter((item) => desired.has(item.handle)).map((item) => ({ id: item.id, handle: item.handle, title: item.title, ruleSet: item.ruleSet, image: item.image, products: sorted(item.products.nodes.map((product) => product.handle)), categoryNavigation: item.categoryNavigation?.value || null })).sort((a, b) => a.handle.localeCompare(b.handle)),
    mainMenu: catalog.menus.nodes.find((item) => item.handle === 'main-menu'),
  };
  fs.writeFileSync(READBACK_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

try {
  const manifest = readJson(MANIFEST_PATH);
  const baseline = readJson(BASELINE_PATH);
  if (manifest.shop !== connection.shop || manifest.products.length !== 43 || manifest.collections.length !== 25) fail('Manifest boundary does not match the authorized store/catalog.');
  const before = await graphql(INSPECT);
  assertImmutableCatalog(before, baseline);
  const plan = buildPlan(before, manifest);
  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'plan', store: connection.shop,
    productUpdates: plan.productUpdates.map((item) => ({ handle: item.handle, tags: item.tags.length, templateSuffix: item.templateSuffix })),
    automatedCollectionCreates: plan.collectionCreates.map((item) => ({ handle: item.createHandle, ruleTag: item.ruleTag, expectedProducts: item.expectedProducts.length })),
    collectionSwaps: plan.collectionSwaps.map((item) => item.handle),
    navigation: { mainMenu: true, categoryMaps: Object.keys(manifest.categoryNavigation).length },
  }, null, 2));

  if (!APPLY) {
    console.log('Plan only: no Shopify mutations were performed.');
  } else {
    const backupDirectory = backupCurrent(before, manifest);
    console.log(`Private recovery snapshot: ${backupDirectory}`);
    await updateProducts(plan);
    const afterProducts = await graphql(INSPECT);
    const createPlan = buildPlan(afterProducts, manifest);
    await createCollections(createPlan);
    await waitForMembership(manifest);
    await swapCollections(manifest);
    await updateNavigation(manifest);
    await publishCollections(manifest);
    await ensureCollectionPresentation(manifest);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    let verified = await graphql(INSPECT);
    const verification = verifyFinal(verified, manifest, baseline);
    await deleteLegacyCollections(verification.legacy);
    verified = await graphql(INSPECT);
    const finalVerification = verifyFinal(verified, manifest, baseline);
    if (finalVerification.legacy.length) fail('Legacy manual collections remain after bounded cleanup.');
    const desiredHandles = new Set(manifest.collections.map((item) => item.handle));
    if (verified.collections.nodes.filter((item) => desiredHandles.has(item.handle)).length !== 25) fail('Expected 25 final automated collections.');
    writeReadback(verified, manifest, backupDirectory);
    console.log(`Verified 43 Draft tagged products, 274 preserved variants, and 25 automated collections.`);
    console.log(`Wrote ${path.relative(ROOT, READBACK_PATH)}.`);
  }
} catch (error) {
  console.error(`Catalog restructure stopped safely: ${error.message}`);
  process.exitCode = 1;
}
