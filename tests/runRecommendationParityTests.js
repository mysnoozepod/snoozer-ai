#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { resolveRecommendation } = require("../services/recommendationResolver");
const { loadReactShowroomRecommendations } = require("./loadReactShowroomRecommendations");

const MATRIX_PATH = path.join(__dirname, "recommendationParityMatrix.json");

function loadMatrix() {
  return JSON.parse(fs.readFileSync(MATRIX_PATH, "utf8"));
}

function toMotionKey(value) {
  const raw = String(value || "").toLowerCase().trim();
  if (raw.includes("full split")) return "full_split";
  if (raw.includes("half split")) return "half_split";
  if (raw.includes("standard")) return "standard";
  if (raw.includes("no motion")) return "none";
  return "";
}

function normalizeWarnings(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "")) : [];
}

function normalizeReactOutput(result) {
  const pods = Array.isArray(result?.pods) ? [...result.pods] : [];
  pods.sort((a, b) => Number(a.rank || 999) - Number(b.rank || 999));
  const topPods = pods.filter((pod) => pod.recommended).slice(0, 3);
  const topPod = topPods[0] || null;

  return {
    topPodId: topPod ? String(topPod.podId) : null,
    topPodIds: topPods.map((pod) => String(pod.podId)),
    primaryMattressHandle: result?.meta?.primaryMattressHandle || null,
    baseHandle: topPod?.baseHandle || null,
    motionKey: toMotionKey(result?.meta?.motionMode),
    warnings: normalizeWarnings(result?.meta?.warnings),
  };
}

function normalizeResolverOutput(result) {
  return {
    topPodId: result?.recommendation?.topPodId || null,
    topPodIds: Array.isArray(result?.recommendation?.topPodIds)
      ? result.recommendation.topPodIds.map((item) => String(item))
      : [],
    primaryMattressHandle: result?.recommendation?.primaryMattressHandle || null,
    baseHandle: result?.recommendation?.baseHandle || null,
    motionKey: result?.normalizedAssessment?.motionKey || null,
    warnings: normalizeWarnings(result?.recommendation?.warnings),
  };
}

function diffFields(reactView, resolverView) {
  const fields = [
    "topPodId",
    "topPodIds",
    "primaryMattressHandle",
    "baseHandle",
    "motionKey",
    "warnings",
  ];

  const differences = [];

  for (const field of fields) {
    const left = JSON.stringify(reactView[field]);
    const right = JSON.stringify(resolverView[field]);
    if (left !== right) {
      differences.push({
        field,
        react: reactView[field],
        resolver: resolverView[field],
      });
    }
  }

  return differences;
}

async function main() {
  const matrix = loadMatrix();
  const reactModule = loadReactShowroomRecommendations();
  const report = [];

  for (const testCase of matrix) {
    const reactResult = await reactModule.generateShowroomRecommendations(testCase.input, {
      includeAccessories: false,
    });
    const resolverResult = await resolveRecommendation({
      source: "parity_test",
      assessment: testCase.input,
      includeProducts: false,
      includePods: true,
      includeBuilderConfig: false,
    });

    const reactView = normalizeReactOutput(reactResult);
    const resolverView = normalizeResolverOutput(resolverResult);
    const differences = diffFields(reactView, resolverView);

    report.push({
      id: testCase.id,
      react: reactView,
      resolver: resolverView,
      differences,
      parity: differences.length === 0,
    });
  }

  const mismatches = report.filter((item) => !item.parity);

  console.log(JSON.stringify({
    totalCases: report.length,
    parityCases: report.length - mismatches.length,
    mismatchCases: mismatches.length,
    results: report,
  }, null, 2));

  if (mismatches.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
