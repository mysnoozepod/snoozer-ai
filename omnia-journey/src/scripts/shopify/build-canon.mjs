import fs from "fs";
import path from "path";

// Paths (repo-root assumed)
const repoRoot = process.cwd();
const variantsPath = path.join(repoRoot, "out", "storefront-variants.json");
const allowlistPath = path.join(repoRoot, "catalog", "showroom-handles.txt");

const outDir = path.join(repoRoot, "out", "canon");
const mdDir = path.join(outDir, "products");

function readAllowlist(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const txt = fs.readFileSync(filePath, "utf8");
  const handles = txt
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(handles);
}

function groupByHandle(rows) {
  const map = new Map();
  for (const r of rows) {
    const h = r.productHandle;
    if (!map.has(h)) map.set(h, []);
    map.get(h).push(r);
  }
  return map;
}

function extractOptionValue(selectedOptions, optionName) {
  // selectedOptions string looks like: "Size:Queen|Firmness:Medium"
  if (!selectedOptions) return null;
  const parts = selectedOptions.split("|");
  for (const p of parts) {
    const [k, v] = p.split(":");
    if ((k || "").trim().toLowerCase() === optionName.toLowerCase()) return (v || "").trim();
  }
  return null;
}

function buildSizeMap(variants) {
  // Priority: use "Size" option if present, else fall back to variantTitle
  const sizeMap = {};
  for (const v of variants) {
    const size = extractOptionValue(v.selectedOptions, "Size") || v.variantTitle;
    if (!size) continue;
    sizeMap[size] = v.variantGid;
  }
  return sizeMap;
}

function mdForProduct(handle, variants) {
  const title = variants[0]?.productTitle || handle;

  // Table rows
  const rows = variants.map((v) => {
    const size = extractOptionValue(v.selectedOptions, "Size") || v.variantTitle;
    return `| ${size} | ${v.variantGid} | ${v.variantTitle} |`;
  });

  return [
    `Title: ${title}`,
    `Handle: ${handle}`,
    `Type: product`,
    `Collections: showroom-core`,
    `Tags: showroom, wired`,
    `Updated: ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `# ${title}`,
    ``,
    `## Variant Wiring (Storefront GIDs)`,
    ``,
    `| Size/Option | variantGid | Shopify Variant Title |`,
    `|---|---|---|`,
    ...rows,
    ``,
    `## Notes`,
    `- This file is auto-generated from out/storefront-variants.json`,
    `- Update catalog/showroom-handles.txt to control what’s included`,
    ``,
  ].join("\n");
}

function main() {
  if (!fs.existsSync(variantsPath)) {
    console.error(`Missing ${variantsPath}. Run the dump script first.`);
    process.exit(1);
  }

  const allow = readAllowlist(allowlistPath);

  const rows = JSON.parse(fs.readFileSync(variantsPath, "utf8"));
  const byHandle = groupByHandle(rows);

  fs.mkdirSync(mdDir, { recursive: true });

  const products = {};
  const handles = Array.from(byHandle.keys()).sort();

  for (const handle of handles) {
    if (allow && !allow.has(handle)) continue;

    const variants = byHandle.get(handle);
    const sizeMap = buildSizeMap(variants);

    products[handle] = {
      handle,
      title: variants[0]?.productTitle || handle,
      variantsCount: variants.length,
      sizeMap,
    };

    // Write product md
    const md = mdForProduct(handle, variants);
    fs.writeFileSync(path.join(mdDir, `${handle}.md`), md);
  }

  const canon = {
    version: new Date().toISOString(),
    source: "storefront-variants.json",
    products,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "canon.json"), JSON.stringify(canon, null, 2));

  console.log(`Wrote canon: ${path.join(outDir, "canon.json")}`);
  console.log(`Wrote product md files: ${mdDir}`);
  console.log(`Products included: ${Object.keys(products).length}`);
}

main();
