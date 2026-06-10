#!/usr/bin/env node

const assert = require("assert");
const { resolveRecommendation } = require("../services/recommendationResolver");
const { loadShopifyAssessmentModule } = require("./loadShopifyAssessmentModule");
const { BANNED_SNOOZER_PHRASES } = require("../services/snoozerVoice");

function assertNoBannedPhrases(text, label) {
  const normalized = String(text || "").toLowerCase();
  for (const phrase of BANNED_SNOOZER_PHRASES) {
    assert(
      !normalized.includes(String(phrase).toLowerCase()),
      `${label} should not include banned phrase: ${phrase}`
    );
  }
}

function createRoot() {
  return {
    getAttribute(name) {
      if (name === "data-assessment-api-base") {
        return "https://api.example.test/prod";
      }
      return "";
    },
  };
}

function createProductMap(HANDLES) {
  return {
    [HANDLES.mattresses.dualComfort]: {
      title: '12" Dual Comfort Hybrid',
      url: "/products/12-dual-comfort-hybrid",
      image: "",
    },
    [HANDLES.mattresses.hybrid14]: {
      title: '14" Hybrid',
      url: "/products/14-hybrid",
      image: "",
    },
    [HANDLES.mattresses.allFoam12]: {
      title: '12" All Foam Mattress',
      url: "/products/12-all-foam-mattress",
      image: "",
    },
    [HANDLES.mattresses.allFoam10]: {
      title: '10" All Foam Mattress',
      url: "/products/10-all-foam-mattress",
      image: "",
    },
    [HANDLES.bases.adjustable]: {
      title: "Premium Motion Adjustable Base",
      url: "/products/premium-motion-adjustable-base",
      image: "",
    },
    [HANDLES.bases.platform]: {
      title: "Platform Base",
      url: "/products/platform-base",
      image: "",
    },
    [HANDLES.bases.storage]: {
      title: "Storage Base",
      url: "/products/storage-base",
      image: "",
    },
  };
}

function createRoutes() {
  return {
    mattresses: "/collections/mattresses",
    booking: "/pages/booking-a-snooze-session",
    adjustableBase: "/products/premium-motion-adjustable-base",
    basesCollection: "/collections/bases",
    pillows: "/collections/pillows",
    bedding: "/collections/bedding",
  };
}

async function testCanonicalAssessmentFlow() {
  const calls = [];
  const assessment = {
    size: "Queen",
    motionMode: "No Motion",
    firmness: "Soft",
    sleepPosition: "Side",
    sleepPartner: "No",
    baseType: "No Base",
    temperature: "Hot",
  };
  const canonical = await resolveRecommendation({
    assessment,
    includeProducts: true,
    includePods: true,
  });

  const moduleUnderTest = loadShopifyAssessmentModule({
    fetch: async function mockedFetch(url, options = {}) {
      calls.push({
        url,
        method: String(options.method || "GET").toUpperCase(),
      });

      if (String(url).endsWith("/assessment")) {
        return {
          ok: true,
          json: async function json() {
            return { ok: true };
          },
        };
      }

      if (String(url).endsWith("/recommendations/resolve")) {
        return {
          ok: true,
          json: async function json() {
            return canonical;
          },
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  });

  const { HANDLES, saveAssessmentAnswers, resolveAssessmentRecommendationResult } = moduleUnderTest;
  const productMap = createProductMap(HANDLES);
  const routes = createRoutes();

  await saveAssessmentAnswers(createRoot(), { shopperId: "shopper-1" }, assessment);
  const resolved = await resolveAssessmentRecommendationResult(
    createRoot(),
    assessment,
    "shopper-1",
    productMap,
    routes
  );

  assert.deepStrictEqual(
    calls.map((call) => call.method + " " + call.url),
    [
      "POST https://api.example.test/prod/assessment",
      "POST https://api.example.test/prod/recommendations/resolve",
    ],
    "assessment save should happen before canonical resolve"
  );
  assert.strictEqual(resolved.source, "canonical_resolver", "canonical resolver should be preferred");
  assert.strictEqual(resolved.fallbackUsed, false, "canonical success should not use fallback");
  assert.strictEqual(
    resolved.recommendation.meta.primaryMattressHandle,
    canonical.recommendation.primaryMattressHandle,
    "canonical primary mattress should be preserved"
  );
  assert.strictEqual(
    resolved.recommendation.meta.baseHandle,
    canonical.recommendation.baseHandle,
    "explicit no-base intent should remain null"
  );
  assert(
    Array.isArray(resolved.result.recommendedProducts) && resolved.result.recommendedProducts.length > 0,
    "canonical result should render into the current result shape"
  );
  assert.strictEqual(
    resolved.result.recommendedProducts[0].handle,
    HANDLES.mattresses.allFoam12,
    "canonical result should lead with the matched mattress"
  );
  assert(/SnoozePod 4/i.test(String(resolved.result.summary || "")), "canonical summary should name the first pod");
  assert(/12" All Foam/i.test(String(resolved.result.summary || "")), "canonical summary should name the matched mattress");
  assert(/Mattress Only|No Base/i.test(String(resolved.result.summary || "")), "canonical summary should preserve explicit no-base intent");
  assertNoBannedPhrases(resolved.result.summary, "canonical assessment summary");
  assertNoBannedPhrases(resolved.result.recommendedProducts[0].blurb, "canonical mattress blurb");
  assert(
    resolved.result.directions.some((item) => /leave the base out|mattress-only/i.test(String(item && item.text || ""))),
    "canonical directions should explain the mattress-only path naturally"
  );
}

async function testCanonicalAssessmentFallback() {
  const warnings = [];
  const moduleUnderTest = loadShopifyAssessmentModule({
    console: {
      ...console,
      warn: function warn(message) {
        warnings.push(String(message));
      },
    },
    fetch: async function mockedFetch(url) {
      if (String(url).endsWith("/recommendations/resolve")) {
        throw new Error("resolver unavailable");
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  });

  const { HANDLES, resolveAssessmentRecommendationResult } = moduleUnderTest;
  const answers = {
    size: "King",
    motionMode: "Standard Motion",
    firmness: "Firm",
    sleepPosition: "Back",
    sleepPartner: "No",
    baseType: "Adjustable Base",
  };
  const resolved = await resolveAssessmentRecommendationResult(
    createRoot(),
    answers,
    "shopper-2",
    createProductMap(HANDLES),
    createRoutes()
  );

  assert.strictEqual(resolved.source, "local_fallback", "fallback should return the local result source");
  assert.strictEqual(resolved.fallbackUsed, true, "resolver failure should preserve local fallback");
  assert(
    warnings.some((message) => message.includes("canonical recommendations unavailable")),
    "fallback should log a clear warning"
  );
  assert(
    Array.isArray(resolved.result.recommendedProducts) && resolved.result.recommendedProducts.length > 0,
    "fallback should still return the current result shape"
  );
  assertNoBannedPhrases(resolved.result.summary, "fallback assessment summary");
}

async function main() {
  await testCanonicalAssessmentFlow();
  await testCanonicalAssessmentFallback();
  console.log("All Shopify assessment canonical tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
