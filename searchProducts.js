
import fs from 'fs';
import csv from 'csv-parser';

// Load CSV data into memory
const products = [];
fs.createReadStream('cleaned_products.csv')
  .pipe(csv())
  .on('data', (row) => {
    products.push(row);
  })
  .on('end', () => {
    console.log('CSV file successfully loaded.');
    runSearch();
  });

// Function to search products by title, handle, or category
function searchProducts(query) {
  query = query.toLowerCase();

  // Filter results
  let results = products.filter(product => 
    (product.Title.toLowerCase().includes(query) ||
    product.Handle.toLowerCase().includes(query) ||
    product['Product Category'].toLowerCase().includes(query)) &&
    product.Title !== "Unknown" // Ignore "Unknown" entries
  );

  // Remove duplicate entries by Handle
  let uniqueResults = [];
  let seenHandles = new Set();

  for (let product of results) {
    if (!seenHandles.has(product.Handle)) {
      seenHandles.add(product.Handle);
      uniqueResults.push(product);
    }
  }

  return uniqueResults;
}

// Run search query when the file is loaded
function runSearch() {
  const query = "comforter"; // Modify this to test different searches
  const searchResults = searchProducts(query);
  console.log("Search Results:", searchResults);
}
