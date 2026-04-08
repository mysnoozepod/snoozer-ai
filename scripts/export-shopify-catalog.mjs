import fs from "fs";
import path from "path";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN; // e.g. mysnoozepodtest.myshopify.com
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN; // Admin API access token
const VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2024-01";

if (!SHOP || !TOKEN) {
  console.error("Missing env vars: SHOPIFY_STORE_DOMAIN and/or SHOPIFY_ADMIN_TOKEN");
  process.exit(1);
}

const endpoint = `https://${SHOP}/admin/api/${VERSION}/graphql.json`;

async function adminGraphql(query, variables = {}) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (!res.ok || json.errors) {
    console.error("Admin GraphQL error:", JSON.stringify(json, null, 2));
    throw new Error("Admin GraphQL request failed");
  }
  return json.data;
}

const PRODUCTS_QUERY = `
query Products($first:Int!, $after:String) {
  products(first:$first, after:$after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      handle
      productType
      vendor
      tags
      collections(first:20) { nodes { title handle } }
      variants(first:100) {
        nodes {
          id
          title
          sku
          price
          selectedOptions { name value }
        }
      }
    }
  }
}
`;

async function run() {
  const outDir = path.resolve("./_out");
  fs.mkdirSync(outDir, { recursive: true });

  let all = [];
  let after = null;

  while (true) {
    const data = await adminGraphql(PRODUCTS_QUERY, { first: 250, after });
    const conn = data.products;

    all.push(...conn.nodes);

    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }

  // Normalize into your canonical shape
  const catalog = all.map((p) => {
    const variants = p.variants.nodes.map((v) => {
      // Try to infer "size" from options when available
      const sizeOpt =
        v.selectedOptions?.find((o) => o.name.toLowerCase() === "size")?.value || v.title;

      return {
        title: v.title,
        size: sizeOpt,
        sku: v.sku || null,
        price: Number(v.price),
        variantGid: v.id,
      };
    });

    return {
      title: p.title,
      handle: p.handle,
      shopifyProductGid: p.id,
      vendor: p.vendor || null,
      productType: p.productType || null,
      tags: p.tags || [],
      collections: (p.collections?.nodes || []).map((c) => ({ title: c.title, handle: c.handle })),
      variants,
    };
  });

  fs.writeFileSync(path.join(outDir, "catalog.json"), JSON.stringify(catalog, null, 2));
  console.log(`✅ Exported ${catalog.length} products to _out/catalog.json`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
