import flags from "./productFeatures.json";

export const PRODUCT_FEATURES = Object.freeze(flags);

export function resolvePersonalInferenceMode(mode) {
  if (mode === "openwhispr" && !PRODUCT_FEATURES.openWhisprCloud) return "providers";
  if (mode === "enterprise" && !PRODUCT_FEATURES.enterprise) return "providers";
  return mode;
}

export function isInferenceModeEnabled(mode) {
  if (mode === "openwhispr") return PRODUCT_FEATURES.openWhisprCloud;
  if (mode === "enterprise") return PRODUCT_FEATURES.enterprise;
  return true;
}
