"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const { lambdaHandler } = require(path.join(root, "index.js"));

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function sourceFiles(relativePath) {
  const absolute = path.join(root, relativePath);
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return entry.isFile() && entry.name.endsWith(".js") ? [child] : [];
  });
}

function main() {
  assert.strictEqual(process.versions.node.split(".")[0], "24", "tests must run on Node.js 24");
  assert.strictEqual(packageJson.engines.node, ">=24.0.0 <25");

  assert.match(read("template.yaml"), /Runtime:\s*nodejs24\.x/);
  assert.match(read("infrastructure/rewards-template.yaml"), /Runtime:\s*nodejs24\.x/);

  assert.strictEqual(typeof lambdaHandler, "function");
  assert.strictEqual(lambdaHandler.constructor.name, "AsyncFunction", "Lambda handler must be async");
  assert.ok(lambdaHandler.length <= 2, "Lambda handler must not use a callback parameter");

  const runtimeSources = ["index.js", ...sourceFiles("handlers"), ...sourceFiles("routes"), ...sourceFiles("services")];
  const deprecatedPatterns = [
    /context\.(?:succeed|fail|done)\s*\(/,
    /callbackWaitsForEmptyEventLoop/,
    /\(\s*event\s*,\s*context\s*,\s*callback\s*\)/,
  ];
  for (const file of runtimeSources) {
    const source = read(file);
    for (const pattern of deprecatedPatterns) {
      assert.ok(!pattern.test(source), `${file} uses removed callback-era Lambda API ${pattern}`);
    }
  }

  assert.ok(!Object.prototype.hasOwnProperty.call(packageJson, "type"), "backend remains CommonJS");
  for (const dependency of Object.keys(packageJson.dependencies)) {
    if (dependency.startsWith("@aws-sdk/")) require.resolve(dependency, { paths: [root] });
  }

  console.log("Node.js 24 Lambda compatibility: PASS");
  console.log(`Runtime: ${process.version}`);
  console.log("Handler: async index.lambdaHandler (no callback API)");
  console.log("Modules: CommonJS; bundled AWS SDK v3 clients resolved");
}

main();
