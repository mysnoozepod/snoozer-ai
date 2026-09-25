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
const builderFlowSource = read("src/lib/podBuilderFlow.mjs");
const builderFlow = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(builderFlowSource)}`);
const learnSource = read("src/components/pod/PodLearnPanel.jsx");
const routeGuardSource = read("src/hooks/useHudRouteVoiceGuard.js");
const voiceQueueSource = read("src/lib/snoozer/voice/VoiceQueueContext.jsx");
const whatSource = read("src/pages/WhatToExpect.jsx");
const welcomeSource = read("src/pages/Welcome.jsx");
const layoutSource = read("src/Layout.jsx");
const viteSource = read("vite.config.js");
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

assert.doesNotMatch(builderSource, /key: "essentials", label: "Essentials"/);
assert.doesNotMatch(builderSource, /Complete Your Sleep Setup|data-sleep-essentials-card|Continue to Sleep Essentials|Back to essentials/);
assert.deepEqual(
  ["essentials", "pillows", "sheets", "protector"].map(builderFlow.normalizeCoreBuildStepCandidate),
  ["review", "review", "review", "review"]
);
assert.match(builderSource, /resolveMattressSizeFromCart/);
assert.match(builderSource, /cartMattressSize \|\| initialSelections\.size/);
assert.doesNotMatch(builderSource, /Choose your size, motion setup, and sleep essentials/);
assert.match(sleepEssentialsSource, /\["essentials", "pillows", "sheets", "protector", "review"\]/);
assert.match(builderSource, /desiredCartState === "exact"/);
assert.match(builderSource, /syncCartFromShopify\?\.\(\{ sourcePage: "pod-build-review" \}\)/);
assert.match(builderSource, /synchronizeCoreCartLines/);
assert.match(builderSource, /data-mattress-cart-continuity/);
assert.match(builderSource, /data-pod-builder-review-layout="decision"/);
assert.match(builderSource, /data-pod-builder-success-layout="balanced"/);
assert.doesNotMatch(builderSource, /essentialReviewRows|selectedEssentials|skippedEssentials|essentialsVersion/);
assert.match(podSource, /primaryCtaLabel="Add Selected Setup to Cart"/);

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
assert.match(routeGuardSource, /fadeMs: 0/);
assert.match(voiceQueueSource, /controller\.handleRouteChange\(\{ allowContinuation, maxCarryoverMs \}\)/);
assert.match(voiceQueueSource, /createSilentUnlockUrl/);
assert.match(voiceQueueSource, /data-snoozer-voice-audio/);
assert.match(whatSource, /isMountedRef\.current = true/);
assert.match(whatSource, /assessmentComplete \? "\/results" : "\/assessment"/);
assert.match(welcomeSource, /introJobId/);
assert.doesNotMatch(welcomeSource, /setTimeout/);
assert.match(layoutSource, /hudOpen &&\s*!pageOwnsSnoozerVisual/);
assert.doesNotMatch(layoutSource, /!pageOwnsSnoozerVisual \|\| isWhatToExpectRoute/);
assert.match(viteSource, /entryFileNames: "assets\/app-\[hash\]\.js"/);
assert.match(viteSource, /return "assets\/index-\[hash\]\[extname\]"/);
assert.match(viteSource, /return "assets\/\[name\]\[extname\]"/);

console.log("Pod experience polish tests passed: Learn truth, core-only authoritative cart, review coaching, captions, and route-entry voice.");
