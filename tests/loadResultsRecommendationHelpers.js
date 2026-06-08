const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RESULTS_HELPERS_PATH = path.join(
  __dirname,
  "..",
  "omnia-journey",
  "src",
  "lib",
  "utils",
  "resultsRecommendations.js"
);

function transformResultsHelpersSource(source) {
  return `${source
    .replace(/^export\s+async\s+function\s+/gm, "async function ")
    .replace(/^export\s+function\s+/gm, "function ")
    .replace(/^export\s+const\s+/gm, "const ")}

module.exports = {
  USE_CANONICAL_RECOMMENDATIONS_FLAG,
  isCanonicalRecommendationsEnabled,
  sanitizeRecommendationsPayload,
  adaptCanonicalRecommendations,
  getResultsRecommendations,
};
`;
}

function loadResultsRecommendationHelpers() {
  const raw = fs.readFileSync(RESULTS_HELPERS_PATH, "utf8");
  const transformed = transformResultsHelpersSource(raw);

  const sandbox = {
    module: { exports: {} },
    exports: {},
    require,
    console,
    process,
    setTimeout,
    clearTimeout,
  };

  vm.createContext(sandbox);
  const script = new vm.Script(transformed, {
    filename: RESULTS_HELPERS_PATH,
  });
  script.runInContext(sandbox);
  return sandbox.module.exports;
}

module.exports = {
  RESULTS_HELPERS_PATH,
  loadResultsRecommendationHelpers,
};
