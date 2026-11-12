(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SnoozePodShopBySize = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function normalizeSize(value) {
    const clean = String(value || "").trim().replace(/\s*\(2pc\)$/i, "").replace(/Cal King/gi, "California King").replace(/\s+/g, " ");
    if (!clean || clean.toLowerCase() === "one size") return null;
    return clean;
  }

  function shopSizeLabels(value) {
    const normalized = normalizeSize(value);
    if (!normalized) return [];
    return Array.from(new Set(normalized.split("/").map(function (label) { return label.trim(); }).filter(Boolean)));
  }

  function eligibleVariant(variants, selectedSize) {
    const wanted = normalizeSize(selectedSize);
    if (!wanted || !Array.isArray(variants)) return null;
    return variants.find(function (variant) {
      return variant && variant.available === true && shopSizeLabels(variant.nativeSize).includes(wanted);
    }) || null;
  }

  function systemOnlyMattressSize(value) {
    const normalized = normalizeSize(value);
    return Boolean(normalized && (/^Split Head /i.test(normalized) || /^Split (King|California King)$/i.test(normalized) || /^Twin XL x 2$/i.test(normalized)));
  }

  function selectedSizeFromSearch(search) {
    const params = new URLSearchParams(search || "");
    const explicit = normalizeSize(params.get("size"));
    if (explicit) return explicit;
    const nativeSizes = params.getAll("filter.v.option.size").flatMap(shopSizeLabels);
    return nativeSizes.length === 1 ? nativeSizes[0] : null;
  }

  function productUrlForVariant(url, variantId, selectedSize, origin) {
    const next = new URL(url, origin || "https://mysnoozepod.com");
    next.searchParams.set("variant", String(variantId));
    next.searchParams.set("size", normalizeSize(selectedSize) || String(selectedSize || ""));
    return next.pathname + next.search + next.hash;
  }

  function collectionContext(map, handle) {
    if (!map || !handle) return null;
    if (handle === map.masterCollectionHandle) {
      return { heading: "Shop Everything by Size", intro: "Choose a size to see every currently available product that supports it.", sizes: map.storewide, selectedSize: null, clearHandle: map.masterCollectionHandle, noun: "product" };
    }
    const storewide = (map.storewide || []).find(function (entry) { return entry.handle === handle; });
    if (storewide) {
      return { heading: "Shop " + storewide.label, intro: "Showing products with an available " + storewide.label + " variant and its exact price.", sizes: map.storewide, selectedSize: storewide.label, clearHandle: map.masterCollectionHandle, noun: "product" };
    }
    for (const category of map.categories || []) {
      if (handle === category.canonicalCollectionHandle) {
        return { heading: "Shop " + category.title + " by Size", intro: "Choose a size to see currently available " + category.title.toLowerCase() + " and exact variant pricing.", sizes: category.sizes, selectedSize: null, clearHandle: category.canonicalCollectionHandle, noun: category.title.toLowerCase() };
      }
      const categorySize = (category.sizes || []).find(function (entry) { return entry.handle === handle; });
      if (categorySize) {
        return { heading: categorySize.label + " " + category.title, intro: "Showing " + category.title.toLowerCase() + " with an available " + categorySize.label + " variant and its exact price.", sizes: category.sizes, selectedSize: categorySize.label, clearHandle: category.canonicalCollectionHandle, noun: category.title.toLowerCase() };
      }
    }
    return null;
  }

  function parseVariants(card) {
    const source = card.querySelector("[data-shop-by-size-variants]");
    if (!source) return [];
    try {
      const parsed = JSON.parse(source.textContent || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function setCardLinks(card, variant, selectedSize) {
    card.querySelectorAll("a[href]").forEach(function (link) {
      if (!link.dataset.shopBySizeOriginalHref) link.dataset.shopBySizeOriginalHref = link.getAttribute("href") || "";
      link.setAttribute("href", variant ? productUrlForVariant(link.dataset.shopBySizeOriginalHref, variant.variantId, selectedSize, window.location.origin) : link.dataset.shopBySizeOriginalHref);
    });
  }

  function preserveSizeInFacetForms(selectedSize) {
    document.querySelectorAll("#main-collection-filters form").forEach(function (form) {
      let input = form.querySelector("input[data-shop-by-size-preserver]");
      if (!selectedSize) {
        if (input) input.remove();
        return;
      }
      if (!input) {
        input = document.createElement("input");
        input.type = "hidden";
        input.name = "size";
        input.dataset.shopBySizePreserver = "true";
        form.appendChild(input);
      }
      input.value = selectedSize;
    });
  }

  function renderPanel(section, context) {
    section.hidden = false;
    const heading = section.querySelector("[data-shop-by-size-heading]");
    const intro = section.querySelector("[data-shop-by-size-intro]");
    const options = section.querySelector("[data-shop-by-size-options]");
    const clear = section.querySelector("[data-shop-by-size-clear]");
    if (heading) heading.textContent = context.heading;
    if (intro) intro.textContent = context.intro;
    if (options) {
      options.textContent = "";
      (context.sizes || []).forEach(function (size) {
        const link = document.createElement("a");
        link.className = "snoozepod-shop-by-size__option";
        link.href = "/collections/" + size.handle + "?size=" + encodeURIComponent(size.label);
        link.dataset.shopBySizeOption = size.label;
        link.setAttribute("aria-current", size.label === context.selectedSize ? "page" : "false");
        link.classList.toggle("is-active", size.label === context.selectedSize);
        link.textContent = size.label;
        options.appendChild(link);
      });
    }
    if (clear) {
      clear.hidden = !context.selectedSize;
      clear.href = "/collections/" + context.clearHandle;
      clear.textContent = "Show all " + context.noun + (context.noun.endsWith("s") ? "" : "s");
    }
  }

  function controller(root, map) {
    const context = collectionContext(map, root.dataset.collectionHandle);
    if (!context) return;
    const panel = root.querySelector("[data-shop-by-size]");
    if (panel) renderPanel(panel, context);
    const selectedSize = context.selectedSize || selectedSizeFromSearch(window.location.search);
    const grid = document.getElementById("product-grid");
    const cards = grid ? Array.from(grid.querySelectorAll("[data-shop-by-size-product]")) : [];
    let visibleCount = 0;
    cards.forEach(function (card) {
      const match = selectedSize ? eligibleVariant(parseVariants(card), selectedSize) : null;
      const standaloneMattressBlocked = card.dataset.productType === "mattress" && systemOnlyMattressSize(selectedSize);
      const visible = !standaloneMattressBlocked && (!selectedSize || Boolean(match));
      card.hidden = !visible;
      if (visible) visibleCount += 1;
      setCardLinks(card, match, selectedSize);
      const nativePrice = card.querySelector(".card-information > .price");
      const selectedPrice = card.querySelector("[data-shop-by-size-price]");
      if (nativePrice) nativePrice.hidden = Boolean(match);
      if (selectedPrice) {
        selectedPrice.hidden = !match;
        if (match) {
          const label = selectedPrice.querySelector("[data-shop-by-size-price-label]");
          const amount = selectedPrice.querySelector("[data-shop-by-size-price-amount]");
          if (label) label.textContent = selectedSize + " price";
          if (amount) amount.textContent = match.price;
        }
      }
    });
    const status = panel ? panel.querySelector("[data-shop-by-size-status]") : null;
    if (status) status.textContent = selectedSize ? visibleCount + (visibleCount === 1 ? " product" : " products") + " shown in " + selectedSize + "." : "Choose a size to see exact availability and pricing.";
    preserveSizeInFacetForms(selectedSize);
  }

  function init() {
    const root = document.querySelector("[data-shop-by-size-root]");
    const map = typeof window !== "undefined" ? window.SnoozePodSizeCollections : null;
    if (!root || !map || !collectionContext(map, root.dataset.collectionHandle)) return;
    controller(root, map);
    const container = document.getElementById("ProductGridContainer");
    if (container && typeof MutationObserver !== "undefined") {
      let queued = false;
      new MutationObserver(function () {
        if (queued) return;
        queued = true;
        queueMicrotask(function () { queued = false; controller(root, map); });
      }).observe(container, { childList: true, subtree: true });
    }
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
  }

  return { normalizeSize: normalizeSize, shopSizeLabels: shopSizeLabels, eligibleVariant: eligibleVariant, systemOnlyMattressSize: systemOnlyMattressSize, selectedSizeFromSearch: selectedSizeFromSearch, productUrlForVariant: productUrlForVariant, collectionContext: collectionContext };
});
