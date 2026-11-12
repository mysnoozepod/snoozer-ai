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
      copy: "Choose the recommended protector for this build, or skip it for now."
    },
    {
      key: "pillow",
      label: "Pillow",
      title: "Choose your pillow",
      copy: "Choose the recommended pillow for this build, or skip pillows for now."
    },
    {
      key: "bedding",
      label: "Bedding",
      title: "Choose your bedding",
      copy: "Choose the recommended bedding set for this build, or leave bedding out for now."
    },
    {
      key: "review",
      label: "Review",
      title: "Review Build",
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
      }
    ],
    pillow: [
      {
        key: "skip_pillow",
        title: "Skip pillow for now",
        summaryLabel: "Skip pillow for now",
        subtitle: "Leave pillows out of this pass."
      }
    ],
    bedding: [
      {
        key: "skip_bedding",
        title: "Skip bedding for now",
        summaryLabel: "Skip bedding for now",
        subtitle: "Leave bedding out of this pass."
      }
    ]
  };

  const SHARED_ASSESSMENT_KEY = "snooze.assessment";
  const SHARED_SHOPPER_KEY = "snooze.assessmentShopperId";
  const BUNDLE_OPERATION_PROPERTY = "_SnoozePod Bundle Operation";
  const BUNDLE_ROLE_PROPERTY = "_SnoozePod Bundle Role";
  const BUNDLE_LOCK_KEY = "snooze.podBuilderCartLock.v1";
  const CART_REQUEST_TIMEOUT_MS = 12000;

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

  function resolveAddonVariant(productOption, size) {
    if (!productOption || productOption.kind !== "product") return null;
    const variants = Array.isArray(productOption.variants) ? productOption.variants : [];
    if (!variants.length) return null;

    if (productOption.exactVariantId) {
      return variants.find(function (variant) {
        return variant && String(variant.id) === String(productOption.exactVariantId) && variant.available !== false;
      }) || null;
    }

    const availableVariants = variants.filter(function (variant) {
      return variant && variant.available !== false;
    });
    if (!size) return availableVariants.length === 1 ? availableVariants[0] : null;

    let bestScore = 0;
    let bestVariants = [];

    availableVariants.forEach(function (variant) {
      if (!variant) return;
      const score = variantMatchScore(variant, size);
      if (score > bestScore) {
        bestScore = score;
        bestVariants = [variant];
      } else if (score > 0 && score === bestScore) {
        bestVariants.push(variant);
      }
    });

    return bestScore > 0 && bestVariants.length === 1 ? bestVariants[0] : null;
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

  function exactVariantCatalogOptions(stepKey, options, state) {
    if (!Array.isArray(options)) return [];
    if (["protection", "pillow", "bedding"].indexOf(stepKey) === -1) return options;

    return options.flatMap(function (option) {
      if (!option || option.kind !== "product") return option ? [option] : [];
      const variants = Array.isArray(option.variants) ? option.variants : [];
      return variants
        .filter(function (variant) {
          if (!variant || variant.available === false) return false;
          if (stepKey === "pillow") return true;
          return !state.size || variantMatchScore(variant, state.size) > 0;
        })
        .map(function (variant) {
          const variantLabel = variant.title && variant.title !== "Default Title" ? variant.title : "";
          return Object.assign({}, option, {
            key: option.key + "::" + String(variant.id),
            exactVariantId: variant.id,
            variants: [variant],
            summaryLabel: variantLabel ? option.title + " — " + variantLabel : option.title
          });
        });
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
        return exactVariantCatalogOptions("protection", catalogs.protection || [], state).concat(SYSTEM_OPTIONS.protection);
      case "pillow":
        return exactVariantCatalogOptions("pillow", catalogs.pillow || [], state).concat(SYSTEM_OPTIONS.pillow);
      case "bedding":
        return exactVariantCatalogOptions("bedding", catalogs.bedding || [], state).concat(SYSTEM_OPTIONS.bedding);
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

  function createBundleOperationId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return "snoozepod-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  function normalizeLineProperties(properties) {
    const normalized = {};
    Object.keys(properties || {}).sort().forEach(function (key) {
      const value = properties[key];
      if (value == null || value === "") return;
      normalized[String(key)] = String(value);
    });
    return normalized;
  }

  function normalizeSellingPlanId(item) {
    const allocation = item && item.selling_plan_allocation;
    const allocationPlan = allocation && allocation.selling_plan;
    return String(
      (item && (item.selling_plan || item.sellingPlanId)) ||
      (allocationPlan && allocationPlan.id) ||
      ""
    );
  }

  function cartLineIdentity(item) {
    const variantId = String(item && (item.variant_id || item.id) ? (item.variant_id || item.id) : "");
    const sellingPlanId = normalizeSellingPlanId(item);
    const properties = normalizeLineProperties(item && item.properties);
    return variantId + "::" + sellingPlanId + "::" + JSON.stringify(properties);
  }

  function requestFingerprint(items) {
    return JSON.stringify((items || []).map(function (item) {
      const publicProperties = normalizeLineProperties(item.properties);
      delete publicProperties[BUNDLE_OPERATION_PROPERTY];
      return {
        id: String(item.id || ""),
        quantity: Number(item.quantity || 0),
        role: String(item.role || ""),
        sellingPlanId: normalizeSellingPlanId(item),
        properties: publicProperties
      };
    }).sort(function (left, right) {
      return JSON.stringify(left).localeCompare(JSON.stringify(right));
    }));
  }

  function createBundleRequestPlan(rawItems, operationId) {
    const bundleOperationId = String(operationId || createBundleOperationId());
    const aggregated = new Map();

    (rawItems || []).forEach(function (rawItem) {
      const role = String(rawItem && rawItem.role ? rawItem.role : "component");
      const properties = Object.assign({}, normalizeLineProperties(rawItem && rawItem.properties), {
        [BUNDLE_OPERATION_PROPERTY]: bundleOperationId,
        [BUNDLE_ROLE_PROPERTY]: role
      });
      const item = {
        id: String(rawItem && rawItem.id ? rawItem.id : ""),
        quantity: Number(rawItem && rawItem.quantity ? rawItem.quantity : 0),
        role: role,
        productHandle: String(rawItem && rawItem.productHandle ? rawItem.productHandle : ""),
        available: !(rawItem && rawItem.available === false),
        compatibilityStatus: String(rawItem && rawItem.compatibilityStatus ? rawItem.compatibilityStatus : ""),
        publicationReadiness: String(rawItem && rawItem.publicationReadiness ? rawItem.publicationReadiness : ""),
        properties: properties
      };

      const sellingPlanId = normalizeSellingPlanId(rawItem);
      if (sellingPlanId) item.selling_plan = sellingPlanId;

      const identity = cartLineIdentity(item);
      const existing = aggregated.get(identity);
      if (existing) {
        existing.quantity += item.quantity;
        return;
      }
      aggregated.set(identity, item);
    });

    const items = Array.from(aggregated.values()).map(function (item) {
      item.properties = Object.freeze(Object.assign({}, item.properties));
      return Object.freeze(item);
    });
    const fingerprint = requestFingerprint(items);

    return Object.freeze({
      operationId: bundleOperationId,
      fingerprint: fingerprint,
      items: Object.freeze(items),
      createdAt: new Date().toISOString()
    });
  }

  function buildBundleRequestPlan(mattressVariant, state, catalogs, sizeOptions, options) {
    const config = options || {};
    const rawItems = [];
    if (!mattressVariant || !mattressVariant.id) {
      return createBundleRequestPlan(rawItems, config.operationId);
    }

    rawItems.push({
      id: mattressVariant.id,
      quantity: 1,
      role: "mattress",
      productHandle: config.mattressHandle || "",
      available: mattressVariant.available !== false,
      compatibilityStatus: mattressVariant.compatibilityStatus || mattressVariant.compatibility_status || "",
      publicationReadiness: mattressVariant.publicationReadiness || mattressVariant.publication_readiness || "",
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
      rawItems.push({
        id: selection.variant.id,
        quantity: 1,
        role: selection.stepKey,
        productHandle: selection.option.handle || "",
        available: selection.variant.available !== false,
        compatibilityStatus:
          selection.variant.compatibilityStatus ||
          selection.variant.compatibility_status ||
          selection.option.compatibilityStatus ||
          selection.option.compatibility_status ||
          "",
        publicationReadiness:
          selection.variant.publicationReadiness ||
          selection.variant.publication_readiness ||
          selection.option.publicationReadiness ||
          selection.option.publication_readiness ||
          ""
      });
    });

    return createBundleRequestPlan(rawItems, config.operationId);
  }

  function validateBundleRequestPlan(plan) {
    const errors = [];
    if (!plan || !plan.operationId || !Array.isArray(plan.items) || !plan.items.length) {
      return ["The selected build does not contain any valid cart items."];
    }

    plan.items.forEach(function (item) {
      const role = item.role || "component";
      if (!/^\d+$/.test(String(item.id || ""))) {
        errors.push(role + " is missing a valid Shopify variant ID.");
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        errors.push(role + " has an invalid quantity.");
      }
      if (item.available === false) {
        errors.push(role + " is no longer available.");
      }
      const compatibilityStatus = normalizeText(item.compatibilityStatus);
      if (["pending verification", "unsupported", "incompatible", "not verified"].indexOf(compatibilityStatus) > -1) {
        errors.push(role + " is not confirmed compatible.");
      }
      const readiness = normalizeText(item.publicationReadiness);
      if (readiness && readiness !== "ready" && readiness !== "live verified") {
        errors.push(role + " is not ready for cart submission.");
      }
      if (!item.properties || item.properties[BUNDLE_OPERATION_PROPERTY] !== plan.operationId) {
        errors.push(role + " is missing its bundle operation identity.");
      }
    });

    return errors;
  }

  function cartQuantityByIdentity(cart) {
    const quantities = new Map();
    (cart && Array.isArray(cart.items) ? cart.items : []).forEach(function (line) {
      const identity = cartLineIdentity(line);
      const quantity = Number(line && line.quantity ? line.quantity : 0);
      quantities.set(identity, (quantities.get(identity) || 0) + quantity);
    });
    return quantities;
  }

  function reconcileBundleCart(plan, cart) {
    const cartQuantities = cartQuantityByIdentity(cart);
    const items = plan.items.map(function (item) {
      const identity = cartLineIdentity(item);
      const confirmedQuantity = cartQuantities.get(identity) || 0;
      const missingQuantity = Math.max(0, item.quantity - confirmedQuantity);
      return {
        identity: identity,
        id: item.id,
        role: item.role,
        requestedQuantity: item.quantity,
        confirmedQuantity: Math.min(item.quantity, confirmedQuantity),
        missingQuantity: missingQuantity,
        complete: missingQuantity === 0
      };
    });
    const confirmedQuantity = items.reduce(function (total, item) {
      return total + item.confirmedQuantity;
    }, 0);
    const requestedQuantity = items.reduce(function (total, item) {
      return total + item.requestedQuantity;
    }, 0);

    return {
      complete: items.length > 0 && items.every(function (item) { return item.complete; }),
      partial: confirmedQuantity > 0 && confirmedQuantity < requestedQuantity,
      requestedQuantity: requestedQuantity,
      confirmedQuantity: confirmedQuantity,
      items: items
    };
  }

  function missingRequestItems(plan, reconciliation) {
    return reconciliation.items.filter(function (resultItem) {
      return resultItem.missingQuantity > 0;
    }).map(function (resultItem) {
      const plannedItem = plan.items.find(function (item) {
        return cartLineIdentity(item) === resultItem.identity;
      });
      const requestItem = {
        id: plannedItem.id,
        quantity: resultItem.missingQuantity,
        properties: Object.assign({}, plannedItem.properties)
      };
      if (plannedItem.selling_plan) requestItem.selling_plan = plannedItem.selling_plan;
      return requestItem;
    });
  }

  function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
    const duration = Math.max(1, Number(timeoutMs || CART_REQUEST_TIMEOUT_MS));
    let timeoutId;
    const timeout = new Promise(function (_, reject) {
      timeoutId = setTimeout(function () {
        reject(new Error("Cart request timed out"));
      }, duration);
    });

    return Promise.race([fetchImpl(url, options), timeout]).finally(function () {
      clearTimeout(timeoutId);
    });
  }

  async function readCartState(fetchImpl, cartUrl, timeoutMs) {
    const response = await fetchWithTimeout(fetchImpl, cartUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store"
    }, timeoutMs);
    if (!response || !response.ok) throw new Error("Cart read failed");
    const cart = await response.json();
    if (!cart || !Array.isArray(cart.items)) throw new Error("Cart response was invalid");
    return cart;
  }

  async function verifyBundleVariantReadiness(plan, fetchImpl, rootUrl, timeoutMs) {
    const errors = [];
    const productCache = new Map();

    for (const item of plan.items) {
      if (!item.productHandle) {
        errors.push(item.role + " is missing its Shopify product handle.");
        continue;
      }
      if (!productCache.has(item.productHandle)) {
        const url = rootUrl + "products/" + encodeURIComponent(item.productHandle) + ".js";
        try {
          const response = await fetchWithTimeout(fetchImpl, url, {
            method: "GET",
            headers: { Accept: "application/json" },
            credentials: "same-origin",
            cache: "no-store"
          }, timeoutMs);
          if (!response || !response.ok) throw new Error("Product read failed");
          const product = await response.json();
          if (!product || !Array.isArray(product.variants)) throw new Error("Product response was invalid");
          productCache.set(item.productHandle, product);
        } catch (error) {
          productCache.set(item.productHandle, null);
        }
      }

      const product = productCache.get(item.productHandle);
      if (!product) {
        errors.push(item.role + " availability could not be verified.");
        continue;
      }
      const liveVariant = product.variants.find(function (variant) {
        return String(variant && variant.id ? variant.id : "") === String(item.id);
      });
      if (!liveVariant) {
        errors.push(item.role + " is no longer offered by the selected product.");
      } else if (liveVariant.available === false) {
        errors.push(item.role + " is no longer available.");
      }
    }

    return { ok: errors.length === 0, errors: errors };
  }

  async function executeBundleCartOperation(plan, fetchImpl, routes, options) {
    const config = options || {};
    const validationErrors = validateBundleRequestPlan(plan);
    if (validationErrors.length) {
      return { status: "failed", stage: "validation", errors: validationErrors, mutationAttempted: false };
    }

    let beforeCart;
    try {
      beforeCart = await readCartState(fetchImpl, routes.cart, config.timeoutMs);
    } catch (error) {
      return {
        status: "failed",
        stage: "preflight",
        errors: ["The cart could not be checked before adding this build."],
        mutationAttempted: false
      };
    }

    const before = reconcileBundleCart(plan, beforeCart);
    if (before.complete) {
      return { status: "success", stage: "reconciled", reconciliation: before, mutationAttempted: false };
    }

    const itemsToAdd = missingRequestItems(plan, before);
    let addResponseOk = false;
    let addResponseMalformed = false;
    let addError = null;
    try {
      const response = await fetchWithTimeout(fetchImpl, routes.add, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        credentials: "same-origin",
        body: JSON.stringify({ items: itemsToAdd })
      }, config.timeoutMs);
      addResponseOk = Boolean(response && response.ok);
      if (response && typeof response.json === "function") {
        try {
          await response.json();
        } catch (error) {
          addResponseMalformed = true;
        }
      }
    } catch (error) {
      addError = error;
    }

    let afterCart;
    try {
      afterCart = await readCartState(fetchImpl, routes.cart, config.timeoutMs);
    } catch (error) {
      return {
        status: "uncertain",
        stage: "reconciliation",
        addResponseOk: addResponseOk,
        addResponseMalformed: addResponseMalformed,
        addError: addError,
        mutationAttempted: true
      };
    }

    const after = reconcileBundleCart(plan, afterCart);
    if (after.complete) {
      return {
        status: "success",
        stage: "reconciled",
        reconciliation: after,
        addResponseOk: addResponseOk,
        addResponseMalformed: addResponseMalformed,
        addError: addError,
        mutationAttempted: true
      };
    }

    return {
      status: after.confirmedQuantity > 0 ? "partial" : "failed",
      stage: "reconciled",
      reconciliation: after,
      addResponseOk: addResponseOk,
      addResponseMalformed: addResponseMalformed,
      addError: addError,
      mutationAttempted: true
    };
  }

  function safeLocalStorage() {
    try {
      return window.localStorage || null;
    } catch (error) {
      return null;
    }
  }

  function claimBundleLock(plan, storage, now) {
    if (!storage) return true;
    const currentTime = Number(now || Date.now());
    try {
      const current = parseJson(storage.getItem(BUNDLE_LOCK_KEY) || "{}", {});
      if (
        current.expiresAt > currentTime &&
        current.fingerprint === plan.fingerprint &&
        current.operationId !== plan.operationId
      ) {
        return false;
      }
      storage.setItem(BUNDLE_LOCK_KEY, JSON.stringify({
        operationId: plan.operationId,
        fingerprint: plan.fingerprint,
        expiresAt: currentTime + 120000
      }));
      const claimed = parseJson(storage.getItem(BUNDLE_LOCK_KEY) || "{}", {});
      return claimed.operationId === plan.operationId;
    } catch (error) {
      return true;
    }
  }

  function retainBundleLock(plan, storage, durationMs, now) {
    if (!storage || !plan) return;
    try {
      storage.setItem(BUNDLE_LOCK_KEY, JSON.stringify({
        operationId: plan.operationId,
        fingerprint: plan.fingerprint,
        expiresAt: Number(now || Date.now()) + Number(durationMs || 0)
      }));
    } catch (error) {
      // Same-tab submission protection remains active even when storage is unavailable.
    }
  }

  function cartResultMessage(result) {
    if (result && result.status === "success") {
      return "Your complete SnoozePod was verified in the cart.";
    }
    if (result && result.status === "partial") {
      const missing = (result.reconciliation && result.reconciliation.items || [])
        .filter(function (item) { return item.missingQuantity > 0; })
        .map(function (item) { return item.role; });
      return "Your SnoozePod was not fully added" +
        (missing.length ? ". Missing: " + missing.join(", ") : "") +
        ". Your selections are still here. Review your cart before trying again.";
    }
    if (result && result.status === "uncertain") {
      return "We couldn't verify the cart. It may contain part of your selection. Your selections are still here. Check your cart before trying again.";
    }
    if (result && result.status === "concurrent") {
      return "This SnoozePod is already being added in another tab. Wait for that attempt to finish, then check your cart.";
    }
    const reason = result && Array.isArray(result.errors) && result.errors[0]
      ? " " + result.errors[0]
      : "";
    return "We couldn't add this SnoozePod. Nothing was confirmed as added." + reason +
      " Your selections are still here. Review them and try again.";
  }

  function renderCartStatus(statusElement, result) {
    if (!statusElement) return;
    if (!result) {
      statusElement.hidden = true;
      statusElement.textContent = "";
      statusElement.removeAttribute("data-status");
      return;
    }

    statusElement.hidden = false;
    statusElement.setAttribute("data-status", result.status || "failed");
    statusElement.textContent = cartResultMessage(result);
    if (result.status !== "success" && typeof statusElement.focus === "function") {
      statusElement.focus();
    }
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
      cartStatus: root.querySelector("[data-builder-cart-status]"),
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
      guidance: null,
      cartPlan: null,
      isSubmitting: false
    };

    function setStepValue(stepKey, value) {
      state[stepKey] = value;
      state.cartPlan = null;
      renderCartStatus(els.cartStatus, null);

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

        ["base", "protection", "bedding"].forEach(function (dependentStep) {
          if (!state[dependentStep]) return;
          const selected = getSelectedOption(dependentStep, state, catalogs, sizeOptions);
          if (!selected || (selected.kind === "product" && !resolveAddonVariant(selected, value))) {
            state[dependentStep] = "";
          }
        });
      }
    }

    function canProceed(stepKey) {
      if (stepKey === "review") return true;
      if (!state[stepKey]) return false;
      if (["base", "protection", "pillow", "bedding"].indexOf(stepKey) === -1) return true;
      const selected = getSelectedOption(stepKey, state, catalogs, sizeOptions);
      return Boolean(selected && (selected.kind !== "product" || resolveAddonVariant(selected, stepKey === "pillow" ? "" : state.size)));
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
        els.next.textContent = nextStep && nextStep.key === "review" ? "Review Build" : "Next";
      }

      if (els.submit) {
        const unavailable = !mattressVariant || mattressVariant.available === false;
        els.submit.disabled = unavailable;
        els.submit.textContent = unavailable ? "Selected size unavailable" : (root.dataset.addLabel || "Add SnoozePod to cart");
      }
    }

    root.addEventListener("click", function (event) {
      if (state.isSubmitting && event.target.closest("[data-builder-reset], [data-builder-option], [data-builder-back], [data-builder-next]")) {
        return;
      }

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
        state.cartPlan = null;
        renderCartStatus(els.cartStatus, null);
        if (state.builderPlan) {
          applyBuilderPlan(state.builderPlan);
        }
        render();
      }
    });

    if (els.form) {
      els.form.addEventListener("submit", async function (event) {
        event.preventDefault();
        if (state.isSubmitting) return;

        const mattressVariant = findVariantForSize(variants, state.size, sizeOptionIndex);
        if (!mattressVariant || !window.fetch) {
          renderCartStatus(els.cartStatus, { status: "failed", stage: "validation" });
          return;
        }

        const freshPlan = buildBundleRequestPlan(mattressVariant, state, catalogs, sizeOptions, {
          mattressHandle: root.dataset.productHandle || ""
        });
        const plan = state.cartPlan && state.cartPlan.fingerprint === freshPlan.fingerprint
          ? state.cartPlan
          : freshPlan;
        state.cartPlan = plan;

        const validationErrors = validateBundleRequestPlan(plan);
        if (validationErrors.length) {
          renderCartStatus(els.cartStatus, {
            status: "failed",
            stage: "validation",
            errors: validationErrors
          });
          return;
        }

        const storage = safeLocalStorage();
        if (!claimBundleLock(plan, storage)) {
          renderCartStatus(els.cartStatus, { status: "concurrent", stage: "lock" });
          return;
        }

        state.isSubmitting = true;
        const originalLabel = els.submit ? els.submit.textContent : "";
        if (els.submit) {
          els.submit.disabled = true;
          els.submit.textContent = "Adding and verifying...";
        }
        if (els.reset) els.reset.disabled = true;
        if (els.cartStatus) {
          els.cartStatus.hidden = false;
          els.cartStatus.setAttribute("data-status", "pending");
          els.cartStatus.textContent = "Adding and verifying your complete SnoozePod.";
        }

        try {
          const shopifyRoot = window.Shopify && Shopify.routes && Shopify.routes.root
            ? Shopify.routes.root
            : "/";
          const readiness = await verifyBundleVariantReadiness(
            plan,
            window.fetch.bind(window),
            shopifyRoot,
            CART_REQUEST_TIMEOUT_MS
          );
          let result;
          if (!readiness.ok) {
            result = {
              status: "failed",
              stage: "availability",
              errors: readiness.errors,
              mutationAttempted: false
            };
          } else {
            result = await executeBundleCartOperation(
              plan,
              window.fetch.bind(window),
              {
                add: shopifyRoot + "cart/add.js",
                cart: shopifyRoot + "cart.js"
              },
              { timeoutMs: CART_REQUEST_TIMEOUT_MS }
            );
          }

          renderCartStatus(els.cartStatus, result);
          if (result.status === "success") {
            retainBundleLock(plan, storage, 15000);
            window.location.href = (window.Shopify && Shopify.routes && Shopify.routes.cart_url) || "/cart";
            return;
          }

          retainBundleLock(plan, storage, result.status === "failed" ? 60000 : 120000);
        } catch (error) {
          renderCartStatus(els.cartStatus, { status: "uncertain", stage: "unexpected" });
          retainBundleLock(plan, storage, 120000);
        } finally {
          state.isSubmitting = false;
          if (els.submit) {
            els.submit.disabled = false;
            els.submit.textContent = originalLabel;
          }
          if (els.reset) els.reset.disabled = false;
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

  window.SnoozePodBundleCart = Object.freeze({
    createBundleRequestPlan: createBundleRequestPlan,
    validateBundleRequestPlan: validateBundleRequestPlan,
    verifyBundleVariantReadiness: verifyBundleVariantReadiness,
    executeBundleCartOperation: executeBundleCartOperation,
    claimBundleLock: claimBundleLock,
    retainBundleLock: retainBundleLock,
    renderCartStatus: renderCartStatus
  });

  document.addEventListener("DOMContentLoaded", initAll);
  document.addEventListener("shopify:section:load", function (event) {
    const root = event.target && event.target.querySelector ? event.target.querySelector("[data-snoozepod-builder]") : null;
    if (root) initBuilder(root);
  });
})();
