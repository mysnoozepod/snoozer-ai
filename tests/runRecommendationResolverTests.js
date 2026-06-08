#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { resolveRecommendation } = require("../services/recommendationResolver");

const FIXTURE_PATH = path.join(__dirname, "recommendationResolverFixtures.json");

function loadFixtures() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
}

async function runFixture(fixture) {
  const result = await resolveRecommendation(fixture.input);
  assert.strictEqual(result.ok, true, `${fixture.id}: ok should be true`);
  assert.strictEqual(
    result.recommendation.topPodId,
    fixture.expected.topPodId,
    `${fixture.id}: topPodId mismatch`
  );
  assert.deepStrictEqual(
    result.recommendation.topPodIds,
    fixture.expected.topPodIds,
    `${fixture.id}: topPodIds mismatch`
  );
  assert.strictEqual(
    result.recommendation.primaryMattressHandle,
    fixture.expected.primaryMattressHandle,
    `${fixture.id}: primaryMattressHandle mismatch`
  );
  assert.strictEqual(
    result.recommendation.baseHandle,
    fixture.expected.baseHandle,
    `${fixture.id}: baseHandle mismatch`
  );
  assert.strictEqual(
    result.normalizedAssessment.motionKey,
    fixture.expected.motionKey,
    `${fixture.id}: motionKey mismatch`
  );
}

async function runEndpointSmoke(fixture) {
  const { lambdaHandler } = require("../index");
  const event = {
    version: "2.0",
    routeKey: "POST /recommendations/resolve",
    rawPath: "/recommendations/resolve",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      host: "local.recommendations.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: {
        method: "POST",
        path: "/recommendations/resolve",
        sourceIp: "127.0.0.1",
        userAgent: "recommendation-resolver-test",
      },
      requestId: `resolve-${fixture.id}`,
      routeKey: "POST /recommendations/resolve",
      stage: "local",
      timeEpoch: Date.now(),
    },
    body: JSON.stringify(fixture.input),
    isBase64Encoded: false,
  };

  const response = await lambdaHandler(event);
  assert.strictEqual(response.statusCode, 200, "route smoke: expected 200");
  const body = JSON.parse(response.body);
  assert.strictEqual(body.ok, true, "route smoke: ok should be true");
  assert(body.data && body.data.recommendation, "route smoke: missing data.recommendation");
  assert.strictEqual(
    body.data.recommendation.topPodId,
    fixture.expected.topPodId,
    "route smoke: topPodId mismatch"
  );
}

async function main() {
  const fixtures = loadFixtures();
  const failures = [];

  for (const fixture of fixtures) {
    try {
      await runFixture(fixture);
      console.log(`PASS ${fixture.id}`);
    } catch (error) {
      failures.push({ id: fixture.id, message: error.message });
      console.error(`FAIL ${fixture.id}: ${error.message}`);
    }
  }

  try {
    await runEndpointSmoke(fixtures[0]);
    console.log("PASS route_smoke");
  } catch (error) {
    failures.push({ id: "route_smoke", message: error.message });
    console.error(`FAIL route_smoke: ${error.message}`);
  }

  if (failures.length) {
    console.error(`\n${failures.length} failure(s) detected.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${fixtures.length} fixture tests passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
