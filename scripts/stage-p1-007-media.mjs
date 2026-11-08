import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "docs", "p1-007", "PRODUCT_MEDIA_LIBRARY.json");
const RENDITIONS_PATH = path.join(ROOT, "docs", "p1-007", "FAILED_MEDIA_RENDITIONS.json");
const READBACK_PATH = path.join(ROOT, "docs", "p1-007", "SHOPIFY_MEDIA_READBACK.json");
const PRIVATE_BACKUP_ROOT = path.join(
  "C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Backups",
  "Shopify",
  "catalog-media-p1-007",
);
const APPLY = process.argv.includes("--apply");
const SCHEMA = process.argv.includes("--schema");
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

const STATE_QUERY = `
  query P1007MediaState {
    products(first: 250, sortKey: TITLE) {
      nodes {
        id legacyResourceId title handle status vendor productType templateSuffix updatedAt
        media(first: 100) {
          nodes {
            id alt mediaContentType status
            ... on MediaImage { image { id url altText width height } }
          }
        }
        variants(first: 250) {
          nodes {
            id legacyResourceId title sku price selectedOptions { name value }
            image { id url altText width height }
          }
        }
      }
    }
    collections(first: 250, sortKey: TITLE) {
      nodes {
        id legacyResourceId title handle templateSuffix updatedAt
        image { id url altText width height }
        productsCount { count }
      }
    }
  }
`;

const SCHEMA_QUERY = `
  query P1007MediaSchema {
    mutation: __schema {
      mutationType {
        fields {
          name
          args { name type { kind name ofType { kind name ofType { kind name } } } }
        }
      }
    }
    createMedia: __type(name: "CreateMediaInput") { inputFields { name type { kind name ofType { kind name } } } }
    variantMedia: __type(name: "ProductVariantAppendMediaInput") { inputFields { name type { kind name ofType { kind name } } } }
    variantMediaPayload: __type(name: "ProductVariantAppendMediaPayload") { fields { name type { kind name ofType { kind name } } } }
    collectionInput: __type(name: "CollectionInput") { inputFields { name type { kind name ofType { kind name } } } }
  }
`;

const CREATE_MEDIA = `
  mutation P1007CreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productUpdate(product: { id: $productId }, media: $media) {
      product {
        id
        media(first: 100) {
          nodes {
            id alt mediaContentType status
            ... on MediaImage { image { id url altText width height } }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

const APPEND_VARIANT_MEDIA = `
  mutation P1007AppendVariantMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
    productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

const UPDATE_COLLECTION = `
  mutation P1007UpdateCollectionImage($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection { id handle image { id url altText width height } }
      userErrors { field message }
    }
  }
`;

const CREATE_STAGED_UPLOAD = `
  mutation P1007CreateStagedUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

const DELETE_FILES = `
  mutation P1007DeleteFailedMedia($fileIds: [ID!]!) {
    fileDelete(fileIds: $fileIds) {
      deletedFileIds
      userErrors { field message }
    }
  }
`;

function requireNoErrors(errors, label) {
  if (errors?.length) fail(`${label}: ${errors.map((error) => `${error.field?.join(".") || "input"}: ${error.message}`).join(" | ")}`);
}

function commercialSnapshot(state) {
  return state.products.nodes
    .map((product) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status,
      vendor: product.vendor,
      productType: product.productType,
      templateSuffix: product.templateSuffix,
      variants: product.variants.nodes.map((variant) => ({
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        price: variant.price,
        selectedOptions: variant.selectedOptions,
      })),
    }))
    .sort((a, b) => a.handle.localeCompare(b.handle));
}

function timestampForPath() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function canonicalMediaUrl(url) {
  if (!url) return null;
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

function sourceAsset(manifest, handle, index = 0) {
  const product = manifest.products.find((entry) => entry.handle === handle);
  const asset = product?.supportingImageOrder[index];
  if (!asset) fail(`Collection source asset is unavailable: ${handle}[${index}].`);
  return asset;
}

async function stageLocalRendition(rendition) {
  const data = await graphql(CREATE_STAGED_UPLOAD, {
    input: [{
      filename: rendition.fileName,
      mimeType: rendition.mimeType,
      resource: "IMAGE",
      httpMethod: "POST",
      fileSize: String(rendition.bytes),
    }],
  });
  requireNoErrors(data.stagedUploadsCreate.userErrors, `Staged upload request failed for ${rendition.alt}`);
  const target = data.stagedUploadsCreate.stagedTargets[0];
  if (!target?.url || !target.resourceUrl) fail(`Shopify did not return a staged target for ${rendition.alt}.`);
  const form = new FormData();
  for (const parameter of target.parameters) form.append(parameter.name, parameter.value);
  const bytes = fs.readFileSync(rendition.optimizedPath);
  form.append("file", new Blob([bytes], { type: rendition.mimeType }), rendition.fileName);
  const response = await fetch(target.url, { method: "POST", body: form });
  if (!response.ok) fail(`Staged binary upload failed for ${rendition.alt}: HTTP ${response.status}.`);
  return target.resourceUrl;
}

function collectionPlan(manifest) {
  return {
    mattresses: sourceAsset(manifest, "12-inch-memory-foam-mattress", 2),
    "adjustable-bases": sourceAsset(manifest, "flex-l-adjustable-base", 0),
    bedding: sourceAsset(manifest, "dri-tec-sheet-set", 1),
    "bedroom-furniture": sourceAsset(manifest, "hennessy-upholstered-headboard", 0),
    comforters: sourceAsset(manifest, "medium-weight-comforter", 0),
    "cooling-bedding": sourceAsset(manifest, "ver-tex-sheet-set", 1),
    "filled-pillows": sourceAsset(manifest, "gelled-microfiber-pillow", 0),
    "foam-pillows": sourceAsset(manifest, "zoned-gel-dough-pillow", 0),
    furniture: sourceAsset(manifest, "eastman-upholstered-platform-base", 0),
    headboards: sourceAsset(manifest, "hennessy-upholstered-headboard", 0),
    "mattress-protectors": sourceAsset(manifest, "ver-tex-mattress-protector", 2),
    "mattress-toppers": sourceAsset(manifest, "malouf-2-5-inch-gel-memory-foam-topper", 1),
    pillows: sourceAsset(manifest, "ice-cloud-omniphase-pillow", 0),
    "platform-bases": sourceAsset(manifest, "watson-upholstered-platform-base", 0),
    "sheet-sets": sourceAsset(manifest, "cotton-sheet-set", 0),
    sheets: sourceAsset(manifest, "dri-tec-sheet-set", 1),
    "temperature-regulating-pillows": sourceAsset(manifest, "ice-cloud-omniphase-pillow", 1),
    "zoned-pillows": sourceAsset(manifest, "zoned-gel-activedough-pillow", 0),
  };
}

function writeReadback(state, manifest, note) {
  const payload = {
    generatedAt: new Date().toISOString(),
    note,
    shop: connection.shop,
    summary: {
      products: state.products.nodes.length,
      draftProducts: state.products.nodes.filter((product) => product.status === "DRAFT").length,
      media: state.products.nodes.reduce((sum, product) => sum + product.media.nodes.length, 0),
      variantsWithImages: state.products.nodes.reduce((sum, product) => sum + product.variants.nodes.filter((variant) => variant.image).length, 0),
      collections: state.collections.nodes.length,
      collectionsWithImages: state.collections.nodes.filter((collection) => collection.image).length,
    },
    desired: manifest.summary,
    products: state.products.nodes,
    collections: state.collections.nodes,
  };
  fs.mkdirSync(path.dirname(READBACK_PATH), { recursive: true });
  fs.writeFileSync(READBACK_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

if (SCHEMA) {
  const schema = await graphql(SCHEMA_QUERY);
  const relevant = schema.mutation.mutationType.fields.filter((field) =>
    ["productCreateMedia", "productUpdate", "productVariantAppendMedia", "productDeleteMedia", "fileDelete", "collectionUpdate", "stagedUploadsCreate"].includes(field.name),
  );
  console.log(JSON.stringify({
    relevantMutations: relevant,
    createMedia: schema.createMedia,
    variantMedia: schema.variantMedia,
    variantMediaPayload: schema.variantMediaPayload,
    collectionInput: schema.collectionInput,
  }, null, 2));
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const renditions = fs.existsSync(RENDITIONS_PATH)
  ? JSON.parse(fs.readFileSync(RENDITIONS_PATH, "utf8").replace(/^\uFEFF/, "")).records
  : [];
const renditionsByAlt = new Map(renditions.map((rendition) => [rendition.alt, rendition]));
const desiredCollections = collectionPlan(manifest);
const before = await graphql(STATE_QUERY);
const beforeProductsByHandle = new Map(before.products.nodes.map((product) => [product.handle, product]));
const beforeCollectionsByHandle = new Map(before.collections.nodes.map((collection) => [collection.handle, collection]));

if (before.products.nodes.length !== 43 || before.products.nodes.some((product) => product.status !== "DRAFT")) {
  fail("P1-007 requires exactly 43 Draft products before media staging.");
}
if (before.collections.nodes.length !== 18) fail("P1-007 requires exactly 18 existing collections before media staging.");

for (const product of manifest.products) {
  const live = beforeProductsByHandle.get(product.handle);
  if (!live || live.id !== product.shopifyProductId) fail(`Product identity drift for ${product.handle}.`);
}
for (const handle of Object.keys(desiredCollections)) {
  if (!beforeCollectionsByHandle.has(handle)) fail(`Missing collection ${handle}.`);
}

const plan = {
  productsReceivingMedia: manifest.products.filter((product) => product.supportingImageOrder.length).length,
  desiredProductMedia: manifest.summary.selectedAssets,
  existingProductMedia: before.products.nodes.reduce((sum, product) => sum + product.media.nodes.length, 0),
  missingMediaAdds: manifest.products.reduce((sum, desired) => {
    const liveAlts = new Set(beforeProductsByHandle.get(desired.handle).media.nodes.filter((media) => media.status === "READY").map((media) => media.alt));
    return sum + desired.supportingImageOrder.filter((asset) => !liveAlts.has(asset.alt)).length;
  }, 0),
  variantAssociations: manifest.summary.variantMediaAssociations,
  collectionsReceivingImages: Object.keys(desiredCollections).length,
  existingCollectionImages: before.collections.nodes.filter((collection) => collection.image).length,
  missingPrimaryMedia: manifest.summary.productsMissingPrimaryMedia,
};

console.log(JSON.stringify(plan, null, 2));
if (!APPLY) {
  writeReadback(before, manifest, "Plan only; no Shopify mutation was performed.");
  console.log("Plan only. Re-run with --apply after reviewing the manifest and source archive.");
} else {
fs.mkdirSync(PRIVATE_BACKUP_ROOT, { recursive: true });
const backupPath = path.join(PRIVATE_BACKUP_ROOT, `before-${timestampForPath()}.json`);
fs.writeFileSync(backupPath, `${JSON.stringify(before, null, 2)}\n`, "utf8");
console.log(`Saved recoverable pre-mutation catalog media snapshot: ${backupPath}`);

for (const desired of manifest.products) {
  const live = beforeProductsByHandle.get(desired.handle);
  const existingByAlt = new Map(live.media.nodes.filter((media) => media.alt && media.status === "READY").map((media) => [media.alt, media]));
  const missingAssets = desired.supportingImageOrder.filter((asset) => !existingByAlt.has(asset.alt));
  if (!missingAssets.length) continue;
  const mediaInputs = [];
  for (const asset of missingAssets) {
    const rendition = renditionsByAlt.get(asset.alt);
    const originalSource = rendition ? await stageLocalRendition(rendition) : asset.sourceUrl;
    mediaInputs.push({ alt: asset.alt, mediaContentType: "IMAGE", originalSource });
  }
  const data = await graphql(CREATE_MEDIA, {
    productId: live.id,
    media: mediaInputs,
  });
  requireNoErrors(data.productUpdate.userErrors, `Media upload failed for ${desired.handle}`);
  console.log(`Submitted ${missingAssets.length} images for ${desired.handle}.`);
}

let afterMedia = await graphql(STATE_QUERY);
for (let attempt = 1; attempt <= 12; attempt += 1) {
  const pending = afterMedia.products.nodes.flatMap((product) => product.media.nodes).filter((media) => media.status === "PROCESSING" || media.status === "UPLOADED");
  if (!pending.length) break;
  await new Promise((resolve) => setTimeout(resolve, 2500));
  afterMedia = await graphql(STATE_QUERY);
}

for (const desired of manifest.products) {
  const live = afterMedia.products.nodes.find((product) => product.handle === desired.handle);
  const readyAlts = new Set(live.media.nodes.filter((media) => media.status === "READY").map((media) => media.alt));
  const missing = desired.supportingImageOrder.filter((asset) => !readyAlts.has(asset.alt));
  if (missing.length) fail(`Shopify media processing did not produce READY media for ${desired.handle}: ${missing.map((asset) => asset.alt).join(", ")}.`);
}

const failedMediaIds = afterMedia.products.nodes.flatMap((product) =>
  product.media.nodes.filter((media) => media.status === "FAILED").map((media) => media.id),
);
if (failedMediaIds.length) {
  const data = await graphql(DELETE_FILES, { fileIds: failedMediaIds });
  requireNoErrors(data.fileDelete.userErrors, "Failed-media cleanup was not completed");
  if (data.fileDelete.deletedFileIds.length !== failedMediaIds.length) fail("Shopify did not confirm every exact failed-media deletion.");
  console.log(`Removed ${failedMediaIds.length} failed media records after READY replacements were verified.`);
  afterMedia = await graphql(STATE_QUERY);
}

const afterMediaProducts = new Map(afterMedia.products.nodes.map((product) => [product.handle, product]));
for (const desired of manifest.products) {
  const live = afterMediaProducts.get(desired.handle);
  const mediaByAlt = new Map(live.media.nodes.filter((media) => media.alt && media.status === "READY").map((media) => [media.alt, media]));
  const missing = desired.supportingImageOrder.filter((asset) => !mediaByAlt.has(asset.alt));
  if (missing.length) fail(`Post-upload media is missing for ${desired.handle}: ${missing.map((asset) => asset.alt).join(", ")}.`);
  const associationsByVariant = new Map();
  for (const association of desired.variantMediaAssociations) {
    const asset = desired.supportingImageOrder.find((candidate) => candidate.sourceId === association.sourceAssetId);
    const media = mediaByAlt.get(asset?.alt);
    if (!media) fail(`Variant media source is missing for ${association.sku}.`);
    const liveVariant = live.variants.nodes.find((variant) => variant.id === association.shopifyVariantId);
    if (!liveVariant) fail(`Variant identity is missing for ${association.sku}.`);
    if (liveVariant.image) {
      if (canonicalMediaUrl(liveVariant.image.url) === canonicalMediaUrl(media.image?.url)) continue;
      fail(`Variant ${association.sku} already has a different image; refusing to overwrite a possible owner edit.`);
    }
    if (!associationsByVariant.has(association.shopifyVariantId)) associationsByVariant.set(association.shopifyVariantId, []);
    associationsByVariant.get(association.shopifyVariantId).push(media.id);
  }
  if (associationsByVariant.size) {
    const data = await graphql(APPEND_VARIANT_MEDIA, {
      productId: live.id,
      variantMedia: [...associationsByVariant].map(([variantId, mediaIds]) => ({ variantId, mediaIds: [...new Set(mediaIds)] })),
    });
    requireNoErrors(data.productVariantAppendMedia.userErrors, `Variant media failed for ${desired.handle}`);
    console.log(`Associated media with ${associationsByVariant.size} variants for ${desired.handle}.`);
  }
}

for (const [handle, asset] of Object.entries(desiredCollections)) {
  const collection = beforeCollectionsByHandle.get(handle);
  const collectionAlt = `${collection.title} collection`;
  if (collection.image?.altText === collectionAlt) continue;
  const sourceProduct = manifest.products.find((product) =>
    product.supportingImageOrder.some((candidate) => candidate.alt === asset.alt && candidate.sourceId === asset.sourceId),
  );
  const readySource = afterMediaProducts
    .get(sourceProduct?.handle)
    ?.media.nodes.find((media) => media.status === "READY" && media.alt === asset.alt);
  if (!readySource?.image?.url) fail(`A READY Shopify media URL is unavailable for collection ${handle}.`);
  let data;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    data = await graphql(UPDATE_COLLECTION, {
      input: {
        id: collection.id,
        image: { src: readySource.image.url, altText: collectionAlt },
      },
    });
    if (!data.collectionUpdate.userErrors.length) break;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
  requireNoErrors(data.collectionUpdate.userErrors, `Collection image failed for ${handle}`);
  console.log(`Updated collection image: ${handle}.`);
}

const after = await graphql(STATE_QUERY);
if (JSON.stringify(commercialSnapshot(before)) !== JSON.stringify(commercialSnapshot(after))) {
  fail("Commercial product or variant fields changed during P1-007 media staging.");
}
if (after.products.nodes.some((product) => product.status !== "DRAFT")) fail("A product left Draft status during P1-007.");

const afterByHandle = new Map(after.products.nodes.map((product) => [product.handle, product]));
for (const desired of manifest.products) {
  const live = afterByHandle.get(desired.handle);
  const liveAlts = new Set(live.media.nodes.filter((media) => media.status === "READY").map((media) => media.alt));
  for (const asset of desired.supportingImageOrder) {
    if (!liveAlts.has(asset.alt)) fail(`Final verification is missing ${desired.handle}: ${asset.alt}.`);
  }
}
if (after.collections.nodes.filter((collection) => collection.image).length !== Object.keys(desiredCollections).length) {
  fail("Not all 18 collection images were verified after staging.");
}

const readback = writeReadback(after, manifest, "P1-007 media staging applied and verified; all products remained Draft.");
console.log(JSON.stringify(readback.summary, null, 2));
console.log(`Wrote ${path.relative(ROOT, READBACK_PATH)}.`);
}
