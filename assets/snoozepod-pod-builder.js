(function () {
  const STEPS = [
    { key: "size", label: "Size", title: "Choose your size", copy: "Use the actual product sizes here so the rest of your build stays anchored to a real mattress selection." },
    { key: "base", label: "Base", title: "Choose your base", copy: "Decide how you want this SnoozePod set up underneath before you move into motion or finishing layers." },
    { key: "motion", label: "Motion", title: "Choose your motion setup", copy: "Only show up when an adjustable base is part of the plan. Pick the direction that best fits how you want to rest." },
    { key: "protection", label: "Protection", title: "Choose mattress protection", copy: "Add the protection layer that best fits how you want to care for the mattress over time." },
    { key: "pillow", label: "Pillow", title: "Choose your pillow direction", copy: "Pick the support direction you want to solve for first, then test the actual feel during a Snooze Session." },
    { key: "bedding", label: "Bedding", title: "Choose your bedding finish", copy: "Finish the pod with the bedding direction that best matches your temperature and comfort story." },
    { key: "review", label: "Review", title: "Review your SnoozePod", copy: "Take one last look before you add the current product to cart and carry the rest of the build forward as SnoozePod direction." }
  ];

  const BASE_OPTIONS = [
    { value: "none", title: "No base", subtitle: "Keep the mattress as the only committed product for now." },
    { value: "platform", title: "Platform base", subtitle: "A simple, supportive foundation that keeps the setup grounded." },
    { value: "adjustable", title: "Adjustable base", subtitle: "Add positioning and open up the motion step below." },
    { value: "not_sure", title: "Not sure yet", subtitle: "Keep moving and decide after you test the setup in person." }
  ];

  const MOTION_OPTIONS = [
    { value: "head_foot", title: "Head + foot adjustability", subtitle: "Lift and recline the base in one continuous setup." },
    { value: "split", title: "Split setup / partner flexibility", subtitle: "Lean toward partner-specific movement and shared-sleep flexibility." },
    { value: "zero_gravity", title: "Zero gravity / pressure relief direction", subtitle: "Bias the adjustable setup toward relief and recovery positioning." },
    { value: "not_sure", title: "Not sure yet", subtitle: "Leave the motion path open for your showroom test." }
  ];

  const PROTECTION_OPTIONS = [
    { value: "protector", title: "Protector", subtitle: "A straightforward layer that protects the surface without overcomplicating the setup." },
    { value: "encasement", title: "Encasement", subtitle: "A fuller wrap when you want more complete mattress coverage." },
    { value: "not_sure", title: "Not sure yet", subtitle: "Decide after you narrow the rest of the pod." }
  ];

  const PILLOW_OPTIONS = [
    { value: "cooling", title: "Cooling", subtitle: "Prioritize airflow and a cooler pillow direction." },
    { value: "shoulder_support", title: "Shoulder support", subtitle: "Bias the pillow choice toward side-sleeper pressure relief." },
    { value: "neck_alignment", title: "Neck alignment", subtitle: "Focus on cleaner head and neck positioning." },
    { value: "adjustable_fill", title: "Adjustable / fill-control", subtitle: "Keep the loft and support direction more customizable." },
    { value: "not_sure", title: "Not sure yet", subtitle: "Choose this if you want to compare pillow types later." }
  ];

  const BEDDING_OPTIONS = [
    { value: "cooling_sheets", title: "Cooling sheets", subtitle: "Push the setup toward temperature control and airflow." },
    { value: "soft_cotton", title: "Soft cotton feel", subtitle: "Keep the finish classic, soft, and easy to layer." },
    { value: "full_bedding", title: "Full bedding layer", subtitle: "Think beyond sheets and build a fuller finished bed." },
    { value: "not_sure", title: "Not sure yet", subtitle: "Save the final bedding decision for after you test the core setup." }
  ];

  const LABELS = {
    none: "No base",
    platform: "Platform base",
    adjustable: "Adjustable base",
    not_sure: "Not sure yet",
    head_foot: "Head + foot adjustability",
    split: "Split setup / partner flexibility",
    zero_gravity: "Zero gravity / pressure relief direction",
    protector: "Protector",
    encasement: "Encasement",
    cooling: "Cooling",
    shoulder_support: "Shoulder support",
    neck_alignment: "Neck alignment",
    adjustable_fill: "Adjustable / fill-control",
    cooling_sheets: "Cooling sheets",
    soft_cotton: "Soft cotton feel",
    full_bedding: "Full bedding layer"
  };

  const DIRECTION_LINKS = {
    platform: { label: "Platform base", note: "See the foundation that fits this direction.", href: "/products/platform-base" },
    adjustable: { label: "Adjustable base", note: "Explore the main adjustable base path.", href: "/products/premium-motion-adjustable-base" },
    protector: { label: "Mattress protector", note: "Start with the core protector path.", href: "/products/dri-tec-mattress-protector" },
    encasement: { label: "Mattress encasement", note: "See the full-coverage protection option.", href: "/products/mattress-encasement" },
    pillow: { label: "Pillow direction", note: "Compare pillows around alignment, cooling, and support.", href: "/collections/pillows" },
    bedding: { label: "Bedding finish", note: "Finish the bed with sheets and layers that match the setup.", href: "/collections/bedding" }
  };

  function parseJson(text, fallback) {
    try {
      return JSON.parse(text);
    } catch (error) {
      return fallback;
    }
  }

  function formatMoney(raw) {
    const amount = Number(String(raw == null ? "" : raw).replace(/[^0-9.]/g, ""));
    const safe = Number.isFinite(amount) ? amount : 0;
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(safe);
    } catch (error) {
      return "$" + safe.toFixed(2);
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function uniqueSizeOptions(variants, sizeOptionIndex) {
    const seen = new Set();
    const list = [];

    variants.forEach((variant) => {
      const optionKey = "option" + sizeOptionIndex;
      const value = String(variant?.[optionKey] || "").trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      list.push({
        value,
        title: value,
        subtitle: variant?.available ? "Available to add right now." : "Check availability before you commit."
      });
    });

    return list;
  }

  function findVariantForSize(variants, size, sizeOptionIndex) {
    const optionKey = "option" + sizeOptionIndex;
    return variants.find((variant) => String(variant?.[optionKey] || "").trim() === String(size || "").trim()) || null;
  }

  function visibleSteps(state) {
    return STEPS.filter((step) => step.key !== "motion" || state.base === "adjustable");
  }

  function titleForProduct(productTitle) {
    return String(productTitle || "current product").trim();
  }

  function summaryRows(state, productTitle) {
    const rows = [
      { term: "Mattress", value: titleForProduct(productTitle) },
      { term: "Size", value: state.size || "Choose a size" },
      { term: "Base", value: LABELS[state.base] || "Choose a base" },
      { term: "Protection", value: LABELS[state.protection] || "Choose protection" },
      { term: "Pillow direction", value: LABELS[state.pillow] || "Choose pillow direction" },
      { term: "Bedding finish", value: LABELS[state.bedding] || "Choose bedding finish" }
    ];

    if (state.base === "adjustable") {
      rows.splice(3, 0, { term: "Motion setup", value: LABELS[state.motion] || "Choose motion setup" });
    }

    return rows;
  }

  function reviewLinks(state) {
    const links = [];
    if (state.base === "platform") links.push(DIRECTION_LINKS.platform);
    if (state.base === "adjustable") links.push(DIRECTION_LINKS.adjustable);
    if (state.protection === "protector") links.push(DIRECTION_LINKS.protector);
    if (state.protection === "encasement") links.push(DIRECTION_LINKS.encasement);
    if (state.pillow && state.pillow !== "not_sure") links.push(DIRECTION_LINKS.pillow);
    if (state.bedding && state.bedding !== "not_sure") links.push(DIRECTION_LINKS.bedding);
    return links;
  }

  function initBuilder(root) {
    if (!root || root.dataset.builderReady === "true") return;
    root.dataset.builderReady = "true";

    const productDataNode = root.querySelector("[data-builder-product]");
    const productData = parseJson(productDataNode ? productDataNode.textContent : "{}", {});
    const variants = Array.isArray(productData.variants) ? productData.variants : [];
    const sizeOptionIndex = Math.max(1, Number(root.dataset.sizeOptionIndex || 1));
    const sizeOptions = uniqueSizeOptions(variants, sizeOptionIndex);
    const firstSize = sizeOptions[0] ? sizeOptions[0].value : "";
    const selectedVariantId = Number(productData.selectedVariantId || 0);
    const initiallySelectedVariant =
      variants.find((variant) => Number(variant?.id || 0) === selectedVariantId) || variants[0] || null;
    const initialSize =
      String(initiallySelectedVariant?.["option" + sizeOptionIndex] || "").trim() || firstSize;

    const els = {
      progress: root.querySelector("[data-builder-progress]"),
      steps: root.querySelector("[data-builder-steps]"),
      stepCount: root.querySelector("[data-builder-step-count]"),
      stepTitle: root.querySelector("[data-builder-step-title]"),
      stepCopy: root.querySelector("[data-builder-step-copy]"),
      options: root.querySelector("[data-builder-options]"),
      summary: root.querySelector("[data-builder-summary]"),
      links: root.querySelector("[data-builder-links]"),
      price: root.querySelector("[data-builder-price]"),
      next: root.querySelector("[data-builder-next]"),
      back: root.querySelector("[data-builder-back]"),
      reset: root.querySelector("[data-builder-reset]"),
      form: root.querySelector("[data-builder-form]"),
      reviewNote: root.querySelector("[data-builder-review-note]"),
      submit: root.querySelector("[data-builder-submit]"),
      book: root.querySelector("[data-builder-book]")
    };

    const formFields = els.form
      ? {
          id: els.form.querySelector('input[name="id"]'),
          size: els.form.querySelector('input[name="properties[SnoozePod Size]"]'),
          base: els.form.querySelector('input[name="properties[SnoozePod Base Direction]"]'),
          motion: els.form.querySelector('input[name="properties[SnoozePod Motion Direction]"]'),
          protection: els.form.querySelector('input[name="properties[SnoozePod Protection Direction]"]'),
          pillow: els.form.querySelector('input[name="properties[SnoozePod Pillow Direction]"]'),
          bedding: els.form.querySelector('input[name="properties[SnoozePod Bedding Direction]"]')
        }
      : null;

    const state = {
      currentStep: "size",
      size: initialSize,
      base: "",
      motion: "",
      protection: "",
      pillow: "",
      bedding: ""
    };

    function optionSetForStep(stepKey) {
      if (stepKey === "size") return sizeOptions;
      if (stepKey === "base") return BASE_OPTIONS;
      if (stepKey === "motion") return MOTION_OPTIONS;
      if (stepKey === "protection") return PROTECTION_OPTIONS;
      if (stepKey === "pillow") return PILLOW_OPTIONS;
      if (stepKey === "bedding") return BEDDING_OPTIONS;
      return [];
    }

    function valueForStep(stepKey) {
      return state[stepKey] || "";
    }

    function setValueForStep(stepKey, value) {
      state[stepKey] = value;
      if (stepKey === "base" && value !== "adjustable") {
        state.motion = "";
        if (state.currentStep === "motion") state.currentStep = "protection";
      }
    }

    function canProceed(stepKey) {
      if (stepKey === "review") return true;
      return Boolean(valueForStep(stepKey));
    }

    function renderOptions(step) {
      const options = optionSetForStep(step.key);
      if (step.key === "review") {
        els.options.innerHTML = `
          <div class="snoozepod-builder__review-note">
            This adds the current product to cart and keeps the rest of your selections attached as SnoozePod direction.
          </div>
        `;
        return;
      }

      els.options.innerHTML = options
        .map((option) => {
          const selected = valueForStep(step.key) === option.value;
          return `
            <button
              type="button"
              class="snoozepod-builder__option${selected ? " is-selected" : ""}"
              data-builder-option
              data-step="${escapeHtml(step.key)}"
              data-value="${escapeHtml(option.value)}"
            >
              <span class="snoozepod-builder__option-copy">
                <span>
                  <span class="snoozepod-builder__option-title">${escapeHtml(option.title)}</span>
                  <span class="snoozepod-builder__option-subtitle">${escapeHtml(option.subtitle || "")}</span>
                </span>
                <span class="snoozepod-builder__option-check" aria-hidden="true"></span>
              </span>
            </button>
          `;
        })
        .join("");
    }

    function renderSteps(stepList) {
      const currentIndex = stepList.findIndex((step) => step.key === state.currentStep);
      els.steps.innerHTML = stepList
        .map((step, index) => {
          const classNames = ["snoozepod-builder__step-pill"];
          if (step.key === state.currentStep) classNames.push("is-active");
          else if (index < currentIndex) classNames.push("is-complete");
          return `<span class="${classNames.join(" ")}">${escapeHtml(step.label)}</span>`;
        })
        .join("");
    }

    function renderSummary(productTitle, variant) {
      els.summary.innerHTML = summaryRows(state, productTitle)
        .map(
          (row) => `
            <div class="snoozepod-builder__summary-row">
              <dt class="snoozepod-builder__summary-term">${escapeHtml(row.term)}</dt>
              <dd class="snoozepod-builder__summary-value">${escapeHtml(row.value)}</dd>
            </div>
          `
        )
        .join("");

      els.price.textContent = variant ? formatMoney(variant.price) : "Choose a size";

      const links = reviewLinks(state);
      els.links.innerHTML = links
        .map(
          (link) => `
            <a class="snoozepod-builder__direction-link" href="${escapeHtml(link.href)}">
              <span>
                ${escapeHtml(link.label)}
                <small>${escapeHtml(link.note)}</small>
              </span>
              <span aria-hidden="true">&rarr;</span>
            </a>
          `
        )
        .join("");
    }

    function updateFormFields(variant) {
      if (!formFields) return;
      formFields.id.value = variant && variant.id ? String(variant.id) : "";
      formFields.size.value = state.size || "";
      formFields.base.value = LABELS[state.base] || "";
      formFields.motion.value = state.base === "adjustable" ? LABELS[state.motion] || "" : "";
      formFields.protection.value = LABELS[state.protection] || "";
      formFields.pillow.value = LABELS[state.pillow] || "";
      formFields.bedding.value = LABELS[state.bedding] || "";
    }

    function render() {
      const stepList = visibleSteps(state);
      if (!stepList.some((step) => step.key === state.currentStep)) {
        state.currentStep = stepList[0].key;
      }

      const currentIndex = stepList.findIndex((step) => step.key === state.currentStep);
      const currentStep = stepList[currentIndex];
      const variant = findVariantForSize(variants, state.size, sizeOptionIndex);
      const progressWidth = ((currentIndex + 1) / stepList.length) * 100;

      els.progress.style.width = progressWidth + "%";
      els.stepCount.textContent = "Step " + (currentIndex + 1) + " of " + stepList.length;
      els.stepTitle.textContent = currentStep.title;
      els.stepCopy.textContent = currentStep.copy;
      renderSteps(stepList);
      renderOptions(currentStep);
      renderSummary(root.dataset.productTitle, variant);
      updateFormFields(variant);

      const reviewing = currentStep.key === "review";
      if (els.reviewNote) els.reviewNote.hidden = !reviewing;
      if (els.form) els.form.hidden = !reviewing;

      if (els.back) {
        els.back.disabled = currentIndex === 0;
      }

      if (els.next) {
        const nextStep = stepList[currentIndex + 1];
        els.next.hidden = reviewing;
        els.next.disabled = !canProceed(currentStep.key);
        els.next.textContent = nextStep && nextStep.key === "review" ? "Review Your SnoozePod" : "Next";
      }

      if (els.submit) {
        const unavailable = !variant || variant.available === false;
        els.submit.disabled = unavailable;
        if (unavailable) {
          els.submit.textContent = "Selected size unavailable";
        } else {
          els.submit.textContent = root.dataset.addLabel || "Add current product to cart";
        }
      }
    }

    root.addEventListener("click", function (event) {
      const optionButton = event.target.closest("[data-builder-option]");
      if (optionButton) {
        const stepKey = optionButton.getAttribute("data-step");
        const value = optionButton.getAttribute("data-value");
        setValueForStep(stepKey, value);
        render();
        return;
      }

      const backButton = event.target.closest("[data-builder-back]");
      if (backButton) {
        const steps = visibleSteps(state);
        const index = steps.findIndex((step) => step.key === state.currentStep);
        if (index > 0) {
          state.currentStep = steps[index - 1].key;
          render();
        }
        return;
      }

      const nextButton = event.target.closest("[data-builder-next]");
      if (nextButton) {
        const steps = visibleSteps(state);
        const index = steps.findIndex((step) => step.key === state.currentStep);
        const currentStep = steps[index];
        if (!canProceed(currentStep.key)) return;
        if (steps[index + 1]) {
          state.currentStep = steps[index + 1].key;
          render();
        }
        return;
      }

      const resetButton = event.target.closest("[data-builder-reset]");
      if (resetButton) {
        state.currentStep = "size";
        state.size = initialSize;
        state.base = "";
        state.motion = "";
        state.protection = "";
        state.pillow = "";
        state.bedding = "";
        render();
      }
    });

    render();
  }

  function initAll() {
    document.querySelectorAll("[data-snoozepod-builder]").forEach(initBuilder);
  }

  document.addEventListener("DOMContentLoaded", initAll);
  document.addEventListener("shopify:section:load", function (event) {
    const root = event.target && event.target.querySelector ? event.target.querySelector("[data-snoozepod-builder]") : null;
    if (root) initBuilder(root);
  });
})();
