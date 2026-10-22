"use strict";

const { getOfficialShowroomLineupReadiness } = require("../services/officialShowroomLineup");

const readiness = getOfficialShowroomLineupReadiness();
console.log(JSON.stringify(readiness, null, 2));

if (!readiness.schemaValid) {
  process.exitCode = 1;
}
