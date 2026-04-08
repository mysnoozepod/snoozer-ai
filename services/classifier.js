/**
 * classifyIntent
 * Lightweight phase classifier for Snoozer MVP
 * - welcome: greetings, getting started
 * - explore: product questions, browsing
 * - checkout: cart, purchase, payment
 */

function classifyIntent(text = "", channel = "online") {
  const msg = (text || "").toLowerCase();

  // --- Checkout phase ---
  if (
    /(checkout|cart|buy|purchase|order|pay|start checkout|open cart)/.test(msg)
  ) {
    return "checkout";
  }

  // --- Welcome phase ---
  if (
    /(hi|hello|hey|good (morning|afternoon|evening)|start|help|begin|welcome)/.test(
      msg
    )
  ) {
    return "welcome";
  }

  // --- Explore phase ---
  if (
    /(mattress|bed|foam|hybrid|compare|price|cost|financing|delivery|warranty|return|options|show me)/.test(
      msg
    )
  ) {
    return "explore";
  }

  // --- Fallback ---
  return "explore"; // default to explore if unknown
}

module.exports = { classifyIntent };
