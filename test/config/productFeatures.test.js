const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/config/productFeatures.js");

test("this fork disables OpenWhispr Cloud, account, meetings, and app updates", async () => {
  const { PRODUCT_FEATURES } = await load();
  assert.equal(PRODUCT_FEATURES.appUpdates, false);
  assert.equal(PRODUCT_FEATURES.openWhisprCloud, false);
  assert.equal(PRODUCT_FEATURES.openWhisprAccount, false);
  assert.equal(PRODUCT_FEATURES.meetings, false);
  assert.equal(PRODUCT_FEATURES.notes, false);
});

test("OpenWhispr Cloud and enterprise inference modes fall back to BYOK providers", async () => {
  const { resolvePersonalInferenceMode, isInferenceModeEnabled } = await load();
  assert.equal(resolvePersonalInferenceMode("openwhispr"), "providers");
  assert.equal(resolvePersonalInferenceMode("enterprise"), "providers");
  assert.equal(resolvePersonalInferenceMode("providers"), "providers");
  assert.equal(resolvePersonalInferenceMode("local"), "local");
  assert.equal(isInferenceModeEnabled("openwhispr"), false);
  assert.equal(isInferenceModeEnabled("providers"), true);
  assert.equal(isInferenceModeEnabled("local"), true);
});
