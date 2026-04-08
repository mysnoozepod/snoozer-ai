// services/productCategories.js

const categories = [
  {
    name: "cooling",
    label: "Cooling Mattresses",
    keywords: ["cooling", "hot sleeper", "temperature", "heat", "breeze"],
    url: "/collections/cooling"
  },
  {
    name: "hybrid",
    label: "Hybrid Mattresses",
    keywords: ["hybrid", "coil", "spring", "support", "comfort"],
    url: "/collections/hybrid"
  },
  {
    name: "foam",
    label: "All-Foam Mattresses",
    keywords: ["foam", "memory foam", "sink", "soft", "contour"],
    url: "/collections/foam"
  },
  {
    name: "bases",
    label: "Adjustable Bases",
    keywords: ["adjustable base", "motion base", "head lift", "foot up", "zero gravity"],
    url: "/collections/bases"
  },
  {
    name: "accessories",
    label: "Pillows & Accessories",
    keywords: ["pillow", "protector", "accessory", "bedding", "cover"],
    url: "/collections/accessories"
  }
];

function matchCategory(input) {
  const lower = input.toLowerCase();
  const match = categories.find(cat =>
    cat.keywords.some(keyword => lower.includes(keyword))
  );
  return match
    ? { name: match.name, url: match.url, label: match.label }
    : null;
}

module.exports = { matchCategory };
