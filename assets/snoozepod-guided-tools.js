(function () {
  "use strict";

  const STORAGE_PREFIX = "mysnoozepod.guided-tool.v1.";
  const PLAN_KEY = "mysnoozepod.guided-plan.v1";

  function parseJson(node, fallback) {
    try {
      return JSON.parse(node ? node.textContent : "");
    } catch (_error) {
      return fallback;
    }
  }

  function selectedValues(form, name) {
    return Array.from(form.querySelectorAll('[name="' + name + '"]:checked')).map(function (input) {
      return input.value;
    });
  }

  function value(form, name) {
    const field = form.elements.namedItem(name);
    if (!field) return "";
    if (typeof RadioNodeList !== "undefined" && field instanceof RadioNodeList) return field.value || "";
    return String(field.value || "");
  }

  function pretty(input) {
    return String(input || "")
      .replaceAll("-", " ")
      .replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function escapeHtml(input) {
    return String(input || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function tagHandle(tag) {
    return String(tag || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function hasTag(product, tag) {
    return Array.isArray(product.tags) && product.tags.some(function (candidate) {
      return String(candidate).toLowerCase() === String(tag).toLowerCase();
    });
  }

  function collectionUrl(handle, tag) {
    return "/collections/" + handle + (tag ? "/" + tagHandle(tag) : "");
  }

  function formSnapshot(form) {
    const data = {};
    Array.from(form.elements).forEach(function (field) {
      if (!field.name || field.type === "submit" || field.type === "reset") return;
      if (field.type === "checkbox") {
        if (!Array.isArray(data[field.name])) data[field.name] = [];
        if (field.checked) data[field.name].push(field.value);
      } else if (field.type === "radio") {
        if (field.checked) data[field.name] = field.value;
      } else {
        data[field.name] = field.value;
      }
    });
    return data;
  }

  function restoreForm(form, data) {
    if (!data || typeof data !== "object") return;
    Array.from(form.elements).forEach(function (field) {
      if (!field.name || !(field.name in data)) return;
      const stored = data[field.name];
      if (field.type === "checkbox") field.checked = Array.isArray(stored) && stored.includes(field.value);
      else if (field.type === "radio") field.checked = stored === field.value;
      else field.value = stored;
    });
  }

  function readStored(key) {
    try {
      return JSON.parse(window.localStorage.getItem(key) || "null");
    } catch (_error) {
      return null;
    }
  }

  function writeStored(key, data) {
    try {
      window.localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function productMarkup(products) {
    return products.slice(0, 4).map(function (product) {
      const price = product.priceText ? "<span>" + escapeHtml(product.priceText) + "</span>" : "";
      return '<article class="snoozepod-tools__product"><strong>' + escapeHtml(product.title) + '</strong><br>' + price + '<br><a href="' + escapeHtml(product.url) + '">View product →</a></article>';
    }).join("");
  }

  function render(context, result) {
    context.title.textContent = result.title;
    context.copy.textContent = result.copy;
    context.list.innerHTML = (result.items || []).map(function (item) {
      return "<li>" + escapeHtml(item) + "</li>";
    }).join("");

    if (result.products && result.products.length) {
      context.products.innerHTML = productMarkup(result.products);
      context.products.hidden = false;
    } else {
      context.products.innerHTML = "";
      context.products.hidden = true;
    }

    context.primaryLink.href = result.href || "/pages/book-a-snooze-session";
    context.primaryLink.textContent = result.linkLabel || "Book a Snooze Session";
    context.status.textContent = result.status || "Your choices were saved on this device for your next step.";
    context.status.hidden = false;

    const plan = {
      tool: context.type,
      updatedAt: new Date().toISOString(),
      selections: formSnapshot(context.form),
      result: { title: result.title, items: result.items || [], href: result.href || "" },
    };
    writeStored(STORAGE_PREFIX + context.type, plan);
    writeStored(PLAN_KEY, plan);
    window.snoozepodGuidedToolContext = plan;
  }

  function builderResult(context) {
    const direction = value(context.form, "mattress_direction") || "not-sure";
    const size = value(context.form, "size") || "Not sure yet";
    const geometry = value(context.form, "geometry") || "unknown";
    const components = selectedValues(context.form, "components");
    const candidates = direction === "not-sure"
      ? context.catalog.mattresses
      : context.catalog.mattresses.filter(function (product) { return hasTag(product, "comfort:" + direction); });
    const href = direction === "not-sure" ? "/collections/mattresses" : collectionUrl("mattresses", "comfort:" + direction);
    return {
      title: candidates.length ? "Your SnoozePod starting point" : "Your SnoozePod plan is saved",
      copy: candidates.length
        ? "These currently available Shopify products match the selected mattress direction. Confirm size, geometry, and every component on the product page or during a Snooze Session."
        : "The storefront catalog does not currently expose an orderable product for this plan. Your choices remain useful for a Snooze Session and will not be presented as purchasable.",
      items: [
        "Mattress direction: " + pretty(direction),
        "Planning size: " + size,
        "Geometry: " + pretty(geometry),
        "Optional components: " + (components.length ? components.map(pretty).join(", ") : "None selected"),
        "Compatibility status: Pending product-level verification",
      ],
      products: candidates,
      href: href,
      linkLabel: candidates.length ? "Review Mattress Options" : "Browse Mattresses",
      status: "Plan saved. No accessory or unverified configuration was automatically added to cart.",
    };
  }

  function mattressResult(context) {
    const comfort = value(context.form, "comfort") || "Not sure";
    const construction = value(context.form, "construction") || "not-sure";
    const position = value(context.form, "sleep_position") || "combination";
    const candidates = construction === "not-sure"
      ? context.catalog.mattresses
      : context.catalog.mattresses.filter(function (product) { return hasTag(product, "comfort:" + construction); });
    return {
      title: "A clearer mattress starting point",
      copy: "Comfort language describes your testing direction; it does not replace trying the mattress or confirming the exact ordered configuration.",
      items: ["Comfort direction: " + comfort, "Construction direction: " + pretty(construction), "Sleep pattern: " + pretty(position)],
      products: candidates,
      href: construction === "not-sure" ? "/collections/mattresses" : collectionUrl("mattresses", "comfort:" + construction),
      linkLabel: "View Matching Mattress Collection",
    };
  }

  function compatibilityResult(context) {
    const mattressSize = value(context.form, "mattress_size");
    const otherSize = value(context.form, "other_size");
    const mattressGeometry = value(context.form, "mattress_geometry");
    const otherGeometry = value(context.form, "other_geometry");
    const component = value(context.form, "component");
    const sizeMatches = mattressSize && mattressSize === otherSize;
    const geometryMatches = mattressGeometry && mattressGeometry === otherGeometry;
    const unknownGeometry = otherGeometry === "unknown";
    let title = "Not yet verified";
    let copy = "Matching labels are not enough to confirm mechanical or manufacturer compatibility. Verify the exact product pair before purchase.";
    if (!sizeMatches || (!geometryMatches && !unknownGeometry)) {
      title = "Configuration mismatch found";
      copy = "The selected size or geometry differs. Do not treat this combination as compatible.";
    }
    return {
      title: title,
      copy: copy,
      items: [
        "Mattress: " + mattressSize + " / " + pretty(mattressGeometry),
        pretty(component) + ": " + otherSize + " / " + pretty(otherGeometry),
        "Size check: " + (sizeMatches ? "Labels match" : "Mismatch"),
        "Geometry check: " + (geometryMatches ? "Labels match" : unknownGeometry ? "Unknown" : "Mismatch"),
        "Manufacturer compatibility: Pending verification",
      ],
      href: "/pages/book-a-snooze-session",
      linkLabel: "Verify During a Snooze Session",
      status: title === "Configuration mismatch found" ? "This combination should not proceed without correction." : "No confirmed-compatibility claim was made.",
    };
  }

  function compareResult(context) {
    const category = value(context.form, "compare_category") || "mattresses";
    const priorities = selectedValues(context.form, "priorities");
    const products = Array.isArray(context.catalog[category]) ? context.catalog[category] : [];
    const routes = { mattresses: "/collections/mattresses", bases: "/collections/adjustable-bases", pillows: "/collections/pillows", bedding: "/collections/bedding" };
    return {
      title: products.length ? "Available products to compare" : "Comparison framework ready",
      copy: products.length
        ? "Open up to three product pages and compare only the verified fields shown by Shopify."
        : "No public Shopify products are currently available in this category. The tool will populate automatically when products become storefront-available.",
      items: ["Category: " + pretty(category), "Priorities: " + (priorities.length ? priorities.map(pretty).join(", ") : "No priority selected"), "Unknown values remain blank rather than inferred"],
      products: products.slice(0, 3),
      href: routes[category],
      linkLabel: "Browse This Collection",
    };
  }

  function sessionResult(context) {
    const items = selectedValues(context.form, "test_items");
    const comfort = value(context.form, "comfort") || "Not sure yet";
    const notes = value(context.form, "notes").trim();
    return {
      title: "Your Snooze Session plan is ready",
      copy: "This plan is saved on this device so you can review it while booking or talking with Snoozer.",
      items: ["Test: " + (items.length ? items.map(pretty).join(", ") : "General sleep-system guidance"), "Comfort direction: " + comfort, "Questions: " + (notes || "None added yet")],
      href: "/pages/book-a-snooze-session",
      linkLabel: "Book My Snooze Session",
    };
  }

  function dualComfortResult(context) {
    const left = value(context.form, "left_comfort");
    const right = value(context.form, "right_comfort");
    const size = value(context.form, "size");
    return {
      title: left === right ? "One shared comfort direction" : "Independent comfort directions saved",
      copy: "This records preference only. Add to Cart remains unavailable until the exact size and left/right combination maps to an approved Shopify sellable configuration.",
      items: ["Size: " + size, "Left side: " + left, "Right side: " + right, "Orderable mapping: Not yet verified"],
      href: "/collections/m3",
      linkLabel: "Explore Dual Comfort",
      status: "Preference saved without creating an unsupported order configuration.",
    };
  }

  function pillowResult(context) {
    const position = value(context.form, "sleep_position");
    const type = value(context.form, "pillow_type");
    const handles = { zoned: "zoned-pillows", filled: "filled-pillows", foam: "foam-pillows", "temperature-regulating": "temperature-regulating-pillows" };
    const candidates = context.catalog.pillows.filter(function (product) { return hasTag(product, "subcategory:" + type); });
    return {
      title: "Your pillow starting direction",
      copy: "Pillow height and feel depend on your body, mattress, and sleep position. Use this result as a comparison starting point.",
      items: ["Sleep position: " + pretty(position), "Pillow direction: " + pretty(type), "Final loft and fit: Verify in person"],
      products: candidates,
      href: "/collections/" + handles[type],
      linkLabel: "View This Pillow Collection",
    };
  }

  function beddingResult(context) {
    const goal = value(context.form, "bedding_goal");
    const size = value(context.form, "size") || "Not sure yet";
    const geometry = value(context.form, "geometry");
    const handles = { cooling: "cooling-bedding", protection: "mattress-protectors", sheets: "sheets", comforter: "comforters" };
    return {
      title: "Your bedding starting direction",
      copy: "Size and geometry must be confirmed on the exact product. Split-head compatibility is never inferred from a standard size label.",
      items: ["Goal: " + pretty(goal), "Size: " + size, "Geometry: " + pretty(geometry), "Product-specific fit: Pending verification"],
      href: "/collections/" + handles[goal],
      linkLabel: "View Recommended Collection",
    };
  }

  function roomResult(context) {
    const dimensions = { "Twin XL": [38, 80], Full: [54, 75], Queen: [60, 80], King: [76, 80], "California King": [72, 84] };
    const size = value(context.form, "size");
    const roomWidth = Number(value(context.form, "room_width"));
    const roomLength = Number(value(context.form, "room_length"));
    const doorWidth = Number(value(context.form, "door_width"));
    const bed = dimensions[size] || [0, 0];
    const sideClearance = bed[0] ? Math.floor((roomWidth - bed[0]) / 2) : 0;
    const endClearance = bed[1] ? roomLength - bed[1] : 0;
    const fits = sideClearance >= 0 && endClearance >= 0;
    return {
      title: fits ? "The planning footprint fits" : "The planning footprint does not fit",
      copy: "These common mattress dimensions are estimates. Frames, headboards, adjustable bases, packaging, turns, stairs, and manufacturer dimensions can require more space.",
      items: ["Planning size: " + size + " (about " + bed[0] + " × " + bed[1] + " in)", "Estimated clearance per side: " + sideClearance + " in", "Estimated foot clearance: " + endClearance + " in", "Narrowest doorway: " + (doorWidth || "Not recorded") + (doorWidth ? " in" : ""), "Delivery approval: Pending exact product and route verification"],
      href: "/pages/book-a-snooze-session",
      linkLabel: "Review My Room Plan",
      status: "Room plan saved. No delivery-fit guarantee was created.",
    };
  }

  const handlers = {
    builder: builderResult,
    "mattress-finder": mattressResult,
    compatibility: compatibilityResult,
    compare: compareResult,
    "session-planner": sessionResult,
    "dual-comfort": dualComfortResult,
    "pillow-finder": pillowResult,
    "bedding-finder": beddingResult,
    "room-planner": roomResult,
  };

  function init(root) {
    const type = root.dataset.guidedTool;
    if (!type || type === "hub" || root.dataset.guidedReady === "true") return;
    root.dataset.guidedReady = "true";
    const form = root.querySelector("[data-guided-form]");
    const result = root.querySelector("[data-guided-result]");
    if (!form || !result || !handlers[type]) return;
    const context = {
      type: type,
      form: form,
      catalog: parseJson(root.querySelector("[data-guided-catalog]"), { mattresses: [], bases: [], pillows: [], bedding: [] }),
      title: result.querySelector("[data-guided-result-title]"),
      copy: result.querySelector("[data-guided-result-copy]"),
      list: result.querySelector("[data-guided-result-list]"),
      products: result.querySelector("[data-guided-products]"),
      status: result.querySelector("[data-guided-status]"),
      primaryLink: result.querySelector("[data-guided-primary-link]"),
    };
    const stored = readStored(STORAGE_PREFIX + type);
    if (stored && stored.selections) restoreForm(form, stored.selections);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      render(context, handlers[type](context));
      result.setAttribute("tabindex", "-1");
      result.focus({ preventScroll: false });
    });

    form.addEventListener("reset", function () {
      window.setTimeout(function () {
        try { window.localStorage.removeItem(STORAGE_PREFIX + type); } catch (_error) {}
        context.title.textContent = "Start with what you know";
        context.copy.textContent = "Choose the options that fit you. We will preserve unknowns and point you toward a safe next step.";
        context.list.innerHTML = "";
        context.products.hidden = true;
        context.status.hidden = true;
        context.primaryLink.href = "/pages/book-a-snooze-session";
        context.primaryLink.textContent = "Book a Snooze Session";
      }, 0);
    });
  }

  function initAll(scope) {
    (scope || document).querySelectorAll("[data-guided-tool]").forEach(init);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { initAll(document); });
  else initAll(document);
  document.addEventListener("shopify:section:load", function (event) { initAll(event.target); });
})();

