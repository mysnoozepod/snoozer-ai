import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [podSource, headerSource, navSource, builderSource, hookSource, layoutSource, helpSource, restPanelSource] = await Promise.all([
  readSource("../src/pages/Pod.jsx"),
  readSource("../src/components/pod/PodHeader.jsx"),
  readSource("../src/components/pod/PodFooterNav.jsx"),
  readSource("../src/components/PodBuilder.jsx"),
  readSource("../src/hooks/useGuidedRestTest.js"),
  readSource("../src/Layout.jsx"),
  readSource("../src/components/HumanAssistanceControl.jsx"),
  readSource("../src/components/pod/PodRestPanels.jsx"),
]);

assert.equal(
  podSource.includes('guidedRestTest.pause();\n  }, [guidedRestTest.isActive'),
  false,
  "changing Pod tabs must not auto-pause the Rest Test"
);
assert.ok(podSource.includes('setOpenStage("ask")'), "Ask Snoozer must remain inside the mounted Pod runtime");
assert.equal(podSource.includes('setOpenStage("human")'), false, "Human Assistance must not create a duplicate Pod tab");
assert.equal(podSource.includes("Back to results"), false, "Pod devices must not navigate digitally back to Results");
assert.ok(podSource.includes("<HumanAssistanceControl"), "Pod header must own Human Assistance");
assert.ok(podSource.includes("<ShowroomCartBadge"), "Pod header must expose the authoritative cart control");
assert.ok(podSource.includes("count={snoozepodCount}"), "Pod cart control must use the existing cart count");
assert.ok(layoutSource.includes('!pathname.startsWith("/pod/")'), "the floating assistance bubble must be suppressed on Pod routes");
assert.ok(helpSource.includes("emitDeviceHumanHelp"), "Pod header assistance must reuse the existing help behavior");
assert.ok(podSource.includes('setOpenStage("rest")'), "completion must return to the Rest Test rating surface");
assert.ok(podSource.includes("restStatus={restStatus}"), "the Pod hero must receive live Rest Test status");
assert.ok(
  podSource.includes("hydratedPodIdRef.current !== pid"),
  "recommendation hydration must preserve the current Pod and Rest Test session"
);

for (const label of ["Rest Test", "Learn", "Customize", "Ask Snoozer"]) {
  assert.ok(navSource.includes(`label="${label}"`), `${label} must appear in Pod navigation`);
}
assert.equal(navSource.includes('label="Talk to Human"'), false, "Talk to Human must not be duplicated in Pod navigation");
assert.equal(navSource.includes('label="Pod Home"'), false, "Pod Home must be absent from Pod navigation");
assert.equal(navSource.includes('label="Build"'), false, "Build must be customer-facing as Customize");

assert.ok(headerSource.includes('data-pod-rest-status="true"'));
assert.ok(headerSource.includes('aria-label="Return to active Rest Test"'));
assert.ok(headerSource.includes('"Resume Rest Test" : "Pause Rest Test"'));
assert.equal(restPanelSource.includes("active time"), false, "the active panel must not duplicate the persistent timer");

for (const dimension of ['38" x 75"', '38" x 80"', '54" x 75"', '60" x 80"', '76" x 80"']) {
  assert.ok(builderSource.includes(dimension), `verified size dimension ${dimension} must be present`);
}
for (const asset of ["/standard-motion.png", "/half-split-motion.png", "/full-split-motion.png"]) {
  assert.ok(builderSource.includes(asset), `${asset} must be reused from the assessment`);
  await access(new URL(`../public${asset}`, import.meta.url));
}
for (const step of ['"pillows"', '"sheets"', '"protector"']) {
  assert.ok(builderSource.includes(step), `${step} must have a guided customization stage`);
}
assert.equal(builderSource.includes('"Bedding"'), false, "the generic Bedding category must not be in Customize");
assert.equal(builderSource.includes("Catalog setup pending"), false, "live approved products must replace placeholders");
assert.ok(
  builderSource.includes("gid://shopify/ProductVariant/"),
  "Sleep Essentials must require exact Shopify variant GIDs"
);
assert.ok(
  builderSource.includes("selectedEssentialChoices"),
  "selected Sleep Essentials must be revalidated against the live catalog"
);
assert.ok(podSource.includes('primaryCtaLabel="Add Selected Setup to Cart"'), "Customize must expose the requested cart action");
assert.ok(builderSource.includes("Explore more at the Sleep Essentials station"), "Customize must hand off physically to the Sleep Essentials station");
assert.equal(builderSource.includes("View All Sleep Essentials"), false, "Customize must not navigate to the full catalog");
assert.ok(builderSource.includes('data-pod-builder-success-layout="balanced"'), "completion must use the balanced success layout");

assert.ok(hookSource.includes('priority: "high"'), "Rest Test speech must use the high-priority HUD lane");
assert.ok(hookSource.includes("audioRef.current?.stop()"), "route unmount must clean up the shared audio runtime");
assert.equal(hookSource.includes("new Audio"), false, "the Rest hook must use the single ambient controller");

console.log("Persistent Pod experience tests passed: runtime ownership, navigation, status, visuals, and catalog boundaries.");
