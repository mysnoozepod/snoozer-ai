export const POD_LAYOUT_LAB_STATES = Object.freeze([
  "rest-selection",
  "rest-active",
  "learn",
  "build-size",
  "build-base",
  "build-review",
]);

export const POD_LAYOUT_VIEWPORTS = Object.freeze([
  { name: "1180x820", width: 1180, height: 820, primary: true },
  { name: "1024x768", width: 1024, height: 768, primary: false },
  { name: "1366x768", width: 1366, height: 768, primary: false },
]);

export const POD_LAYOUT_CONTRACT = Object.freeze({
  primaryViewport: {
    width: 1180,
    height: 820,
  },
  verticalBudget: {
    viewportHeight: 820,
    header: 72,
    navigation: 56,
    productHero: 190,
    outerVerticalAllowance: 24,
    sectionGaps: 36,
    activeContent: 442,
  },
  spacing: {
    outerHorizontalPadding: 24,
    cardPadding: 16,
    mainGap: 12,
    sectionGap: 16,
  },
  sizing: {
    buttonMinHeight: 48,
    touchTargetMin: 44,
    cardRadius: 16,
    buttonRadius: 12,
  },
  typography: {
    productTitleMin: 40,
    productTitleMax: 48,
    sectionHeadingMin: 28,
    sectionHeadingMax: 34,
    cardHeadingMin: 20,
    cardHeadingMax: 24,
    bodyMin: 16,
    bodyMax: 18,
    labelMin: 13,
    labelMax: 15,
  },
});

export function normalizePodLabState(value) {
  const state = String(value || "").trim().toLowerCase();
  return POD_LAYOUT_LAB_STATES.includes(state) ? state : "rest-selection";
}
