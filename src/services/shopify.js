import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-01';

// ✅ Function to fetch all product titles from Shopify API
export async function getAllProductTitles() {
    console.log("🔍 Fetching all product titles from Shopify");

    const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json`;
    try {
        const response = await axios.get(url, {
            headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_TOKEN }
        });

        if (!response.data.products) {
            console.warn("⚠️ No products found in Shopify response.");
            return [];
        }

        const products = response.data.products.map(p => p.title);
        console.log(`🛒 Shopify returned ${products.length} products`);
        return products;
    } catch (error) {
        console.error("❌ Shopify API Error (Fetching Titles):", error.response ? JSON.stringify(error.response.data) : error.message);
        return [];
    }
}

// ✅ Function to fetch product details from Shopify API
export async function getProductDetails(productQuery) {
    console.log("🔍 Searching Shopify API for:", productQuery);

    const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json`;
    try {
        const response = await axios.get(url, {
            headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_TOKEN }
        });

        const products = response.data.products || [];
        console.log("🔍 Full Shopify API Response:", JSON.stringify(products, null, 2));

        // Improved search logic to match multiple product fields
        console.log("🔍 Available Shopify Products:");
products.forEach(p => console.log(`- ${p.title}`));

const match = products.find(p => {
    const productTitle = p.title.toLowerCase();
    const productHandle = p.handle ? p.handle.toLowerCase() : "";
    const productDescription = p.body_html ? p.body_html.toLowerCase() : "";
    
    return productTitle.includes(productQuery.toLowerCase()) ||
           productHandle.includes(productQuery.toLowerCase()) ||
           productDescription.includes(productQuery.toLowerCase());
});

if (match) {
    console.log("✅ Matched Product:", match.title);
} else {
    console.warn("⚠️ No matching products found in Shopify.");
}


        if (match) {
            console.log("✅ Found in Shopify:", match.title);
            return {
                title: match.title,
                vendor: match.vendor,
                product_type: match.product_type,
                price: match.variants[0]?.price || "N/A",
                handle: match.handle
            };
        } else {
            console.warn("⚠️ No matching products found in Shopify.");
            return null;
        }
    } catch (error) {
        console.error("❌ Shopify API Error (Fetching Product Details):", error.response ? JSON.stringify(error.response.data) : error.message);
        return null;
    }
}
