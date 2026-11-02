const fs = require('node:fs');
const path = require('node:path');

const manifestPath = path.resolve(__dirname, '..', 'docs', 'catalog', 'MVP_CATALOG_MANIFEST.json');
const outputPath = path.resolve(__dirname, '..', 'docs', 'catalog', 'import', 'malouf-pillows-p1-005b.csv');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const headers = [
  'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type', 'Tags', 'Published',
  'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
  'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker', 'Variant Inventory Qty',
  'Variant Inventory Policy', 'Variant Fulfillment Service', 'Variant Price', 'Variant Compare At Price',
  'Variant Requires Shipping', 'Variant Taxable', 'Variant Barcode', 'Image Src', 'Image Position',
  'Image Alt Text', 'Gift Card', 'SEO Title', 'SEO Description', 'Google Shopping / Google Product Category',
  'Google Shopping / Gender', 'Google Shopping / Age Group', 'Google Shopping / MPN',
  'Google Shopping / AdWords Grouping', 'Google Shopping / AdWords Labels', 'Google Shopping / Condition',
  'Google Shopping / Custom Product', 'Google Shopping / Custom Label 0', 'Google Shopping / Custom Label 1',
  'Google Shopping / Custom Label 2', 'Google Shopping / Custom Label 3', 'Google Shopping / Custom Label 4',
  'Variant Image', 'Variant Weight Unit', 'Variant Tax Code', 'Cost per item', 'Price / International',
  'Compare At Price / International', 'Status'
];

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function rowFor(product, variant, index) {
  const options = Object.entries(variant.options);
  const values = {
    Handle: product.handle,
    Title: index === 0 ? product.title : '',
    'Body (HTML)': '',
    Vendor: index === 0 ? product.manufacturer : '',
    'Product Category': index === 0 ? 'Home & Garden > Linens & Bedding > Bedding > Pillows' : '',
    Type: index === 0 ? product.productType : '',
    Tags: '',
    Published: 'FALSE',
    'Option1 Name': options[0]?.[0] || '',
    'Option1 Value': options[0]?.[1] || '',
    'Option2 Name': options[1]?.[0] || '',
    'Option2 Value': options[1]?.[1] || '',
    'Option3 Name': options[2]?.[0] || '',
    'Option3 Value': options[2]?.[1] || '',
    'Variant SKU': variant.sku,
    'Variant Grams': '0',
    'Variant Inventory Tracker': '',
    'Variant Inventory Qty': '0',
    'Variant Inventory Policy': 'deny',
    'Variant Fulfillment Service': 'manual',
    'Variant Price': variant.referencePrice,
    'Variant Compare At Price': '',
    'Variant Requires Shipping': 'TRUE',
    'Variant Taxable': 'TRUE',
    'Variant Barcode': '',
    'Image Src': '',
    'Image Position': '',
    'Image Alt Text': '',
    'Gift Card': 'FALSE',
    'SEO Title': '',
    'SEO Description': '',
    'Google Shopping / Google Product Category': '',
    'Google Shopping / Gender': '',
    'Google Shopping / Age Group': '',
    'Google Shopping / MPN': '',
    'Google Shopping / AdWords Grouping': '',
    'Google Shopping / AdWords Labels': '',
    'Google Shopping / Condition': '',
    'Google Shopping / Custom Product': '',
    'Google Shopping / Custom Label 0': '',
    'Google Shopping / Custom Label 1': '',
    'Google Shopping / Custom Label 2': '',
    'Google Shopping / Custom Label 3': '',
    'Google Shopping / Custom Label 4': '',
    'Variant Image': '',
    'Variant Weight Unit': 'lb',
    'Variant Tax Code': '',
    'Cost per item': '',
    'Price / International': '',
    'Compare At Price / International': '',
    Status: 'draft'
  };
  return headers.map((header) => csvCell(values[header])).join(',');
}

const newProducts = manifest.products.filter((product) => product.shopifyProductId == null);
const rows = [headers.join(',')];
for (const product of newProducts) {
  product.variants.forEach((variant, index) => rows.push(rowFor(product, variant, index)));
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${rows.join('\n')}\n`, 'utf8');
console.log(`Created ${outputPath} with ${newProducts.length} products and ${rows.length - 1} variant rows.`);

