(function () {
  "use strict";

  function money(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
  }
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character];
    });
  }
  function variantLabel(variant) {
    var entries = Object.entries(variant.options || {}).filter(function (entry) { return entry[0].toLowerCase() !== "size"; });
    return entries.length ? entries.map(function (entry) { return entry[0] + ": " + entry[1]; }).join(" · ") : variant.nativeSize || variant.title;
  }
  function sizeRecord(bundle, label) {
    return bundle.sizes.find(function (size) { return size.label === label; }) || bundle.sizes[0];
  }
  function selectedVariants(card, bundle) {
    var size = sizeRecord(bundle, card.querySelector("[data-bundle-size]").value);
    return Array.from(card.querySelectorAll("[data-component-variant]")).map(function (select, index) {
      var options = size.componentVariants[index] || [];
      return options.find(function (variant) { return variant.variantId === select.value; }) || options[0];
    });
  }
  function updateCard(card, bundle) {
    var size = sizeRecord(bundle, card.querySelector("[data-bundle-size]").value);
    var fields = card.querySelector("[data-component-fields]");
    var selected = null;
    if (fields) {
      fields.innerHTML = size.componentVariants.map(function (variants, index) {
        var component = bundle.components[index];
        return '<div class="snoozepod-bundle-card__field"><label for="' + escapeHtml(bundle.id) + '-component-' + index + '">' + escapeHtml(component.title) + '</label><select id="' + escapeHtml(bundle.id) + '-component-' + index + '" data-component-variant>' + variants.map(function (variant) {
          return '<option value="' + escapeHtml(variant.variantId) + '">' + escapeHtml(variantLabel(variant)) + ' — ' + money(variant.price) + '</option>';
        }).join("") + '</select></div>';
      }).join("");
      selected = selectedVariants(card, bundle);
    }
    card.querySelectorAll("[data-component-price]").forEach(function (element, index) {
      var variants = size.componentVariants[index] || [];
      var prices = variants.map(function (variant) { return Number(variant.price || 0); });
      var exact = selected && selected[index] ? Number(selected[index].price || 0) : null;
      var minimum = Math.min.apply(Math, prices);
      var maximum = Math.max.apply(Math, prices);
      element.textContent = exact != null ? money(exact) : minimum === maximum ? money(minimum) : money(minimum) + "–" + money(maximum);
    });
    var total = selected ? selected.reduce(function (sum, variant) { return sum + Number(variant.price || 0); }, 0) : null;
    card.querySelector("[data-bundle-total]").textContent = total != null ? money(total) : size.minCombinedPrice === size.maxCombinedPrice ? money(size.minCombinedPrice) : money(size.minCombinedPrice) + "–" + money(size.maxCombinedPrice);
  }
  function cardMarkup(bundle) {
    var purchasable = bundle.purchaseStatus === "STAGED_PURCHASABLE";
    var firstSize = bundle.sizes[0];
    var images = bundle.components.filter(function (component) { return component.image; }).slice(0, 1);
    return '<article class="snoozepod-bundle-card" data-bundle-card="' + escapeHtml(bundle.id) + '" data-category="' + escapeHtml(bundle.category) + '" data-sizes="' + escapeHtml(bundle.sizes.map(function (size) { return size.label; }).join("|")) + '">' +
      '<div class="snoozepod-bundle-card__images" style="--image-count:' + Math.max(1, images.length) + '">' + images.map(function (component) { return '<img src="' + escapeHtml(component.image) + '" alt="' + escapeHtml(component.title) + '" loading="lazy" width="720" height="540">'; }).join("") + '</div>' +
      '<div class="snoozepod-bundle-card__body"><span class="snoozepod-bundle-card__badge' + (purchasable ? '' : ' snoozepod-bundle-card__badge--pending') + '">' + (purchasable ? 'Ready to configure' : 'Compatibility review required') + '</span>' +
      '<h3>' + escapeHtml(bundle.name) + '</h3><p class="snoozepod-bundle-card__basis">' + escapeHtml(bundle.curationBasis) + '</p>' +
      '<ul class="snoozepod-bundle-card__components">' + bundle.components.map(function (component) { return '<li><span><a href="' + escapeHtml(component.url) + '">' + escapeHtml(component.title) + '</a> × ' + Number(component.quantity || 1) + '</span><strong data-component-price></strong></li>'; }).join("") + '</ul>' +
      '<div class="snoozepod-bundle-card__field"><label for="' + escapeHtml(bundle.id) + '-size">Size</label><select id="' + escapeHtml(bundle.id) + '-size" data-bundle-size>' + bundle.sizes.map(function (size) { return '<option value="' + escapeHtml(size.label) + '">' + escapeHtml(size.label) + '</option>'; }).join("") + '</select></div>' +
      (purchasable ? '<div class="snoozepod-bundle-card__variant-fields" data-component-fields></div>' : '') + '<div class="snoozepod-bundle-card__total"><span>' + (purchasable ? 'Component total' : 'Current component total') + '</span><strong data-bundle-total>' + money(firstSize.minCombinedPrice) + '</strong></div>' + (purchasable ? '<button class="button button--primary snoozepod-bundle-card__button" type="button" data-add-bundle>Add Set to Cart</button>' : '<p class="snoozepod-bundle-card__pending">Not available to purchase yet. Matching labels alone do not confirm mattress and base compatibility.</p>') +
      '</div></article>';
  }

  async function addBundle(root, card, bundle) {
    var api = window.SnoozePodBundleCart;
    var status = root.querySelector("[data-bundle-cart-status]");
    var button = card.querySelector("[data-add-bundle]");
    if (!api) { status.hidden = false; status.textContent = "The cart tools could not be loaded. Your selections are still here."; return; }
    if (button.dataset.pending === "true") return;
    var selectedSize = card.querySelector("[data-bundle-size]").value;
    var variants = selectedVariants(card, bundle);
    var rawItems = variants.map(function (variant, index) {
      return { id: variant.variantId, quantity: Number(bundle.components[index].quantity || 1), role: "component-" + (index + 1), productHandle: bundle.components[index].handle, available: variant.available !== false, compatibilityStatus: "verified", publicationReadiness: "ready", properties: { "Curated Set": bundle.name, "Set Size": selectedSize, "Set Component": bundle.components[index].title } };
    });
    var plan = api.createBundleRequestPlan(rawItems);
    var errors = api.validateBundleRequestPlan(plan);
    if (errors.length) { api.renderCartStatus(status, { status: "failed", stage: "validation", errors: errors }); return; }
    if (!api.claimBundleLock(plan, window.localStorage)) { api.renderCartStatus(status, { status: "concurrent", stage: "lock" }); return; }
    button.dataset.pending = "true"; button.disabled = true; button.textContent = "Adding and verifying…";
    status.hidden = false; status.setAttribute("data-status", "pending"); status.textContent = "Adding and verifying every selected component.";
    try {
      var rootUrl = window.Shopify && Shopify.routes && Shopify.routes.root ? Shopify.routes.root : "/";
      var readiness = await api.verifyBundleVariantReadiness(plan, window.fetch.bind(window), rootUrl, 12000);
      var result = readiness.ok ? await api.executeBundleCartOperation(plan, window.fetch.bind(window), { add: rootUrl + "cart/add.js", cart: rootUrl + "cart.js" }, { timeoutMs: 12000 }) : { status: "failed", stage: "availability", errors: readiness.errors, mutationAttempted: false };
      api.renderCartStatus(status, result);
      if (result.status === "success") {
        status.textContent = "Every selected component was verified in your cart. Opening the cart now.";
        api.retainBundleLock(plan, window.localStorage, 15000);
        window.location.href = window.Shopify && Shopify.routes && Shopify.routes.cart_url ? Shopify.routes.cart_url : "/cart";
        return;
      }
      api.retainBundleLock(plan, window.localStorage, result.status === "failed" ? 60000 : 120000);
    } catch (_error) {
      api.renderCartStatus(status, { status: "uncertain", stage: "unexpected" });
      api.retainBundleLock(plan, window.localStorage, 120000);
    } finally {
      button.dataset.pending = "false"; button.disabled = false; button.textContent = "Add Set to Cart";
    }
  }

  function init(root) {
    if (root.dataset.ready === "true") return;
    root.dataset.ready = "true";
    var catalog = window.SnoozePodCuratedBundles;
    if (!catalog || !Array.isArray(catalog.bundles)) return;
    ["SLEEP_SYSTEM", "BEDDING_SET", "COMPLETE_SLEEP_PACKAGE"].forEach(function (category) {
      var grid = root.querySelector('[data-bundle-grid="' + category + '"]');
      grid.innerHTML = catalog.bundles.filter(function (bundle) { return bundle.category === category; }).map(cardMarkup).join("");
    });
    catalog.bundles.forEach(function (bundle) {
      var card = root.querySelector('[data-bundle-card="' + bundle.id + '"]');
      updateCard(card, bundle);
    });
    var filter = root.querySelector("[data-bundle-size-filter]");
    var sizes = Array.from(new Set(catalog.bundles.flatMap(function (bundle) { return bundle.sizes.map(function (size) { return size.label; }); }))).sort();
    filter.insertAdjacentHTML("beforeend", sizes.map(function (size) { return '<option value="' + escapeHtml(size) + '">' + escapeHtml(size) + '</option>'; }).join(""));
    function applyFilter() {
      var shown = 0;
      root.querySelectorAll("[data-bundle-card]").forEach(function (card) { var visible = !filter.value || card.dataset.sizes.split("|").includes(filter.value); card.hidden = !visible; if (visible) shown += 1; });
      root.querySelector("[data-bundle-filter-count]").textContent = shown + (shown === 1 ? " set shown" : " sets shown");
      root.querySelector("[data-bundle-empty]").hidden = shown !== 0;
    }
    filter.addEventListener("change", applyFilter); applyFilter();
    root.addEventListener("change", function (event) { var card = event.target.closest("[data-bundle-card]"); if (!card) return; var bundle = catalog.bundles.find(function (item) { return item.id === card.dataset.bundleCard; }); if (bundle) updateCard(card, bundle); });
    root.addEventListener("click", function (event) { var button = event.target.closest("[data-add-bundle]"); if (!button) return; var card = button.closest("[data-bundle-card]"); var bundle = catalog.bundles.find(function (item) { return item.id === card.dataset.bundleCard; }); if (bundle) addBundle(root, card, bundle); });
  }
  function initAll() { document.querySelectorAll("[data-curated-bundles]").forEach(init); }
  document.addEventListener("DOMContentLoaded", initAll);
  document.addEventListener("shopify:section:load", initAll);
  window.SnoozePodCuratedBundleUI = Object.freeze({ money: money, variantLabel: variantLabel, sizeRecord: sizeRecord });
})();
