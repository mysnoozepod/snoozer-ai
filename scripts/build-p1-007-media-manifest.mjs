import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const INVENTORY_PATH = path.join(ROOT, "docs", "p1-007", "SHOPIFY_MEDIA_INVENTORY.json");
const OUTPUT_PATH = path.join(ROOT, "docs", "p1-007", "PRODUCT_MEDIA_LIBRARY.json");
const BEDGEAR_LINKS_PATH = path.join(ROOT, "docs", "p1-007", "BEDGEAR_SOURCE_LINKS.json");
const PRIVATE_ASSET_ROOT = path.join(
  "C:\\Users\\1ones\\OneDrive\\Documents\\ChatGPT\\Private Assets",
  "Shopify",
  "P1-007",
);
const bedgearSourceLinks = fs.existsSync(BEDGEAR_LINKS_PATH)
  ? JSON.parse(fs.readFileSync(BEDGEAR_LINKS_PATH, "utf8"))
  : {};

const patternUrl = (id) => `https://pxm.patterncdn.com/${id}`;
const bgAsset = (id, fileName, role, alt) => ({
  sourceId: id,
  sourceUrl: bedgearSourceLinks[id] || patternUrl(id),
  fileName,
  role,
  alt,
  authorization: "BEDGEAR authenticated dealer media library",
});

const bedgear = {
  "12-inch-memory-foam-mattress": {
    search: "12 inch memory foam mattress",
    availableAssetCount: 20,
    selected: [
      bgAsset("8ed40231-f6ba-43b5-aa2b-758b80dcd454", "S7_Mattress_Angle_BEDGEAR.jpg", "primary", "12-inch memory foam mattress shown at an angle"),
      bgAsset("79bf83a1-cba5-4c8e-b3a6-b526d29506ff", "S7_Mattress_Corner_BEDGEAR.jpg", "detail", "12-inch memory foam mattress corner and cover detail"),
      bgAsset("ffd79485-cc8c-4007-a3c4-710170c1883c", "S7_Mattress_Lifestyle_1_BEDGEAR.jpg", "lifestyle", "12-inch memory foam mattress in a bedroom setting"),
    ],
  },
  "12-inch-hybrid-mattress": {
    search: "12 inch hybrid mattress",
    availableAssetCount: 34,
    selected: [
      bgAsset("dfc9910f-93a8-4126-ba73-dd2981243b93", "H6_Mattress_Main_1_BEDGEAR.jpg", "primary", "12-inch hybrid mattress product view"),
      bgAsset("47aef7db-d327-4295-9b5f-408a97e0359e", "H6_Mattress_angle.jpg", "detail", "12-inch hybrid mattress angle view"),
      bgAsset("fd405ccc-1f3c-4c62-9b90-92101f2e96c4", "H6_Mattress_Lifestyle_1_BEDGEAR.jpg", "lifestyle", "12-inch hybrid mattress in a bedroom setting"),
    ],
  },
  "12-inch-dual-comfort-mattress": {
    search: "12 inch dual comfort mattress",
    availableAssetCount: 65,
    selected: [
      bgAsset("08124560-3df0-4bae-8786-6fa8b8d8827a", "M3_Mattress_Angle-Style-01.jpg", "primary", "12-inch dual comfort mattress angle view"),
      bgAsset("fe9856f2-7093-4dd3-be7e-cea8f3b90bf5", "M3_Mattress_Front-Style_02.jpg", "detail", "12-inch dual comfort mattress front view"),
      bgAsset("38a08257-75bc-45e1-b530-a54af2b6f181", "M3_Mattress_Lifestyle_01.jpg", "lifestyle", "12-inch dual comfort mattress in a bedroom setting"),
    ],
  },
  "14-inch-dual-comfort-mattress": {
    search: "14 inch dual comfort mattress",
    availableAssetCount: 88,
    selected: [
      bgAsset("3c6a4b56-07b6-4590-bd4a-9d75ff146920", "BG-WEB-PDP-GALLERY-M5-MATTRESS-MAIN.jpg", "primary", "14-inch dual comfort mattress product view"),
      bgAsset("261baed7-f370-41a4-b2de-fbeb6c39bdb7", "M5_Mattress_Angle_Shot_4889.jpg", "detail", "14-inch dual comfort mattress angle view"),
      bgAsset("99a13eb4-7840-4999-8f7a-5b7696d5643f", "M5_Mattress_Models_Lifestyle_4937_copy_2.jpg", "lifestyle", "14-inch dual comfort mattress in a bedroom setting"),
    ],
  },
  "flex-l-adjustable-base": {
    search: "Flex L Adjustable Base",
    availableAssetCount: 20,
    selected: [
      bgAsset("0af53a18-5eff-4179-8a17-660d69c63294", "BGF026805-BLK_02_Flex_L_Adjustable_Base_Lifestyle_Bedroom_No_Frame_BEDGEAR.jpg", "primary", "BEDGEAR Flex L adjustable base in a bedroom"),
      bgAsset("b69eef19-88d6-423b-9177-eccdc28eccd7", "BGF026805-BLK_04_Flex_L_Adjustable_Base_Lifestyle_Flat_Bed_Frame_BEDGEAR.jpg", "lifestyle", "BEDGEAR Flex L adjustable base in a flat position"),
      bgAsset("b14b1a14-64bf-446d-b122-3268eb2ff888", "BGF026805-BLK05_Flex_L_Adjustable_Base_Lifestyle_Head_Foot_Up_Remote_BEDGEAR.jpg", "detail", "BEDGEAR Flex L adjustable base with head and foot raised"),
    ],
  },
  "flex-lsx-adjustable-base": {
    search: "Flex LSX Adjustable Base",
    availableAssetCount: 13,
    selected: [
      bgAsset("eba03ba8-76de-4a19-9410-d087f66c6c35", "BGF021105_02_Flex_LSX_Adjustable_Base_Lifestyle_Bedroom_Frame_BEDGEAR.jpg", "primary", "BEDGEAR Flex LSX adjustable base in a bedroom"),
      bgAsset("ecb8ca9f-7453-41f6-8f1b-94c2d4ee48a7", "BGF021105_04_Flex_LSX_Adjustable_Base_Lifestyle_Head_Foot_Up_Remote_BEDGEAR.jpg", "detail", "BEDGEAR Flex LSX adjustable base with head and foot raised"),
      bgAsset("83c0e35f-84da-4c05-b13f-0b366b337f1c", "BGF021105_03_Flex_LSX_Adjustable_Base_Lifestyle_Bedroom_Massage_BEDGEAR.jpg", "lifestyle", "BEDGEAR Flex LSX adjustable base in use"),
    ],
  },
  "flex-sh-adjustable-base": {
    search: "Flex SH Adjustable Base",
    availableAssetCount: 7,
    selected: [],
    missingReason: "The dealer search returned only generic adjustable-base campaign images; no file identified the Flex SH model or its split-head geometry.",
  },
  "cotton-sheet-set": {
    search: "Cotton Sheet Set",
    availableAssetCount: 6,
    selected: [
      bgAsset("4d00d279-7543-4600-ada1-e83c18328535", "Sheets-cotton.jpg", "primary", "BEDGEAR Cotton sheet set"),
      bgAsset("0f272ee3-1d89-4efa-bf47-4a284933fdc1", "COTTONSHEET-NEWSHEETS-AD4-NaturalSheet-2026-V1-4x5.jpg", "lifestyle", "BEDGEAR Cotton sheets styled on a bed"),
    ],
  },
  "dri-tec-sheet-set": {
    search: "Dri-Tec Sheet Set",
    availableAssetCount: 12,
    selected: [
      bgAsset("9d6658fc-f4b4-4afa-b975-1ead497a5b2d", "Sheets-dri-tec.jpg", "primary", "BEDGEAR Dri-Tec sheet set"),
      bgAsset("4ad1f01e-e476-44bf-8cfb-811824d9085a", "Dri-Tec_Sheets_Light_Grey_Lifestyle_4004.jpg", "lifestyle", "BEDGEAR Dri-Tec sheets in Light Grey on a bed"),
      bgAsset("00fa4526-6b14-4d17-9be5-9a870e127051", "Dri-Tec_Sheets_Light_Grey_Lifestyle_Model_5141.jpg", "lifestyle", "BEDGEAR Dri-Tec Light Grey sheets in a bedroom"),
    ],
  },
  "ver-tex-sheet-set": {
    search: "Ver-Tex Sheet Set",
    availableAssetCount: 41,
    selected: [
      bgAsset("6c1865fc-cfff-46fa-8461-6a9fd1add66e", "Sheets-VERTEX.jpg", "primary", "BEDGEAR Ver-Tex sheet set"),
      bgAsset("4e630a53-4e14-40f5-94f6-75641f291e94", "Ver-Tex_Sheets_White_Lifestyle_Model_5159.jpg", "lifestyle", "BEDGEAR Ver-Tex White sheets in a bedroom"),
      bgAsset("510dd83f-c622-4013-96c9-8cbee10fe5c8", "Splithead_Sheets_Ver-Tex_Light_Grey_Lifestyle_Model_05.jpg", "variant", "BEDGEAR Ver-Tex Light Grey split-head sheets"),
    ],
  },
  "dri-tec-mattress-protector": {
    search: "Dri-Tec Mattress Protector",
    availableAssetCount: 18,
    selected: [
      bgAsset("87b8499b-e306-452f-ad9c-69b04c545ab6", "Dri-Tec_MattressProtector_main.jpg", "primary", "BEDGEAR Dri-Tec mattress protector"),
      bgAsset("2979d679-9610-4692-a416-3f5b6ee860c2", "Dri-Tec_MattressProtector_corner.jpg", "detail", "BEDGEAR Dri-Tec mattress protector corner detail"),
      bgAsset("79677620-5e11-41f6-b8e8-5733cb2d2f5a", "Dri-Tec_Mattress_Protector_lifestyle1.jpg", "lifestyle", "BEDGEAR Dri-Tec mattress protector fitted to a bed"),
    ],
  },
  "ver-tex-mattress-protector": {
    search: "Ver-Tex Mattress Protector",
    availableAssetCount: 32,
    selected: [
      bgAsset("2497b0fc-7e93-4178-93cd-d7377399bf41", "Ver-Tex_Mattress_Protector_2022_main.jpg", "primary", "BEDGEAR Ver-Tex mattress protector"),
      bgAsset("95de6e28-a2fe-4c01-8e4d-2a3afbce5eeb", "Ver-Tex_Mattress_Protector_2022_corner.jpg", "detail", "BEDGEAR Ver-Tex mattress protector corner detail"),
      bgAsset("3c627e76-a079-4829-913c-724a10a4d990", "Ver-Tex_Mattress_Protector_2022_lifestyle1.jpg", "lifestyle", "BEDGEAR Ver-Tex mattress protector fitted to a bed"),
    ],
  },
  "stretchwick-mattress-encasement": {
    search: "Stretchwick Mattress",
    availableAssetCount: 4,
    selected: [
      bgAsset("480324ee-726a-4bec-b208-001aa40124e4", "BGM52AWFQ01_05_Stretchwick_Encasement_Lifestyle_BEDGEAR.jpg", "primary", "BEDGEAR Stretchwick six-sided mattress encasement"),
      bgAsset("cc81c1cb-6d23-43c2-b625-8912c6427287", "Mattress-Protector1-stretchwick-desktop.jpg", "detail", "BEDGEAR Stretchwick mattress protection detail"),
    ],
  },
  "light-weight-comforter": {
    search: "Light Weight Comforter",
    availableAssetCount: 7,
    selected: [
      bgAsset("8be70dc9-136e-4427-98a0-239e5074bcd6", "BGB050W50_02_Light_Weight_Comforter_Lifestyle_1_BEDGEAR.png", "primary", "BEDGEAR Light Weight comforter on a bed"),
      bgAsset("f511b1c1-f1fd-4b74-a959-ed5bea89d1e4", "BGB050W50_03_Light_Weight_Comforter_Lifestyle_2_BEDGEAR.png", "lifestyle", "BEDGEAR Light Weight comforter in a bedroom"),
    ],
  },
  "medium-weight-comforter": {
    search: "Medium Weight Comforter",
    availableAssetCount: 5,
    selected: [
      bgAsset("cad2c08b-cbd3-4bb8-b726-5fae988d2a5d", "BGB051W50_02_Medium_Weight_Comforter_Lifestyle_1_BEDGEAR.png", "primary", "BEDGEAR Medium Weight comforter on a bed"),
      bgAsset("40cb81d5-66bc-4e98-bf56-89bbce1f4cd2", "BGB051W50_03_Medium_Weight_Comforter_Lifestyle_2_BEDGEAR.png", "lifestyle", "BEDGEAR Medium Weight comforter in a bedroom"),
    ],
  },
  "ultra-weight-comforter": {
    search: "Ultra Weight Comforter",
    availableAssetCount: 6,
    selected: [
      bgAsset("5944ba14-53e8-4514-b357-fddab0541884", "BGB052W50_02_Ultra_Weight_Comforter_Lifestyle_1_BEDGEAR.png", "primary", "BEDGEAR Ultra Weight comforter on a bed"),
      bgAsset("7a7c60b6-2bae-4fe4-b7de-d89f40e43d57", "BGB052W50_03_Ultra_Weight_Comforter_Lifestyle_2_BEDGEAR.png", "lifestyle", "BEDGEAR Ultra Weight comforter in a bedroom"),
    ],
  },
  "light-grey-racetrack-duvet-sham-set": {
    search: "Racetrack Duvet",
    availableAssetCount: 10,
    selected: [
      bgAsset("e0a83f90-80b5-457e-9b27-3d33e5b2691c", "Duvet-Set-Grey-Racetrack-2025-HERO.png", "primary", "BEDGEAR Light Grey Racetrack duvet and sham set"),
      bgAsset("a7ce85dd-16bb-4156-8290-568f8e5feceb", "DUVET-BGHOME-STATIC-FEATURES-2025-V3-16x9.jpg", "detail", "BEDGEAR duvet and sham set feature view"),
    ],
  },
  "solid-white-duvet-sham-set": {
    search: "Solid White Duvet",
    availableAssetCount: 10,
    selected: [
      bgAsset("924a5ecb-98e3-4ed0-aeb8-240567643d93", "DUVET-SOLID-WHITE-1x1.jpg", "primary", "BEDGEAR Solid White duvet and sham set"),
      bgAsset("09d69dc5-4e14-4b21-9604-f52069fd1aa6", "B2B-SM-RET-DP-PRODUCT-LAUNCH-DUVETSET-SOLID-WHITE-1080x1080-Social.jpg", "lifestyle", "BEDGEAR Solid White duvet and sham set on a bed"),
    ],
  },
  "cooling-performance-throw": {
    search: "Cooling Performance Throw",
    availableAssetCount: 12,
    selected: [],
    missingReason: "The dealer search returned campaign graphics with promotional overlays, but no clean product or lifestyle photograph identified by the catalog SKU.",
  },
  "react-pro-performance-topper": {
    search: "React Pro Performance Topper",
    availableAssetCount: 14,
    selected: [],
    missingReason: "The dealer search returned promotional campaign graphics only; no clean exact product photograph was available for a primary gallery image.",
  },
};

const malouf = {
  "malouf-2-5-inch-gel-memory-foam-topper": { sourceHandle: "gel-memory-foam-mattress-topper", maxImages: 4 },
  "carboncool-omniphase-pillow": { sourceHandle: "carboncool-pillow", maxImages: 4 },
  "convolution-pillow": { sourceHandle: "convolution-pillow", maxImages: 4 },
  "gel-convolution-pillow": { sourceHandle: "gel-convolution-pillow", maxImages: 4 },
  "gel-dough-z-gel-pillow": { sourceHandle: "gel-dough-z-gel-pillow", maxImages: 4 },
  "gelled-microfiber-pillow": { sourceHandle: "gelled-microfiber-pillow", maxImages: 4 },
  "hexcurve-omniphase-pillow": { sourceHandle: "hexcurve-pillow", maxImages: 4 },
  "ice-cloud-omniphase-pillow": { sourceHandle: "ice-cloud-pillow", maxImages: 4 },
  "quilted-convolution-hyperchill-pillow": { sourceHandle: "quilted-convolution-pillow", maxImages: 4 },
  "shoulder-zoned-gel-activedough-pillow": { sourceHandle: "shoulder-zoned-gel-activedough", maxImages: 4 },
  "zoned-talalay-latex-pillow": { sourceHandle: "zoned-talalay-latex-pillow", maxImages: 4 },
  "zoned-activedough-bamboo-charcoal-pillow": {
    sourceHandle: "zoned-activedough-pillow",
    primaryPattern: "BambooCharcoal-ENstraitCROP",
    maxImages: 4,
  },
  "zoned-gel-activedough-pillow": {
    sourceHandle: "zoned-activedough-pillow",
    primaryPattern: "ZndActDghGel-ENstraitCROP",
    maxImages: 4,
  },
  "zoned-dough-bamboo-charcoal-pillow": {
    sourceHandle: "zoned-dough-pillow",
    primaryPattern: "BambooCharcoal",
    maxImages: 4,
  },
  "zoned-gel-dough-pillow": {
    sourceHandle: "zoned-dough-pillow",
    primaryPattern: "ZndDghGel|ZonedDoughGel|Gel-EN",
    maxImages: 4,
  },
  "hennessy-upholstered-headboard": { sourceHandle: "hennessy-headboard", maxImages: 6, includeVariantImages: true },
  "carlisle-upholstered-headboard": { sourceHandle: "carlisle-headboard", maxImages: 6, includeVariantImages: true },
  "scoresby-designer-headboard": { sourceHandle: "scoresby-headboard", maxImages: 6, includeVariantImages: true },
  "blackwell-designer-headboard": { sourceHandle: "blackwell-headboard", maxImages: 6, includeVariantImages: true },
  "eastman-upholstered-platform-base": { sourceHandle: "eastman-platform-bed-frame", maxImages: 6, includeVariantImages: true },
  "watson-upholstered-platform-base": { sourceHandle: "watson-platform-bed-frame", maxImages: 6, includeVariantImages: true },
  "weekender-gel-memory-foam-pillow": {
    sourceHandle: "weekender-gel-memory-foam-pillow",
    maxImages: 4,
    missingReason: "The exact manufacturer product record is available but currently contains no image media.",
  },
  "bamboo-charcoal-pillow-cooling-cover": {
    sourceHandle: null,
    maxImages: 0,
    missingReason: "Manufacturer press materials verify the product, but no exact public product-media record or authorized downloadable product image was available.",
  },
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMaloufProduct(handle) {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    if (attempt > 1) await wait(attempt * 1500);
    const response = await fetch(`https://maloufhome.com/products/${handle}.json`);
    lastStatus = response.status;
    if (response.ok) return (await response.json()).product;
    if (response.status !== 429) break;
  }
  throw new Error(`Unable to read official Malouf product ${handle}; HTTP ${lastStatus}.`);
}

function fileNameFromUrl(url) {
  return decodeURIComponent(new URL(url).pathname.split("/").at(-1));
}

function roleForMaloufImage(image, index) {
  if (index === 0) return "primary";
  const fileName = image.fileName || fileNameFromUrl(image.sourceUrl || image.src);
  if (/wide|talent|lifestyle|bedroom/i.test(fileName)) return "lifestyle";
  if (/detail|profile|stack|corner|feature|cutaway/i.test(fileName)) return "detail";
  return "supporting";
}

function altForMaloufImage(product, role, index) {
  const suffix = {
    primary: "product view",
    lifestyle: "in a bedroom setting",
    detail: "feature detail",
    supporting: "supporting product view",
    variant: "variant view",
  }[role];
  return `${product.title.replace(/[®™]/g, "")} ${suffix}${index > 0 ? ` ${index + 1}` : ""}`;
}

const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf8"));
const productsByHandle = new Map(inventory.products.map((product) => [product.handle, product]));
const sourceCache = new Map();
const productRecords = [];

for (const product of inventory.products) {
  const base = {
    shopifyProductId: product.id,
    legacyProductId: String(product.legacyResourceId),
    title: product.title,
    handle: product.handle,
    vendor: product.vendor,
    productType: product.productType,
    status: product.status,
    currentMediaCount: product.media.nodes.length,
    selectedPrimaryImage: null,
    supportingImageOrder: [],
    variantMediaAssociations: [],
    missingMedia: null,
  };

  if (bedgear[product.handle]) {
    const source = bedgear[product.handle];
    const selected = source.selected.map((asset, index) => ({
      ...asset,
      order: index + 1,
      width: null,
      height: null,
      resolutionStatus: "Captured after local archive download",
      localPath: path.join(PRIVATE_ASSET_ROOT, "BEDGEAR", product.handle, asset.fileName),
    }));
    productRecords.push({
      ...base,
      source: {
        manufacturer: "BEDGEAR",
        library: "Pattern PXM dealer media library",
        search: source.search,
        availableAssetCount: source.availableAssetCount,
      },
      availableAssets: selected,
      selectedPrimaryImage: selected[0] || null,
      supportingImageOrder: selected,
      missingMedia: source.missingReason || null,
    });
    continue;
  }

  const config = malouf[product.handle];
  if (!config) throw new Error(`No P1-007 source mapping for ${product.handle}.`);
  if (!config.sourceHandle) {
    productRecords.push({
      ...base,
      source: { manufacturer: "Malouf", library: "Malouf Home manufacturer site", availableAssetCount: 0 },
      availableAssets: [],
      missingMedia: config.missingReason,
    });
    continue;
  }

  if (!sourceCache.has(config.sourceHandle)) {
    await wait(1200);
    sourceCache.set(config.sourceHandle, await fetchMaloufProduct(config.sourceHandle));
  }
  const sourceProduct = sourceCache.get(config.sourceHandle);
  const candidates = sourceProduct.images.map((image) => ({
    sourceId: String(image.id),
    sourceUrl: image.src,
    fileName: fileNameFromUrl(image.src),
    width: image.width,
    height: image.height,
    variantIds: image.variant_ids.map(String),
    authorization: "Malouf manufacturer product media",
  }));

  let primary = config.primaryPattern
    ? candidates.find((candidate) => new RegExp(config.primaryPattern, "i").test(candidate.fileName))
    : candidates[0];
  if (!primary && candidates.length) primary = candidates[0];
  const selected = [];
  if (primary) selected.push(primary);
  for (const candidate of candidates) {
    if (selected.length >= config.maxImages) break;
    if (!selected.some((asset) => asset.sourceId === candidate.sourceId)) selected.push(candidate);
  }

  const officialVariantsBySku = new Map(sourceProduct.variants.filter((variant) => variant.sku).map((variant) => [variant.sku, variant]));
  const findOfficialVariant = (shopifyVariant) => {
    const exact = officialVariantsBySku.get(shopifyVariant.sku);
    if (exact) return exact;
    if (!config.includeVariantImages) return null;
    const color = shopifyVariant.selectedOptions.find((option) => option.name.toLowerCase() === "color")?.value;
    if (!color) return null;
    return sourceProduct.variants.find((variant) => variant.option2 === color) || null;
  };
  if (config.includeVariantImages) {
    for (const shopifyVariant of product.variants.nodes) {
      const officialVariant = findOfficialVariant(shopifyVariant);
      const variantImage = candidates.find((candidate) => candidate.variantIds.includes(String(officialVariant?.id)));
      if (variantImage && !selected.some((asset) => asset.sourceId === variantImage.sourceId)) selected.push(variantImage);
    }
  }

  const selectedAssets = selected.map((asset, index) => {
    const role = index === 0 ? "primary" : roleForMaloufImage(asset, index);
    return {
      ...asset,
      order: index + 1,
      role,
      alt: altForMaloufImage(product, role, index),
      resolutionStatus: "Manufacturer source metadata",
      localPath: path.join(PRIVATE_ASSET_ROOT, "Malouf", product.handle, asset.fileName),
    };
  });

  const variantMediaAssociations = [];
  for (const shopifyVariant of product.variants.nodes) {
    const officialVariant = findOfficialVariant(shopifyVariant);
    if (!officialVariant) continue;
    const selectedAsset = selectedAssets.find((asset) => asset.variantIds.includes(String(officialVariant.id)));
    if (!selectedAsset) continue;
    variantMediaAssociations.push({
      shopifyVariantId: shopifyVariant.id,
      sku: shopifyVariant.sku,
      sourceAssetId: selectedAsset.sourceId,
    });
  }

  productRecords.push({
    ...base,
    source: {
      manufacturer: "Malouf",
      library: "Malouf Home manufacturer product JSON",
      productHandle: config.sourceHandle,
      productUrl: `https://maloufhome.com/products/${config.sourceHandle}`,
      availableAssetCount: candidates.length,
    },
    availableAssets: candidates,
    selectedPrimaryImage: selectedAssets[0] || null,
    supportingImageOrder: selectedAssets,
    variantMediaAssociations,
    missingMedia: selectedAssets.length ? null : config.missingReason || "No exact manufacturer image media available.",
  });
}

if (productRecords.length !== inventory.summary.products) {
  throw new Error(`Expected ${inventory.summary.products} product records, built ${productRecords.length}.`);
}

const selectedAssetCount = productRecords.reduce((sum, product) => sum + product.supportingImageOrder.length, 0);
const completedProducts = productRecords.filter((product) => product.selectedPrimaryImage).length;
const manifest = {
  generatedAt: new Date().toISOString(),
  shopifyInventoryGeneratedAt: inventory.generatedAt,
  shop: inventory.shop,
  privateAssetRoot: PRIVATE_ASSET_ROOT,
  summary: {
    products: productRecords.length,
    productsWithSelectedPrimaryMedia: completedProducts,
    productsMissingPrimaryMedia: productRecords.length - completedProducts,
    selectedAssets: selectedAssetCount,
    variantMediaAssociations: productRecords.reduce((sum, product) => sum + product.variantMediaAssociations.length, 0),
  },
  products: productRecords,
};

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest.summary, null, 2));
console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}.`);
