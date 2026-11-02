import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "docs", "catalog", "STOREFRONT_SKELETON_MANIFEST.json");
const READBACK_PATH = path.join(ROOT, "docs", "catalog", "storefront-skeleton-shopify-readback.json");
const SOURCE_MANIFESTS = [
  "MVP_CATALOG_MANIFEST.json",
  "BEDGEAR_CATALOG_MANIFEST.json",
  "MALOUF_FURNITURE_TOPPER_MANIFEST.json",
  "BEDGEAR_MATTRESS_CATALOG_MANIFEST.json",
];
const APPLY = process.argv.includes("--apply");

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

const connection = readShopifyConnection();
const endpoint = `https://${connection.shop}/admin/api/${connection.apiVersion}/graphql.json`;

async function graphql(query, variables = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": connection.token,
      },
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json().catch(() => null);
    const errors = payload?.errors?.map((error) => error.message) || [];
    if (errors.length && errors.every((message) => /throttled/i.test(message)) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
      continue;
    }
    if (!response.ok || !payload || errors.length) {
      fail(`Shopify Admin GraphQL failed: ${(errors.length ? errors : [`HTTP ${response.status}`]).join(" | ")}`);
    }
    return payload.data;
  }
  fail("Shopify Admin GraphQL remained throttled after bounded retries.");
}

const SCHEMA_QUERY = `
  query StorefrontSkeletonSchema {
    mutation: __type(name: "Mutation") {
      fields(includeDeprecated: true) {
        name
        args { name type { kind name ofType { kind name ofType { kind name } } } }
      }
    }
    queryRoot: __type(name: "QueryRoot") {
      fields(includeDeprecated: true) { name args { name type { kind name ofType { kind name } } } }
    }
    productInput: __type(name: "ProductUpdateInput") { inputFields { name type { kind name ofType { kind name } } } }
    collectionInput: __type(name: "CollectionInput") { inputFields { name type { kind name ofType { kind name } } } }
    menuItemInput: __type(name: "MenuItemCreateInput") { inputFields { name type { kind name ofType { kind name } } } }
    menuItemUpdateInput: __type(name: "MenuItemUpdateInput") { inputFields { name type { kind name ofType { kind name } } } }
    menuItemType: __type(name: "MenuItemType") { enumValues { name } }
    page: __type(name: "Page") { fields { name type { kind name ofType { kind name } } } }
  }
`;

const INSPECT_QUERY = `
  query StorefrontSkeletonInspection {
    products(first: 250) {
      nodes {
        id legacyResourceId title handle status productType templateSuffix
        collections(first: 50) { nodes { id legacyResourceId title handle templateSuffix } }
      }
    }
    collections(first: 250) {
      nodes {
        id legacyResourceId title handle templateSuffix
        categoryNavigation: metafield(namespace: "custom", key: "category_navigation") { id type value compareDigest }
        products(first: 250) { nodes { id legacyResourceId handle title } }
      }
    }
    menus(first: 50) {
      nodes {
        id handle title
        items { id title type url resourceId items { id title type url resourceId items { id title type url resourceId } } }
      }
    }
    pages(first: 100) { nodes { id title handle isPublished templateSuffix } }
    shop { name }
  }
`;

const COLLECTION_CREATE = `
  mutation CreateSkeletonCollection($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection { id legacyResourceId title handle templateSuffix }
      userErrors { field message }
    }
  }
`;

const COLLECTION_UPDATE = `
  mutation UpdateSkeletonCollection($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection { id legacyResourceId title handle templateSuffix }
      userErrors { field message }
    }
  }
`;

const COLLECTION_ADD_PRODUCTS = `
  mutation AddSkeletonCollectionProducts($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      collection { id handle }
      userErrors { field message }
    }
  }
`;

const PRODUCT_UPDATE = `
  mutation UpdateSkeletonProduct($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id legacyResourceId title handle status templateSuffix }
      userErrors { field message }
    }
  }
`;

const METAFIELDS_SET = `
  mutation SetSkeletonMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id ownerType namespace key type value compareDigest }
      userErrors { field message code elementIndex }
    }
  }
`;

const MENU_UPDATE = `
  mutation UpdateSkeletonMenu($id: ID!, $title: String!, $handle: String, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, handle: $handle, items: $items) {
      menu { id handle title items { id title type url resourceId items { id title type url resourceId items { id title type url resourceId } } } }
      userErrors { field message }
    }
  }
`;

const MENU_CREATE = `
  mutation CreateSkeletonMenu($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
    menuCreate(title: $title, handle: $handle, items: $items) {
      menu { id handle title items { id title type url resourceId items { id title type url resourceId items { id title type url resourceId } } } }
      userErrors { field message }
    }
  }
`;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function legacyId(gid) {
  return gid ? gid.split("/").at(-1) : null;
}

function requireNoUserErrors(errors, label) {
  if (errors?.length) fail(`${label}: ${errors.map((error) => `${error.field || "input"}: ${error.message}`).join(" | ")}`);
}

function indexBy(items, key) {
  return new Map(items.map((item) => [item[key], item]));
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} mismatch. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

function loadSourceContract() {
  const products = new Map();
  const sourceCollections = new Map();
  for (const fileName of SOURCE_MANIFESTS) {
    const manifest = readJson(path.join(ROOT, "docs", "catalog", fileName));
    for (const product of manifest.products) {
      if (products.has(product.handle)) fail(`Duplicate source product handle ${product.handle}.`);
      products.set(product.handle, product);
      for (const collectionHandle of product.collections || []) {
        if (!sourceCollections.has(collectionHandle)) sourceCollections.set(collectionHandle, []);
        sourceCollections.get(collectionHandle).push(product.handle);
      }
    }
  }
  return { products, sourceCollections };
}

function resolveCollectionProducts(collection, sourceCollections) {
  if (collection.products) return collection.products;
  const products = sourceCollections.get(collection.productsFromSourceCollection);
  if (!products) fail(`Missing source collection mapping ${collection.productsFromSourceCollection}.`);
  return products;
}

function resolveMenuItems(items, collectionsByHandle, pagesByHandle) {
  return items.map((item) => {
    const resolved = { title: item.title, type: item.type };
    if (item.collection) {
      const collection = collectionsByHandle.get(item.collection);
      if (!collection) fail(`Menu item ${item.title} references missing collection ${item.collection}.`);
      resolved.resourceId = collection.id;
    }
    if (item.page) {
      const page = pagesByHandle.get(item.page);
      if (!page || !page.isPublished) fail(`Menu item ${item.title} references missing or unpublished page ${item.page}.`);
      resolved.resourceId = page.id;
    }
    if (item.url) resolved.url = item.url;
    if (item.items?.length) resolved.items = resolveMenuItems(item.items, collectionsByHandle, pagesByHandle);
    return resolved;
  });
}

function normalizedMenuItems(items) {
  return (items || []).map((item) => ({
    title: item.title,
    type: item.type,
    resourceId: item.resourceId || null,
    items: normalizedMenuItems(item.items),
  }));
}

function buildPlan(manifest, source, catalog) {
  const productsByHandle = indexBy(catalog.products.nodes, "handle");
  const collectionsByHandle = indexBy(catalog.collections.nodes, "handle");
  const menusByHandle = indexBy(catalog.menus.nodes, "handle");
  const pagesByHandle = indexBy(catalog.pages.nodes, "handle");
  assertEqual(sorted(productsByHandle.keys()), sorted(source.products.keys()), "Shopify product handles");
  if (productsByHandle.size !== manifest.expectedProductCount) fail(`Expected ${manifest.expectedProductCount} Shopify products.`);
  for (const product of productsByHandle.values()) {
    if (product.status !== "DRAFT") fail(`${product.handle} is not Draft; refusing skeleton mutation.`);
  }

  const desiredCollections = manifest.collections.map((collection) => ({
    ...collection,
    templateSuffix: "snoozepod-v1",
    products: resolveCollectionProducts(collection, source.sourceCollections),
  }));
  const desiredCollectionHandles = new Set(desiredCollections.map((collection) => collection.handle));
  for (const existing of collectionsByHandle.values()) {
    if (!desiredCollectionHandles.has(existing.handle)) fail(`Unexpected Shopify collection ${existing.handle}; refusing broad reorganization.`);
  }

  const missingCollections = desiredCollections.filter((collection) => !collectionsByHandle.has(collection.handle));
  const collectionTemplateUpdates = desiredCollections.filter((collection) => {
    const actual = collectionsByHandle.get(collection.handle);
    return actual && actual.templateSuffix !== collection.templateSuffix;
  });
  const membershipAdds = [];
  for (const collection of desiredCollections) {
    const actual = collectionsByHandle.get(collection.handle);
    if (!actual) continue;
    const actualHandles = new Set(actual.products.nodes.map((product) => product.handle));
    const extras = [...actualHandles].filter((handle) => !collection.products.includes(handle));
    if (extras.length) fail(`${collection.handle} contains unexpected products: ${extras.join(", ")}.`);
    const missing = collection.products.filter((handle) => !actualHandles.has(handle));
    if (missing.length) membershipAdds.push({ collection, actual, handles: missing });
  }

  const productUpdates = [];
  for (const [handle, sourceProduct] of source.products) {
    const actual = productsByHandle.get(handle);
    const override = manifest.productOverrides[handle] || {};
    const desired = {
      title: override.title || sourceProduct.title,
      templateSuffix: override.templateSuffix || manifest.productTemplateDefault,
    };
    if (actual.title !== desired.title || actual.templateSuffix !== desired.templateSuffix) {
      productUpdates.push({ actual, desired });
    }
  }

  const menuPlans = [];
  for (const [handle, expected] of Object.entries(manifest.menus)) {
    const actual = menusByHandle.get(handle) || null;
    let items = null;
    try {
      items = resolveMenuItems(expected.items, collectionsByHandle, pagesByHandle);
    } catch (error) {
      if (!missingCollections.length) throw error;
    }
    const matches = actual && actual.title === expected.title &&
      items &&
      JSON.stringify(normalizedMenuItems(actual.items)) === JSON.stringify(normalizedMenuItems(items));
    if (!matches) menuPlans.push({ handle, expected, actual, items });
  }

  const navigationPlans = [];
  for (const [ownerHandle, childHandles] of Object.entries(manifest.categoryNavigation)) {
    const owner = collectionsByHandle.get(ownerHandle);
    if (!owner) continue;
    const missingChild = childHandles.find((handle) => !collectionsByHandle.has(handle));
    if (missingChild) {
      if (!missingCollections.length) fail(`Category navigation ${ownerHandle} references missing ${missingChild}.`);
      continue;
    }
    const childIds = childHandles.map((handle) => collectionsByHandle.get(handle).id);
    const desiredValue = JSON.stringify(childIds);
    const current = owner.categoryNavigation;
    if (!current || current.type !== "list.collection_reference" || current.value !== desiredValue) {
      if (current && current.type !== "list.collection_reference") fail(`${ownerHandle} category_navigation has conflicting type ${current.type}.`);
      navigationPlans.push({ owner, desiredValue, compareDigest: current?.compareDigest || null });
    }
  }

  return {
    productsByHandle,
    collectionsByHandle,
    menusByHandle,
    pagesByHandle,
    desiredCollections,
    missingCollections,
    collectionTemplateUpdates,
    membershipAdds,
    productUpdates,
    menuPlans,
    navigationPlans,
  };
}

async function createCollections(plan) {
  for (const collection of plan.missingCollections) {
    const productIds = collection.products.map((handle) => plan.productsByHandle.get(handle)?.id || fail(`Missing product ${handle}.`));
    const data = await graphql(COLLECTION_CREATE, {
      input: { title: collection.title, handle: collection.handle, templateSuffix: collection.templateSuffix, products: productIds },
    });
    requireNoUserErrors(data.collectionCreate.userErrors, `Could not create ${collection.handle}`);
    console.log(`Created collection ${collection.handle} with ${productIds.length} products.`);
  }
}

async function updateCollections(plan) {
  for (const collection of plan.collectionTemplateUpdates) {
    const actual = plan.collectionsByHandle.get(collection.handle);
    const data = await graphql(COLLECTION_UPDATE, { input: { id: actual.id, templateSuffix: collection.templateSuffix } });
    requireNoUserErrors(data.collectionUpdate.userErrors, `Could not assign ${collection.handle} template`);
    console.log(`Assigned Collection Page v1 to ${collection.handle}.`);
  }
  for (const addition of plan.membershipAdds) {
    const productIds = addition.handles.map((handle) => plan.productsByHandle.get(handle).id);
    const data = await graphql(COLLECTION_ADD_PRODUCTS, { id: addition.actual.id, productIds });
    requireNoUserErrors(data.collectionAddProducts.userErrors, `Could not organize ${addition.collection.handle}`);
    console.log(`Added ${productIds.length} products to ${addition.collection.handle}.`);
  }
}

async function updateProducts(plan) {
  for (const update of plan.productUpdates) {
    const data = await graphql(PRODUCT_UPDATE, {
      product: { id: update.actual.id, title: update.desired.title, templateSuffix: update.desired.templateSuffix },
    });
    requireNoUserErrors(data.productUpdate.userErrors, `Could not update ${update.actual.handle}`);
    if (data.productUpdate.product.status !== "DRAFT") fail(`${update.actual.handle} did not remain Draft.`);
    console.log(`Updated Draft product presentation: ${update.actual.handle}.`);
  }
}

async function updateNavigationMetafields(plans) {
  if (!plans.length) return;
  const inputs = plans.map((plan) => ({
    ownerId: plan.owner.id,
    namespace: "custom",
    key: "category_navigation",
    type: "list.collection_reference",
    value: plan.desiredValue,
    compareDigest: plan.compareDigest,
  }));
  const data = await graphql(METAFIELDS_SET, { metafields: inputs });
  requireNoUserErrors(data.metafieldsSet.userErrors, "Could not set collection category navigation");
  console.log(`Wrote ${inputs.length} collection navigation mappings.`);
}

async function updateMenus(plans) {
  for (const plan of plans) {
    if (plan.actual) {
      const data = await graphql(MENU_UPDATE, {
        id: plan.actual.id,
        title: plan.expected.title,
        handle: plan.handle,
        items: plan.items,
      });
      requireNoUserErrors(data.menuUpdate.userErrors, `Could not update ${plan.handle}`);
      console.log(`Updated navigation menu ${plan.handle}.`);
    } else {
      const data = await graphql(MENU_CREATE, { title: plan.expected.title, handle: plan.handle, items: plan.items });
      requireNoUserErrors(data.menuCreate.userErrors, `Could not create ${plan.handle}`);
      console.log(`Created navigation menu ${plan.handle}.`);
    }
  }
}

function readback(manifest, catalog) {
  const products = catalog.products.nodes.map((product) => ({
    title: product.title,
    handle: product.handle,
    status: product.status,
    productType: product.productType,
    templateSuffix: product.templateSuffix,
    shopifyProductId: legacyId(product.id),
    collections: sorted(product.collections.nodes.map((collection) => collection.handle)),
  })).sort((a, b) => a.handle.localeCompare(b.handle));
  const collections = catalog.collections.nodes.map((collection) => ({
    title: collection.title,
    handle: collection.handle,
    templateSuffix: collection.templateSuffix,
    shopifyCollectionId: legacyId(collection.id),
    products: sorted(collection.products.nodes.map((product) => product.handle)),
    categoryNavigation: collection.categoryNavigation?.value ? JSON.parse(collection.categoryNavigation.value).map(legacyId) : [],
  })).sort((a, b) => a.handle.localeCompare(b.handle));
  const menus = catalog.menus.nodes
    .filter((menu) => Object.hasOwn(manifest.menus, menu.handle))
    .map((menu) => ({ id: legacyId(menu.id), handle: menu.handle, title: menu.title, items: menu.items }))
    .sort((a, b) => a.handle.localeCompare(b.handle));
  return {
    schemaVersion: "1.0",
    verifiedAt: new Date().toISOString(),
    store: connection.shop,
    apiVersion: connection.apiVersion,
    publicationBoundary: "ALL_43_PRODUCTS_REMAIN_DRAFT_NO_THEME_PUBLICATION",
    products,
    collections,
    menus,
  };
}

try {
  if (process.argv.includes("--schema")) {
    const data = await graphql(SCHEMA_QUERY);
    data.mutation.fields = data.mutation.fields.filter((field) => /^(menu|productUpdate|collection)/.test(field.name));
    data.queryRoot.fields = data.queryRoot.fields.filter((field) => /polic/i.test(field.name));
    console.log(JSON.stringify(data, null, 2));
  } else if (process.argv.includes("--inspect")) {
    const data = await graphql(INSPECT_QUERY);
    console.log(JSON.stringify({ store: connection.shop, apiVersion: connection.apiVersion, ...data }, null, 2));
  } else {
    const manifest = readJson(MANIFEST_PATH);
    if (manifest.shopifyStore !== "mysnoozepodtest") fail("Skeleton manifest targets an unexpected store.");
    const source = loadSourceContract();
    const before = await graphql(INSPECT_QUERY);
    let plan = buildPlan(manifest, source, before);
    console.log(JSON.stringify({
      mode: APPLY ? "apply" : "plan",
      store: connection.shop,
      existingProducts: before.products.nodes.length,
      existingCollections: before.collections.nodes.length,
      missingCollections: plan.missingCollections.map((collection) => collection.handle),
      collectionTemplateUpdates: plan.collectionTemplateUpdates.map((collection) => collection.handle),
      membershipAdds: plan.membershipAdds.map((entry) => ({ collection: entry.collection.handle, products: entry.handles })),
      productUpdates: plan.productUpdates.map((entry) => ({ handle: entry.actual.handle, ...entry.desired })),
      menuUpdates: plan.menuPlans.map((entry) => entry.handle),
      categoryNavigationUpdates: plan.navigationPlans.map((entry) => entry.owner.handle),
    }, null, 2));
    if (!APPLY) {
      console.log("Plan only: no Shopify mutations were performed. Re-run with --apply after reviewing this exact plan.");
    } else {
      await createCollections(plan);
      const afterCreate = await graphql(INSPECT_QUERY);
      plan = buildPlan(manifest, source, afterCreate);
      await updateCollections(plan);
      await updateProducts(plan);
      const afterCatalog = await graphql(INSPECT_QUERY);
      plan = buildPlan(manifest, source, afterCatalog);
      await updateNavigationMetafields(plan.navigationPlans);
      await updateMenus(plan.menuPlans);
      const finalCatalog = await graphql(INSPECT_QUERY);
      const finalPlan = buildPlan(manifest, source, finalCatalog);
      const remaining = finalPlan.missingCollections.length + finalPlan.collectionTemplateUpdates.length +
        finalPlan.membershipAdds.length + finalPlan.productUpdates.length + finalPlan.menuPlans.length + finalPlan.navigationPlans.length;
      if (finalCatalog.collections.nodes.length !== manifest.expectedCollectionCount) {
        fail(`Expected ${manifest.expectedCollectionCount} final collections, received ${finalCatalog.collections.nodes.length}.`);
      }
      if (remaining) fail(`Skeleton reconciliation left ${remaining} unresolved changes.`);
      const durable = readback(manifest, finalCatalog);
      fs.writeFileSync(READBACK_PATH, `${JSON.stringify(durable, null, 2)}\n`, "utf8");
      const verifiedIds = {
        products: Object.fromEntries(durable.products.map((product) => [product.handle, product.shopifyProductId])),
        collections: Object.fromEntries(durable.collections.map((collection) => [collection.handle, collection.shopifyCollectionId])),
        menus: Object.fromEntries(durable.menus.map((menu) => [menu.handle, menu.id])),
      };
      fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify({ ...manifest, verifiedIds }, null, 2)}\n`, "utf8");
      console.log(`Verified ${durable.products.length} Draft products, ${durable.collections.length} collections, and ${durable.menus.length} menus.`);
      console.log(`Wrote ${path.relative(ROOT, READBACK_PATH)} and synchronized verified IDs into the skeleton manifest.`);
    }
  }
} catch (error) {
  console.error(`Storefront skeleton staging stopped safely: ${error.message}`);
  process.exitCode = 1;
}
