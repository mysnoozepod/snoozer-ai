const express = require("express");
const axios = require("axios");
const router = express.Router();

const {
  createLead,
  findLeadByEmail,
  getOrderStatus,
} = require("../services/zoho");
const {
  getZohoApiBase,
  logZohoConfigStatus,
  refreshZohoToken,
  resolveZohoConfig,
} = require("../services/zohoauth");

router.get("/crm/users", async (_req, res) => {
  try {
    const status = logZohoConfigStatus("zoho.routes.users");
    if (!status.enabled) {
      return res.status(503).json({
        error: "Zoho CRM unavailable",
        detail: "Zoho configuration is incomplete",
      });
    }

    const accessToken = await refreshZohoToken();
    const base = getZohoApiBase(resolveZohoConfig());

    const zohoResponse = await axios.get(`${base}/crm/v2/users`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    res.status(200).json(zohoResponse.data?.data || []);
  } catch (error) {
    console.error("Zoho API error:", error?.response?.data || error.message);
    res.status(500).json({
      error: "Zoho CRM API failed",
      detail: error?.response?.data || error.message,
    });
  }
});

router.post("/lead", async (req, res) => {
  try {
    const leadData = req.body;
    const existing = await findLeadByEmail(leadData.Email || leadData.email);
    const result = existing || (await createLead(leadData));
    res.status(200).json(result);
  } catch (error) {
    console.error("Zoho Lead Error:", error?.response?.data || error.message);
    res.status(500).json({
      error: "Zoho Lead operation failed",
      detail: error?.response?.data || error.message,
    });
  }
});

router.get("/order/:num", async (req, res) => {
  try {
    const orderNum = req.params.num;
    const order = await getOrderStatus(orderNum);
    res.status(200).json(order);
  } catch (error) {
    console.error("Zoho Order Error:", error?.response?.data || error.message);
    res.status(500).json({
      error: "Zoho Order lookup failed",
      detail: error?.response?.data || error.message,
    });
  }
});

module.exports = router;
