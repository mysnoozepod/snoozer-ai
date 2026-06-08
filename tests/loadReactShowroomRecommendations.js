const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REACT_RECOMMENDATIONS_PATH = path.join(
  __dirname,
  "..",
  "omnia-journey",
  "src",
  "lib",
  "utils",
  "recommendations.js"
);

function transformReactModuleSource(source) {
  return `${source
    .replace(
      /^import\s+\{\s*api\s*\}\s+from\s+["']@\/lib\/api["'];?\s*$/m,
      'const api = { getProducts: async () => ({ items: [] }) };'
    )
    .replace(/^export\s+async\s+function\s+/gm, "async function ")
    .replace(/^export\s+function\s+/gm, "function ")
    .replace(/^export\s+const\s+/gm, "const ")}

module.exports = {
  HANDLES,
  getBaseHandleForType,
  generateShowroomRecommendations,
};
`;
}

function loadReactShowroomRecommendations() {
  const raw = fs.readFileSync(REACT_RECOMMENDATIONS_PATH, "utf8");
  const transformed = transformReactModuleSource(raw);

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
    filename: REACT_RECOMMENDATIONS_PATH,
  });
  script.runInContext(sandbox);
  return sandbox.module.exports;
}

module.exports = {
  REACT_RECOMMENDATIONS_PATH,
  loadReactShowroomRecommendations,
};
