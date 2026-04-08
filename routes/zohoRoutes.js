const express = require("express");
const axios = require("axios");
const router = express.Router();

const {
  findLeadByEmail,
  createLead,
  getOrderStatus
} = require("../services/zoho");

// 🔍 GET /api/zoho/crm/users
router.get("/crm/users", async (req, res) => {
  try {
    const accessToken = await require("../services/zohoauth").refreshZohoToken();
    console.log("🔑 Zoho Access Token starts with:", accessToken.substring(0, 10));

    const zohoRes = await axios.get("https://www.zohoapis.com/crm/v2/users", {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json"
      }
    });

    res.status(200).json(zohoRes.data?.data || []);
  } catch (err) {
    console.error("❌ Zoho API error:", err?.response?.data || err.message);
    res.status(500).json({
      error: "Zoho CRM API failed",
      detail: err?.response?.data || err.message
    });
  }
});

// 🧠 POST /api/zoho/lead
router.post("/lead", async (req, res) => {
  try {
    const leadData = req.body;
    console.log("📥 Incoming lead data:", leadData);

    const existing = await findLeadByEmail(leadData.Email || leadData.email);
    const result = existing || (await createLead(leadData));

    console.log("✅ Lead response:", result);
    res.status(200).json(result);
  } catch (error) {
    console.error("❌ Zoho Lead Error:", error?.response?.data || error.message);
    res.status(500).json({
      error: "Zoho Lead operation failed",
      detail: error?.response?.data || error.message
    });
  }
});

// 📦 GET /api/zoho/order/:num
router.get("/order/:num", async (req, res) => {
  try {
    const orderNum = req.params.num;
    console.log("🔎 Looking up Zoho order:", orderNum);

    const order = await getOrderStatus(orderNum);
    console.log("✅ Order lookup response:", order);

    res.status(200).json(order);
  } catch (error) {
    console.error("❌ Zoho Order Error:", error?.response?.data || error.message);
    res.status(500).json({
      error: "Zoho Order lookup failed",
      detail: error?.response?.data || error.message
    });
  }
});

module.exports = router;
