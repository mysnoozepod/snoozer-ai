import { POD_LAYOUT_CONTRACT, getPodLayoutBudgetForViewport } from "@/lib/podLayoutContract";

function rectFor(node) {
  if (!node || typeof node.getBoundingClientRect !== "function") return null;
  const rect = node.getBoundingClientRect();
  return {
    top: Math.round(rect.top * 100) / 100,
    right: Math.round(rect.right * 100) / 100,
    bottom: Math.round(rect.bottom * 100) / 100,
    left: Math.round(rect.left * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100,
  };
}

function region(name) {
  return document.querySelector(`[data-pod-layout-region="${name}"]`);
}

function activeContentScrollAllowed(state) {
  const normalized = String(state || "").trim().toLowerCase();
  return normalized === "learn" || normalized.startsWith("build");
}

function intersects(a, b) {
  if (!a || !b) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function intersectionRatio(rect, viewport) {
  if (!rect || !viewport) return 0;
  const left = Math.max(rect.left, viewport.left);
  const right = Math.min(rect.right, viewport.right);
  const top = Math.max(rect.top, viewport.top);
  const bottom = Math.min(rect.bottom, viewport.bottom);
  const area = Math.max(0, right - left) * Math.max(0, bottom - top);
  const total = Math.max(1, rect.width * rect.height);
  return Math.round((area / total) * 1000) / 10;
}

function collectTouchTargets(root = document) {
  const targets = Array.from(
    root.querySelectorAll(
      'button:not([data-pod-lab-ignore]), a[href]:not([data-pod-lab-ignore]), [role="button"]:not([data-pod-lab-ignore])'
    )
  );

  return targets
    .map((node) => {
      const rect = rectFor(node);
      return {
        label: (node.textContent || node.getAttribute("aria-label") || node.tagName || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 80),
        width: rect?.width || 0,
        height: rect?.height || 0,
        rect,
      };
    })
    .filter((item) => item.width > 0 && item.height > 0);
}

function fixedElements() {
  return Array.from(document.querySelectorAll("body *"))
    .filter((node) => {
      if (node.closest("[data-pod-lab-ignore]")) return false;
      const style = window.getComputedStyle(node);
      return style.position === "fixed" || style.position === "sticky";
    })
    .map((node) => ({
      label: node.getAttribute("data-pod-layout-region") || node.getAttribute("data-pod-lab-panel") || node.tagName,
      rect: rectFor(node),
    }))
    .filter((item) => item.rect);
}

function targetDiff(actual, target) {
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return null;
  return Math.round((actual - target) * 100) / 100;
}

export function measurePodLayout({ state = "", contract = POD_LAYOUT_CONTRACT } = {}) {
  const doc = document.documentElement;
  const body = document.body;
  const viewport = {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    width: window.innerWidth,
    height: window.innerHeight,
  };
  const budget = getPodLayoutBudgetForViewport(viewport);
  const visualViewport = window.visualViewport
    ? {
        width: Math.round(window.visualViewport.width * 100) / 100,
        height: Math.round(window.visualViewport.height * 100) / 100,
        offsetLeft: Math.round(window.visualViewport.offsetLeft * 100) / 100,
        offsetTop: Math.round(window.visualViewport.offsetTop * 100) / 100,
      }
    : null;

  const nodes = {
    header: region("top-header"),
    productHero: region("product-hero"),
    activeContent: region("active-content"),
    navigation: region("pod-nav") || region("bottom-nav"),
    diagnostics: region("diagnostics"),
  };

  const rects = Object.fromEntries(Object.entries(nodes).map(([key, node]) => [key, rectFor(node)]));
  const activeContent = nodes.activeContent;
  const primaryActions = Array.from(document.querySelectorAll("[data-pod-layout-primary-action]"))
    .map((node) => ({
      id: node.getAttribute("data-pod-layout-primary-action") || "primary",
      label: (node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
      rect: rectFor(node),
    }))
    .filter((item) => item.rect);

  const primaryVisibility = primaryActions.map((action) => ({
    ...action,
    visiblePercent: intersectionRatio(action.rect, viewport),
  }));

  const touchTargets = collectTouchTargets(document);
  const smallestTouchTarget = touchTargets.reduce(
    (smallest, item) => {
      const minSide = Math.min(item.width, item.height);
      return minSide < smallest.minSide ? { ...item, minSide } : smallest;
    },
    { label: "", width: 0, height: 0, minSide: Number.POSITIVE_INFINITY, rect: null }
  );

  const overlaps = [];
  const addOverlap = (name, a, b) => {
    if (intersects(a, b)) overlaps.push({ name, a, b });
  };

  addOverlap("navigation-active-content", rects.navigation, rects.activeContent);
  addOverlap("diagnostics-navigation", rects.diagnostics, rects.navigation);
  primaryVisibility.forEach((action) => {
    addOverlap(`diagnostics-primary-action:${action.id}`, rects.diagnostics, action.rect);
  });
  fixedElements().forEach((item) => {
    if (item.label === "diagnostics") return;
    addOverlap(`fixed-active-content:${item.label}`, item.rect, rects.activeContent);
  });
  if (state === "rest-active") {
    document.querySelectorAll("[data-pod-layout-rest-control]").forEach((node) => {
      addOverlap(`rest-controls-navigation:${node.textContent?.trim() || "control"}`, rectFor(node), rects.navigation);
    });
  }
  if (state.startsWith("build")) {
    document.querySelectorAll("[data-pod-layout-build-action]").forEach((node) => {
      addOverlap(`build-actions-navigation:${node.textContent?.trim() || "build-action"}`, rectFor(node), rects.navigation);
    });
  }

  const pageScrollHeight = Math.max(doc.scrollHeight, body?.scrollHeight || 0);
  const pageClientHeight = doc.clientHeight;
  const pageScrollWidth = Math.max(doc.scrollWidth, body?.scrollWidth || 0);
  const pageClientWidth = doc.clientWidth;
  const smallestTouchMinSide =
    Number.isFinite(smallestTouchTarget.minSide) && smallestTouchTarget.minSide !== Number.POSITIVE_INFINITY
      ? smallestTouchTarget.minSide
      : 0;

  const failures = [];
  if (pageScrollWidth > pageClientWidth + 1) failures.push("horizontal-page-overflow");
  if (pageScrollHeight > pageClientHeight + 1) failures.push("vertical-page-overflow");
  const activeContentOverflows = activeContent ? activeContent.scrollHeight > activeContent.clientHeight + 1 : false;
  const warnings = [];
  if (activeContentOverflows) {
    warnings.push("active-content-scroll");
  }
  if (activeContentOverflows && !activeContentScrollAllowed(state)) {
    failures.push("active-content-scroll");
  }
  if (overlaps.length) failures.push("element-overlap");
  if (primaryVisibility.length && primaryVisibility.some((action) => action.visiblePercent < 95)) {
    failures.push("primary-action-not-fully-visible");
  }
  if (smallestTouchMinSide > 0 && smallestTouchMinSide < contract.sizing.touchTargetMin) {
    failures.push("touch-target-below-minimum");
  }

  return {
    state,
    timestamp: new Date().toISOString(),
    devicePixelRatio: window.devicePixelRatio || 1,
    viewport,
    visualViewport,
    page: {
      scrollHeight: pageScrollHeight,
      clientHeight: pageClientHeight,
      scrollWidth: pageScrollWidth,
      clientWidth: pageClientWidth,
      verticalOverflow: pageScrollHeight > pageClientHeight + 1,
      horizontalOverflow: pageScrollWidth > pageClientWidth + 1,
    },
    regions: {
      header: {
        target: budget.header,
        actual: rects.header?.height || 0,
        diff: targetDiff(rects.header?.height || 0, budget.header),
        rect: rects.header,
      },
      navigation: {
        target: budget.navigation,
        actual: rects.navigation?.height || 0,
        diff: targetDiff(rects.navigation?.height || 0, budget.navigation),
        rect: rects.navigation,
      },
      productHero: {
        target: budget.productHero,
        actual: rects.productHero?.height || 0,
        diff: targetDiff(rects.productHero?.height || 0, budget.productHero),
        rect: rects.productHero,
      },
      activeContent: {
        target: budget.activeContent,
        actual: rects.activeContent?.height || 0,
        diff: targetDiff(rects.activeContent?.height || 0, budget.activeContent),
        scrollHeight: activeContent?.scrollHeight || 0,
        clientHeight: activeContent?.clientHeight || 0,
        overflow: activeContentOverflows,
        rect: rects.activeContent,
      },
    },
    overlaps,
    primaryActions: primaryVisibility,
    primaryActionVisible: primaryVisibility.length
      ? primaryVisibility.every((action) => action.visiblePercent >= 95)
      : null,
    primaryActionVisiblePercent: primaryVisibility.length
      ? Math.min(...primaryVisibility.map((action) => action.visiblePercent))
      : null,
    touchTargets: {
      count: touchTargets.length,
      belowMinimum: touchTargets.filter((item) => Math.min(item.width, item.height) < contract.sizing.touchTargetMin),
      smallest: smallestTouchMinSide ? smallestTouchTarget : null,
    },
    warnings,
    failures,
    result: failures.length ? "fail" : "pass",
  };
}
