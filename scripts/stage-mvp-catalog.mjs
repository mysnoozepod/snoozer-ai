import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const manifestArgument = process.argv.find((argument) => argument.startsWith("--manifest="));
const MANIFEST_PATH = manifestArgument
  ? path.resolve(ROOT, manifestArgument.slice("--manifest=".length))
  : path.join(ROOT, "docs", "catalog", "MVP_CATALOG_MANIFEST.json");
const DEFAULT_READBACK_PATH = path.join(ROOT, "docs", "catalog", "shopify-catalog-readback.json");
const APPLY = process.argv.includes("--apply");
const SCHEMA = process.argv.includes("--schema");
const ALLOW_CONTRACT_UPDATES = process.argv.includes("--allow-contract-updates");
const EXPECTED_STORE = "mysnoozepodtest.myshopify.com";
const EXPECTED_API_VERSION = "2025-10";
const LAMBDA_FUNCTION = "snoozer-backend";
const AWS_REGION = "us-east-1";

function fail(message) {
  throw new Error(message);
}

function readShopifyConnection() {
  const raw = execFileSync(
    "aws",
    [
      "lambda",
      "get-function-configuration",
      "--function-name",
      LAMBDA_FUNCTION,
      "--region",
      AWS_REGION,
      "--query",
      "Environment.Variables.{SHOPIFY_DOMAIN:SHOPIFY_DOMAIN,SHOPIFY_ADMIN_TOKEN:SHOPIFY_ADMIN_TOKEN,SHOPIFY_ADMIN_API_VERSION:SHOPIFY_ADMIN_API_VERSION}",
      "--output",
      "json",
      "--no-cli-pager",
    ],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: "1", AWS_PAGER: "" },
    },
  );
  const variables = JSON.parse(raw);
  const shop = variables.SHOPIFY_DOMAIN;
  const token = variables.SHOPIFY_ADMIN_TOKEN;
  const apiVersion = variables.SHOPIFY_ADMIN_API_VERSION || EXPECTED_API_VERSION;

  if (shop !== EXPECTED_STORE) fail(`Refusing unexpected Shopify store: ${shop || "missing"}.`);
  if (apiVersion !== EXPECTED_API_VERSION) fail(`Refusing unexpected Admin API version: ${apiVersion}.`);
  if (!token) fail("SHOPIFY_ADMIN_TOKEN is unavailable from the existing development configuration.");
  return { shop, token, apiVersion };
}

function legacyId(gid) {
  return gid ? gid.split("/").at(-1) : null;
}

function money(value) {
  return Number(value).toFixed(2);
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} mismatch. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

const connection = readShopifyConnection();
const endpoint = `https://${connection.shop}/admin/api/${connection.apiVersion}/graphql.json`;

async function graphql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": connection.token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.errors) {
    const errors = payload?.errors?.map((error) => error.message) || [`HTTP ${response.status}`];
    fail(`Shopify Admin GraphQL failed: ${errors.join(" | ")}`);
  }
  return payload.data;
}

const CATALOG_QUERY = `
  query MvpCatalogPreflight {
    products(first: 250) {
      nodes {
        id legacyResourceId title handle status vendor productType templateSuffix
        category { id name fullName }
        collections(first: 50) { nodes { id legacyResourceId title handle } }
        variants(first: 250) {
          nodes {
            id legacyResourceId title sku barcode price
            selectedOptions { name value }
            inventoryPolicy taxable
            inventoryItem { tracked requiresShipping }
          }
        }
      }
    }
    collections(first: 250) {
      nodes {
        id legacyResourceId title handle templateSuffix
        products(first: 250) { nodes { id handle } }
      }
    }
  }
`;

const SCHEMA_QUERY = `
  query CatalogInputSchema {
    productSetInput: __type(name: "ProductSetInput") { inputFields { name type { kind name ofType { kind name } } } }
    productVariantSetInput: __type(name: "ProductVariantSetInput") { inputFields { name type { kind name ofType { kind name } } } }
    optionSetInput: __type(name: "OptionSetInput") { inputFields { name type { kind name ofType { kind name } } } }
    collectionInput: __type(name: "CollectionInput") { inputFields { name type { kind name ofType { kind name } } } }
  }
`;

const CONTRACT_FIELDS_QUERY = `
  query CatalogContractFields($ids: [ID!]!) {
    nodes(ids: $ids) {
      id
      ... on Product {
        metafields(first: 20, namespace: "custom") {
          nodes { id namespace key type value compareDigest }
        }
      }
      ... on ProductVariant {
        metafields(first: 20, namespace: "custom") {
          nodes { id namespace key type value compareDigest }
        }
      }
    }
  }
`;

async function hydrateContractFields(catalog) {
  const owners = catalog.products.nodes.flatMap((product) => [product].concat(product.variants.nodes));
  const ownersById = new Map(owners.map((owner) => [owner.id, owner]));
  for (let offset = 0; offset < owners.length; offset += 25) {
    const ids = owners.slice(offset, offset + 25).map((owner) => owner.id);
    const data = await graphql(CONTRACT_FIELDS_QUERY, { ids });
    for (const node of data.nodes) {
      if (!node) fail("Shopify returned a missing catalog owner during metafield readback.");
      ownersById.get(node.id).metafields = node.metafields || { nodes: [] };
    }
  }
  return catalog;
}

function validateManifest(manifest) {
  if (manifest.shopifyStore !== "mysnoozepodtest") fail("Manifest store is not mysnoozepodtest.");
  if (manifest.publicationRule !== "DRAFT_ONLY_UNTIL_OWNER_RELEASE_GATE") fail("Manifest publication rule is not fail-closed.");
  const expectedProductCount = manifest.expectedProductCount || 16;
  const expectedVariantCount = manifest.expectedVariantCount || 43;
  if (manifest.products.length !== expectedProductCount) fail(`Manifest must contain exactly ${expectedProductCount} products.`);
  const handles = manifest.products.map((product) => product.handle);
  const skus = manifest.products.flatMap((product) => product.variants.map((variant) => variant.sku));
  if (new Set(handles).size !== handles.length) fail("Manifest contains duplicate product handles.");
  if (new Set(skus).size !== skus.length) fail("Manifest contains duplicate SKUs.");
  if (skus.length !== expectedVariantCount) fail(`Manifest must contain exactly ${expectedVariantCount} variants.`);
  for (const product of manifest.products) {
    if (!["APPROVED", "SELECTED"].includes(product.assortmentStatus) || product.shopifyStatus !== "DRAFT") {
      fail(`${product.handle} is not approved or selected for Draft staging.`);
    }
    if (product.publicationReadiness !== "BLOCKED") fail(`${product.handle} is not publication-blocked.`);
    if (!Array.isArray(product.collections) || !product.collections.length) fail(`${product.handle} has no collection mapping.`);
  }
}

function indexCatalog(catalog) {
  const productsByHandle = new Map(catalog.products.nodes.map((product) => [product.handle, product]));
  const collectionsByHandle = new Map(catalog.collections.nodes.map((collection) => [collection.handle, collection]));
  const variantsBySku = new Map();
  for (const product of catalog.products.nodes) {
    for (const variant of product.variants.nodes) {
      if (!variant.sku) continue;
      if (variantsBySku.has(variant.sku)) fail(`Shopify already contains duplicate SKU ${variant.sku}.`);
      variantsBySku.set(variant.sku, { product, variant });
    }
  }
  return { productsByHandle, collectionsByHandle, variantsBySku };
}

function verifyProduct(expected, actual, { requireMembership = true } = {}) {
  if (!actual) fail(`Missing Shopify product ${expected.handle}.`);
  if (expected.shopifyProductId && legacyId(actual.id) !== expected.shopifyProductId) {
    fail(`${expected.handle} Shopify product ID does not match the manifest.`);
  }
  assertEqual(actual.title, expected.title, `${expected.handle} title`);
  assertEqual(actual.status, "DRAFT", `${expected.handle} status`);
  assertEqual(actual.vendor, expected.manufacturer, `${expected.handle} vendor`);
  assertEqual(actual.productType, expected.productType, `${expected.handle} product type`);
  if (expected.templateSuffix) assertEqual(actual.templateSuffix, expected.templateSuffix, `${expected.handle} template suffix`);

  const expectedVariants = new Map(expected.variants.map((variant) => [variant.sku, variant]));
  assertEqual(actual.variants.nodes.length, expectedVariants.size, `${expected.handle} variant count`);
  for (const variant of actual.variants.nodes) {
    const wanted = expectedVariants.get(variant.sku);
    if (!wanted) fail(`${expected.handle} has unexpected Shopify SKU ${variant.sku || "(blank)"}.`);
    if (wanted.shopifyVariantId && legacyId(variant.id) !== wanted.shopifyVariantId) {
      fail(`${variant.sku} Shopify variant ID does not match the manifest.`);
    }
    assertEqual(money(variant.price), wanted.referencePrice, `${variant.sku} price`);
    if (wanted.upc) assertEqual(variant.barcode, wanted.upc, `${variant.sku} barcode`);
    const actualOptions = Object.fromEntries(variant.selectedOptions.map((option) => [option.name, option.value]));
    assertEqual(actualOptions, wanted.options, `${variant.sku} options`);
    assertEqual(variant.inventoryPolicy, "DENY", `${variant.sku} inventory policy`);
    assertEqual(variant.inventoryItem.tracked, false, `${variant.sku} inventory tracking`);
    assertEqual(variant.inventoryItem.requiresShipping, true, `${variant.sku} shipping requirement`);
    assertEqual(variant.taxable, true, `${variant.sku} taxable state`);
  }

  if (requireMembership) {
    const memberships = sorted(actual.collections.nodes.map((collection) => collection.handle).filter((handle) => expected.collections.includes(handle)));
    assertEqual(memberships, sorted(expected.collections), `${expected.handle} collection membership`);
  }
}

function preflight(manifest, catalog) {
  const index = indexCatalog(catalog);
  const expectedHandles = new Set(manifest.products.map((product) => product.handle));
  const expectedSkus = new Set(manifest.products.flatMap((product) => product.variants.map((variant) => variant.sku)));

  for (const [sku, record] of index.variantsBySku) {
    if (!expectedSkus.has(sku)) continue;
    const expected = manifest.products.find((product) => product.variants.some((variant) => variant.sku === sku));
    if (record.product.handle !== expected.handle) {
      fail(`SKU ${sku} belongs to unexpected product ${record.product.handle}; refusing mutation.`);
    }
  }
  for (const handle of expectedHandles) {
    const actual = index.productsByHandle.get(handle);
    if (!actual) continue;
    const expected = manifest.products.find((product) => product.handle === handle);
    verifyProduct(expected, actual, { requireMembership: false });
  }

  const existingAnchor = manifest.products
    .map((product) => index.productsByHandle.get(product.handle))
    .find((product) => product?.category?.id);

  for (const collection of manifest.collections) {
    const existing = index.collectionsByHandle.get(collection.handle);
    if (!existing) continue;
    assertEqual(existing.title, collection.title, `${collection.handle} collection title`);
    if (collection.templateSuffix) assertEqual(existing.templateSuffix, collection.templateSuffix, `${collection.handle} collection template suffix`);
    if (collection.shopifyCollectionId && legacyId(existing.id) !== collection.shopifyCollectionId) {
      fail(`${collection.handle} collection ID does not match the manifest.`);
    }
  }

  return {
    index,
    categoryId: manifest.shopifyCategoryId || existingAnchor?.category?.id || null,
    missingCollections: manifest.collections.filter((collection) => !index.collectionsByHandle.has(collection.handle)),
    missingProducts: manifest.products.filter((product) => !index.productsByHandle.has(product.handle)),
  };
}

const COLLECTION_CREATE = `
  mutation CreateMvpCollection($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection { id legacyResourceId title handle templateSuffix }
      userErrors { field message }
    }
  }
`;

const PRODUCT_SET = `
  mutation SetMvpProduct($input: ProductSetInput!) {
    productSet(synchronous: true, input: $input) {
      product {
        id legacyResourceId title handle status vendor productType templateSuffix
        category { id name fullName }
        collections(first: 50) { nodes { id legacyResourceId title handle } }
        variants(first: 250) {
          nodes {
            id legacyResourceId title sku barcode price
            selectedOptions { name value }
            inventoryPolicy taxable
            inventoryItem { tracked requiresShipping }
          }
        }
      }
      userErrors { code field message }
    }
  }
`;

const METAFIELDS_SET = `
  mutation SetMvpContractFields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key type value compareDigest ownerType }
      userErrors { code elementIndex field message }
    }
  }
`;

function optionNames(product) {
  const names = [];
  for (const variant of product.variants) {
    for (const name of Object.keys(variant.options)) if (!names.includes(name)) names.push(name);
  }
  return names;
}

function productInput(product, categoryId, collectionsByHandle) {
  const names = optionNames(product);
  const input = {
    title: product.title,
    handle: product.handle,
    status: "DRAFT",
    vendor: product.manufacturer,
    productType: product.productType,
    collections: product.collections.map((handle) => {
      const collection = collectionsByHandle.get(handle);
      if (!collection) fail(`Cannot create ${product.handle}; missing collection ${handle}.`);
      return collection.id;
    }),
    productOptions: names.map((name, position) => ({
      name,
      position: position + 1,
      values: [...new Set(product.variants.map((variant) => variant.options[name]))].map((value) => ({ name: value })),
    })),
    variants: product.variants.map((variant, position) => {
      const input = {
        position: position + 1,
        optionValues: names.map((name) => ({ optionName: name, name: variant.options[name] })),
        price: variant.referencePrice,
        sku: variant.sku,
        inventoryPolicy: "DENY",
        taxable: true,
        inventoryItem: { sku: variant.sku, tracked: false, requiresShipping: true },
      };
      if (variant.upc) input.barcode = variant.upc;
      return input;
    }),
  };
  if (product.templateSuffix) input.templateSuffix = product.templateSuffix;
  if (categoryId) input.category = categoryId;
  return input;
}

function requireNoUserErrors(errors, label) {
  if (errors?.length) fail(`${label}: ${errors.map((error) => `${error.field || "input"}: ${error.message}`).join(" | ")}`);
}

function contractFields(manifest, catalog, { requireAll = true } = {}) {
  const index = indexCatalog(catalog);
  const fields = [];
  for (const expected of manifest.products) {
    const actual = index.productsByHandle.get(expected.handle);
    if (!actual) {
      if (requireAll) fail(`Cannot build contract fields; missing ${expected.handle}.`);
      continue;
    }
    const productContract = productContractFor(expected);
    fields.push(...Object.entries(productContract).map(([key, value]) => contractField(actual, key, value, {
      type: key === "builder_roles" ? "list.single_line_text_field" : "single_line_text_field",
      serialize: key === "builder_roles" ? JSON.stringify : String,
    })));

    const expectedVariants = new Map(expected.variants.map((variant) => [variant.sku, variant]));
    for (const actualVariant of actual.variants.nodes) {
      const wanted = expectedVariants.get(actualVariant.sku);
      if (!wanted) fail(`Cannot build contract fields; unexpected SKU ${actualVariant.sku}.`);
      const variantContract = variantContractFor(expected, wanted);
      fields.push(...Object.entries(variantContract).map(([key, value]) => contractField(actualVariant, key, value)));
    }
  }
  return fields;
}

function contractField(owner, key, entry, defaults = {}) {
  const typed = entry && typeof entry === "object" && !Array.isArray(entry) && "type" in entry && "value" in entry;
  const type = typed ? entry.type : (defaults.type || "single_line_text_field");
  const rawValue = typed ? entry.value : entry;
  const serialize = typed ? (typeof rawValue === "string" ? String : JSON.stringify) : (defaults.serialize || String);
  return {
    owner,
    ownerId: owner.id,
    namespace: "custom",
    key,
    type,
    value: serialize(rawValue),
  };
}

function productContractFor(product) {
  return product.contract || {
    assortment_status: product.assortmentStatus,
    publication_readiness: product.publicationReadiness,
    builder_roles: ["pillow"],
    owner_content_status: "PENDING",
  };
}

function variantContractFor(product, variant) {
  if (variant.contract) return variant.contract;
  const keyParts = Object.values(variant.options).map((value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  return {
    sleep_geometry: "not_applicable",
    price_verification_status: "HISTORICAL_REFERENCE",
    fulfillment_readiness: "PENDING",
    compatibility_key: [product.handle].concat(keyParts).join("-"),
  };
}

function planContractFieldWrites(fields) {
  return fields.filter((field) => {
    const existing = field.owner.metafields?.nodes?.find((metafield) => metafield.namespace === field.namespace && metafield.key === field.key);
    if (!existing) {
      field.compareDigest = null;
      return true;
    }
    if (existing.type !== field.type || existing.value !== field.value) {
      if (APPLY && ALLOW_CONTRACT_UPDATES) {
        field.compareDigest = existing.compareDigest;
        return true;
      }
      fail(`Refusing to overwrite conflicting metafield ${field.ownerId} ${field.namespace}.${field.key}.`);
    }
    return false;
  });
}

async function applyContractFields(fields) {
  const writes = planContractFieldWrites(fields);
  for (let offset = 0; offset < writes.length; offset += 25) {
    const batch = writes.slice(offset, offset + 25).map(({ owner, ...input }) => input);
    const data = await graphql(METAFIELDS_SET, { metafields: batch });
    requireNoUserErrors(data.metafieldsSet.userErrors, "Could not set catalog contract metafields");
    if (data.metafieldsSet.metafields.length !== batch.length) fail("Shopify returned an incomplete metafield batch.");
  }
  console.log(`Verified ${fields.length - writes.length} existing contract fields; wrote ${writes.length} authorized contract fields.`);
}

async function applyChanges(manifest, plan) {
  const collectionsByHandle = new Map(plan.index.collectionsByHandle);
  for (const expected of plan.missingCollections) {
    const input = { title: expected.title, handle: expected.handle };
    if (expected.templateSuffix) input.templateSuffix = expected.templateSuffix;
    const data = await graphql(COLLECTION_CREATE, { input });
    requireNoUserErrors(data.collectionCreate.userErrors, `Could not create ${expected.handle}`);
    const created = data.collectionCreate.collection;
    if (!created || created.handle !== expected.handle || created.title !== expected.title) {
      fail(`Shopify returned an unexpected collection for ${expected.handle}.`);
    }
    collectionsByHandle.set(expected.handle, created);
    console.log(`Created Draft catalog collection: ${expected.handle}`);
  }

  for (const expected of plan.missingProducts) {
    const input = productInput(expected, plan.categoryId, collectionsByHandle);
    const data = await graphql(PRODUCT_SET, { input });
    requireNoUserErrors(data.productSet.userErrors, `Could not create ${expected.handle}`);
    verifyProduct(expected, data.productSet.product);
    console.log(`Created Draft product: ${expected.handle} (${expected.variants.length} variants)`);
  }
}

function durableReadback(manifest, catalog) {
  const index = indexCatalog(catalog);
  const products = manifest.products.map((expected) => {
    const actual = index.productsByHandle.get(expected.handle);
    verifyProduct(expected, actual);
    return {
      title: actual.title,
      handle: actual.handle,
      status: actual.status,
      templateSuffix: actual.templateSuffix,
      shopifyProductId: legacyId(actual.id),
      category: actual.category,
      collections: actual.collections.nodes.map((collection) => ({
        handle: collection.handle,
        shopifyCollectionId: legacyId(collection.id),
      })),
      variants: actual.variants.nodes.map((variant) => ({
        sku: variant.sku,
        barcode: variant.barcode,
        price: money(variant.price),
        shopifyVariantId: legacyId(variant.id),
        options: Object.fromEntries(variant.selectedOptions.map((option) => [option.name, option.value])),
        contract: Object.fromEntries(variant.metafields.nodes.map((metafield) => [metafield.key, metafield.value])),
      })),
      contract: Object.fromEntries(actual.metafields.nodes.map((metafield) => [metafield.key, metafield.value])),
    };
  });
  return {
    schemaVersion: "1.0",
    verifiedAt: new Date().toISOString(),
    store: connection.shop,
    apiVersion: connection.apiVersion,
    publicationGate: "ALL_PRODUCTS_VERIFIED_DRAFT_AND_UNPUBLISHED_BY_THIS_SCRIPT",
    collections: manifest.collections.map((expected) => {
      const actual = index.collectionsByHandle.get(expected.handle);
      if (!actual) fail(`Missing expected collection ${expected.handle} during readback.`);
      if (expected.templateSuffix) assertEqual(actual.templateSuffix, expected.templateSuffix, `${expected.handle} collection template suffix`);
      return {
        title: actual.title,
        handle: actual.handle,
        templateSuffix: actual.templateSuffix,
        shopifyCollectionId: legacyId(actual.id),
      };
    }),
    products,
  };
}

function syncManifestIds(manifest, readback) {
  const collectionsByHandle = new Map(readback.collections.map((collection) => [collection.handle, collection]));
  const productsByHandle = new Map(readback.products.map((product) => [product.handle, product]));
  for (const collection of manifest.collections) {
    collection.shopifyCollectionId = collectionsByHandle.get(collection.handle)?.shopifyCollectionId || null;
  }
  for (const product of manifest.products) {
    const verified = productsByHandle.get(product.handle);
    if (!verified) fail(`Cannot sync manifest; readback lacks ${product.handle}.`);
    product.shopifyProductId = verified.shopifyProductId;
    const variantsBySku = new Map(verified.variants.map((variant) => [variant.sku, variant]));
    for (const variant of product.variants) {
      variant.shopifyVariantId = variantsBySku.get(variant.sku)?.shopifyVariantId || null;
      if (!variant.shopifyVariantId) fail(`Cannot sync manifest; readback lacks variant ${variant.sku}.`);
    }
  }
  manifest.updatedAt = new Date().toISOString().slice(0, 10);
  manifest.shopifyReadbackVerifiedAt = readback.verifiedAt;
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main() {
  if (SCHEMA) {
    const schema = await graphql(SCHEMA_QUERY);
    console.log(JSON.stringify(schema, null, 2));
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const readbackPath = manifest.readbackFile ? path.resolve(ROOT, manifest.readbackFile) : DEFAULT_READBACK_PATH;
  validateManifest(manifest);
  const before = await hydrateContractFields(await graphql(CATALOG_QUERY));
  const plan = preflight(manifest, before);
  const contractPlan = planContractFieldWrites(contractFields(manifest, before, { requireAll: false }));
  console.log(JSON.stringify({
    mode: APPLY ? "apply" : "plan",
    store: connection.shop,
    apiVersion: connection.apiVersion,
    existingProducts: before.products.nodes.length,
    existingCollections: before.collections.nodes.length,
    missingCollections: plan.missingCollections.map((collection) => collection.handle),
    missingProducts: plan.missingProducts.map((product) => product.handle),
    plannedVariantCount: plan.missingProducts.reduce((count, product) => count + product.variants.length, 0),
    missingContractFields: contractPlan.length,
  }, null, 2));

  if (!APPLY) {
    console.log("Plan only: no Shopify mutations were performed. Re-run with --apply after reviewing this exact plan.");
    return;
  }

  await applyChanges(manifest, plan);
  let after = await hydrateContractFields(await graphql(CATALOG_QUERY));
  await applyContractFields(contractFields(manifest, after));
  after = await hydrateContractFields(await graphql(CATALOG_QUERY));
  const readback = durableReadback(manifest, after);
  fs.writeFileSync(readbackPath, `${JSON.stringify(readback, null, 2)}\n`);
  syncManifestIds(manifest, readback);
  console.log(`Verified ${readback.products.length} Draft products and wrote ${path.relative(ROOT, readbackPath)}.`);
  console.log(`Synchronized verified Shopify IDs into ${path.relative(ROOT, MANIFEST_PATH)}.`);
}

main().catch((error) => {
  console.error(`Catalog staging stopped safely: ${error.message}`);
  process.exitCode = 1;
});
