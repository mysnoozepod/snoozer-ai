import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const journeyRoot = path.resolve(here, "..");
const repoRoot = path.resolve(journeyRoot, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assertHudContract(payload, label) {
  assert.equal(typeof payload.speech, "string", `${label} speech should be a string`);
  assert.equal(typeof payload.captions, "string", `${label} captions should be a string`);
  assert(["idle", "listening", "thinking", "speaking", "celebrate", "warning"].includes(payload.state));
  assert(["low", "normal", "high"].includes(payload.priority));
  assert(Number.isFinite(payload.ttlMs) && payload.ttlMs > 0, `${label} should include a positive ttlMs`);
  assert(Array.isArray(payload.actions), `${label} actions should be an array`);
}

const welcome = read("omnia-journey/src/pages/Welcome.jsx");
assert.match(welcome, /inputMode="numeric"/);
assert.match(welcome, /pattern="\[0-9\]\*"/);
assert.match(welcome, /maxLength=\{4\}/);
assert.match(welcome, /nextCode\.length === 4/);
assert.match(welcome, /handleStart\(nextCode\)/);
assert.match(welcome, /hasStartedRef\.current/);
assert.match(welcome, /Loading your Snooze Session…/);
assert.doesNotMatch(welcome, /starts automatically after the fourth digit/i);
assert.match(welcome, /Personalize Your Experience/);
assert.match(welcome, /rewards, recommendations, and special discounts!/);
assert.doesNotMatch(welcome, /===\s*["']1234["']/);

const whatToExpect = read("omnia-journey/src/pages/WhatToExpect.jsx");
const whatToExpectFallbacks = read(
  "omnia-journey/src/lib/snoozer/hud/whatToExpectFallbacks.js"
);
const fetchHudScript = read("omnia-journey/src/lib/snoozer/hud/fetchHudScript.js");
const responseContract = read("utils/responseContract.js");
assert.match(whatToExpect, /lg:grid-cols-4/);
assert.match(whatToExpect, /orientationJobId/);
assert.match(whatToExpect, /voiceState\?\.loading \|\| voiceState\?\.playing/);
assert.match(whatToExpect, /navigate\(assessmentComplete \? "\/results" : "\/assessment"/);
assert.doesNotMatch(whatToExpect, /Next Step/);
assert.doesNotMatch(whatToExpect, /Retake Snooze Assessment/);
assert.doesNotMatch(whatToExpect, /setTimeout/);
assert.doesNotMatch(whatToExpect, /Welcome to your Snooze Session/);
assert.match(whatToExpectFallbacks, /Let’s start with your Snooze Assessment\./);
assert.match(whatToExpectFallbacks, /Let’s take a look at your recommended pods\./);
assert.match(fetchHudScript, /Math\.min\(30000,/);
assert.match(responseContract, /Math\.min\(n, 30000\)/);

const results = read("omnia-journey/src/pages/Results.jsx");
assert.match(results, /rankedPods\.slice\(1, 3\)/);
assert.match(results, /Next To Try/);
assert.match(results, /grid-cols-\[112px_minmax\(0,1fr\)\]/);
assert.match(results, /SnoozePod&nbsp;\{id\}/);
assert.doesNotMatch(results, /Also available to test/);
assert.doesNotMatch(results, /title="Ask Snoozer"/);
assert.doesNotMatch(results, /title="Talk to Human"/);
assert.doesNotMatch(results, /secondaryPods/);
assert.doesNotMatch(results, /Mattress family match/);
assert.doesNotMatch(results, /Pressure-relief focus/);

const incomplete = JSON.parse(
  read("s3 files/snoozerassetsprod/scripts/hud/what_to_expect/enter.json")
);
const complete = JSON.parse(
  read("s3 files/snoozerassetsprod/scripts/hud/what_to_expect/assessment_complete.json")
);

assertHudContract(incomplete, "incomplete orientation");
assertHudContract(complete, "complete orientation");
assert.match(incomplete.speech, /Let’s start with your Snooze Assessment\.$/);
assert.match(complete.speech, /Let’s take a look at your recommended pods\.$/);
assert.notEqual(incomplete.speech, complete.speech, "orientation branches should be intentionally different");

console.log("PASS welcome_numeric_auto_submit");
console.log("PASS welcome_customer_safe_state_and_copy");
console.log("PASS what_to_expect_hud_completion_routing");
console.log("PASS what_to_expect_orientation_only_layout");
console.log("PASS results_top_three_single_frame_structure");
console.log("PASS what_to_expect_hud_script_contracts");
