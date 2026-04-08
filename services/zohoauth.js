// services/zohoauth.js
//
// Zoho OAuth helper with:
// - in-memory token cache (warm Lambda reuse)
// - expiry buffer to avoid edge-of-expiration failures
// - single-flight refresh so concurrent requests don't double-refresh
//
// IMPORTANT: do NOT log access tokens to CloudWatch.

const axios = require("axios");

// Read all Zoho config from env
const OAUTH_DOMAIN = process.env.ZCRM_OAUTH_DOMAIN;
const API_DOMAIN = process.env.ZCRM_API_DOMAIN;
const CLIENT_ID = process.env.ZCRM_CLIENT_ID;
const CLIENT_SECRET = process.env.ZCRM_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.ZCRM_REFRESH_TOKEN;

// How early (seconds) we refresh before actual expiry
const EXPIRY_SKEW_SEC = Number(process.env.ZOHO_TOKEN_EXPIRY_SKEW_SEC || 90);

if (!OAUTH_DOMAIN || !API_DOMAIN || !CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.warn("🛑 Missing one of Zoho env vars:", {
    OAUTH_DOMAIN: !!OAUTH_DOMAIN,
    API_DOMAIN: !!API_DOMAIN,
    CLIENT_ID: !!CLIENT_ID,
    CLIENT_SECRET: !!CLIENT_SECRET,
    REFRESH_TOKEN: !!REFRESH_TOKEN,
  });
}

// ─────────────────────────────────────────────
// In-memory cache (per Lambda runtime)
// ─────────────────────────────────────────────

let cachedToken = null;           // string
let cachedTokenExpMs = 0;         // epoch ms
let inflightRefresh = null;       // Promise<string> | null

function nowMs() {
  return Date.now();
}

function isTokenValid() {
  if (!cachedToken) return false;
  if (!cachedTokenExpMs) return false;
  return nowMs() < cachedTokenExpMs;
}

/**
 * Refreshes Zoho access token using refresh token.
 * Returns fresh access_token string.
 *
 * Uses cache + single-flight behavior.
 */
async function refreshZohoToken() {
  // Fast path: cached token still valid
  if (isTokenValid()) return cachedToken;

  // If a refresh is already running, await it
  if (inflightRefresh) return inflightRefresh;

  inflightRefresh = (async () => {
    try {
      const url = `${OAUTH_DOMAIN}/oauth/v2/token`;

      console.log("🔁 Refreshing Zoho token");

      const res = await axios.post(url, null, {
        params: {
          refresh_token: REFRESH_TOKEN,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: "refresh_token",
        },
        timeout: 12_000,
      });

      const data = res?.data || {};
      const token = data.access_token;

      if (!token) throw new Error("Zoho token refresh: no access_token in response");

      // Zoho usually returns expires_in seconds (often 3600)
      const expiresInSec = Number(data.expires_in || 3600);

      // Cache with skew buffer (refresh a bit early)
      const expMs = nowMs() + Math.max(0, (expiresInSec - EXPIRY_SKEW_SEC)) * 1000;

      cachedToken = token;
      cachedTokenExpMs = expMs;

      // Log safe metadata only
      console.log("🔓 Zoho token refreshed", {
        expiresInSec,
        cachedUntil: new Date(cachedTokenExpMs).toISOString(),
      });

      return cachedToken;
    } catch (err) {
      // Clear cache on failure
      cachedToken = null;
      cachedTokenExpMs = 0;

      console.error(
        "🧨 Zoho token refresh failed:",
        err.response?.data || err.message
      );
      throw err;
    } finally {
      inflightRefresh = null;
    }
  })();

  return inflightRefresh;
}

module.exports = { refreshZohoToken, API_DOMAIN };
