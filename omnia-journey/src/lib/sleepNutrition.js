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

function hasCoolingTruth(truth = {}) {
  return Boolean(truth.hasCooling);
}

function supportStatement(truth = {}) {
  const family = lower(truth.family);
  if (truth.isDualComfort || family === "dual") {
    return "Dual Comfort hybrid support helps each side feel more intentionally supported.";
  }
  if (truth.hasCoils || family === "hybrid") {
    return "Coil-supported construction helps create a steadier, more lifted feel.";
  }
  if (family === "foam") {
    return "Foam support layers help create a more even, stable feel.";
  }
  return "The support build helps keep the surface feeling balanced and stable.";
}

function comfortStatement(truth = {}, firmness = "") {
  const feel = normalize(firmness);
  if (truth.hasPressureRelief) {
    return "Comfort materials help cushion common pressure areas.";
  }
  if (feel) {
    return `${feel} comfort helps balance cushioning with support.`;
  }
  return "Comfort layers help the mattress feel easier to settle into.";
}

function coolingStatement() {
  return "Cooling or breathable materials support temperature comfort during the test.";
}

function constructionStatement(truth = {}) {
  const family = lower(truth.family);
  if (truth.isDualComfort || family === "dual") {
    return "Dual Comfort hybrid construction adds stability for shared sleep.";
  }
  if (truth.hasCoils || family === "hybrid") {
    return "Hybrid construction supports a steadier, more consistent surface.";
  }
  if (family === "foam") {
    return "All-foam construction supports a quieter, more consistent surface.";
  }
  return "The construction helps the mattress feel consistent through the showroom test.";
}

export function buildSleepNutritionItems({ mattressTruth = {}, firmness = "" } = {}) {
  const items = [
    {
      category: "Protein",
      statement: sentence(supportStatement(mattressTruth)),
    },
    {
      category: "Healthy Fats",
      statement: sentence(comfortStatement(mattressTruth, firmness)),
    },
    hasCoolingTruth(mattressTruth)
      ? {
          category: "Electrolytes",
          statement: sentence(coolingStatement(mattressTruth)),
        }
      : null,
    {
      category: "Fiber",
      statement: sentence(constructionStatement(mattressTruth)),
    },
  ].filter(Boolean);

  return items.filter((item) => item.category && item.statement).slice(0, 3);
}
