import fs from 'fs';
import csv from 'csv-parser';

const products = [];

// Async wrapper to load CSV before exporting the function
let csvLoaded = false;

function loadCSV() {
  return new Promise((resolve, reject) => {
    if (csvLoaded) return resolve(products);

    fs.createReadStream('cleaned_products.csv')
      .pipe(csv())
      .on('data', (row) => {
        products.push(row);
      })
      .on('end', () => {
        console.log('✅ CSV file loaded with', products.length, 'products');
        csvLoaded = true;
        resolve(products);
      })
      .on('error', (err) => {
        console.error('❌ Error loading CSV:', err);
        reject(err);
      });
  });
}

export async function searchProducts(query = "") {
  await loadCSV();

  query = query.toLowerCase();

  const results = products.filter(product =>
    product.Title &&
    product.Title !== "Unknown" &&
    (
      product.Title.toLowerCase().includes(query) ||
      product.Handle?.toLowerCase().includes(query) ||
      product["Product Category"]?.toLowerCase().includes(query)
    )
  );

  const seenHandles = new Set();
  const uniqueResults = [];

  for (let p of results) {
    const handle = p.Handle;
    if (!handle || seenHandles.has(handle)) continue;
    seenHandles.add(handle);

    const price = p.Price || "N/A";
    const image = p.Image || null;
    const url = `https://mysnoozepodtest.myshopify.com/products/${handle}`;
    const variantId = p.ShopifyVariantId || null;

    if (!variantId) {
      console.warn(`⚠️ Skipping product with missing variantId: ${p.Title}`);
      continue;
    }

    uniqueResults.push({
      id: p.ShopifyProductId || p.Handle, // fallback if no numeric ID
      title: p.Title,
      price,
      handle,
      image,
      url,
      variantId,
      summary: `🏷️ *${p.Title}*\n💰 **$${price}**\n[View Product](${url})`
    });
  }

  return uniqueResults;
}
