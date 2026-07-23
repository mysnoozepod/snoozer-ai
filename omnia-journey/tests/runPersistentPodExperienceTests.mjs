import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [podSource, headerSource, navSource, builderSource, hookSource] = await Promise.all([
  readSource("../src/pages/Pod.jsx"),
  readSource("../src/components/pod/PodHeader.jsx"),
  readSource("../src/components/pod/PodFooterNav.jsx"),
  readSource("../src/components/PodBuilder.jsx"),
  readSource("../src/hooks/useGuidedRestTest.js"),
]);

assert.equal(
  podSource.includes('guidedRestTest.pause();\n  }, [guidedRestTest.isActive'),
  false,
  "changing Pod tabs must not auto-pause the Rest Test"
);
assert.ok(podSource.includes('setOpenStage("ask")'), "Ask Snoozer must remain inside the mounted Pod runtime");
assert.ok(podSource.includes('setOpenStage("human")'), "Talk to Human must remain inside the mounted Pod runtime");
assert.ok(podSource.includes('setOpenStage("rest")'), "completion must return to the Rest Test rating surface");
assert.ok(podSource.includes("restStatus={restStatus}"), "the Pod hero must receive live Rest Test status");

for (const label of ["Rest Test", "Learn", "Customize", "Ask Snoozer", "Talk to Human"]) {
  assert.ok(navSource.includes(`label="${label}"`), `${label} must appear in Pod navigation`);
}
assert.equal(navSource.includes('label="Pod Home"'), false, "Pod Home must be absent from Pod navigation");
assert.equal(navSource.includes('label="Build"'), false, "Build must be customer-facing as Customize");

assert.ok(headerSource.includes('data-pod-rest-status="true"'));
assert.ok(headerSource.includes('aria-label="Return to active Rest Test"'));
assert.ok(headerSource.includes('"Resume Rest Test" : "Pause Rest Test"'));

for (const dimension of ['38" x 75"', '38" x 80"', '54" x 75"', '60" x 80"', '76" x 80"']) {
  assert.ok(builderSource.includes(dimension), `verified size dimension ${dimension} must be present`);
}
for (const asset of ["/standard-motion.png", "/half-split-motion.png", "/full-split-motion.png"]) {
  assert.ok(builderSource.includes(asset), `${asset} must be reused from the assessment`);
  await access(new URL(`../public${asset}`, import.meta.url));
}
for (const category of ["Mattress protector", "Sheets", "Bedding", "Pillows"]) {
  assert.ok(builderSource.includes(`"${category}"`), `${category} must have an explicit catalog status`);
}
assert.ok(builderSource.includes("Catalog setup pending"), "unsupported accessories must not receive invented variants");
assert.ok(podSource.includes('primaryCtaLabel="Add Selected Setup to Cart"'), "Customize must expose the requested cart action");

assert.ok(hookSource.includes('priority: "high"'), "Rest Test speech must use the high-priority HUD lane");
assert.ok(hookSource.includes("audioRef.current?.stop()"), "route unmount must clean up the shared audio runtime");
assert.equal(hookSource.includes("new Audio"), false, "the Rest hook must use the single ambient controller");

console.log("Persistent Pod experience tests passed: runtime ownership, navigation, status, visuals, and catalog boundaries.");
