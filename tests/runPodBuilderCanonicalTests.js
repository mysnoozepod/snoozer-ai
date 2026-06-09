#!/usr/bin/env node

const assert = require("assert");
const { loadPodBuilderModule } = require("./loadPodBuilderModule");

function buildCatalogs() {
  return {
    base: [
      {
        kind: "product",
        key: "premium-motion-adjustable-base",
        handle: "premium-motion-adjustable-base",
        title: "Premium Motion Adjustable Base",
        summaryLabel: "Premium Motion Adjustable Base",
        isAdjustable: true,
      },
      {
        kind: "product",
        key: "platform-base",
        handle: "platform-base",
        title: "Platform Base",
        summaryLabel: "Platform Base",
        isAdjustable: false,
      },
      {
        kind: "product",
        key: "storage-base",
        handle: "storage-base",
        title: "Storage Base",
        summaryLabel: "Storage Base",
        isAdjustable: false,
      },
    ],
    protection: [],
    pillow: [],
    bedding: [],
  };
}

const SIZE_OPTIONS = ["Twin", "Full", "Queen", "King"].map((size) => ({
  key: size,
  title: size,
  summaryLabel: size,
  kind: "size",
}));

function loadModule(overrides = {}) {
  return loadPodBuilderModule({
    window: {
      fetch: overrides.fetch || (async function missingFetch() {
        throw new Error("fetch not mocked");
      }),
      sessionStorage: overrides.sessionStorage || {
        getItem() { return ""; },
        setItem() {},
      },
      MySnoozePod: overrides.globalConfig || {},
    },
    document: {
      documentElement: {
        getAttribute(name) {
          if (name === "data-snoozer-api-base") {
            return overrides.docApiBase || "";
          }
          return "";
        },
      },
      addEventListener() {},
      querySelectorAll() { return []; },
    },
    console: overrides.console || console,
    fetch: overrides.fetch,
  });
}

function createRoot(apiBase = "") {
  return {
    getAttribute(name) {
      if (name === "data-builder-api-base") return apiBase;
      return "";
    },
  };
}

function testExplicitNoBaseWins() {
  const moduleUnderTest = loadModule();
  const plan = moduleUnderTest.buildBuilderPlanFromAssessment(
    {
      size: "Queen",
      baseType: "No Base",
      motionMode: "No Motion",
    },
    buildCatalogs(),
    SIZE_OPTIONS,
    null,
    "shared_assessment"
  );

  assert.strictEqual(plan.size, "Queen");
  assert.strictEqual(plan.baseKey, "no_base");
  assert.strictEqual(plan.motionKey, "");
  assert(
    /leave the base out|mattress-only/i.test(
      moduleUnderTest.buildBuilderGuidanceText("base", {
        baseKey: plan.baseKey,
        baseLabel: plan.baseLabel,
      })
    ),
    "no-base guidance should sound natural"
  );
}

function testPlatformBaseMapsToHandle() {
  const moduleUnderTest = loadModule();
  const plan = moduleUnderTest.buildBuilderPlanFromAssessment(
    {
      size: "Queen",
      baseType: "Platform Base",
      motionMode: "No Motion",
    },
    buildCatalogs(),
    SIZE_OPTIONS,
    null,
    "shared_assessment"
  );

  assert.strictEqual(plan.baseKey, "platform-base");
  assert.strictEqual(plan.baseLabel, "Platform Base");
  assert(
    /simple|steady foundation|motion path/i.test(
      moduleUnderTest.buildBuilderGuidanceText("base", {
        baseKey: plan.baseKey,
        baseLabel: plan.baseLabel,
      })
    ),
    "platform-base guidance should explain the simple non-motion path"
  );
}

function testQueenFullSplitNormalizesToHalfSplit() {
  const moduleUnderTest = loadModule();
  const plan = moduleUnderTest.buildBuilderPlanFromAssessment(
    {
      size: "Queen",
      baseType: "Adjustable Base",
      motionMode: "Full Split Motion",
    },
    buildCatalogs(),
    SIZE_OPTIONS,
    null,
    "shared_assessment"
  );

  assert.strictEqual(plan.baseKey, "premium-motion-adjustable-base");
  assert.strictEqual(plan.motionKey, "half_split");
  assert(plan.warnings.some((warning) => /King-only|Half Split Motion/i.test(warning)));
  assert(
    /King-only|Half Split/i.test(
      moduleUnderTest.buildBuilderGuidanceText("motion", {
        motionKey: plan.motionKey,
        motionLabel: plan.motionLabel,
        motionWarning: plan.warnings[0] || "",
      })
    ),
    "motion guidance should explain the Queen to Half Split normalization"
  );
}

function testKingFullSplitStaysFullSplit() {
  const moduleUnderTest = loadModule();
  const plan = moduleUnderTest.buildBuilderPlanFromAssessment(
    {
      size: "King",
      baseType: "Adjustable Base",
      motionMode: "Full Split Motion",
    },
    buildCatalogs(),
    SIZE_OPTIONS,
    null,
    "shared_assessment"
  );

  assert.strictEqual(plan.motionKey, "full_split");
  assert.strictEqual(plan.motionLabel, "Full Split Motion");
  assert(
    /King-only|independent movement/i.test(
      moduleUnderTest.buildBuilderGuidanceText("motion", {
        motionKey: plan.motionKey,
        motionLabel: plan.motionLabel,
      })
    ),
    "full-split guidance should explain the King-only path"
  );
}

async function testCanonicalResolvePreferredWithFallback() {
  const warnings = [];
  const assessment = {
    size: "Queen",
    baseType: "Platform Base",
    motionMode: "No Motion",
  };
  const sessionStorage = {
    getItem(key) {
      if (key === "snooze.assessment") return JSON.stringify(assessment);
      if (key === "snooze.assessmentShopperId") return "shopper-123";
      return "";
    },
    setItem() {},
  };

  const moduleUnderTest = loadModule({
    sessionStorage,
    docApiBase: "https://api.example.test/prod",
    fetch: async function mockedFetch(url, options = {}) {
      assert.strictEqual(url, "https://api.example.test/prod/recommendations/resolve");
      assert.strictEqual(String(options.method || "").toUpperCase(), "POST");
      const payload = JSON.parse(options.body);
      assert.strictEqual(payload.shopperId, "shopper-123");
      assert.strictEqual(payload.source, "shopify_pod_builder");
      return {
        ok: true,
        json: async function json() {
          return {
            recommendation: {
              normalizedAssessment: {
                size: "Queen",
                baseType: "Platform Base",
              },
              baseHandle: "platform-base",
              motionKey: "",
            },
          };
        },
      };
    },
    console: {
      ...console,
      warn(message) {
        warnings.push(String(message));
      },
    },
  });

  const plan = await moduleUnderTest.resolveBuilderPlan(
    createRoot(),
    buildCatalogs(),
    SIZE_OPTIONS
  );

  assert.strictEqual(plan.source, "canonical_resolver");
  assert.strictEqual(plan.baseKey, "platform-base");
  assert.strictEqual(warnings.length, 0);
}

async function testCanonicalResolveFallsBackToSharedAssessment() {
  const warnings = [];
  const assessment = {
    size: "Queen",
    baseType: "No Base",
    motionMode: "No Motion",
  };
  const sessionStorage = {
    getItem(key) {
      if (key === "snooze.assessment") return JSON.stringify(assessment);
      return "";
    },
    setItem() {},
  };

  const moduleUnderTest = loadModule({
    sessionStorage,
    docApiBase: "https://api.example.test/prod",
    fetch: async function failingFetch() {
      throw new Error("resolver unavailable");
    },
    console: {
      ...console,
      warn(message) {
        warnings.push(String(message));
      },
    },
  });

  const plan = await moduleUnderTest.resolveBuilderPlan(
    createRoot(),
    buildCatalogs(),
    SIZE_OPTIONS
  );

  assert.strictEqual(plan.source, "shared_assessment");
  assert.strictEqual(plan.baseKey, "no_base");
  assert(warnings.some((message) => message.includes("canonical plan unavailable")));
}

async function main() {
  testExplicitNoBaseWins();
  testPlatformBaseMapsToHandle();
  testQueenFullSplitNormalizesToHalfSplit();
  testKingFullSplitStaysFullSplit();
  await testCanonicalResolvePreferredWithFallback();
  await testCanonicalResolveFallsBackToSharedAssessment();
  console.log("All Pod Builder canonical tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
