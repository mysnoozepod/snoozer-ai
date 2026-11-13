(function () {
  "use strict";

  var SIZE_ORDER = ["Queen", "King", "California King", "Twin", "Twin XL", "Full", "Full XL", "Split Head Queen", "Split Head King", "Split Head California King", "Split King"];
  var PATH_COPY = {
    standard: { kicker: "Standard system", heading: "Standard Sleep Systems", copy: "Choose a mattress size, then select an exact-size Flex L or Flex LSX adjustable base." },
    split_head: { kicker: "Signature system", heading: "Split-Head Sleep Systems", copy: "Choose a split-head mattress size. The compatible Flex SH base is selected with it." },
    full_split: { kicker: "Fully independent", heading: "Split King Sleep Systems", copy: "Each system contains two Twin XL mattresses and two Twin XL adjustable bases." },
  };
  var COMFORT_OPTIONS = ["Soft", "Medium Soft", "Medium Firm", "Firm"];
  var SHOWROOM_LOCATIONS = {
    "12-inch-memory-foam-mattress": "Try it in Pod 1",
    "12-inch-hybrid-mattress": "Try it in Pod 2",
    "12-inch-dual-comfort-mattress": "Try it in Pods 3 & 4",
    "14-inch-dual-comfort-mattress": "Try it in Pods 5 & 6",
  };

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
  function sortSizes(labels) {
    return labels.sort(function (left, right) {
      var leftIndex = SIZE_ORDER.indexOf(left);
      var rightIndex = SIZE_ORDER.indexOf(right);
      if (leftIndex !== -1 || rightIndex !== -1) return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
      return left.localeCompare(right);
    });
  }
  function sizeRecord(bundle, label) {
    return bundle.sizes.find(function (size) { return size.label === label; }) || bundle.sizes[0];
  }
  function selectedVariants(card, size) {
    return Array.from(card.querySelectorAll("[data-component-variant]")).map(function (select, index) {
      var options = size.componentVariants[index] || [];
      return options.find(function (variant) { return variant.variantId === select.value; }) || options[0];
    });
  }
  function variantFieldsMarkup(id, bundle, size) {
    return size.componentVariants.map(function (variants, index) {
      var component = bundle.components[index];
      if (variants.length === 1) return '<input type="hidden" data-component-variant value="' + escapeHtml(variants[0].variantId) + '">';
      return '<div class="snoozepod-bundle-card__field"><label for="' + escapeHtml(id) + '-component-' + index + '">' + escapeHtml(component.title) + '</label><select id="' + escapeHtml(id) + '-component-' + index + '" data-component-variant>' + variants.map(function (variant) {
        return '<option value="' + escapeHtml(variant.variantId) + '">' + escapeHtml(variantLabel(variant)) + ' — ' + money(variant.price) + '</option>';
      }).join("") + '</select></div>';
    }).join("");
  }
  function totalForSelection(selected, quantities) {
    return selected.reduce(function (sum, variant, index) { return sum + (Number(variant.price || 0) * Number(quantities[index] || 1)); }, 0);
  }
  function renderSelection(card, bundle, size) {
    var fields = card.querySelector("[data-component-fields]");
    if (fields) fields.innerHTML = variantFieldsMarkup(card.dataset.bundleCard, bundle, size);
    var selected = selectedVariants(card, size);
    var quantities = size.componentQuantities || bundle.components.map(function (component) { return component.quantity || 1; });
    card.querySelectorAll("[data-component-price]").forEach(function (element, index) {
      var variant = selected[index];
      element.textContent = variant ? (quantities[index] > 1 ? quantities[index] + " × " + money(variant.price) : money(variant.price)) : "";
    });
    var total = totalForSelection(selected, quantities);
    card.querySelector("[data-bundle-total]").textContent = money(total);
    return selected;
  }
  function updateSetCard(card, bundle) {
    var size = sizeRecord(bundle, card.querySelector("[data-bundle-size]").value);
    renderSelection(card, bundle, size);
  }
  function setCardMarkup(bundle) {
    var firstSize = bundle.sizes[0];
    var image = bundle.components.find(function (component) { return component.image; });
    return '<article class="snoozepod-bundle-card" data-bundle-card="' + escapeHtml(bundle.id) + '" data-category="' + escapeHtml(bundle.category) + '">' +
      '<div class="snoozepod-bundle-card__images">' + (image ? '<img src="' + escapeHtml(image.image) + '" alt="' + escapeHtml(image.title) + '" loading="lazy" width="720" height="540">' : '') + '</div>' +
      '<div class="snoozepod-bundle-card__body"><span class="snoozepod-bundle-card__badge">Ready to configure</span>' +
      '<h3>' + escapeHtml(bundle.name) + '</h3><p class="snoozepod-bundle-card__basis">' + escapeHtml(bundle.curationBasis) + '</p>' +
      '<ul class="snoozepod-bundle-card__components">' + bundle.components.map(function (component) { return '<li><span><a href="' + escapeHtml(component.url) + '">' + escapeHtml(component.title) + '</a></span><strong data-component-price></strong></li>'; }).join("") + '</ul>' +
      '<div class="snoozepod-bundle-card__field"><label for="' + escapeHtml(bundle.id) + '-size">Size</label><select id="' + escapeHtml(bundle.id) + '-size" data-bundle-size>' + bundle.sizes.map(function (size) { return '<option value="' + escapeHtml(size.label) + '">' + escapeHtml(size.label) + '</option>'; }).join("") + '</select></div>' +
      '<div class="snoozepod-bundle-card__variant-fields" data-component-fields></div>' +
      '<div class="snoozepod-bundle-card__total"><span>Component total</span><strong data-bundle-total>' + money(firstSize.minCombinedPrice) + '</strong></div>' +
      '<button class="button button--primary snoozepod-bundle-card__button" type="button" data-add-bundle data-button-label="Add Set to Cart">Add Set to Cart</button>' +
      '</div></article>';
  }

  function groupSystems(bundles) {
    var groups = new Map();
    bundles.filter(function (bundle) { return bundle.category === "SLEEP_SYSTEM"; }).forEach(function (bundle) {
      var mattress = bundle.components[0];
      if (!groups.has(mattress.handle)) groups.set(mattress.handle, { id: "system--" + mattress.handle, mattress: mattress, bundles: [] });
      groups.get(mattress.handle).bundles.push(bundle);
    });
    return Array.from(groups.values());
  }
  function sizeMatchesPath(size, path) {
    return size && size.geometry === path;
  }
  function systemSizeLabels(group, path) {
    return sortSizes(Array.from(new Set(group.bundles.flatMap(function (bundle) {
      return bundle.sizes.filter(function (size) { return sizeMatchesPath(size, path); }).map(function (size) { return size.label; });
    }))));
  }
  function systemBundlesForSize(group, label) {
    return group.bundles.filter(function (bundle) { return bundle.sizes.some(function (size) { return size.label === label; }); });
  }
  function baseLabel(bundle) {
    return bundle.components[1].title;
  }
  function isDualComfortHandle(handle) {
    return /dual-comfort-mattress$/i.test(String(handle || ""));
  }
  function systemComfortProperties(handle, left, right) {
    if (!isDualComfortHandle(handle)) return {};
    if (COMFORT_OPTIONS.indexOf(left) === -1 || COMFORT_OPTIONS.indexOf(right) === -1) return null;
    return { "Left Side Comfort": left, "Right Side Comfort": right };
  }
  function selectedChoice(card, selector) {
    var selected = card.querySelector(selector + '[aria-pressed="true"]');
    return selected ? selected.dataset.value : "";
  }
  function choiceButtonsMarkup(idPrefix, dataAttribute, options, selectedValue, disabled) {
    return options.map(function (option, index) {
      var value = typeof option === "string" ? option : option.value;
      var label = typeof option === "string" ? option : option.label;
      return '<button type="button" id="' + escapeHtml(idPrefix + "-" + index) + '" ' + dataAttribute + ' data-value="' + escapeHtml(value) + '" aria-pressed="' + (value === selectedValue ? 'true' : 'false') + '"' + (disabled ? ' disabled' : '') + '>' + escapeHtml(label) + '</button>';
    }).join("");
  }
  function dualComfortMarkup(group) {
    if (!isDualComfortHandle(group.mattress.handle)) return "";
    return '<fieldset class="snoozepod-bundle-card__comfort"><legend>Dual Comfort</legend>' +
      '<p>Choose each side independently.</p><div class="snoozepod-bundle-card__comfort-grid">' +
      '<fieldset class="snoozepod-bundle-card__choice-field"><legend>Left side comfort</legend><div class="snoozepod-bundle-card__choices">' + choiceButtonsMarkup(group.id + '-left-comfort', 'data-system-comfort="left"', COMFORT_OPTIONS, "", false) + '</div></fieldset>' +
      '<fieldset class="snoozepod-bundle-card__choice-field"><legend>Right side comfort</legend><div class="snoozepod-bundle-card__choices">' + choiceButtonsMarkup(group.id + '-right-comfort', 'data-system-comfort="right"', COMFORT_OPTIONS, "", false) + '</div></fieldset>' +
      '</div><p class="snoozepod-bundle-card__comfort-summary" data-system-comfort-summary role="status" aria-live="polite">Choose a comfort for both sides to continue.</p></fieldset>';
  }
  function systemCardMarkup(group, path) {
    var sizes = systemSizeLabels(group, path);
    if (!sizes.length) return "";
    var firstBundle = systemBundlesForSize(group, sizes[0])[0];
    var image = group.mattress.image;
    var showroom = SHOWROOM_LOCATIONS[group.mattress.handle];
    var pathBasis = path === "split_head"
      ? "Select a split-head size; Flex SH is the compatible adjustable base."
      : path === "full_split"
        ? "Split King includes two Twin XL mattresses and two Twin XL bases."
        : "Select a standard size and an exact-size Flex L or Flex LSX base.";
    return '<article class="snoozepod-bundle-card" data-bundle-card="' + escapeHtml(group.id) + '" data-system-card>' +
      '<div class="snoozepod-bundle-card__images">' + (image ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(group.mattress.title) + '" loading="lazy" width="720" height="540">' : '') + '</div>' +
      '<div class="snoozepod-bundle-card__body">' + (showroom ? '<div class="snoozepod-bundle-card__showroom"><span>' + escapeHtml(showroom) + '</span></div>' : '') +
      '<h3>' + escapeHtml(group.mattress.title) + '</h3>' +
      '<p class="snoozepod-bundle-card__basis">' + escapeHtml(pathBasis) + '</p>' +
      '<fieldset class="snoozepod-bundle-card__choice-field"><legend>Mattress size</legend><div class="snoozepod-bundle-card__choices">' + choiceButtonsMarkup(group.id + '-size', 'data-system-size', sizes, sizes[0], false) + '</div></fieldset>' +
      '<fieldset class="snoozepod-bundle-card__choice-field" data-system-base-field><legend>Adjustable base</legend><div class="snoozepod-bundle-card__choices" data-system-base-options>' + choiceButtonsMarkup(group.id + '-base', 'data-system-base', [{ value: firstBundle.id, label: baseLabel(firstBundle) }], firstBundle.id, true) + '</div></fieldset>' +
      dualComfortMarkup(group) +
      '<ul class="snoozepod-bundle-card__components"><li><span><a href="' + escapeHtml(group.mattress.url) + '">' + escapeHtml(group.mattress.title) + '</a></span><strong data-component-price></strong></li><li><span><a href="#" data-system-base-link>' + escapeHtml(baseLabel(firstBundle)) + '</a></span><strong data-component-price></strong></li></ul>' +
      '<div class="snoozepod-bundle-card__variant-fields" data-component-fields></div>' +
      '<div class="snoozepod-bundle-card__total"><span>System total</span><strong data-bundle-total></strong></div>' +
      '<button class="button button--primary snoozepod-bundle-card__button" type="button" data-add-bundle data-button-label="Add Sleep System to Cart"' + (isDualComfortHandle(group.mattress.handle) ? ' disabled' : '') + '>Add Sleep System to Cart</button>' +
      '</div></article>';
  }
  function updateSystemComfortState(card, handle) {
    if (!isDualComfortHandle(handle)) return {};
    var properties = systemComfortProperties(handle, selectedChoice(card, '[data-system-comfort="left"]'), selectedChoice(card, '[data-system-comfort="right"]'));
    var summary = card.querySelector("[data-system-comfort-summary]");
    var button = card.querySelector("[data-add-bundle]");
    if (properties) {
      summary.textContent = "Your comfort: " + properties["Left Side Comfort"] + " left · " + properties["Right Side Comfort"] + " right";
      if (button.dataset.pending !== "true") button.disabled = false;
    } else {
      summary.textContent = "Choose a comfort for both sides to continue.";
      button.disabled = true;
    }
    return properties;
  }
  function renderActiveSystem(card, group) {
    var selectedSize = selectedChoice(card, "[data-system-size]");
    var availableBundles = systemBundlesForSize(group, selectedSize);
    var selectedBase = selectedChoice(card, "[data-system-base]");
    var bundle = availableBundles.find(function (item) { return item.id === selectedBase; }) || availableBundles[0];
    if (!bundle) return;
    var size = sizeRecord(bundle, selectedSize);
    card.dataset.activeBundle = bundle.id;
    var baseLink = card.querySelector("[data-system-base-link]");
    baseLink.href = bundle.components[1].url;
    baseLink.textContent = baseLabel(bundle);
    renderSelection(card, bundle, size);
    updateSystemComfortState(card, group.mattress.handle);
  }
  function updateSystemSize(card, group) {
    var selectedSize = selectedChoice(card, "[data-system-size]");
    var availableBundles = systemBundlesForSize(group, selectedSize);
    var previous = selectedChoice(card, "[data-system-base]");
    var selectedBase = availableBundles.some(function (bundle) { return bundle.id === previous; }) ? previous : availableBundles[0].id;
    var options = availableBundles.map(function (bundle) { return { value: bundle.id, label: baseLabel(bundle) }; });
    card.querySelector("[data-system-base-options]").innerHTML = choiceButtonsMarkup(group.id + '-base', 'data-system-base', options, selectedBase, availableBundles.length === 1);
    renderActiveSystem(card, group);
  }

  async function addBundle(root, card, bundle) {
    var api = window.SnoozePodBundleCart;
    var status = root.querySelector("[data-bundle-cart-status]");
    var button = card.querySelector("[data-add-bundle]");
    if (!api) { status.hidden = false; status.textContent = "The cart tools could not be loaded. Your selections are still here."; return; }
    if (button.dataset.pending === "true") return;
    var selectedSize = card.hasAttribute("data-system-card") ? selectedChoice(card, "[data-system-size]") : card.querySelector("[data-bundle-size]").value;
    var size = sizeRecord(bundle, selectedSize);
    var variants = selectedVariants(card, size);
    var quantities = size.componentQuantities || bundle.components.map(function (component) { return component.quantity || 1; });
    var isSystem = bundle.category === "SLEEP_SYSTEM";
    var comfortProperties = isSystem ? updateSystemComfortState(card, bundle.components[0].handle) : {};
    if (comfortProperties === null) {
      status.hidden = false;
      status.setAttribute("data-status", "failed");
      status.textContent = "Choose a comfort for both sides before adding this sleep system. Your selections are still here.";
      return;
    }
    var rawItems = variants.map(function (variant, index) {
      return {
        id: variant.variantId,
        quantity: Number(quantities[index] || 1),
        role: isSystem ? (index === 0 ? "mattress" : "adjustable-base") : "component-" + (index + 1),
        productHandle: bundle.components[index].handle,
        available: variant.available !== false,
        compatibilityStatus: "verified",
        publicationReadiness: "ready",
        properties: Object.assign({
          "Curated Selection": isSystem ? "Sleep System" : bundle.name,
          "Selected Size": selectedSize,
          "Component": bundle.components[index].title,
        }, isSystem && index === 0 ? comfortProperties : {}),
      };
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
      button.dataset.pending = "false"; button.textContent = button.dataset.buttonLabel;
      if (isSystem) updateSystemComfortState(card, bundle.components[0].handle);
      else button.disabled = false;
    }
  }

  function init(root) {
    if (root.dataset.ready === "true") return;
    root.dataset.ready = "true";
    var catalog = window.SnoozePodCuratedBundles;
    if (!catalog || !Array.isArray(catalog.bundles)) return;
    var groups = groupSystems(catalog.bundles);
    var systemGrid = root.querySelector('[data-bundle-grid="SLEEP_SYSTEM"]');
    var requestedPath = new URLSearchParams(window.location.search).get("system");
    var activePath = PATH_COPY[requestedPath] ? requestedPath : "split_head";

    function renderSystems() {
      var copy = PATH_COPY[activePath];
      root.dataset.systemPath = activePath;
      root.querySelectorAll("[data-system-path]").forEach(function (button) {
        button.setAttribute("aria-pressed", button.dataset.systemPath === activePath ? "true" : "false");
      });
      var kicker = root.querySelector("[data-system-path-kicker]");
      var heading = root.querySelector("[data-system-path-heading]");
      var description = root.querySelector("[data-system-path-copy]");
      if (kicker) kicker.textContent = copy.kicker;
      if (heading) heading.textContent = copy.heading;
      if (description) description.textContent = copy.copy;
      systemGrid.innerHTML = groups.map(function (group) { return systemCardMarkup(group, activePath); }).join("");
      groups.forEach(function (group) {
        var card = root.querySelector('[data-bundle-card="' + group.id + '"]');
        if (card) updateSystemSize(card, group);
      });
    }
    renderSystems();

    root.addEventListener("change", function (event) {
      var card = event.target.closest("[data-bundle-card]");
      if (!card) return;
      if (card.hasAttribute("data-system-card")) return;
      var bundle = catalog.bundles.find(function (item) { return item.id === card.dataset.bundleCard; });
      if (bundle) updateSetCard(card, bundle);
    });
    root.addEventListener("click", function (event) {
      var pathButton = event.target.closest(".snoozepod-system-path[data-system-path]");
      if (pathButton) {
        activePath = pathButton.dataset.systemPath;
        renderSystems();
        root.querySelector("[data-system-path-heading]")?.focus({ preventScroll: true });
        return;
      }
      var choice = event.target.closest("[data-system-size], [data-system-base], [data-system-comfort]");
      if (choice && !choice.disabled) {
        var choiceCard = choice.closest("[data-system-card]");
        var choiceGroup = groups.find(function (item) { return item.id === choiceCard.dataset.bundleCard; });
        if (!choiceGroup) return;
        var choiceSelector = choice.hasAttribute("data-system-size") ? "[data-system-size]" : choice.hasAttribute("data-system-base") ? "[data-system-base]" : '[data-system-comfort="' + choice.dataset.systemComfort + '"]';
        choiceCard.querySelectorAll(choiceSelector).forEach(function (item) { item.setAttribute("aria-pressed", item === choice ? "true" : "false"); });
        if (choice.hasAttribute("data-system-size")) updateSystemSize(choiceCard, choiceGroup);
        else if (choice.hasAttribute("data-system-base")) renderActiveSystem(choiceCard, choiceGroup);
        else updateSystemComfortState(choiceCard, choiceGroup.mattress.handle);
        return;
      }
      var button = event.target.closest("[data-add-bundle]");
      if (!button) return;
      var card = button.closest("[data-bundle-card]");
      var bundleId = card.dataset.activeBundle || card.dataset.bundleCard;
      var bundle = catalog.bundles.find(function (item) { return item.id === bundleId; });
      if (bundle) addBundle(root, card, bundle);
    });
  }
  function initAll() { document.querySelectorAll("[data-curated-bundles]").forEach(init); }
  document.addEventListener("DOMContentLoaded", initAll);
  document.addEventListener("shopify:section:load", initAll);
  window.SnoozePodCuratedBundleUI = Object.freeze({ money: money, variantLabel: variantLabel, sizeRecord: sizeRecord, groupSystems: groupSystems, systemSizeLabels: systemSizeLabels, systemBundlesForSize: systemBundlesForSize, sizeMatchesPath: sizeMatchesPath, isDualComfortHandle: isDualComfortHandle, systemComfortProperties: systemComfortProperties });
})();
