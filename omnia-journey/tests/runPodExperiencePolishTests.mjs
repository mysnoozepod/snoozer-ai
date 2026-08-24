import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const supportSource = read("src/lib/sleepSupport.js");
const supportModule = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(supportSource)}`);
const coachingSource = read("src/lib/podReviewCoaching.js");
const coaching = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(coachingSource)}`);
const podSource = read("src/pages/Pod.jsx");
const builderSource = read("src/components/PodBuilder.jsx");
const learnSource = read("src/components/pod/PodLearnPanel.jsx");
const routeGuardSource = read("src/hooks/useHudRouteVoiceGuard.js");
const voiceQueueSource = read("src/lib/snoozer/voice/VoiceQueueContext.jsx");
const whatSource = read("src/pages/WhatToExpect.jsx");
const sleepEssentialsSource = read("src/lib/sleepEssentials.js");

const supportItems = supportModule.buildMattressSupportItems({
  mattressTruth: { family: "foam", hasPressureRelief: true, hasCooling: true },
  firmness: "Medium",
});
assert.deepEqual(supportItems.map((item) => item.category), [
  "Support", "Pressure Relief", "Temperature Comfort", "Motion Isolation",
]);
assert.doesNotMatch(`${supportSource}${learnSource}`, /Protein|Healthy Fats|Electrolytes|Sleep Nutrition/);
assert.match(learnSource, /How This Mattress Supports Your Sleep/);
assert.match(learnSource, /Choose Size/);
assert.match(learnSource, /Mattress in Cart/);
assert.match(podSource, /result\?\.items[\s\S]*CART_CONFIRMATION_MISSING/);
assert.match(podSource, /gid:\/\/shopify\/ProductVariant\//);

assert.match(builderSource, /key: "essentials", label: "Essentials"/);
assert.match(builderSource, /Complete Your Sleep Setup/);
assert.match(builderSource, /choices\.slice\(0, 3\)/);
assert.match(builderSource, /No approved Sleep Essentials are available/);
assert.match(builderSource, /View All Sleep Essentials/);
assert.match(sleepEssentialsSource, /\["essentials", "pillows", "sheets", "protector", "review"\]/);
assert.match(builderSource, /exactMattressAlreadyInCart \? \[\] : \[/);
assert.match(builderSource, /await removeFromCart\?\.\(item\.lineId \|\| item\.id\)/);
assert.match(builderSource, /data-mattress-cart-continuity/);

const facts = coaching.buildBoundedPodReviewContext({
  assessment: { position: "back", firmness: "medium" },
  rank: 1,
  restTest: { ratings: { support: 5 }, bestPosition: "Zero Gravity" },
  selection: { mattress: "Verified Mattress", size: "Queen", base: "Adjustable Base", motion: "Standard" },
  essentials: { selected: ["Approved Pillow"], skipped: ["sheets"] },
  cart: [{ title: "Verified Mattress", merchandiseId: "gid://shopify/ProductVariant/1", quantity: 1 }],
  progress: "Review Your SnoozePod",
});
assert.equal(facts.recommendedRank, 1);
assert.equal(facts.cart.length, 1);

coaching.resetPodReviewCoachingCircuit();
const modelHud = await coaching.getPodReviewCoaching({
  api: { askSnoozer: async () => ({ ok: true, hud: { speech: "This verified setup follows your strong support rating." } }) },
  facts,
});
assert.deepEqual(Object.keys(modelHud), ["speech", "captions", "state", "priority", "ttlMs", "actions"]);
assert.match(modelHud.speech, /verified setup/);
assert.equal(modelHud.captions, modelHud.speech);

coaching.resetPodReviewCoachingCircuit();
const fallbackHud = await coaching.getPodReviewCoaching({
  api: { askSnoozer: async () => ({ ok: false }) },
  facts,
});
assert.match(fallbackHud.speech, /Zero Gravity/);
assert.equal(fallbackHud.captions, fallbackHud.speech);

coaching.resetPodReviewCoachingCircuit();
const timeoutHud = await coaching.getPodReviewCoaching({
  api: { askSnoozer: () => new Promise(() => {}) },
  facts,
  timeoutMs: 5,
});
assert.match(timeoutHud.speech, /Zero Gravity/);

coaching.resetPodReviewCoachingCircuit();
let circuitCalls = 0;
const failingApi = { askSnoozer: async () => { circuitCalls += 1; return { ok: false }; } };
await coaching.getPodReviewCoaching({ api: failingApi, facts });
await coaching.getPodReviewCoaching({ api: failingApi, facts });
await coaching.getPodReviewCoaching({ api: failingApi, facts });
assert.equal(circuitCalls, 2);

assert.match(routeGuardSource, /useLayoutEffect/);
assert.match(voiceQueueSource, /controller\.handleRouteChange\(\{ allowContinuation, maxCarryoverMs \}\)/);
assert.match(whatSource, /isMountedRef\.current = true/);
assert.match(whatSource, /assessmentComplete \? "\/results" : "\/assessment"/);

console.log("Pod experience polish tests passed: Learn truth, authoritative cart, combined essentials, review coaching, captions, and route-entry voice.");
