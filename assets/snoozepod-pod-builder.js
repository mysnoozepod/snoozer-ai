(function () {
  const STEPS = [
    {
      key: "size",
      label: "Size",
      title: "Choose your size",
      copy: "Pick the actual mattress size first. This replaces the normal Shopify variant selector."
    },
    {
      key: "base",
      label: "Base",
      title: "Choose your base",
      copy: "Set the foundation direction before you move into motion or finish layers."
    },
    {
      key: "motion",
      label: "Motion",
      title: "Choose your motion setup",
      copy: "Only adjustable-base setups need a motion path."
    },
    {
      key: "protection",
      label: "Protection",
      title: "Choose protection",
      copy: "Add the protection layer that best matches how you plan to use the mattress."
    },
    {
      key: "pillow",
      label: "Pillow",
      title: "Choose pillow direction",
      copy: "Pick the support direction you want to solve for first."
    },
    {
      key: "bedding",
      label: "Bedding",
      title: "Choose bedding finish",
      copy: "Finish the pod with the bedding direction you want to test in person."
    },
    {
      key: "review",
      label: "Review",
      title: "Review your SnoozePod",
      copy: "Check the full setup before you add the mattress to cart."
    }
  ];

  const BASE_OPTIONS = [
    { value: "none", title: "No base", subtitle: "Keep this mattress as the only committed product for now." },
    { value: "platform", title: "Platform base", subtitle: "A simple, supportive foundation." },
    { value: "adjustable", title: "Adjustable base", subtitle: "Adds positioning and opens the motion step." },
    { value: "not_sure", title: "Not sure yet", subtitle: "Keep moving and decide after testing in person." }
  ];

  const MOTION_OPTIONS = [
    { value: "head_foot", title: "Head + foot adjustability", subtitle: "A standard adjustable setup." },
    { value: "split", title: "Split setup / partner flexibility", subtitle: "Better for partner-specific movement." },
    { value: "zero_gravity", title: "Zero gravity / pressure relief direction", subtitle: "Bias the setup toward relief and recovery." },
    { value: "not_sure", title: "Not sure yet", subtitle: "Leave the motion path open for the showroom." }
  ];

  const PROTECTION_OPTIONS = [
    { value: "protector", title: "Mattress protector", subtitle: "A simple top-layer protection choice." },
    { value: "encasement", title: "Mattress encasement", subtitle: "A fuller wrap when you want more coverage." },
    { value: "not_sure", title: "Not sure yet", subtitle: "Choose this if you want to compare in person." }
  ];

  const PILLOW_OPTIONS = [
    { value: "cooling", title: "Cooling", subtitle: "Focus on airflow and temperature control." },
    { value: "shoulder_support", title: "Shoulder support", subtitle: "Prioritize side-sleeper relief and loft." },
    { value: "neck_alignment", title: "Neck alignment", subtitle: "Focus on cleaner head and neck positioning." },
    { value: "adjustable_fill", title: "Adjustable feel", subtitle: "Keep the loft and support feel more flexible." },
    { value: "not_sure", title: "Not sure yet", subtitle: "Save the pillow call for later." }
  ];

  const BEDDING_OPTIONS = [
    { value: "cooling_sheets", title: "Cooling sheets", subtitle: "Push the pod toward cooler sleep." },
    { value: "soft_cotton", title: "Soft cotton feel", subtitle: "Keep the finish classic and soft." },
    { value: "full_bedding", title: "Full bedding layer", subtitle: "Think beyond sheets and finish the bed." },
    { value: "not_sure", title: "Not sure yet", subtitle: "Leave the final bedding choice open." }
  ];

  const LABELS = {
    none: "No base",
    platform: "Platform base",
    adjustable: "Adjustable base",
    not_sure: "Not sure yet",
    head_foot: "Head + foot adjustability",
    split: "Split setup / partner flexibility",
    zero_gravity: "Zero gravity / pressure relief direction",
    protector: "Mattress protector",
    encasement: "Mattress encasement",
    cooling: "Cooling",
    shoulder_support: "Shoulder support",
    neck_alignment: "Neck alignment",
    adjustable_fill: "Adjustable feel",
    cooling_sheets: "Cooling sheets",
    soft_cotton: "Soft cotton feel",
    full_bedding: "Full bedding layer"
  };

  function parseJson(text, fallback) {
    try {
      return JSON.parse(text);
    } catch (error) {
      return fallback;
    }
  }

  function normalizePriceCents(raw) {
    if (raw == null || raw === "") return 0;

    if (typeof raw === "number") {
      return Number.isFinite(raw) ? raw : 0;
    }

    const text = String(raw).trim();
    if (!text) return 0;

    const cleaned = text.replace(/[^0-9.-]/g, "");
    if (!cleaned) return 0;

    const numeric = Number(cleaned);
    if (!Number.isFinite(numeric)) return 0;

    if (cleaned.includes(".")) {
      return Math.round(numeric * 100);
    }

    return numeric;
  }

  function formatMoneyFromCents(raw) {
    const amount = normalizePriceCents(raw) / 100;
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
    } catch (error) {
      return "$" + amount.toFixed(2);
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
      const value = String(variant && variant[optionKey] ? variant[optionKey] : "").trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      list.push({
        value: value,
        title: value,
        subtitle: variant && variant.available ? "Available now." : "Check availability before you commit."
      });
    });

    return list;
  }

  function findVariantForSize(variants, size, sizeOptionIndex) {
    const optionKey = "option" + sizeOptionIndex;
    return (
      variants.find(function (variant) {
        return String(variant && variant[optionKey] ? variant[optionKey] : "").trim() === String(size || "").trim();
      }) || null
    );
  }

  function visibleSteps(state) {
    return STEPS.filter(function (step) {
      return step.key !== "motion" || state.base === "adjustable";
    });
  }

  function summaryRows(state, productTitle) {
    const rows = [
      { term: "Mattress", value: productTitle || "Current mattress" },
      { term: "Size", value: state.size || "Choose a size" },
      { term: "Base", value: LABELS[state.base] || "Choose a base" },
      { term: "Protection", value: LABELS[state.protection] || "Choose protection" },
      { term: "Pillow", value: LABELS[state.pillow] || "Choose pillow direction" },
      { term: "Bedding", value: LABELS[state.bedding] || "Choose bedding finish" }
    ];

    if (state.base === "adjustable") {
      rows.splice(3, 0, { term: "Motion", value: LABELS[state.motion] || "Choose motion setup" });
    }

    return rows;
  }

  function initBuilder(root) {
    if (!root || root.dataset.builderReady === "true") return;
    root.dataset.builderReady = "true";

    const productDataNode = root.querySelector("[data-builder-product]");
    const productData = parseJson(productDataNode ? productDataNode.textContent : "{}", {});
    const variants = Array.isArray(productData.variants) ? productData.variants : [];
    const sizeOptionIndex = Math.max(1, Number(root.dataset.sizeOptionIndex || 1));
    const sizeOptions = uniqueSizeOptions(variants, sizeOptionIndex);
    const selectedVariantId = Number(productData.selectedVariantId || 0);
    const initialVariant =
      variants.find(function (variant) {
        return Number(variant && variant.id ? variant.id : 0) === selectedVariantId;
      }) || variants[0] || null;
    const initialSize =
      String(initialVariant && initialVariant["option" + sizeOptionIndex] ? initialVariant["option" + sizeOptionIndex] : "").trim() ||
      (sizeOptions[0] ? sizeOptions[0].value : "");

    const els = {
      progress: root.querySelector("[data-builder-progress]"),
      steps: root.querySelector("[data-builder-steps]"),
      stepCount: root.querySelector("[data-builder-step-count]"),
      stepLabel: root.querySelector("[data-builder-step-label]"),
      stepTitle: root.querySelector("[data-builder-step-title]"),
      stepCopy: root.querySelector("[data-builder-step-copy]"),
      options: root.querySelector("[data-builder-options]"),
      review: root.querySelector("[data-builder-review]"),
      reviewList: root.querySelector("[data-builder-review-list]"),
      summary: root.querySelector("[data-builder-summary]"),
      price: root.querySelector("[data-builder-price]"),
      form: root.querySelector("[data-builder-form]"),
      submit: root.querySelector("[data-builder-submit]"),
      back: root.querySelector("[data-builder-back]"),
      next: root.querySelector("[data-builder-next]"),
      finalActions: root.querySelector("[data-builder-final-actions]"),
      reset: root.querySelector("[data-builder-reset]")
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
      switch (stepKey) {
        case "size":
          return sizeOptions;
        case "base":
          return BASE_OPTIONS;
        case "motion":
          return MOTION_OPTIONS;
        case "protection":
          return PROTECTION_OPTIONS;
        case "pillow":
          return PILLOW_OPTIONS;
        case "bedding":
          return BEDDING_OPTIONS;
        default:
          return [];
      }
    }

    function stepValue(stepKey) {
      return state[stepKey] || "";
    }

    function setStepValue(stepKey, value) {
      state[stepKey] = value;
      if (stepKey === "base" && value !== "adjustable") {
        state.motion = "";
        if (state.currentStep === "motion") {
          state.currentStep = "protection";
        }
      }
    }

    function canProceed(stepKey) {
      if (stepKey === "review") return true;
      return Boolean(stepValue(stepKey));
    }

    function renderStepPills(stepList) {
      const currentIndex = stepList.findIndex(function (step) {
        return step.key === state.currentStep;
      });

      els.steps.innerHTML = stepList
        .map(function (step, index) {
          const classNames = ["snoozepod-builder__step-pill"];
          if (step.key === state.currentStep) classNames.push("is-active");
          else if (index < currentIndex) classNames.push("is-complete");
          return '<span class="' + classNames.join(" ") + '">' + escapeHtml(step.label) + "</span>";
        })
        .join("");
    }

    function renderOptions(step) {
      if (step.key === "review") {
        els.options.innerHTML = "";
        return;
      }

      const options = optionSetForStep(step.key);
      els.options.innerHTML = options
        .map(function (option) {
          const selected = stepValue(step.key) === option.value;
          return (
            '<button type="button" class="snoozepod-builder__option' +
            (selected ? " is-selected" : "") +
            '" data-builder-option data-step="' +
            escapeHtml(step.key) +
            '" data-value="' +
            escapeHtml(option.value) +
            '">' +
            '<span class="snoozepod-builder__option-copy">' +
            '<span><span class="snoozepod-builder__option-title">' +
            escapeHtml(option.title) +
            "</span><span class=\"snoozepod-builder__option-subtitle\">" +
            escapeHtml(option.subtitle || "") +
            '</span></span><span class="snoozepod-builder__option-check" aria-hidden="true"></span></span></button>'
          );
        })
        .join("");
    }

    function renderSummary(productTitle, variant) {
      const rows = summaryRows(state, productTitle);
      const markup = rows
        .map(function (row) {
          return (
            '<div class="snoozepod-builder__summary-row"><dt class="snoozepod-builder__summary-term">' +
            escapeHtml(row.term) +
            '</dt><dd class="snoozepod-builder__summary-value">' +
            escapeHtml(row.value) +
            "</dd></div>"
          );
        })
        .join("");

      els.summary.innerHTML = markup;
      els.reviewList.innerHTML = markup
        .replaceAll("snoozepod-builder__summary-row", "snoozepod-builder__review-row")
        .replaceAll("snoozepod-builder__summary-term", "snoozepod-builder__review-term")
        .replaceAll("snoozepod-builder__summary-value", "snoozepod-builder__review-value");

      els.price.textContent = variant ? formatMoneyFromCents(variant.price) : "Choose a size";
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
      if (!stepList.some(function (step) { return step.key === state.currentStep; })) {
        state.currentStep = stepList[0].key;
      }

      const currentIndex = stepList.findIndex(function (step) { return step.key === state.currentStep; });
      const currentStep = stepList[currentIndex];
      const variant = findVariantForSize(variants, state.size, sizeOptionIndex);
      const reviewing = currentStep.key === "review";

      els.progress.style.width = (((currentIndex + 1) / stepList.length) * 100) + "%";
      els.stepCount.textContent = "Step " + (currentIndex + 1) + " of " + stepList.length;
      els.stepLabel.textContent = currentStep.label;
      els.stepTitle.textContent = currentStep.title;
      els.stepCopy.textContent = currentStep.copy;

      renderStepPills(stepList);
      renderOptions(currentStep);
      renderSummary(root.dataset.productTitle, variant);
      updateFormFields(variant);

      els.review.hidden = !reviewing;
      els.form.hidden = !reviewing;
      els.finalActions.hidden = !reviewing;
      els.next.hidden = reviewing;

      els.back.disabled = currentIndex === 0;

      if (!reviewing) {
        const nextStep = stepList[currentIndex + 1];
        els.next.disabled = !canProceed(currentStep.key);
        els.next.textContent = nextStep && nextStep.key === "review" ? "Review your SnoozePod" : "Next";
      }

      if (els.submit) {
        const unavailable = !variant || variant.available === false;
        els.submit.disabled = unavailable;
        els.submit.textContent = unavailable ? "Selected size unavailable" : (root.dataset.addLabel || "Add mattress to cart");
      }
    }

    root.addEventListener("click", function (event) {
      const optionButton = event.target.closest("[data-builder-option]");
      if (optionButton) {
        setStepValue(optionButton.getAttribute("data-step"), optionButton.getAttribute("data-value"));
        render();
        return;
      }

      if (event.target.closest("[data-builder-back]")) {
        const stepList = visibleSteps(state);
        const currentIndex = stepList.findIndex(function (step) { return step.key === state.currentStep; });
        if (currentIndex > 0) {
          state.currentStep = stepList[currentIndex - 1].key;
          render();
        }
        return;
      }

      if (event.target.closest("[data-builder-next]")) {
        const stepList = visibleSteps(state);
        const currentIndex = stepList.findIndex(function (step) { return step.key === state.currentStep; });
        const currentStep = stepList[currentIndex];
        if (!canProceed(currentStep.key)) return;
        if (stepList[currentIndex + 1]) {
          state.currentStep = stepList[currentIndex + 1].key;
          render();
        }
        return;
      }

      if (event.target.closest("[data-builder-reset]")) {
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
