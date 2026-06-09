const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ASSESSMENT_PATH = path.join(__dirname, "..", "assets", "snooze-assessment.js");

function transformAssessmentSource(source) {
  const stripped = source
    .replace(/^\(function\s*\(\)\s*\{\s*/, "")
    .replace(/\}\)\(\);\s*$/, "");

  return `${stripped}

module.exports = {
  HANDLES,
  NO_MOTION_LABEL,
  generateShowroomRecommendations,
  adaptCanonicalRecommendation,
  buildLocalShowroomResult,
  resolveAssessmentRecommendationResult,
  saveAssessmentAnswers,
  buildResult,
  buildApiUrl,
};
`;
}

function loadShopifyAssessmentModule(overrides = {}) {
  const raw = fs.readFileSync(ASSESSMENT_PATH, "utf8");
  const transformed = transformAssessmentSource(raw);

  const sandbox = {
    module: { exports: {} },
    exports: {},
    require,
    console: overrides.console || console,
    process,
    setTimeout,
    clearTimeout,
    fetch: overrides.fetch || (async function missingFetch() {
      throw new Error("fetch not mocked");
    }),
    window: overrides.window || {
      sessionStorage: {
        getItem() { return ""; },
        setItem() {},
      },
      MySnoozePod: {},
      setTimeout,
    },
    document: overrides.document || {
      documentElement: {
        getAttribute() { return ""; },
      },
      addEventListener() {},
      querySelectorAll() { return []; },
    },
  };

  vm.createContext(sandbox);
  const script = new vm.Script(transformed, {
    filename: ASSESSMENT_PATH,
  });
  script.runInContext(sandbox);
  return sandbox.module.exports;
}

module.exports = {
  ASSESSMENT_PATH,
  loadShopifyAssessmentModule,
};
