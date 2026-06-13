(function () {
  const sharedVoice = typeof require === "function"
    ? (function loadSharedVoice() {
        try {
          return require("../services/snoozerVoice");
        } catch (error) {
          return null;
        }
      })()
    : null;

  const STEPS = [
    {
      key: "size",
      label: "Size",
      title: "Choose your size",
      copy: "Pick the mattress size for the rest of this build."
    },
    {
      key: "base",
      label: "Base",
      title: "Choose your base",
      copy: "Choose the base you want in this setup."
    },
    {
      key: "motion",
      label: "Motion",
      title: "Choose your motion setup",
      copy: "Only choose motion when you want an adjustable base."
    },
    {
      key: "protection",
      label: "Protection",
      title: "Choose mattress protection",
      copy: "Add protection now or leave it out of this pass."
    },
    {
      key: "pillow",
      label: "Pillow",
      title: "Choose your pillow",
      copy: "Add the pillow you want or skip it for now."
    },
    {
      key: "bedding",
      label: "Bedding",
      title: "Choose your bedding",
      copy: "Finish with bedding or leave it out for now."
    },
    {
      key: "review",
      label: "Review",
      title: "Review your SnoozePod",
      copy: "Check your selections before you add this setup to cart."
    }
  ];

  const MOTION_OPTIONS = [
    {
      key: "standard",
      title: "Standard Motion",
      summaryLabel: "Standard Motion",
      subtitle: "One shared motion base setup."
    },
    {
      key: "half_split",
      title: "Half Split Motion",
      summaryLabel: "Half Split Motion",
      subtitle: "Split flexibility when the size supports it."
    },
    {
      key: "full_split",
      title: "Full Split Motion",
      summaryLabel: "Full Split Motion",
      subtitle: "Full split control when the size supports it."
    }
  ];

  const SYSTEM_OPTIONS = {
    base: [
      {
        key: "no_base",
        title: "No base / already have one",
        summaryLabel: "No base / already have one",
        subtitle: "Continue without adding a base product."
      },
      {
        key: "not_sure",
        title: "Not sure yet",
        summaryLabel: "Not sure yet",
        subtitle: "Leave the base open and confirm it in the showroom."
      }
    ],
    protection: [
      {
        key: "skip_protection",
        title: "Skip protection for now",
        summaryLabel: "Skip protection for now",
        subtitle: "Keep the setup focused on the mattress for now."
      },
      {
        key: "not_sure",
        title: "Not sure yet",
        summaryLabel: "Not sure yet",
        subtitle: "Compare protection options in person later."
      }
    ],
    pillow: [
      {
        key: "skip_pillow",
        title: "Skip pillow for now",
        summaryLabel: "Skip pillow for now",
        subtitle: "Leave pillows out of this pass."
      },
      {
        key: "not_sure",
        title: "Not sure yet",
        summaryLabel: "Not sure yet",
        subtitle: "Try the pillows in the showroom first."
      }
    ],
    bedding: [
      {
        key: "skip_bedding",
        title: "Skip bedding for now",
        summaryLabel: "Skip bedding for now",
        subtitle: "Leave bedding out of this pass."
      },
      {
        key: "not_sure",
        title: "Not sure yet",
        summaryLabel: "Not sure yet",
        subtitle: "Compare bedding finishes in person later."
      }
    ]
  };

  const SHARED_ASSESSMENT_KEY = "snooze.assessment";
  const SHARED_SHOPPER_KEY = "snooze.assessmentShopperId";

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

  function normalizeText(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function buildVoiceReply(scenario, options) {
    if (sharedVoice && typeof sharedVoice.buildSnoozerVoiceReply === "function") {
      return sharedVoice.buildSnoozerVoiceReply(scenario, options || {});
    }

    if (scenario === "no_base") {
      return "If your assessment stayed mattress-only, keep the build clean and leave the base out for now.";
    }
    if (scenario === "platform_base") {
      return "Platform Base keeps this build simple and off the motion path.";
    }
    if (scenario === "adjustable_base") {
      return "If elevation matters, choose the adjustable path on purpose before you worry about the extras.";
    }
    if (scenario === "split_motion") {
      return "Queen usually points to Half Split, while Full Split stays King-only.";
    }
    return "Use the assessment match as your starting direction.";
  }

  function buildBuilderGuidanceText(stepKey, guidance) {
    if (!guidance) return "";

    if (stepKey === "size" && guidance.sizeWarning) {
      return guidance.sizeWarning;
    }
    if (stepKey === "size" && guidance.size) {
      return "Assessment match: stay with " + guidance.size + ".";
    }

    if (stepKey === "base" && guidance.baseWarning) {
      return guidance.baseWarning;
    }
    if (stepKey === "base" && guidance.baseKey === "no_base") {
      return buildVoiceReply("no_base");
    }
    if (stepKey === "base" && guidance.baseKey === "platform-base") {
      return buildVoiceReply("platform_base");
    }
    if (stepKey === "base" && normalizeText(guidance.baseLabel).indexOf("adjustable") > -1) {
      return buildVoiceReply("adjustable_base");
    }
    if (stepKey === "base" && guidance.baseLabel) {
      return "Assessment match: " + guidance.baseLabel + ".";
    }

    if (stepKey === "motion" && guidance.motionWarning) {
      return guidance.motionWarning;
    }
    if (stepKey === "motion" && guidance.motionKey === "half_split") {
      return "Half Split is the right split-motion path when Queen is in play or you want shared foot movement.";
    }
    if (stepKey === "motion" && guidance.motionKey === "full_split") {
      return "Full Split stays King-only and gives each side more independent movement.";
    }
    if (stepKey === "motion" && guidance.motionKey === "standard") {
      return "Standard Motion keeps the adjustable setup simpler when you want both sides moving together.";
    }
    if (stepKey === "motion" && guidance.motionLabel) {
      return "Assessment match: " + guidance.motionLabel + ".";
    }

    return "";
  }

  function safeSessionGet(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (error) {
      return "";
    }
  }

  function normalizeApiBase(value) {
    return String(value == null ? "" : value)
      .trim()
      .replace(/\/+$/, "");
  }

  function getApiBase(root) {
    const globalConfig = window.MySnoozePod || {};
    const docValue = document.documentElement && document.documentElement.getAttribute
      ? document.documentElement.getAttribute("data-snoozer-api-base")
      : "";
    const rootValue = root && root.getAttribute ? root.getAttribute("data-builder-api-base") : "";
    const candidates = [
      rootValue,
      globalConfig.apiBase,
      globalConfig.api_base,
      window.__SNOOZER_API_BASE__,
      docValue
    ];

    for (let index = 0; index < candidates.length; index += 1) {
      const normalized = normalizeApiBase(candidates[index]);
      if (normalized) return normalized;
    }

    return "";
  }

  function buildApiUrl(root, path) {
    const base = getApiBase(root);
    if (!base) return "";
    if (/^https?:\/\//i.test(path)) return String(path);
    return base + (String(path || "").charAt(0) === "/" ? path : "/" + path);
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
        key: value,
        kind: "size",
        title: value,
        summaryLabel: value,
        subtitle: variant && variant.available
          ? "Build around this mattress size."
          : "Build around this size and confirm availability before checkout."
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

  function normalizeSizeKey(size) {
    const value = normalizeText(size);
    if (value === "split king") return "split king";
    if (value === "cal king" || value === "california king") return "cal king";
    if (value === "twin xl" || value === "twin x l") return "twin xl";
    return value;
  }

  function sizeAliases(size) {
    switch (normalizeSizeKey(size)) {
      case "twin":
        return ["twin"];
      case "twin xl":
        return ["twin xl", "twin/twin xl", "twin x l"];
      case "full":
        return ["full", "double"];
      case "queen":
        return ["queen", "queen 2pc", "queen two pc"];
      case "king":
        return ["king", "king 2pc", "king two pc"];
      case "split king":
        return ["split king", "king 2pc", "king"];
      case "cal king":
        return ["cal king", "california king", "cal king 2pc"];
      default:
        return [normalizeText(size)];
    }
  }

  function variantTextParts(variant) {
    return [variant && variant.title, variant && variant.option1, variant && variant.option2, variant && variant.option3]
      .filter(Boolean)
      .map(normalizeText);
  }

  function variantMatchScore(variant, size) {
    const aliases = sizeAliases(size);
    const parts = variantTextParts(variant);
    let score = 0;

    aliases.forEach((alias, aliasIndex) => {
      parts.forEach((part) => {
        if (part === alias) {
          score = Math.max(score, aliasIndex === 0 ? 4 : 3);
        } else if (part.includes(alias) || alias.includes(part)) {
          score = Math.max(score, 2);
        }
      });
    });

    return score;
  }

  function firstAvailableVariant(variants) {
    return (
      variants.find(function (variant) {
        return variant && variant.available !== false;
      }) ||
      variants[0] ||
      null
    );
  }

  function resolveAddonVariant(productOption, size) {
    if (!productOption || productOption.kind !== "product") return null;
    const variants = Array.isArray(productOption.variants) ? productOption.variants : [];
    if (!variants.length) return null;
    if (!size) return firstAvailableVariant(variants);

    let bestVariant = null;
    let bestScore = 0;

    variants.forEach(function (variant) {
      if (!variant) return;
      const score = variantMatchScore(variant, size);
      if (score > bestScore) {
        bestScore = score;
        bestVariant = variant;
      }
    });

    if (bestVariant) {
      return bestVariant;
    }

    return firstAvailableVariant(variants);
  }

  function findCatalogOptionByKey(stepKey, key, catalogs, sizeOptions) {
    if (!key) return null;
    return getStepOptions(stepKey, { size: sizeOptions && sizeOptions[0] ? sizeOptions[0].key : "" }, catalogs, sizeOptions)
      .find(function (option) {
        return option && option.key === key;
      }) || null;
  }

  function findBaseOptionByKey(key, catalogs, sizeOptions) {
    return findCatalogOptionByKey("base", key, catalogs, sizeOptions);
  }

  function findCatalogHandleOption(catalogItems, handle) {
    const wanted = normalizeText(handle);
    return (catalogItems || []).find(function (item) {
      return normalizeText(item && item.handle) === wanted;
    }) || null;
  }

  function findFirstAdjustableBaseOption(catalogs) {
    return (catalogs.base || []).find(function (item) {
      return Boolean(item && item.kind === "product" && item.isAdjustable);
    }) || null;
  }

  function getSharedAssessmentAnswers() {
    const raw = safeSessionGet(SHARED_ASSESSMENT_KEY);
    return raw ? parseJson(raw, null) : null;
  }

  function getSharedAssessmentShopperId() {
    return String(safeSessionGet(SHARED_SHOPPER_KEY) || "").trim();
  }

  function normalizeMotionSelectionKey(value) {
    const normalized = normalizeText(value);
    if (!normalized || normalized === normalizeText("No Motion")) return "";
    if (normalized === "standard motion" || normalized === "standard") return "standard";
    if (normalized === "half split motion" || normalized === "half split" || normalized === "half split motion ") return "half_split";
    if (normalized === "full split motion" || normalized === "full split") return "full_split";
    if (normalized === "half split motion queen") return "half_split";
    return "";
  }

  function motionSummaryLabelForKey(key) {
    const match = MOTION_OPTIONS.find(function (option) {
      return option.key === key;
    });
    return match ? (match.summaryLabel || match.title) : "";
  }

  function normalizeMotionSelectionForSize(key, size) {
    const normalizedKey = normalizeMotionSelectionKey(key);
    if (!normalizedKey) {
      return {
        key: "",
        label: "",
        warning: "",
      };
    }

    const allowedKeys = allowedMotionOptionsForSize(size).map(function (option) {
      return option.key;
    });

    if (allowedKeys.indexOf(normalizedKey) > -1) {
      return {
        key: normalizedKey,
        label: motionSummaryLabelForKey(normalizedKey),
        warning: "",
      };
    }

    if (normalizedKey === "full_split" && normalizeSizeKey(size) === "queen") {
      return {
        key: "half_split",
        label: motionSummaryLabelForKey("half_split"),
        warning: "Full Split is a King-only setup. For Queen, the right split-motion path is Half Split Motion.",
      };
    }

    return {
      key: allowedKeys[0] || "",
      label: motionSummaryLabelForKey(allowedKeys[0] || ""),
      warning: "",
    };
  }

  function findMatchingSizeOption(sizeOptions, size) {
    const wanted = normalizeSizeKey(size);
    if (!wanted) return null;

    return (sizeOptions || []).find(function (option) {
      return normalizeSizeKey(option && option.key) === wanted;
    }) || null;
  }

  function resolveBuilderBaseSelection(assessment, catalogs, canonicalRecommendation) {
    const warnings = [];
    const canonical = canonicalRecommendation || {};
    const normalizedBaseType = normalizeText(
      canonical.normalizedAssessment && canonical.normalizedAssessment.baseType
        ? canonical.normalizedAssessment.baseType
        : assessment && assessment.baseType
    );
    const explicitBaseHandle = Object.prototype.hasOwnProperty.call(canonical, "baseHandle")
      ? String(canonical.baseHandle || "").trim()
      : "";

    if (Object.prototype.hasOwnProperty.call(canonical, "baseHandle") && canonical.baseHandle == null) {
      return {
        key: "no_base",
        label: "No base / already have one",
        warnings: warnings,
      };
    }

    if (
      normalizedBaseType === "mattress only" ||
      normalizedBaseType === "no base" ||
      normalizedBaseType === "no base already have one"
    ) {
      return {
        key: "no_base",
        label: "No base / already have one",
        warnings: warnings,
      };
    }

    if (explicitBaseHandle) {
      const explicitMatch = findCatalogHandleOption(catalogs.base, explicitBaseHandle);
      if (explicitMatch) {
        return {
          key: explicitMatch.key,
          label: explicitMatch.summaryLabel || explicitMatch.title,
          warnings: warnings,
        };
      }
    }

    if (normalizedBaseType === "platform base") {
      const platformMatch = findCatalogHandleOption(catalogs.base, "platform-base");
      if (platformMatch) {
        return {
          key: platformMatch.key,
          label: platformMatch.summaryLabel || platformMatch.title,
          warnings: warnings,
        };
      }
      warnings.push("Your assessment pointed to Platform Base, but this builder does not carry that base on the current product page.");
      return { key: "", label: "Platform Base", warnings: warnings };
    }

    if (normalizedBaseType === "storage base") {
      const storageMatch = findCatalogHandleOption(catalogs.base, "storage-base");
      if (storageMatch) {
        return {
          key: storageMatch.key,
          label: storageMatch.summaryLabel || storageMatch.title,
          warnings: warnings,
        };
      }
      warnings.push("Your assessment pointed to Storage Base, but this builder does not carry that base on the current product page.");
      return { key: "", label: "Storage Base", warnings: warnings };
    }

    if (normalizedBaseType === "adjustable base") {
      const adjustableMatch = explicitBaseHandle
        ? findCatalogHandleOption(catalogs.base, explicitBaseHandle)
        : findFirstAdjustableBaseOption(catalogs);
      if (adjustableMatch) {
        return {
          key: adjustableMatch.key,
          label: adjustableMatch.summaryLabel || adjustableMatch.title,
          warnings: warnings,
        };
      }
      warnings.push("Your assessment pointed to an Adjustable Base, but this builder does not carry an adjustable base on the current product page.");
    }

    return { key: "", label: "", warnings: warnings };
  }

  function buildBuilderPlanFromAssessment(assessment, catalogs, sizeOptions, canonicalRecommendation, sourceLabel) {
    if (!assessment) return null;

    const canonical = canonicalRecommendation || {};
    const warnings = [];
    const requestedSize = String(
      canonical.normalizedAssessment && canonical.normalizedAssessment.size
        ? canonical.normalizedAssessment.size
        : assessment.size || ""
    ).trim();
    const sizeMatch = findMatchingSizeOption(sizeOptions, requestedSize);
    if (requestedSize && !sizeMatch) {
      warnings.push(requestedSize + " is not available on this product page, so I left the size unchanged here.");
    }

    const baseSelection = resolveBuilderBaseSelection(assessment, catalogs, canonical);
    Array.prototype.push.apply(warnings, baseSelection.warnings || []);
    const baseOption = findBaseOptionByKey(baseSelection.key, catalogs, sizeOptions);
    const baseIsAdjustable = Boolean(baseOption && baseOption.kind === "product" && baseOption.isAdjustable);
    const motionInput =
      canonical.motionKey ||
      (canonical.normalizedAssessment && canonical.normalizedAssessment.motionLabel) ||
      (assessment && assessment.motionMode) ||
      "";
    const motionSelection = baseIsAdjustable
      ? normalizeMotionSelectionForSize(motionInput, sizeMatch ? sizeMatch.key : requestedSize)
      : { key: "", label: "", warning: "" };

    if (motionSelection.warning) {
      warnings.push(motionSelection.warning);
    }

    return {
      source: sourceLabel || "shared_assessment",
      requestedSize: requestedSize,
      size: sizeMatch ? sizeMatch.key : "",
      baseKey: baseSelection.key,
      baseLabel: baseSelection.label,
      motionKey: motionSelection.key,
      motionLabel: motionSelection.label,
      warnings: warnings.filter(Boolean),
      canonicalRecommendation: canonicalRecommendation || null,
    };
  }

  async function resolveBuilderPlan(root, catalogs, sizeOptions) {
    const assessment = getSharedAssessmentAnswers();
    if (!assessment) return null;

    const localPlan = buildBuilderPlanFromAssessment(
      assessment,
      catalogs,
      sizeOptions,
      null,
      "shared_assessment"
    );
    const apiUrl = buildApiUrl(root, "/recommendations/resolve");
    if (!apiUrl || !window.fetch) {
      return localPlan;
    }

    try {
      const response = await window.fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shopperId: getSharedAssessmentShopperId() || null,
          assessment: assessment,
          source: "shopify_pod_builder",
        }),
      });

      if (!response.ok) {
        throw new Error("Canonical builder resolve failed");
      }

      const payload = await response.json();
      const canonicalRecommendation = payload && payload.recommendation ? payload.recommendation : null;
      const canonicalPlan = buildBuilderPlanFromAssessment(
        assessment,
        catalogs,
        sizeOptions,
        canonicalRecommendation,
        "canonical_resolver"
      );

      return canonicalPlan || localPlan;
    } catch (error) {
      console.warn("[snoozepod-builder] canonical plan unavailable, using saved assessment defaults", error);
      return localPlan;
    }
  }

  function allowedMotionOptionsForSize(size) {
    const normalized = normalizeSizeKey(size);
    if (normalized === "king" || normalized === "split king") {
      return MOTION_OPTIONS;
    }
    if (normalized === "queen") {
      return MOTION_OPTIONS.filter(function (option) {
        return option.key !== "full_split";
      });
    }
    return MOTION_OPTIONS.filter(function (option) {
      return option.key === "standard";
    });
  }

  function readCatalog(root, key) {
    const node = root.querySelector('[data-builder-catalog="' + key + '"]');
    return parseJson(node ? node.textContent : "[]", []);
  }

  function getSelectedOption(stepKey, state, catalogs, sizeOptions) {
    const selectedKey = state[stepKey];
    if (!selectedKey) return null;
    return getStepOptions(stepKey, state, catalogs, sizeOptions).find(function (option) {
      return option.key === selectedKey;
    }) || null;
  }

  function isAdjustableBaseSelection(state, catalogs, sizeOptions) {
    const baseOption = getSelectedOption("base", state, catalogs, sizeOptions);
    return Boolean(baseOption && baseOption.kind === "product" && baseOption.isAdjustable);
  }

  function visibleSteps(state, catalogs, sizeOptions) {
    return STEPS.filter(function (step) {
      return step.key !== "motion" || isAdjustableBaseSelection(state, catalogs, sizeOptions);
    });
  }

  function getStepOptions(stepKey, state, catalogs, sizeOptions) {
    switch (stepKey) {
      case "size":
        return sizeOptions;
      case "base":
        return (catalogs.base || []).concat(SYSTEM_OPTIONS.base);
      case "motion":
        return allowedMotionOptionsForSize(state.size);
      case "protection":
        return (catalogs.protection || []).concat(SYSTEM_OPTIONS.protection);
      case "pillow":
        return (catalogs.pillow || []).concat(SYSTEM_OPTIONS.pillow);
      case "bedding":
        return (catalogs.bedding || []).concat(SYSTEM_OPTIONS.bedding);
      default:
        return [];
    }
  }

  function summaryRows(state, productTitle, catalogs, sizeOptions) {
    const rows = [{ term: "Mattress", value: productTitle || "Current mattress" }];

    if (state.size) {
      rows.push({ term: "Size", value: state.size });
    }

    ["base", "protection", "pillow", "bedding"].forEach(function (stepKey) {
      const option = getSelectedOption(stepKey, state, catalogs, sizeOptions);
      if (!option) return;

      const termMap = {
        base: "Base",
        protection: "Protection",
        pillow: "Pillow",
        bedding: "Bedding"
      };

      rows.push({
        term: termMap[stepKey],
        value: option.summaryLabel || option.title
      });
    });

    if (isAdjustableBaseSelection(state, catalogs, sizeOptions)) {
      const motionOption = getSelectedOption("motion", state, catalogs, sizeOptions);
      if (motionOption) {
        rows.splice(3, 0, { term: "Motion", value: motionOption.summaryLabel || motionOption.title });
      }
    }

    if (rows.length === 1) {
      rows.push({ term: "Start here", value: "Choose your size to begin." });
    }

    return rows;
  }

  function calculateAddonSelections(state, catalogs, sizeOptions) {
    return ["base", "protection", "pillow", "bedding"].reduce(function (acc, stepKey) {
      const option = getSelectedOption(stepKey, state, catalogs, sizeOptions);
      if (!option || option.kind !== "product") return acc;

      const variant = resolveAddonVariant(option, state.size);
      if (!variant) return acc;

      acc.push({
        stepKey: stepKey,
        option: option,
        variant: variant
      });
      return acc;
    }, []);
  }

  function calculateEstimatedTotalCents(mattressVariant, addonSelections) {
    let total = mattressVariant ? normalizePriceCents(mattressVariant.price) : 0;
    addonSelections.forEach(function (selection) {
      total += normalizePriceCents(selection.variant && selection.variant.price);
    });
    return total;
  }

  function renderProductOption(option, selected, state) {
    const matchedVariant = resolveAddonVariant(option, state.size);
    const priceText = matchedVariant
      ? formatMoneyFromCents(matchedVariant.price)
      : formatMoneyFromCents(option.price);

    const variantLabel = matchedVariant && matchedVariant.title && matchedVariant.title !== "Default Title"
      ? matchedVariant.title
      : "";

    return (
      '<button type="button" class="snoozepod-builder__option snoozepod-builder__option--product' +
      (selected ? " is-selected" : "") +
      '" data-builder-option data-step="' +
      escapeHtml(option.stepKey) +
      '" data-value="' +
      escapeHtml(option.key) +
      '">' +
      '<span class="snoozepod-builder__option-media">' +
      (option.image
        ? '<img src="' + escapeHtml(option.image) + '" alt="' + escapeHtml(option.imageAlt || option.title) + '" loading="lazy">'
        : '<span class="snoozepod-builder__option-media-fallback">' + escapeHtml(option.title) + "</span>") +
      "</span>" +
      '<span class="snoozepod-builder__option-copy snoozepod-builder__option-copy--product">' +
      '<span class="snoozepod-builder__option-main">' +
      '<span class="snoozepod-builder__option-meta">' +
      (option.typeLabel ? '<span class="snoozepod-builder__option-type">' + escapeHtml(option.typeLabel) + "</span>" : "") +
      '<span class="snoozepod-builder__option-price">' + escapeHtml(priceText) + "</span>" +
      "</span>" +
      '<span class="snoozepod-builder__option-title">' + escapeHtml(option.title) + "</span>" +
      (variantLabel ? '<span class="snoozepod-builder__option-subtitle">' + escapeHtml(variantLabel) + "</span>" : "") +
      "</span>" +
      '<span class="snoozepod-builder__option-check" aria-hidden="true"></span>' +
      "</span></button>"
    );
  }

  function renderSystemOption(option, selected, stepKey) {
    return (
      '<button type="button" class="snoozepod-builder__option' +
      (selected ? " is-selected" : "") +
      '" data-builder-option data-step="' +
      escapeHtml(stepKey) +
      '" data-value="' +
      escapeHtml(option.key) +
      '">' +
      '<span class="snoozepod-builder__option-copy">' +
      '<span><span class="snoozepod-builder__option-title">' +
      escapeHtml(option.title) +
      '</span><span class="snoozepod-builder__option-subtitle">' +
      escapeHtml(option.subtitle || "") +
      '</span></span><span class="snoozepod-builder__option-check" aria-hidden="true"></span></span></button>'
    );
  }

  function buildCartItems(mattressVariant, state, catalogs, sizeOptions) {
    const items = [];
    if (!mattressVariant || !mattressVariant.id) return items;

    items.push({
      id: Number(mattressVariant.id),
      quantity: 1,
      properties: {
        "SnoozePod Size": state.size || "",
        "SnoozePod Base Direction": (getSelectedOption("base", state, catalogs, sizeOptions) || {}).summaryLabel || "",
        "SnoozePod Motion Direction": isAdjustableBaseSelection(state, catalogs, sizeOptions)
          ? ((getSelectedOption("motion", state, catalogs, sizeOptions) || {}).summaryLabel || "")
          : "",
        "SnoozePod Protection Direction": (getSelectedOption("protection", state, catalogs, sizeOptions) || {}).summaryLabel || "",
        "SnoozePod Pillow Direction": (getSelectedOption("pillow", state, catalogs, sizeOptions) || {}).summaryLabel || "",
        "SnoozePod Bedding Direction": (getSelectedOption("bedding", state, catalogs, sizeOptions) || {}).summaryLabel || ""
      }
    });

    calculateAddonSelections(state, catalogs, sizeOptions).forEach(function (selection) {
      if (!selection.variant || !selection.variant.id) return;
      items.push({
        id: Number(selection.variant.id),
        quantity: 1
      });
    });

    return items;
  }

  function updateSleepFacts(state, catalogs, sizeOptions) {
    const motionEl = document.querySelector("[data-sleep-fact-motion]");
    if (!motionEl) return;

    const baseOption = getSelectedOption("base", state, catalogs, sizeOptions);
    const motionOption = getSelectedOption("motion", state, catalogs, sizeOptions);

    if (!baseOption) {
      motionEl.textContent = "Compatible with selected base setup";
      return;
    }

    if (baseOption.kind !== "product") {
      motionEl.textContent = baseOption.summaryLabel || baseOption.title;
      return;
    }

    if (baseOption.isAdjustable && motionOption) {
      motionEl.textContent = baseOption.title + " with " + (motionOption.summaryLabel || motionOption.title);
      return;
    }

    motionEl.textContent = baseOption.title;
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
      (sizeOptions[0] ? sizeOptions[0].key : "");

    const catalogs = {
      base: readCatalog(root, "base"),
      protection: readCatalog(root, "protection"),
      pillow: readCatalog(root, "pillow"),
      bedding: readCatalog(root, "bedding")
    };

    Object.keys(catalogs).forEach(function (stepKey) {
      catalogs[stepKey] = (catalogs[stepKey] || []).map(function (item) {
        return Object.assign({}, item, { stepKey: stepKey, kind: item.kind || "product" });
      });
    });

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
      bedding: "",
      hasManualInput: false,
      builderPlan: null,
      guidance: null
    };

    function setStepValue(stepKey, value) {
      state[stepKey] = value;

      if (stepKey === "base" && !isAdjustableBaseSelection(state, catalogs, sizeOptions)) {
        state.motion = "";
        if (state.currentStep === "motion") {
          state.currentStep = "protection";
        }
      }

      if (stepKey === "size") {
        const allowedMotionValues = allowedMotionOptionsForSize(value).map(function (option) {
          return option.key;
        });
        if (state.motion && allowedMotionValues.indexOf(state.motion) === -1) {
          state.motion = "";
        }
      }
    }

    function canProceed(stepKey) {
      if (stepKey === "review") return true;
      return Boolean(state[stepKey]);
    }

    function buildStepGuidance(stepKey) {
      return buildBuilderGuidanceText(stepKey, state.guidance);
    }

    function applyBuilderPlan(plan) {
      if (!plan) return;

      state.builderPlan = plan;
      state.guidance = {
        size: plan.size || "",
        baseKey: plan.baseKey || "",
        baseLabel: plan.baseLabel || "",
        motionKey: plan.motionKey || "",
        motionLabel: plan.motionLabel || "",
        sizeWarning: Array.isArray(plan.warnings)
          ? plan.warnings.find(function (warning) {
              return normalizeText(warning).indexOf("size") > -1 || normalizeText(warning).indexOf("product page") > -1;
            }) || ""
          : "",
        baseWarning: Array.isArray(plan.warnings)
          ? plan.warnings.find(function (warning) {
              return normalizeText(warning).indexOf("base") > -1;
            }) || ""
          : "",
        motionWarning: Array.isArray(plan.warnings)
          ? plan.warnings.find(function (warning) {
              return normalizeText(warning).indexOf("motion") > -1 || normalizeText(warning).indexOf("full split") > -1;
            }) || ""
          : "",
      };

      if (state.hasManualInput) {
        return;
      }

      if (plan.size && state.size === initialSize) {
        setStepValue("size", plan.size);
      }

      if (plan.baseKey && !state.base) {
        setStepValue("base", plan.baseKey);
      }

      if (plan.motionKey && !state.motion && isAdjustableBaseSelection(state, catalogs, sizeOptions)) {
        setStepValue("motion", plan.motionKey);
      }
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

      const options = getStepOptions(step.key, state, catalogs, sizeOptions);
      const realProductCount = options.filter(function (option) {
        return option.kind === "product";
      }).length;

      let markup = "";
      if (["base", "protection", "pillow", "bedding"].indexOf(step.key) > -1 && realProductCount === 0) {
        markup += '<div class="snoozepod-builder__catalog-empty">No products found for this step yet.</div>';
      }

      markup += options
        .map(function (option) {
          const selected = state[step.key] === option.key;
          if (option.kind === "product") {
            return renderProductOption(option, selected, state);
          }
          return renderSystemOption(option, selected, step.key);
        })
        .join("");

      els.options.innerHTML = markup;
    }

    function updateFormFields(mattressVariant) {
      if (!formFields) return;
      formFields.id.value = mattressVariant && mattressVariant.id ? String(mattressVariant.id) : "";
      formFields.size.value = state.size || "";
      formFields.base.value = ((getSelectedOption("base", state, catalogs, sizeOptions) || {}).summaryLabel || "");
      formFields.motion.value = isAdjustableBaseSelection(state, catalogs, sizeOptions)
        ? (((getSelectedOption("motion", state, catalogs, sizeOptions) || {}).summaryLabel || ""))
        : "";
      formFields.protection.value = ((getSelectedOption("protection", state, catalogs, sizeOptions) || {}).summaryLabel || "");
      formFields.pillow.value = ((getSelectedOption("pillow", state, catalogs, sizeOptions) || {}).summaryLabel || "");
      formFields.bedding.value = ((getSelectedOption("bedding", state, catalogs, sizeOptions) || {}).summaryLabel || "");
    }

    function renderSummary(productTitle, mattressVariant) {
      const rows = summaryRows(state, productTitle, catalogs, sizeOptions);
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

      const totalCents = calculateEstimatedTotalCents(mattressVariant, calculateAddonSelections(state, catalogs, sizeOptions));
      els.price.textContent = mattressVariant ? formatMoneyFromCents(totalCents) : "Choose a size";
    }

    function render() {
      const stepList = visibleSteps(state, catalogs, sizeOptions);
      if (!stepList.some(function (step) { return step.key === state.currentStep; })) {
        state.currentStep = stepList[0].key;
      }

      const currentIndex = stepList.findIndex(function (step) { return step.key === state.currentStep; });
      const currentStep = stepList[currentIndex];
      const mattressVariant = findVariantForSize(variants, state.size, sizeOptionIndex);
      const reviewing = currentStep.key === "review";

      els.progress.style.width = (((currentIndex + 1) / stepList.length) * 100) + "%";
      els.stepCount.textContent = "Step " + (currentIndex + 1) + " of " + stepList.length;
      els.stepLabel.textContent = currentStep.label;
      els.stepTitle.textContent = currentStep.title;
      els.stepCopy.textContent = [currentStep.copy, buildStepGuidance(currentStep.key)].filter(Boolean).join(" ");

      renderStepPills(stepList);
      renderOptions(currentStep);
      renderSummary(root.dataset.productTitle, mattressVariant);
      updateFormFields(mattressVariant);
      updateSleepFacts(state, catalogs, sizeOptions);

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
        const unavailable = !mattressVariant || mattressVariant.available === false;
        els.submit.disabled = unavailable;
        els.submit.textContent = unavailable ? "Selected size unavailable" : (root.dataset.addLabel || "Add SnoozePod to cart");
      }
    }

    root.addEventListener("click", function (event) {
      const optionButton = event.target.closest("[data-builder-option]");
      if (optionButton) {
        state.hasManualInput = true;
        setStepValue(optionButton.getAttribute("data-step"), optionButton.getAttribute("data-value"));
        render();
        return;
      }

      if (event.target.closest("[data-builder-back]")) {
        const stepList = visibleSteps(state, catalogs, sizeOptions);
        const currentIndex = stepList.findIndex(function (step) { return step.key === state.currentStep; });
        if (currentIndex > 0) {
          state.currentStep = stepList[currentIndex - 1].key;
          render();
        }
        return;
      }

      if (event.target.closest("[data-builder-next]")) {
        const stepList = visibleSteps(state, catalogs, sizeOptions);
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
        state.hasManualInput = false;
        if (state.builderPlan) {
          applyBuilderPlan(state.builderPlan);
        }
        render();
      }
    });

    if (els.form) {
      els.form.addEventListener("submit", async function (event) {
        const mattressVariant = findVariantForSize(variants, state.size, sizeOptionIndex);
        if (!mattressVariant || !window.fetch) return;

        event.preventDefault();

        const items = buildCartItems(mattressVariant, state, catalogs, sizeOptions);
        if (!items.length) {
          HTMLFormElement.prototype.submit.call(els.form);
          return;
        }

        const originalLabel = els.submit ? els.submit.textContent : "";
        if (els.submit) {
          els.submit.disabled = true;
          els.submit.textContent = "Adding...";
        }

        try {
          const response = await fetch((window.Shopify && Shopify.routes && Shopify.routes.root ? Shopify.routes.root : "/") + "cart/add.js", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: JSON.stringify({ items: items })
          });

          if (!response.ok) {
            throw new Error("Cart add failed");
          }

          window.location.href = (window.Shopify && Shopify.routes && Shopify.routes.cart_url) || "/cart";
        } catch (error) {
          if (els.submit) {
            els.submit.disabled = false;
            els.submit.textContent = originalLabel;
          }
          HTMLFormElement.prototype.submit.call(els.form);
        }
      });
    }

    render();
    resolveBuilderPlan(root, catalogs, sizeOptions).then(function (plan) {
      if (!plan) return;
      applyBuilderPlan(plan);
      render();
    });
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
