const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = require(path.join(root, 'docs', 'p1-007', 'PRODUCT_MEDIA_LIBRARY.json'));
const inventory = require(path.join(root, 'docs', 'p1-007', 'SHOPIFY_MEDIA_INVENTORY.json'));
const readback = require(path.join(root, 'docs', 'p1-007', 'SHOPIFY_MEDIA_READBACK.json'));
const environmentLiquid = fs.readFileSync(path.join(root, 'sections', 'snoozepod-environment.liquid'), 'utf8');
const productFixture = fs.readFileSync(path.join(root, 'docs', 'p1-007', 'fixture-preview', 'p1-007-product-media-fixture.html'), 'utf8');

let groups = 0;
function group(name, check) {
  check();
  groups += 1;
  console.log(`PASS ${name}`);
}

function flatMedia(products) {
  return products.flatMap((product) => product.media?.nodes || []);
}

function flatVariants(products) {
  return products.flatMap((product) => product.variants?.nodes || []);
}

function imageDimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.subarray(1, 4).toString('ascii') === 'PNG') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  assert.equal(bytes.readUInt16BE(0), 0xffd8, `${filePath} is not a JPEG or PNG.`);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    offset += length + 2;
  }
  assert.fail(`${filePath} has no readable JPEG size marker.`);
}

group('manifest summary is exact', () => {
  assert.deepEqual(manifest.summary, {
    products: 43,
    productsWithSelectedPrimaryMedia: 38,
    productsMissingPrimaryMedia: 5,
    selectedAssets: 147,
    variantMediaAssociations: 48,
  });
});

group('all manifest products are unique Draft records', () => {
  assert.equal(manifest.products.length, 43);
  assert.equal(new Set(manifest.products.map((product) => product.handle)).size, 43);
  assert.ok(manifest.products.every((product) => product.status === 'DRAFT'));
});

group('38 products have primaries and five fail closed', () => {
  assert.equal(manifest.products.filter((product) => product.selectedPrimaryImage).length, 38);
  assert.equal(manifest.products.filter((product) => !product.selectedPrimaryImage).length, 5);
});

group('missing-media products are the exact known set', () => {
  const actual = manifest.products
    .filter((product) => !product.selectedPrimaryImage)
    .map((product) => product.handle)
    .sort();
  const expected = [
    'bamboo-charcoal-pillow-cooling-cover',
    'cooling-performance-throw',
    'flex-sh-adjustable-base',
    'react-pro-performance-topper',
    'weekender-gel-memory-foam-pillow',
  ].sort();
  assert.deepEqual(actual, expected);
});

group('every missing-media product has a specific reason', () => {
  for (const product of manifest.products.filter((entry) => !entry.selectedPrimaryImage)) {
    assert.ok(product.missingMedia && product.missingMedia.length > 40, product.handle);
    assert.equal(product.supportingImageOrder.length, 0, product.handle);
  }
});

const assets = manifest.products.flatMap((product) => product.supportingImageOrder);
group('the selected archive contains 147 ordered assets', () => {
  assert.equal(assets.length, 147);
  for (const product of manifest.products.filter((entry) => entry.selectedPrimaryImage)) {
    assert.equal(product.supportingImageOrder[0].role, 'primary', product.handle);
    assert.deepEqual(
      product.supportingImageOrder.map((asset) => asset.order),
      product.supportingImageOrder.map((_, index) => index + 1),
      product.handle,
    );
  }
});

group('every selected asset has source, dimensions, alt text, and archive proof', () => {
  for (const asset of assets) {
    assert.match(asset.sourceUrl, /^https:\/\//);
    assert.ok(path.isAbsolute(asset.localPath));
    assert.ok(asset.width > 0 && asset.height > 0);
    assert.ok(asset.bytes > 0);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.ok(['primary', 'supporting', 'detail', 'lifestyle', 'variant'].includes(asset.role));
    assert.ok(asset.alt.trim().length > 4);
    assert.ok(asset.archivedAt);
  }
});

group('every selected asset exists in the private archive at its recorded size', () => {
  for (const asset of assets) {
    assert.equal(fs.statSync(asset.localPath).size, asset.bytes, asset.localPath);
  }
});

group('variant-media associations are exact and reference selected assets', () => {
  const associations = manifest.products.flatMap((product) => product.variantMediaAssociations);
  assert.equal(associations.length, 48);
  for (const product of manifest.products) {
    const sourceIds = new Set(product.supportingImageOrder.map((asset) => String(asset.sourceId)));
    for (const association of product.variantMediaAssociations) {
      assert.match(association.shopifyVariantId, /^gid:\/\/shopify\/ProductVariant\//);
      assert.ok(association.sku);
      assert.ok(sourceIds.has(String(association.sourceAssetId)), `${product.handle}: ${association.sourceAssetId}`);
    }
  }
});

group('final inventory matches the verified Shopify counts', () => {
  assert.deepEqual(inventory.summary, {
    products: 43,
    draftProducts: 43,
    productMedia: 147,
    variants: 274,
    variantsWithMedia: 48,
    collections: 18,
    collectionsWithImages: 18,
  });
});

group('durable readback matches desired media counts', () => {
  assert.deepEqual(readback.summary, {
    products: 43,
    draftProducts: 43,
    media: 147,
    variantsWithImages: 48,
    collections: 18,
    collectionsWithImages: 18,
  });
  assert.deepEqual(readback.desired, manifest.summary);
});

group('all live product media is READY image media', () => {
  const media = flatMedia(readback.products);
  assert.equal(media.length, 147);
  assert.ok(media.every((entry) => entry.status === 'READY'));
  assert.ok(media.every((entry) => entry.mediaContentType === 'IMAGE'));
  assert.ok(media.every((entry) => entry.image?.url && entry.alt && entry.image.width > 0 && entry.image.height > 0));
});

group('all products remained Draft after media staging', () => {
  assert.equal(readback.products.length, 43);
  assert.ok(readback.products.every((product) => product.status === 'DRAFT'));
});

group('48 Shopify variants have assigned images', () => {
  const variants = flatVariants(readback.products);
  assert.equal(variants.length, 274);
  assert.equal(variants.filter((variant) => variant.image?.url).length, 48);
});

group('all 18 Shopify collections have image and alt text', () => {
  assert.equal(readback.collections.length, 18);
  assert.ok(readback.collections.every((collection) => collection.image?.url));
  assert.ok(readback.collections.every((collection) => collection.image?.altText?.trim()));
});

group('product and variant commerce identity survived the media operation', () => {
  const inventoryProducts = new Map(inventory.products.map((product) => [product.id, product]));
  for (const product of readback.products) {
    const before = inventoryProducts.get(product.id);
    assert.ok(before, product.id);
    assert.equal(before.handle, product.handle);
    assert.equal(before.vendor, product.vendor);
    assert.equal(before.productType, product.productType);
    const beforeVariants = new Map(before.variants.nodes.map((variant) => [variant.id, variant]));
    for (const variant of product.variants.nodes) {
      const beforeVariant = beforeVariants.get(variant.id);
      assert.ok(beforeVariant, variant.id);
      assert.equal(beforeVariant.sku, variant.sku);
      assert.deepEqual(beforeVariant.selectedOptions, variant.selectedOptions);
    }
  }
});

group('homepage collection cards use collection imagery and stable routes', () => {
  assert.match(environmentLiquid, /linked_collection\.featured_image/);
  assert.match(environmentLiquid, /routes\.collections_url \| append: '\/' \| append: linked_collection\.handle/);
  assert.match(environmentLiquid, /widths: '200, 320, 480, 640, 800, 900'/);
  assert.match(environmentLiquid, /object-fit:\s*cover/);
});

group('authenticated desktop and mobile screenshot evidence has expected dimensions', () => {
  const expected = {
    'homepage-desktop.jpg': [1425, 990],
    'homepage-merchandising-desktop.jpg': [1425, 990],
    'homepage-mobile.jpg': [375, 812],
    'homepage-merchandising-mobile.jpg': [375, 812],
    'mattresses-collection-desktop.jpg': [1425, 990],
    'mattresses-collection-mobile.jpg': [375, 812],
  };
  for (const [name, [width, height]] of Object.entries(expected)) {
    const dimensions = imageDimensions(path.join(root, 'docs', 'p1-007', 'shopify-preview', name));
    assert.deepEqual(dimensions, { width, height }, name);
  }
});

group('representative product fixture uses exact media at desktop and mobile widths', () => {
  assert.match(productFixture, /LOCAL MEDIA FIXTURE/);
  assert.match(productFixture, /ZZQQ00GM-gelledmicrofiberpillow-EN3qtWEB\.jpg/);
  assert.match(productFixture, /ZZQQ00GM-gelledmicrofiberpillow-ENcroppedstraightWEB\.jpg/);
  assert.match(productFixture, /ZZQQ00GM-gelledmicrofiberpillow-ENprofileWEB\.jpg/);
  assert.match(productFixture, /ZZQQ00GM-gelledmicrofiberpillow-ENhandpressdetailWEB\.jpg/);
  const expected = {
    'product-v1-desktop-fixture.png': [1440, 1200],
    'product-v1-mobile-fixture.png': [390, 844],
  };
  for (const [name, [width, height]] of Object.entries(expected)) {
    const dimensions = imageDimensions(path.join(root, 'docs', 'p1-007', 'fixture-preview', name));
    assert.deepEqual(dimensions, { width, height }, name);
  }
});

console.log(`P1-007 media contract passed ${groups} assertion groups.`);
