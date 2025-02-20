import express from "express";
import { getSnoozerResponse } from "./src/services/openai.js";
import { connectMongoDB } from "./src/services/mongo.js"; // Import MongoDB connection
import dotenv from "dotenv";

dotenv.config();console.log("🔍 Using OpenAI API Key:", process.env.OPENAI_API_KEY);

console.log("🔍 DEBUG: Environment Variables Loaded");
console.log("✅ OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "Exists" : "❌ MISSING");
console.log("✅ SHOPIFY_STORE_URL:", process.env.SHOPIFY_STORE_URL ? "Exists" : "❌ MISSING");
console.log("✅ SHOPIFY_ADMIN_API_TOKEN:", process.env.SHOPIFY_ADMIN_API_TOKEN ? "Exists" : "❌ MISSING");
console.log("✅ MONGODB_URI:", process.env.MONGODB_URI ? "Exists" : "❌ MISSING");
const app = express();
app.use(express.json());

// Connect to MongoDB
connectMongoDB();

app.post("/ask-snoozer", async (req, res) => {
  const { userMessage, userId } = req.body;
  try {
    const response = await getSnoozerResponse(userMessage, userId);
    res.json({ message: response });
  } catch (error) {
    console.error("❌ FULL ERROR:", error.stack || error.message || error);
    res.status(500).json({ error: "Error generating response", details: error.message });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
