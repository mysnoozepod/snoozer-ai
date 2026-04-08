import fs from "fs";
import path from "path";

const catalogPath = path.resolve("./_out/catalog.json");
if (!fs.existsSync(catalogPath)) {
  console.error("Missing _out/catalog.json. Run export-shopify-catalog first.");
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));

function safeSlug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function folderForProduct(p) {
  const tags = (p.tags || []).map((t) => t.toLowerCase());
  const type = (p.productType || "").toLowerCase();

  if (tags.includes("cat:mattress") || type.includes("mattress") || tags.includes("mattress")) return "products/mattress";
  if (type.includes("adjustable") || tags.includes("adjustable") || tags.includes("motion")) return "products/adjustable-base";
  if (type.includes("platform") || tags.includes("platform")) return "products/platform-base";
  if (type.includes("protector") || tags.includes("protector")) return "products/protectors";
  if (type.includes("bedding") || tags.includes("bedding")) return "products/bedding";
  return "products/furniture";
}

function pickPrimaryVariantGid(p) {
  // Prefer Queen if exists, else first variant
  const queen = p.variants.find((v) => String(v.size).toLowerCase() === "queen");
  return (queen || p.variants[0])?.variantGid || null;
}

function mdForProduct(p) {
  const primaryVariantGid = pickPrimaryVariantGid(p);

  const lines = [];
  lines.push(`Title: ${p.title}`);
  lines.push(`Handle: ${p.handle}`);
  lines.push(`ShopifyProductGid: ${p.shopifyProductGid}`);
  lines.push(`PrimaryVariantGid: ${primaryVariantGid || ""}`);
  lines.push(`Category: ${p.productType || ""}`);

  const collections = (p.collections || []).map((c) => c.title).filter(Boolean);
  lines.push(`Collections: ${collections.join(", ")}`);

  lines.push(`Tags: ${(p.tags || []).join(", ")}`);
  lines.push(`Updated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push(`# ${p.title}`);
  lines.push("");

  lines.push(`## Variants & Pricing`);
  for (const v of p.variants) {
    lines.push(`- ${v.size} — $${v.price.toFixed(2)}`);
  }

  lines.push("");
  lines.push(`## Variant IDs`);
  for (const v of p.variants) {
    lines.push(`- ${v.size}: ${v.variantGid}`);
  }

  return lines.join("\n");
}

const outBase = path.resolve("./_out/md");
for (const p of catalog) {
  const folder = folderForProduct(p);
  const fullFolder = path.join(outBase, folder);
  fs.mkdirSync(fullFolder, { recursive: true });

  const filename = `${safeSlug(p.handle || p.title)}.md`;
  fs.writeFileSync(path.join(fullFolder, filename), mdForProduct(p));
}

console.log(`✅ Wrote ${catalog.length} markdown files under _out/md/`);
