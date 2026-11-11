(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SnoozePodShopBySize = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const STANDARD_SIZES = ["Twin", "Twin XL", "Full", "Queen", "King", "California King"];
  const SIZE_ALIASES = new Map([
    ["twin", "Twin"],
    ["twin xl", "Twin XL"],
    ["full", "Full"],
    ["queen", "Queen"],
    ["king", "King"],
    ["cal king", "California King"],
    ["california king", "California King"],
  ]);

  function normalizeSize(value) {
    const normalized = String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
    return SIZE_ALIASES.get(normalized) || null;
  }

  function eligibleVariant(variants, selectedSize) {
    const wanted = normalizeSize(selectedSize);
    if (!wanted || !Array.isArray(variants)) return null;
    return variants.find(function (variant) {
      return variant && variant.available === true && normalizeSize(variant.nativeSize) === wanted;
    }) || null;
  }

  function selectedSizeFromSearch(search) {
    const params = new URLSearchParams(search || "");
    const explicit = normalizeSize(params.get("size"));
    if (explicit) return explicit;
    const nativeSizes = params.getAll("filter.v.option.size").map(normalizeSize).filter(Boolean);
    return nativeSizes.length === 1 ? nativeSizes[0] : null;
  }

  function productUrlForVariant(url, variantId, selectedSize, origin) {
    const next = new URL(url, origin || "https://mysnoozepod.com");
    next.searchParams.set("variant", String(variantId));
    next.searchParams.set("size", normalizeSize(selectedSize) || String(selectedSize || ""));
    return next.pathname + next.search + next.hash;
  }

  function filterUrl(search, selectedSize) {
    const params = new URLSearchParams(search || "");
    params.delete("page");
    params.delete("size");
    params.delete("filter.v.option.size");
    const normalized = normalizeSize(selectedSize);
    if (normalized) {
      params.set("size", normalized);
      params.set("filter.v.option.size", normalized === "California King" ? "Cal King" : normalized);
    }
    const query = params.toString();
    return query ? "?" + query : "";
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
      if (variant) {
        link.setAttribute("href", productUrlForVariant(link.dataset.shopBySizeOriginalHref, variant.variantId, selectedSize, window.location.origin));
      } else {
        link.setAttribute("href", link.dataset.shopBySizeOriginalHref);
      }
    });
  }

  function updateCount(count) {
    [document.getElementById("ProductCount"), document.getElementById("ProductCountDesktop")].forEach(function (node) {
      if (!node) return;
      if (!node.dataset.shopBySizeOriginalText) node.dataset.shopBySizeOriginalText = node.textContent.trim();
      node.textContent = count === null ? node.dataset.shopBySizeOriginalText : count + (count === 1 ? " product" : " products");
    });
  }

  function preserveSizeInFacetForms(selectedSize) {
    document.querySelectorAll("#main-collection-filters form").forEach(function (form) {
      let input = form.querySelector('input[data-shop-by-size-preserver]');
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

  function controller(section) {
    const selectedSize = selectedSizeFromSearch(window.location.search);
    const grid = document.getElementById("product-grid");
    const cards = grid ? Array.from(grid.querySelectorAll("[data-shop-by-size-product]")) : [];
    const availableSizes = new Set();
    let visibleCount = 0;

    cards.forEach(function (card) {
      const variants = parseVariants(card);
      variants.forEach(function (variant) {
        const normalized = variant && variant.available === true ? normalizeSize(variant.nativeSize) : null;
        if (normalized) availableSizes.add(normalized);
      });

      const match = selectedSize ? eligibleVariant(variants, selectedSize) : null;
      const visible = !selectedSize || Boolean(match);
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

    section.querySelectorAll("[data-shop-by-size-option]").forEach(function (button) {
      const size = normalizeSize(button.dataset.shopBySizeOption);
      const active = Boolean(selectedSize && size === selectedSize);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.disabled = !availableSizes.has(size);
      button.classList.toggle("is-active", active);
    });

    const clear = section.querySelector("[data-shop-by-size-clear]");
    if (clear) clear.hidden = !selectedSize;
    const status = section.querySelector("[data-shop-by-size-status]");
    if (status) {
      status.textContent = selectedSize
        ? visibleCount + (visibleCount === 1 ? " mattress" : " mattresses") + " available in " + selectedSize + "."
        : "Choose a size to see exact availability and pricing.";
    }
    updateCount(selectedSize ? visibleCount : null);
    preserveSizeInFacetForms(selectedSize);
    document.documentElement.classList.toggle("snoozepod-size-filter-active", Boolean(selectedSize));
  }

  function navigateToSize(size) {
    window.location.assign(window.location.pathname + filterUrl(window.location.search, size) + window.location.hash);
  }

  function init() {
    const section = document.querySelector("[data-shop-by-size]");
    if (!section) return;

    section.addEventListener("click", function (event) {
      const option = event.target.closest("[data-shop-by-size-option]");
      if (option && !option.disabled) {
        navigateToSize(option.dataset.shopBySizeOption);
        return;
      }
      if (event.target.closest("[data-shop-by-size-clear]")) navigateToSize(null);
    });

    controller(section);
    const container = document.getElementById("ProductGridContainer");
    if (container && typeof MutationObserver !== "undefined") {
      let queued = false;
      new MutationObserver(function () {
        if (queued) return;
        queued = true;
        queueMicrotask(function () {
          queued = false;
          controller(section);
        });
      }).observe(container, { childList: true, subtree: true });
    }
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
  }

  return {
    STANDARD_SIZES: STANDARD_SIZES,
    normalizeSize: normalizeSize,
    eligibleVariant: eligibleVariant,
    selectedSizeFromSearch: selectedSizeFromSearch,
    productUrlForVariant: productUrlForVariant,
    filterUrl: filterUrl,
  };
});
