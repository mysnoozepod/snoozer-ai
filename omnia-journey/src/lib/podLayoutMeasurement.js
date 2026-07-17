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

function styleFor(node) {
  if (!node) return null;
  const style = window.getComputedStyle(node);
  return {
    position: style.position,
    display: style.display,
    overflow: style.overflow,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    height: style.height,
    minHeight: style.minHeight,
    maxHeight: style.maxHeight,
  };
}

function region(name) {
  return document.querySelector(`[data-pod-layout-region="${name}"]`);
}

function nodeLabel(node) {
  if (!node) return "";
  const parts = [
    node.getAttribute("data-pod-layout-region"),
    node.getAttribute("data-pod-layout-primary-action"),
    node.getAttribute("aria-label"),
    node.id ? `#${node.id}` : "",
    node.className && typeof node.className === "string"
      ? `.${node.className.trim().split(/\s+/).slice(0, 3).join(".")}`
      : "",
    node.tagName,
  ].filter(Boolean);
  return parts[0] || node.tagName || "element";
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

function collectScrollContainers(root = document.body) {
  return Array.from(root.querySelectorAll("*"))
    .filter((node) => !node.closest("[data-pod-lab-ignore]"))
    .map((node) => {
      const style = styleFor(node);
      const overflowText = `${style.overflow} ${style.overflowX} ${style.overflowY}`.toLowerCase();
      const isOverflowNode = /(auto|scroll|hidden|clip)/.test(overflowText);
      if (!isOverflowNode) return null;

      const rect = rectFor(node);
      const scrollHeight = node.scrollHeight || 0;
      const clientHeight = node.clientHeight || 0;
      const scrollWidth = node.scrollWidth || 0;
      const clientWidth = node.clientWidth || 0;
      const concealsVertical = scrollHeight > clientHeight + 1;
      const concealsHorizontal = scrollWidth > clientWidth + 1;

      return {
        label: nodeLabel(node),
        tagName: node.tagName,
        rect,
        style,
        scrollHeight,
        clientHeight,
        scrollWidth,
        clientWidth,
        concealsVertical,
        concealsHorizontal,
        isShell: Boolean(node.closest("[data-pod-layout-shell]")),
        isRegion: Boolean(node.getAttribute("data-pod-layout-region")),
      };
    })
    .filter(Boolean)
    .filter((item) => item.rect && item.rect.width > 0 && item.rect.height > 0);
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

function visibleHeight(rect, viewport) {
  if (!rect || !viewport) return 0;
  return Math.max(0, Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top));
}

function rectWithin(inner, outer, tolerance = 1) {
  if (!inner || !outer) return false;
  return (
    inner.top >= outer.top - tolerance &&
    inner.left >= outer.left - tolerance &&
    inner.right <= outer.right + tolerance &&
    inner.bottom <= outer.bottom + tolerance
  );
}

function collectHeroContainment(productHero) {
  const heroRect = rectFor(productHero);
  if (!productHero || !heroRect) {
    return {
      checked: 0,
      failures: [],
      images: [],
      contentRect: null,
    };
  }

  const contentNode = productHero.firstElementChild || null;
  const contentRect = rectFor(contentNode);
  const descendants = Array.from(productHero.querySelectorAll("*"))
    .filter((node) => !node.closest("[data-pod-lab-ignore]"))
    .map((node) => ({
      label: nodeLabel(node),
      tagName: node.tagName,
      rect: rectFor(node),
    }))
    .filter((item) => item.rect && item.rect.width > 0 && item.rect.height > 0);

  const failures = descendants.filter((item) => !rectWithin(item.rect, heroRect, 1));
  const images = descendants
    .filter((item) => item.tagName === "IMG")
    .map((item) => ({
      ...item,
      contained: rectWithin(item.rect, heroRect, 1),
      visiblePercent: intersectionRatio(item.rect, heroRect),
    }));

  return {
    checked: descendants.length,
    failures,
    images,
    contentRect,
  };
}

function serializeRegion(node, target) {
  const rect = rectFor(node);
  return {
    target,
    actual: rect?.height || 0,
    diff: targetDiff(rect?.height || 0, target),
    rect,
    style: styleFor(node),
    scrollHeight: node?.scrollHeight || 0,
    clientHeight: node?.clientHeight || 0,
    scrollWidth: node?.scrollWidth || 0,
    clientWidth: node?.clientWidth || 0,
    visiblePercent: intersectionRatio(rect, {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight,
    }),
  };
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
    appViewport: document.querySelector("[data-pod-layout-shell]"),
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
  if (!nodes.header) failures.push("missing-header-region");
  if (!nodes.navigation) failures.push("missing-navigation-region");
  if (!nodes.productHero) failures.push("missing-product-hero-region");
  if (!nodes.activeContent) failures.push("missing-active-content-region");
  if (pageScrollWidth > pageClientWidth + 1) failures.push("horizontal-page-overflow");
  if (pageScrollHeight > pageClientHeight + 1) failures.push("vertical-page-overflow");
  const activeContentOverflows = activeContent ? activeContent.scrollHeight > activeContent.clientHeight + 1 : false;
  const warnings = [];
  if (activeContentOverflows) failures.push("active-content-scroll");
  if (overlaps.length) failures.push("element-overlap");
  if (primaryVisibility.length && primaryVisibility.some((action) => action.visiblePercent < 95)) {
    failures.push("primary-action-not-fully-visible");
  }
  if (smallestTouchMinSide > 0 && smallestTouchMinSide < contract.sizing.touchTargetMin) {
    failures.push("touch-target-below-minimum");
  }

  const headerDiff = Math.abs(targetDiff(rects.header?.height || 0, budget.header) || 0);
  const navDiff = Math.abs(targetDiff(rects.navigation?.height || 0, budget.navigation) || 0);
  const heroDiff = Math.abs(targetDiff(rects.productHero?.height || 0, budget.productHero) || 0);
  if (headerDiff > 2) failures.push("header-height-out-of-contract");
  if (navDiff > 2) failures.push("navigation-height-out-of-contract");
  if (heroDiff > 2) failures.push("product-hero-height-out-of-contract");

  const activeVisibleHeight = visibleHeight(rects.activeContent, viewport);
  if (rects.activeContent && rects.activeContent.top > budget.activeContentTopMax + 1) {
    failures.push("active-content-starts-too-low");
  }
  if (rects.activeContent && activeVisibleHeight < budget.activeContentVisibleMin) {
    failures.push("active-content-visible-height-too-small");
  }

  const heroContainment = collectHeroContainment(nodes.productHero);
  if (heroContainment.failures.length) failures.push("product-hero-child-overflow");
  if (heroContainment.images.some((item) => !item.contained)) failures.push("mattress-image-outside-hero");

  const scrollContainers = collectScrollContainers(document.body);
  const shellScrollContainers = scrollContainers.filter((item) => {
    const values = `${item.style.overflow} ${item.style.overflowX} ${item.style.overflowY}`.toLowerCase();
    const scrollIntent = /(auto|scroll)/.test(values);
    return item.isShell && scrollIntent && (item.concealsVertical || item.concealsHorizontal);
  });
  const clippedShellContainers = scrollContainers.filter((item) => {
    const values = `${item.style.overflow} ${item.style.overflowX} ${item.style.overflowY}`.toLowerCase();
    return item.isShell && /hidden/.test(values) && (item.concealsVertical || item.concealsHorizontal);
  });
  if (shellScrollContainers.length) failures.push("shell-scroll-container");
  if (clippedShellContainers.length) failures.push("shell-clipping-content");

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
    appViewport: serializeRegion(nodes.appViewport, viewport.height),
    regions: {
      header: serializeRegion(nodes.header, budget.header),
      navigation: serializeRegion(nodes.navigation, budget.navigation),
      productHero: serializeRegion(nodes.productHero, budget.productHero),
      activeContent: {
        ...serializeRegion(nodes.activeContent, budget.activeContent),
        scrollHeight: activeContent?.scrollHeight || 0,
        clientHeight: activeContent?.clientHeight || 0,
        overflow: activeContentOverflows,
        visibleHeight: activeVisibleHeight,
        topMax: budget.activeContentTopMax,
        visibleMin: budget.activeContentVisibleMin,
        rect: rects.activeContent,
      },
    },
    productHeroContainment: heroContainment,
    scrollContainers,
    shellScrollContainers,
    clippedShellContainers,
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
