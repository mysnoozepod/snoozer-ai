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
assert.match(welcome, /digits\.map/);
assert.match(welcome, /maxLength=\{1\}/);
assert.match(welcome, /handleDigitKeyDown/);
assert.match(welcome, /event\.key === "Backspace"/);
assert.match(welcome, /handleCodePaste/);
assert.match(welcome, /pastedDigits\.length === 4/);
assert.match(welcome, /nextDigits\.every\(Boolean\).*nextCode\.length === 4/s);
assert.match(welcome, /handleStart\(nextCode\)/);
assert.match(welcome, /hasStartedRef\.current/);
assert.match(welcome, /Loading your Snooze Session…/);
assert.doesNotMatch(welcome, /starts automatically after the fourth digit/i);
assert.match(welcome, /Personalize Your Experience/);
assert.match(welcome, /rewards, recommendations, and special discounts!/);
assert.match(welcome, /Need Human Help\?/);
assert.match(welcome, /Talk to Brandy, your dedicated Human Assistant\./);
assert.equal((welcome.match(/Talk to Brandy/g) || []).length, 1);
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
assert.match(whatToExpect, /Build Your Sleep Profile/);
assert.match(whatToExpect, /Visit Your Recommended Pods/);
assert.match(whatToExpect, /Explore Sleep Essentials/);
assert.match(whatToExpect, /aria-current=\{active \? "step"/);
assert.match(whatToExpect, /presentationSource: "what-to-expect"/);
assert.doesNotMatch(whatToExpect, /Next Step/);
assert.doesNotMatch(whatToExpect, /Retake Snooze Assessment/);
assert.doesNotMatch(whatToExpect, /Test Recommended Pods/);
assert.doesNotMatch(whatToExpectFallbacks, /while the feel is fresh/i);
assert.doesNotMatch(whatToExpect, /setTimeout/);
assert.doesNotMatch(whatToExpect, /Welcome to your Snooze Session/);
assert.match(whatToExpectFallbacks, /Let’s start with your Snooze Assessment\./);
assert.match(whatToExpectFallbacks, /Let’s take a look at your recommended pods\./);
assert.match(fetchHudScript, /Math\.min\(30000,/);
assert.match(responseContract, /Math\.min\(n, 30000\)/);

const results = read("omnia-journey/src/pages/Results.jsx");
const assessment = read("omnia-journey/src/pages/Assessment.jsx");
const layout = read("omnia-journey/src/Layout.jsx");
const humanAssistance = read("omnia-journey/src/components/HumanAssistanceControl.jsx");
assert.match(results, /rankedPods\.slice\(1, 3\)/);
assert.match(results, /Your First Stop/);
assert.match(results, /Also Recommended/);
assert.match(results, /Your strongest match based on your sleep profile\./);
assert.match(results, /grid-cols-\[112px_minmax\(0,1fr\)\]/);
assert.match(results, /SnoozePod&nbsp;\{id\}/);
assert.match(results, /presentationSource: "results"/);
assert.doesNotMatch(results, /Next To Try/);
assert.doesNotMatch(results, /View pod/);
assert.doesNotMatch(results, /while the feel is fresh/i);
assert.doesNotMatch(results, /Go to SnoozePod/);
assert.doesNotMatch(results, /Also available to test/);
assert.doesNotMatch(results, /title="Ask Snoozer"/);
assert.doesNotMatch(results, /title="Talk to Human"/);
assert.doesNotMatch(results, /secondaryPods/);
assert.doesNotMatch(results, /Mattress family match/);
assert.doesNotMatch(results, /Pressure-relief focus/);

assert.match(assessment, /Question \{Math\.min\(step \+ 1/);
assert.equal((assessment.match(/style=\{\{ width: `\$\{progress\}%`/g) || []).length, 1);
assert.doesNotMatch(assessment, /questionSupportText/);
assert.doesNotMatch(assessment, /ShowroomCartBadge/);
assert.doesNotMatch(assessment, /Done \{doneCount\}/);
assert.doesNotMatch(assessment, /\{doneCount\} answered/);

assert.match(layout, /persistent-human-assistance/);
assert.match(layout, /<HumanAssistanceControl/);
assert.match(layout, /hideTrigger=\{pathname\.startsWith\("\/welcome"\)\}/);
assert.match(humanAssistance, /emitDeviceHumanHelp\(true/);
assert.match(humanAssistance, /Your Snooze Session will stay right here\./);
assert.match(humanAssistance, /brandy-avatar-c1\.png/);

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
console.log("PASS assessment_single_progress_no_cart");
console.log("PASS results_physical_handoff_top_three");
console.log("PASS persistent_human_assistance");
console.log("PASS what_to_expect_hud_script_contracts");
