const POLICY_RETURNS_TERMS = Object.freeze([
  "return", "returns", "returnable", "refund", "refunds", "exchange", "trial",
  "trial period", "sleep trial", "100 night trial", "100-night trial", "comfort trial",
  "how long can i try it", "how long do i have to return it", "can i try it for 100 nights",
  "dont like", "don't like", "motion bases", "pillows",
]);

const POLICY_DELIVERY_TERMS = Object.freeze([
  "deliver", "delivery", "shipping", "setup", "set up", "white glove",
  "remove my old mattress", "mattress removal", "old bed", "old mattress",
  "how fast can i get my mattress", "free delivery", "delivery free", "track", "schedule",
]);

const POLICY_WARRANTY_TERMS = Object.freeze([
  "warranty", "warranties", "register", "registration", "product registration",
  "warranty registration", "coverage", "claim", "claims", "warranty claim",
  "warranty claims", "file a warranty claim", "guarantee", "defect", "defects", "sagging",
]);

const POLICY_FINANCING_TERMS = Object.freeze([
  "finance", "financing", "no money down", "down payment", "payment", "payments",
  "what would payments be", "monthly payment", "monthly payments", "payment plan",
  "payment plans", "pay over time", "buy now and pay later", "credit", "credit check",
  "prequalify", "shop pay", "affirm", "synchrony", "0% apr", "apr", "interest",
]);

const POLICY_PRICING_TERMS = Object.freeze(["how much", "price", "cost", "pricing", "fee", "fees"]);

function normalizeAskSnoozerText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function includesAny(text, phrases = []) {
  return phrases.some((phrase) => text.includes(phrase));
}

function parseAskSnoozerSizeLabel(value) {
  const text = normalizeAskSnoozerText(value);
  const sizeMatchers = [
    ["split california king", "Split Cal King"], ["split cal king", "Split Cal King"],
    ["california king", "Cal King"], ["half split king", "Half Split King"],
    ["split king", "Split King"], ["cal king", "Cal King"],
    ["half split queen", "Half Split Queen"], ["twin xl", "Twin XL"],
    ["queen", "Queen"], ["king", "King"], ["full", "Full"], ["twin", "Twin"],
  ];
  for (const [needle, label] of sizeMatchers) {
    if (text.includes(needle)) return label;
  }
  return "";
}

function classifyAskSnoozerPolicySubtype(value) {
  const text = normalizeAskSnoozerText(value);
  if (!text) return "general_policy";
  if (includesAny(text, POLICY_RETURNS_TERMS)) return "returns";
  if (includesAny(text, POLICY_WARRANTY_TERMS)) return "warranty";
  if (includesAny(text, POLICY_FINANCING_TERMS)) return "financing";
  if (includesAny(text, POLICY_DELIVERY_TERMS) || (text.includes("how much") && text.includes("delivery"))) return "delivery";
  if (includesAny(text, POLICY_PRICING_TERMS)) return "pricing";
  return "general_policy";
}

module.exports = {
  classifyAskSnoozerPolicySubtype,
  normalizeAskSnoozerText,
  parseAskSnoozerSizeLabel,
};
