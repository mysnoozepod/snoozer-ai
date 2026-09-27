function normalize(value) {
  return String(value || "").trim();
}

function lower(value) {
  return normalize(value).toLowerCase();
}

function sentence(value) {
  const text = normalize(value).replace(/\s+/g, " ");
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function buildMattressSupportItems({ mattressTruth = {}, firmness = "" } = {}) {
  const family = lower(mattressTruth.family);
  const feel = normalize(firmness);
  const items = [];

  if (mattressTruth.isDualComfort || family === "dual") {
    items.push({ category: "Support", statement: "Dual Comfort hybrid support gives each side a more intentional support profile." });
  } else if (mattressTruth.hasCoils || family === "hybrid") {
    items.push({ category: "Support", statement: "Coil-supported construction creates a steadier, more lifted feel." });
  } else if (family === "foam") {
    items.push({ category: "Support", statement: "Foam support layers create a more even, stable feel." });
  }

  if (mattressTruth.hasPressureRelief) {
    items.push({ category: "Pressure Relief", statement: "Comfort materials cushion common pressure areas." });
  }
  if (mattressTruth.hasCooling) {
    items.push({ category: "Temperature Comfort", statement: "Cooling or breathable materials support temperature comfort." });
  }
  if (mattressTruth.isDualComfort || family === "dual" || family === "foam") {
    items.push({
      category: "Motion Isolation",
      statement: family === "foam"
        ? "The foam-led construction creates a quieter surface with less bounce."
        : "The support construction keeps the surface more composed through movement.",
    });
  }
  if (feel) {
    items.push({ category: "Mattress Feel", statement: `${feel} comfort balances cushioning with support.` });
  }

  return items
    .map((item) => ({ ...item, statement: sentence(item.statement) }))
    .filter((item) => item.category && item.statement)
    .slice(0, 4);
}

const NOTICE_COPY = {
  Support: "Notice whether the mattress feels steady and supportive beneath you.",
  "Pressure Relief": "Notice how your shoulders and hips settle into the mattress.",
  "Temperature Comfort": "Pay attention to whether heat starts building as you settle in.",
  "Motion Isolation": "Notice how much movement travels across the mattress.",
};

export function buildMattressNoticeItems(supportItems = []) {
  const seen = new Set();

  return (Array.isArray(supportItems) ? supportItems : [])
    .map((item) => {
      const category = normalize(item?.category);
      const verifiedFact = sentence(item?.statement);
      if (!category || !verifiedFact || seen.has(category)) return null;

      let prompt = NOTICE_COPY[category] || "";
      if (category === "Mattress Feel") {
        const feel = verifiedFact.match(/^(.+?) comfort balances cushioning with support\.?$/i)?.[1];
        prompt = feel
          ? `Notice whether the ${normalize(feel).toLowerCase()} feel gives you the right balance of cushioning and support.`
          : "Notice whether the feel gives you the right balance of cushioning and support.";
      }
      if (!prompt) return null;

      seen.add(category);
      return { category, prompt: sentence(prompt), verifiedFact };
    })
    .filter(Boolean)
    .slice(0, 4);
}
