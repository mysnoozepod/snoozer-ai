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
const showroomStyles = read("omnia-journey/src/styles/index.css");
assert.match(welcome, /const SNOOZE_CODE_LENGTH = 6/);
assert.match(welcome, /inputMode="numeric"/);
assert.match(welcome, /pattern="\[0-9\]\*"/);
assert.match(welcome, /digits\.map/);
assert.match(welcome, /maxLength=\{1\}/);
assert.match(welcome, /handleDigitKeyDown/);
assert.match(welcome, /event\.key === "Backspace"/);
assert.match(welcome, /handleCodePaste/);
assert.match(welcome, /pastedDigits\.length === SNOOZE_CODE_LENGTH/);
assert.match(welcome, /nextDigits\.every\(Boolean\).*nextCode\.length === SNOOZE_CODE_LENGTH/s);
assert.match(welcome, /handleStart\(nextCode\)/);
assert.match(welcome, /hasStartedRef\.current/);
assert.match(welcome, /readOnly=\{loading\}/);
assert.match(welcome, /aria-describedby="welcome-code-feedback"/);
assert.match(welcome, /Loading your Snooze Session…/);
assert.doesNotMatch(welcome, /starts automatically after the fourth digit/i);
assert.match(welcome, /Personalize Your Experience/);
assert.match(welcome, /rewards, recommendations, and special discounts!/);
assert.match(welcome, /Need Human Help\?/);
assert.match(welcome, /Talk to Brandy, your dedicated Human Assistant\./);
assert.equal((welcome.match(/Talk to Brandy/g) || []).length, 1);
assert.doesNotMatch(welcome, /===\s*["']1234["']/);
assert.match(welcome, /useReducedMotion/);
assert.match(welcome, /shouldReduceMotion \? false/);
assert.match(welcome, /import welcomeBrandMarkSrc from "@\/assets\/mysnoozepod-logo-welcome\.png"/);
assert.match(welcome, /imageSrc=\{welcomeBrandMarkSrc\}/);
assert.match(welcome, /data-welcome-headline-phrase="true"/);
assert.match(welcome, /whitespace-nowrap/);
assert.match(welcome, /w-\[238px\].*md:w-\[266px\]/);
assert.match(welcome, /data-welcome-code-feedback="true"/);
assert.match(showroomStyles, /--showroom-color-brand-primary:\s*#2f57e8/);
assert.match(showroomStyles, /--showroom-radius-input:/);
assert.match(showroomStyles, /--showroom-shadow-focus:/);
assert.match(showroomStyles, /--showroom-motion-page-enter:/);

const whatToExpect = read("omnia-journey/src/pages/WhatToExpect.jsx");
const whatToExpectFallbacks = read(
  "omnia-journey/src/lib/snoozer/hud/whatToExpectFallbacks.js"
);
const fetchHudScript = read("omnia-journey/src/lib/snoozer/hud/fetchHudScript.js");
const responseContract = read("utils/responseContract.js");
assert.match(whatToExpect, /md:grid-cols-2/);
assert.match(whatToExpect, /orientationJobId/);
assert.match(whatToExpect, /voiceState\?\.loading \|\| voiceState\?\.playing/);
assert.match(whatToExpect, /navigate\(assessmentComplete \? "\/results" : "\/assessment"/);
assert.match(whatToExpect, /Build Your Sleep Profile/);
assert.match(whatToExpect, /Visit Your Recommended Pods/);
assert.match(whatToExpect, /Explore Sleep Essentials/);
assert.match(whatToExpect, /Tell us how you sleep\./);
assert.match(whatToExpect, /Try your best matches\./);
assert.match(whatToExpect, /Pillows, bedding & protection\./);
assert.match(whatToExpect, /Choose what feels right\./);
assert.match(whatToExpect, /aria-current=\{isCurrent \? "step"/);
assert.match(whatToExpect, /data-journey-state=\{state\}/);
assert.match(whatToExpect, /h-14 w-14/);
assert.match(whatToExpect, /src="\/snoozer-avatar\.png"/);
assert.match(whatToExpect, /imageSrc=\{welcomeBrandMarkSrc\}/);
assert.match(whatToExpect, /useReducedMotion/);
assert.match(whatToExpect, /presentationSource: "what-to-expect"/);
assert.doesNotMatch(whatToExpect, /Next Step/);
assert.doesNotMatch(whatToExpect, /Retake Snooze Assessment/);
assert.doesNotMatch(whatToExpect, /Test Recommended Pods/);
assert.doesNotMatch(whatToExpect, /Answer a few sleep questions/);
assert.doesNotMatch(whatToExpect, /Walk to your first match/);
assert.doesNotMatch(whatToExpect, /Try pillows, bedding, and protectors/);
assert.doesNotMatch(whatToExpectFallbacks, /while the feel is fresh/i);
assert.doesNotMatch(whatToExpect, /setTimeout/);
assert.doesNotMatch(whatToExpect, /Welcome to your Snooze Session/);
assert.match(whatToExpectFallbacks, /We’ll start with your sleep profile/);
assert.match(whatToExpectFallbacks, /You already finished your sleep profile/);
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
