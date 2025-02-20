import axios from 'axios';
import dotenv from 'dotenv';
import { getAllProductTitles, getProductDetails } from './shopify.js';

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
console.log("🔍 OpenAI API Key Sent to API:", `"${OPENAI_API_KEY}"`);

console.log("📡 API Fine-Tuning Mode Active");

// ✅ Main function to process user queries
export async function getSnoozerResponse(userMessage, userId) {
    console.log("🔍 User Query:", userMessage);

    // ✅ Check Shopify API first
    console.log("🔍 Searching Shopify API for:", userMessage);
    let productDetails = await getProductDetails(userMessage);
    if (productDetails && productDetails.price) {
        console.log("✅ Found in Shopify:", productDetails);
        return `🛏 **${productDetails.title}**\n📦 **Vendor:** ${productDetails.vendor}\n📄 **Category:** ${productDetails.product_type}\n💰 **Price:** $${productDetails.price}\n🔗 **Buy Now:** [View on Shopify](https://${process.env.SHOPIFY_STORE_URL}/products/${productDetails.handle})`;
    }

    // ✅ If Shopify fails, fallback to OpenAI
    console.log("⚠️ No structured data found. Using OpenAI fallback...");
    const productTitles = await getAllProductTitles();
    let basePrompt = `
    You are Snoozer, an AI-powered sleep expert.
    - Use structured product data from Shopify API when possible.
    - If no structured data is found, generate a response using OpenAI.
    - Always provide clear, well-formatted responses.

    **Available Products:**
    ${productTitles.join(", ")}`;

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: "gpt-4-turbo",
                messages: [
                    { role: "system", content: basePrompt },
                    { role: "user", content: userMessage }
                ],
                max_tokens: 400,
                temperature: 0.5
            },
            {
                headers: {
                    "Authorization": `Bearer ${OPENAI_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("✅ OpenAI Response:", response.data.choices[0].message.content);
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error("❌ OpenAI API Error:", error.response ? error.response.data : error.message);
        return "Sorry, I couldn't find what you're looking for.";
    }
}
