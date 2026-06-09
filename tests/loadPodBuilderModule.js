const fs = require("fs");
const path = require("path");
const vm = require("vm");

const POD_BUILDER_PATH = path.join(__dirname, "..", "assets", "snoozepod-pod-builder.js");

function transformPodBuilderSource(source) {
  const stripped = source
    .replace(/^\(function\s*\(\)\s*\{\s*/, "")
    .replace(/\}\)\(\);\s*$/, "");

  return `${stripped}

module.exports = {
  MOTION_OPTIONS,
  SYSTEM_OPTIONS,
  allowedMotionOptionsForSize,
  buildApiUrl,
  buildBuilderGuidanceText,
  buildBuilderPlanFromAssessment,
  getApiBase,
  normalizeMotionSelectionForSize,
  normalizeMotionSelectionKey,
  resolveBuilderPlan,
};
`;
}

function loadPodBuilderModule(overrides = {}) {
  const raw = fs.readFileSync(POD_BUILDER_PATH, "utf8");
  const transformed = transformPodBuilderSource(raw);

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
      fetch: overrides.fetch || (async function missingFetch() {
        throw new Error("fetch not mocked");
      }),
      sessionStorage: {
        getItem() { return ""; },
        setItem() {},
      },
      MySnoozePod: {},
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
    filename: POD_BUILDER_PATH,
  });
  script.runInContext(sandbox);
  return sandbox.module.exports;
}

module.exports = {
  POD_BUILDER_PATH,
  loadPodBuilderModule,
};
