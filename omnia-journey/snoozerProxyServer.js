import express from 'express';
import axios from 'axios';
import cors from 'cors';

const app = express();
const PORT = 8787;

app.use(cors());
app.use(express.json());

app.post('/api/ask-snoozer', async (req, res) => {
  console.log("🛰️ Received POST with body:", req.body);

  try {
    const response = await axios.post(
      'https://u6zcsigqj0.execute-api.us-east-1.amazonaws.com/prod/ask-snoozer',
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    console.log("📬 Lambda Response:", response.data);
    res.status(200).json(response.data);
  } catch (error) {
    console.error("❌ Axios Proxy Error:", error.message);

    res.status(500).json({
      error: "Proxy failed to reach Lambda",
      message: error.message,
      stack: error.stack,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Proxy live at http://localhost:${PORT}`);
});
