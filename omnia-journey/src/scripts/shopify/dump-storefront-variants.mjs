// dump-storefront-variants.mjs
import "dotenv/config";
import fs from "fs";
import path from "path";

// Use your existing .env keys (VITE_*) with fallback to SHOPIFY_*
const SHOP =
  process.env.VITE_STORE_DOMAIN ||
  process.env.SHOPIFY_STORE_DOMAIN ||
  "";
const TOKEN =
  process.env.VITE_STOREFRONT_TOKEN ||
  process.env.SHOPIFY_STOREFRONT_TOKEN ||
  "";
const API_VERSION =
  process.env.SHOPIFY_STOREFRONT_VERSION || "2025-01";

if (!SHOP || !TOKEN) {
  console.error(
    "Missing env vars. Need VITE_STORE_DOMAIN + VITE_STOREFRONT_TOKEN (or SHOPIFY_STORE_DOMAIN + SHOPIFY_STOREFRONT_TOKEN)."
  );
  process.exit(1);
}

const endpoint = `https://${SHOP}/api/${API_VERSION}/graphql.json`;

async function gql(query, variables = {}) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (!res.ok || json.errors) {
    console.error(JSON.stringify(json.errors || json, null, 2));
    throw new Error("Storefront GraphQL failed");
  }
  return json.data;
}

const PRODUCTS_QUERY = `
query Products($first:Int!, $after:String) {
  products(first:$first, after:$after) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        title
        handle
        variants(first: 100) {
          edges {
            node {
              id
              title
              selectedOptions { name value }
            }
          }
        }
      }
    }
  }
}
`;

function csvEscape(v) {
  const s = (v ?? "").toString();
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function run() {
  const out = [];
  let after = null;

  while (true) {
    const data = await gql(PRODUCTS_QUERY, { first: 250, after });

    for (const e of data.products.edges || []) {
      const p = e.node;
      for (const ve of p.variants.edges || []) {
        const v = ve.node;
        const opts = (v.selectedOptions || [])
          .map((o) => `${o.name}:${o.value}`)
          .join("|");

        out.push({
          productHandle: p.handle,
          productTitle: p.title,
          variantTitle: v.title,
          variantGid: v.id,
          selectedOptions: opts,
        });
      }
    }

    if (!data.products.pageInfo?.hasNextPage) break;
    after = data.products.pageInfo.endCursor;
  }

  // Write to ./out so it’s tidy
  const outDir = path.join(process.cwd(), "out");
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(
    path.join(outDir, "storefront-variants.json"),
    JSON.stringify(out, null, 2)
  );

  const headers = Object.keys(out[0] || {});
  const csv = [
    headers.join(","),
    ...out.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
  ].join("\n");

  fs.writeFileSync(path.join(outDir, "storefront-variants.csv"), csv);

  console.log(`Exported ${out.length} variants.`);
  console.log(`Wrote: ${path.join(outDir, "storefront-variants.csv")}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
