#!/usr/bin/env node

const { validateKnowledgeManifestSources } = require("../services/knowledgeManifest");

async function main() {
  const checkS3 = process.argv.includes("--check-s3");
  const result = await validateKnowledgeManifestSources({ checkS3 });

  console.log("Ask Snoozer Knowledge Manifest Validation");
  console.log(`Manifest version: ${result.manifestVersion}`);
  console.log(`Checked at: ${result.checkedAt}`);
  console.log(`Total entries: ${result.summary.totalEntries}`);
  console.log(`Required failures: ${result.summary.requiredFailures}`);
  console.log(`Local sources found: ${result.summary.localFoundCount}`);
  console.log(`Local sources missing: ${result.summary.localMissingCount}`);
  console.log(`S3 checked: ${result.s3Checked ? "yes" : "no"}`);
  if (result.s3SkippedReason) {
    console.log(`S3 validation skipped: ${result.s3SkippedReason}`);
  }

  const rows = result.results.map((item) => ({
    section: item.sectionName,
    key: item.entryKey,
    required: item.required,
    status: item.status,
    localFound: item.localFound.length,
    localMissing: item.localMissing.length,
    showroomMatch: item.showroomMatch,
    s3Status: item.s3Status,
  }));
  console.table(rows);

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
