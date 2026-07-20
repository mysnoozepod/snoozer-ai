export const POD_LAYOUT_LAB_STATES = Object.freeze([
  "pod-home",
  "rest-selection",
  "rest-active",
  "learn",
  "build-size",
  "build-base",
  "build-motion",
  "build-comfort",
  "build-review",
  "build-success",
]);

export const POD_LAYOUT_VIEWPORTS = Object.freeze([
  { name: "1180x820", width: 1180, height: 820, primary: true },
  { name: "1024x768", width: 1024, height: 768, primary: false },
  { name: "1366x768", width: 1366, height: 768, primary: false },
  { name: "staging-review-1600x900", width: 1600, height: 900, primary: false },
  { name: "staging-observed-1920x899", width: 1920, height: 899, primary: false },
  { name: "staging-compact-1920x860", width: 1920, height: 860, primary: false },
  {
    name: "staging-actual-1280x585",
    width: 1280,
    height: 585,
    primary: false,
    textRoutesOnly: true,
  },
  {
    name: "staging-short-1280x560",
    width: 1280,
    height: 560,
    primary: false,
    textRoutesOnly: true,
  },
]);

export const POD_LAYOUT_CONTRACT = Object.freeze({
  primaryViewport: {
    width: 1180,
    height: 820,
  },
  verticalBudget: {
    viewportHeight: 820,
    header: 72,
    navigation: 64,
    productHero: 116,
    outerVerticalAllowance: 24,
    sectionGaps: 36,
    activeContent: 508,
    activeContentTopMax: 288,
    activeContentVisibleMin: 490,
  },
  compactVerticalBudget: {
    viewportHeight: 768,
    header: 72,
    navigation: 64,
    productHero: 116,
    outerVerticalAllowance: 24,
    sectionGaps: 36,
    activeContent: 456,
    activeContentTopMax: 288,
    activeContentVisibleMin: 430,
  },
  shortVerticalBudget: {
    viewportHeight: 585,
    header: 72,
    navigation: 64,
    productHero: 116,
    outerVerticalAllowance: 24,
    sectionGaps: 36,
    activeContent: 273,
    activeContentTopMax: 288,
    activeContentVisibleMin: 253,
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

export function getPodLayoutBudgetForViewport(viewport = {}) {
  const height = Number(viewport.height) || POD_LAYOUT_CONTRACT.primaryViewport.height;
  if (height <= 640) {
    const fixedHeight =
      POD_LAYOUT_CONTRACT.shortVerticalBudget.header +
      POD_LAYOUT_CONTRACT.shortVerticalBudget.navigation +
      POD_LAYOUT_CONTRACT.shortVerticalBudget.productHero +
      POD_LAYOUT_CONTRACT.shortVerticalBudget.outerVerticalAllowance +
      POD_LAYOUT_CONTRACT.shortVerticalBudget.sectionGaps;
    const activeContent = Math.max(220, height - fixedHeight);
    return {
      ...POD_LAYOUT_CONTRACT.shortVerticalBudget,
      viewportHeight: height,
      activeContent,
      activeContentVisibleMin: Math.max(210, activeContent - 20),
    };
  }
  return height >= POD_LAYOUT_CONTRACT.primaryViewport.height
    ? POD_LAYOUT_CONTRACT.verticalBudget
    : POD_LAYOUT_CONTRACT.compactVerticalBudget;
}

export function normalizePodLabState(value) {
  const state = String(value || "").trim().toLowerCase();
  return POD_LAYOUT_LAB_STATES.includes(state) ? state : "pod-home";
}
