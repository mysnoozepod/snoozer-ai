(function () {
  const STORAGE_NAMESPACE = "snooze.assessment.page.v2";
  const SHARED_RESULTS_KEY = "snooze.recommendedProductHandles";
  const SHARED_ANSWERS_KEY = "snooze.assessment";
  const SHARED_SUMMARY_KEY = "snooze.assessmentSummary";
  const DEFAULT_SHOPPER_KEY = "snooze.assessmentShopperId";

  const HANDLES = {
    mattresses: {
      dualComfort: "12-dual-comfort-hybrid",
      hybrid14: "14-hybrid",
      allFoam12: "12-all-foam-mattress",
      allFoam10: "10-all-foam-mattress",
    },
    bases: {
      adjustable: "premium-motion-adjustable-base",
      storage: "storage-base",
      platform: "platform-base",
    },
  };

  const SIZE_OPTIONS = ["Twin", "Full", "Queen", "King"];
  const BASE_OPTIONS = ["Mattress Only", "Platform Base", "Adjustable Base"];
  const MOTION_OPTIONS = ["Standard Motion", "Half Split Motion", "Full Split Motion"];
  const NO_MOTION_LABEL = "No Motion";

  const MOTION_DESCRIPTIONS = {
    "Standard Motion": "Both sides elevate together in sync.",
    "Half Split Motion": "Separate head adjustment with the feet moving together.",
    "Full Split Motion": "Each side moves independently at the head and foot.",
  };

  const PRODUCT_BLURBS = {
    "14-hybrid": "A stronger starting point if you want lift, airflow, and support together.",
    "12-dual-comfort-hybrid": "A better couple-friendly option when both sides need more flexibility.",
    "12-all-foam-mattress": "A contouring all-foam option when pressure relief matters most.",
    "10-all-foam-mattress": "A simpler value-first all-foam option for a steadier feel.",
    "premium-motion-adjustable-base": "Compare elevation and motion flexibility alongside your mattress fit.",
    "platform-base": "A simpler non-motion base path if you want a steadier foundation.",
    "storage-base": "A storage base is worth comparing if you want a non-motion foundation with utility built in.",
  };

  const FALLBACK_QUESTIONS = [
    {
      id: "size",
      text: "First up: what mattress size are you leaning toward?",
      options: SIZE_OPTIONS,
      required: true,
    },
    {
      id: "sleepPartner",
      text: "Do you regularly share the bed with a partner?",
      options: ["Yes", "No"],
      required: true,
    },
    {
      id: "sleepPosition",
      text: "How do you mostly sleep: on your side, back, stomach, or a mix?",
      options: ["Side", "Back", "Stomach", "Mix / Combination"],
      required: true,
    },
    {
      id: "motionSensitivity",
      text: "How sensitive are you to movement in the bed?",
      options: [
        "Low — movement rarely bothers me",
        "Medium — I notice it but can deal with it",
        "High — I wake up easily from movement",
      ],
      required: true,
    },
    {
      id: "temperature",
      text: "Do you usually sleep hot, cold, or pretty neutral at night?",
      options: ["Hot", "Cold", "Neutral"],
      required: true,
    },
    {
      id: "firmness",
      text: "If you had to choose, do you lean soft, medium, or firm for comfort?",
      options: ["Soft", "Medium", "Firm"],
      required: true,
    },
    {
      id: "snore",
      text: "Do you personally snore or use a CPAP / sleep apnea device?",
      options: ["Yes", "No", "Not sure"],
      required: false,
    },
    {
      id: "painPoints",
      text: "Any back pain, pressure points, or other issues you hope the mattress can help with?",
      options: [
        "Lower back",
        "Upper back",
        "Hips",
        "Shoulders",
        "Neck",
        "Sciatica",
        "General pressure relief",
        "Other / not listed",
      ],
      multi: true,
      required: false,
      note: "Choose any that matter, then continue.",
    },
    {
      id: "partnerSleepPosition",
      text: "How does your partner mostly sleep: on their side, back, stomach, or a mix?",
      options: ["Side", "Back", "Stomach", "Mix / Combination", "Not sure"],
      required: false,
      dependsOn: { question: "sleepPartner", value: "Yes" },
    },
    {
      id: "partnerMotionSensitivity",
      text: "How sensitive is your partner to movement in the bed?",
      options: [
        "Low — movement rarely bothers them",
        "Medium — they notice it but can deal with it",
        "High — they wake up easily from movement",
        "Not sure",
      ],
      required: false,
      dependsOn: { question: "sleepPartner", value: "Yes" },
    },
    {
      id: "partnerTemperature",
      text: "Does your partner usually sleep hot, cold, or neutral at night?",
      options: ["Hot", "Cold", "Neutral", "Not sure"],
      required: false,
      dependsOn: { question: "sleepPartner", value: "Yes" },
    },
    {
      id: "partnerFirmness",
      text: "If your partner could pick their own feel, would they lean soft, medium, or firm?",
      options: ["Soft", "Medium", "Firm", "Not sure"],
      required: false,
      dependsOn: { question: "sleepPartner", value: "Yes" },
    },
    {
      id: "partnerPainPoints",
      text: "Does your partner have any pain or pressure points they care about?",
      options: [
        "Lower back",
        "Upper back",
        "Hips",
        "Shoulders",
        "Neck",
        "Sciatica",
        "General pressure relief",
        "Other / not listed",
        "Not sure",
      ],
      multi: true,
      required: false,
      dependsOn: { question: "sleepPartner", value: "Yes" },
    },
    {
      id: "partnerSnore",
      text: "Does your partner snore or use a CPAP / sleep apnea device?",
      options: ["Yes", "No", "Not sure"],
      required: false,
      dependsOn: { question: "sleepPartner", value: "Yes" },
    },
  ];

  const CANONICAL_SIZE_QUESTION = {
    id: "size",
    text: "What size are you shopping for?",
    options: SIZE_OPTIONS,
    required: true,
  };

  const CANONICAL_BASE_QUESTION = {
    id: "baseType",
    text: "What kind of base setup do you want?",
    options: BASE_OPTIONS,
    required: true,
  };

  const CANONICAL_MOTION_QUESTION = {
    id: "motionMode",
    text: "Choose your motion style.",
    options: MOTION_OPTIONS,
    required: true,
    dependsOn: { question: "baseType", value: "Adjustable Base" },
  };

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  function normalizeKey(value) {
    return normalizeText(value).toLowerCase();
  }

  function lower(value) {
    return normalizeKey(value);
  }

  function slugify(value) {
    return normalizeKey(value)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function safeSessionGet(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return "";
    }
  }

  function safeSessionSet(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }

  function normalizeApiBase(value) {
    const trimmed = normalizeText(value);
    if (!trimmed) return "";
    return trimmed.replace(/\/+$/, "");
  }

  function getApiBase(root) {
    const docValue = document.documentElement.getAttribute("data-snoozer-api-base");
    const rootValue = root ? root.getAttribute("data-assessment-api-base") : "";
    const globalConfig = window.MySnoozePod || {};
    const candidates = [
      rootValue,
      globalConfig.apiBase,
      globalConfig.api_base,
      window.__SNOOZER_API_BASE__,
      docValue,
    ];

    for (let index = 0; index < candidates.length; index += 1) {
      const normalized = normalizeApiBase(candidates[index]);
      if (normalized) return normalized;
    }

    return "";
  }

  function buildApiUrl(root, path) {
    const base = getApiBase(root);
    const cleanPath = String(path || "").startsWith("/") ? String(path || "") : "/" + String(path || "");
    if (base) return base + cleanPath;
    return cleanPath.startsWith("/api/") ? cleanPath : "/api" + cleanPath;
  }

  function createShopperId(sectionId) {
    const existing = safeSessionGet(DEFAULT_SHOPPER_KEY);
    if (existing) return existing;
    const generated = [
      "shopify-assessment",
      sectionId || "page",
      Date.now(),
      Math.random().toString(36).slice(2, 8),
    ].join("-");
    safeSessionSet(DEFAULT_SHOPPER_KEY, generated);
    return generated;
  }

  function isMultiQuestion(question) {
    return Boolean(question && (question.multi === true || normalizeKey(question.zohoType) === "multiselect"));
  }

  function isRequired(question) {
    return Boolean(question && question.required === true);
  }

  function normalizeOptionList(options) {
    return Array.isArray(options) ? options.map(normalizeText).filter(Boolean) : [];
  }

  function isBudgetQuestion(question) {
    const id = normalizeKey(question && question.id);
    const text = normalizeKey(question && question.text);
    return (
      id === "budget" ||
      id === "budgetmax" ||
      id === "priceceiling" ||
      text.indexOf("budget") !== -1 ||
      text.indexOf("price range") !== -1 ||
      text.indexOf("price ceiling") !== -1
    );
  }

  function isSizeQuestion(question) {
    const id = normalizeKey(question && question.id);
    const text = normalizeKey(question && question.text);
    return id === "size" || text.indexOf("what size") !== -1 || text.indexOf("mattress size") !== -1;
  }

  function isBaseQuestion(question) {
    const id = normalizeKey(question && question.id);
    const text = normalizeKey(question && question.text);
    return (
      id === "basetype" ||
      id === "base" ||
      id === "baseselection" ||
      id === "foundation" ||
      text.indexOf("base setup") !== -1 ||
      text.indexOf("platform base") !== -1 ||
      text.indexOf("adjustable base") !== -1 ||
      text.indexOf("mattress only") !== -1 ||
      text.indexOf("no base") !== -1
    );
  }

  function isMotionQuestion(question) {
    const id = normalizeKey(question && question.id);
    const text = normalizeKey(question && question.text);
    return (
      id === "motionmode" ||
      id === "motion" ||
      text.indexOf("motion style") !== -1 ||
      text.indexOf("standard motion") !== -1 ||
      text.indexOf("half split motion") !== -1 ||
      text.indexOf("full split motion") !== -1
    );
  }

  function canonicalizeQuestion(question) {
    if (!question) return null;

    const normalized = {
      id: normalizeText(question.id),
      text: normalizeText(question.text),
      options: normalizeOptionList(question.options),
      required: question.required === true,
      multi: isMultiQuestion(question),
      zohoType: normalizeText(question.zohoType),
      dependsOn: question.dependsOn || null,
      note: normalizeText(question.note || ""),
    };

    if (!normalized.id || !normalized.text || !normalized.options.length || isBudgetQuestion(normalized)) {
      return null;
    }

    if (isSizeQuestion(normalized)) {
      return {
        ...normalized,
        ...CANONICAL_SIZE_QUESTION,
      };
    }

    if (isBaseQuestion(normalized)) {
      return {
        ...normalized,
        ...CANONICAL_BASE_QUESTION,
      };
    }

    if (isMotionQuestion(normalized)) {
      return {
        ...normalized,
        ...CANONICAL_MOTION_QUESTION,
      };
    }

    return normalized;
  }

  function buildQuestionFlow(rawQuestions) {
    const source = (Array.isArray(rawQuestions) && rawQuestions.length ? rawQuestions : FALLBACK_QUESTIONS)
      .map(canonicalizeQuestion)
      .filter(Boolean);

    let sizeQuestion = null;
    let baseQuestion = null;
    let motionQuestion = null;
    const rest = [];

    source.forEach(function (question) {
      if (!sizeQuestion && question.id === "size") {
        sizeQuestion = { ...CANONICAL_SIZE_QUESTION, ...question };
        return;
      }
      if (!baseQuestion && question.id === "baseType") {
        baseQuestion = { ...CANONICAL_BASE_QUESTION, ...question };
        return;
      }
      if (!motionQuestion && question.id === "motionMode") {
        motionQuestion = { ...CANONICAL_MOTION_QUESTION, ...question };
        return;
      }
      if (question.id === "size" || question.id === "baseType" || question.id === "motionMode") {
        return;
      }
      if (isSizeQuestion(question) || isBaseQuestion(question) || isMotionQuestion(question)) {
        return;
      }
      rest.push(question);
    });

    return [
      sizeQuestion || CANONICAL_SIZE_QUESTION,
      baseQuestion || CANONICAL_BASE_QUESTION,
      motionQuestion || CANONICAL_MOTION_QUESTION,
    ].concat(rest);
  }

  function dependsOnMatches(question, answers) {
    if (!question || !question.dependsOn) return true;
    const dependency = question.dependsOn;
    const current = answers[dependency.question];
    const expected = dependency.value;

    if (Array.isArray(current)) {
      return current.indexOf(expected) !== -1;
    }

    return normalizeKey(current) === normalizeKey(expected);
  }

  function getVisibleQuestions(questions, answers) {
    return questions.filter(function (question) {
      if (question.id === "motionMode") {
        return normalizeText(answers.baseType) === "Adjustable Base";
      }
      return dependsOnMatches(question, answers);
    });
  }

  function questionIsAnswered(question, value) {
    if (isMultiQuestion(question)) {
      return Array.isArray(value) && value.length > 0;
    }
    return normalizeText(value) !== "";
  }

  function cleanAnswers(questions, answers) {
    const visible = getVisibleQuestions(questions, answers);
    const keep = new Set(
      visible
        .filter(function (question) { return questionIsAnswered(question, answers[question.id]); })
        .map(function (question) { return question.id; })
    );
    const next = {};

    Object.keys(answers || {}).forEach(function (key) {
      if (!keep.has(key)) return;
      const question = visible.find(function (item) { return item.id === key; });
      const value = answers[key];
      next[key] = Array.isArray(value) ? value.slice() : value;
      if (!questionIsAnswered(question, value)) {
        delete next[key];
      }
    });

    if (normalizeText(next.baseType) !== "Adjustable Base") {
      delete next.motionMode;
    }

    return next;
  }

  function firstNonEmpty() {
    for (let index = 0; index < arguments.length; index += 1) {
      const value = normalizeText(arguments[index]);
      if (value) return value;
    }
    return "";
  }

  function normalizeSize(size) {
    const value = normalizeText(size);
    return SIZE_OPTIONS.indexOf(value) !== -1 ? value : "";
  }

  function normalizeFirmness(value) {
    const normalized = lower(value);
    if (normalized.indexOf("firm") !== -1) return "firm";
    if (normalized.indexOf("soft") !== -1) return "soft";
    if (normalized.indexOf("medium") !== -1) return "medium";
    return "medium";
  }

  function normalizePosition(value) {
    const normalized = lower(value);
    if (normalized.indexOf("side") !== -1) return "side";
    if (normalized.indexOf("back") !== -1) return "back";
    if (normalized.indexOf("stomach") !== -1) return "stomach";
    if (normalized.indexOf("comb") !== -1 || normalized.indexOf("mix") !== -1) return "combo";
    return "side";
  }

  function normalizeMotionMode(value) {
    const normalized = lower(value);
    if (normalized.indexOf("full split") !== -1) return "Full Split Motion";
    if (normalized.indexOf("half split") !== -1) return "Half Split Motion";
    if (normalized.indexOf("standard") !== -1) return "Standard Motion";
    if (normalized.indexOf("no motion") !== -1) return NO_MOTION_LABEL;
    if (normalized.indexOf("split") !== -1) return "Half Split Motion";
    return "";
  }

  function isYes(value) {
    const normalized = lower(value);
    return normalized === "yes" || normalized === "true" || normalized === "partner" || normalized === "shared" || normalized === "share";
  }

  function containsTerm(value, terms) {
    const normalized = lower(value);
    return terms.some(function (term) {
      return normalized.indexOf(lower(term)) !== -1;
    });
  }

  function mattressTypeFromHandle(handle) {
    const normalized = lower(handle);
    if (normalized === lower(HANDLES.mattresses.dualComfort) || (normalized.indexOf("dual") !== -1 && normalized.indexOf("comfort") !== -1)) return "dual12";
    if (normalized === lower(HANDLES.mattresses.hybrid14) || (normalized.indexOf("hybrid") !== -1 && normalized.indexOf("14") !== -1)) return "hybrid14";
    if (normalized === lower(HANDLES.mattresses.allFoam12) || (normalized.indexOf("foam") !== -1 && normalized.indexOf("12") !== -1)) return "foam12";
    if (normalized === lower(HANDLES.mattresses.allFoam10) || (normalized.indexOf("foam") !== -1 && normalized.indexOf("10") !== -1)) return "foam10";
    return "";
  }

  function mattressFamilyFromHandle(handle) {
    const type = mattressTypeFromHandle(handle);
    if (type === "dual12") return "dual";
    if (type === "hybrid14") return "hybrid";
    if (type === "foam12" || type === "foam10") return "foam";
    return "unknown";
  }

  function mattressLabelFromHandle(handle) {
    const normalized = lower(handle);
    if (normalized === lower(HANDLES.mattresses.dualComfort)) return '12" Dual Comfort Hybrid';
    if (normalized === lower(HANDLES.mattresses.hybrid14)) return '14" Hybrid';
    if (normalized === lower(HANDLES.mattresses.allFoam12)) return '12" All Foam';
    if (normalized === lower(HANDLES.mattresses.allFoam10)) return '10" All Foam';
    return "Mattress";
  }

  function allowedMotionTypesForSize(size) {
    const value = normalizeText(size);
    if (value === "King") return ["standard", "half_split", "full_split"];
    if (value === "Queen") return ["standard", "half_split"];
    return ["standard"];
  }

  function motionTypeFromDisplay(motion) {
    const normalized = lower(motion);
    if (normalized.indexOf("full split") !== -1) return "full_split";
    if (normalized.indexOf("half split") !== -1) return "half_split";
    return "standard";
  }

  function isSplitMotionType(motionType) {
    return motionType === "half_split" || motionType === "full_split";
  }

  function validateMotion(config) {
    const size = lower(config && config.size);
    const motionMode = lower(config && config.motionMode);
    const warnings = [];
    let forcedMattressHandle = null;

    const isHalfSplit = motionMode.indexOf("half split") !== -1;
    const isFullSplit = motionMode.indexOf("full split") !== -1;
    const isAnySplit = isHalfSplit || isFullSplit;

    if (isFullSplit && size !== "king") {
      warnings.push("Full Split Motion is only available in King setups.");
    }

    if (isHalfSplit && size !== "queen" && size !== "king") {
      warnings.push("Half Split Motion is only available in Queen or King sizes.");
    }

    if (isAnySplit) {
      forcedMattressHandle = HANDLES.mattresses.dualComfort;
    }

    return {
      motionOk: warnings.length === 0,
      warnings: warnings,
      forcedMattressHandle: forcedMattressHandle,
      isAnySplit: isAnySplit,
      isHalfSplit: isHalfSplit,
      isFullSplit: isFullSplit,
    };
  }

  function choosePrimaryMattress(config) {
    const firmness = lower(config && config.firmness);
    const position = lower(config && config.position);

    if (firmness === "firm" || position === "back" || position === "stomach") return HANDLES.mattresses.hybrid14;
    if (position === "side") return HANDLES.mattresses.allFoam12;
    return HANDLES.mattresses.hybrid14;
  }

  function buildShowroomPods() {
    return [
      {
        podId: 1,
        mattressHandle: HANDLES.mattresses.dualComfort,
        baseHandle: HANDLES.bases.adjustable,
        baseType: "adjustable",
        motionType: "half_split",
        hasAdjustableBase: true,
        displayMattress: '12" Dual Comfort Hybrid',
        displayedIn: {
          size: "King",
          baseLabel: "Adjustable Base",
          motion: "Half Split Motion",
        },
      },
      {
        podId: 2,
        mattressHandle: HANDLES.mattresses.dualComfort,
        baseHandle: HANDLES.bases.adjustable,
        baseType: "adjustable",
        motionType: "full_split",
        hasAdjustableBase: true,
        displayMattress: '12" Dual Comfort Hybrid',
        displayedIn: {
          size: "King",
          baseLabel: "Adjustable Base",
          motion: "Full Split Motion",
        },
      },
      {
        podId: 3,
        mattressHandle: HANDLES.mattresses.hybrid14,
        baseHandle: HANDLES.bases.adjustable,
        baseType: "adjustable",
        motionType: "standard",
        hasAdjustableBase: true,
        displayMattress: '14" Hybrid',
        displayedIn: {
          size: "King",
          baseLabel: "Adjustable Base",
          motion: "Standard Motion",
        },
      },
      {
        podId: 4,
        mattressHandle: HANDLES.mattresses.allFoam12,
        baseHandle: HANDLES.bases.storage,
        baseType: "storage",
        motionType: "standard",
        hasAdjustableBase: false,
        displayMattress: '12" All Foam',
        displayedIn: {
          size: "Queen",
          baseLabel: "Storage Base",
          motion: NO_MOTION_LABEL,
        },
      },
      {
        podId: 5,
        mattressHandle: HANDLES.mattresses.allFoam10,
        baseHandle: HANDLES.bases.platform,
        baseType: "platform",
        motionType: "standard",
        hasAdjustableBase: false,
        displayMattress: '10" All Foam',
        displayedIn: {
          size: "Queen",
          baseLabel: "Platform Base",
          motion: NO_MOTION_LABEL,
        },
      },
    ];
  }

  function fixtureSupportsPartnerNeed(pod) {
    const mattressFamily = mattressFamilyFromHandle(pod && pod.mattressHandle);
    const baseType = normalizeText((pod && pod.baseType) || "");
    return mattressFamily === "dual" || baseType === "adjustable";
  }

  function scorePodForShopper(pod, shopper) {
    let score = 0;
    const reasons = [];

    const mattressHandle = normalizeText(pod && pod.mattressHandle);
    const mattressType = mattressTypeFromHandle(mattressHandle);
    const mattressFamily = mattressFamilyFromHandle(mattressHandle);
    const motionType = normalizeText((pod && pod.motionType) || motionTypeFromDisplay(pod && pod.displayedIn && pod.displayedIn.motion));
    const podSize = normalizeText(pod && pod.displayedIn && pod.displayedIn.size);
    const baseType = normalizeText((pod && pod.baseType) || "");
    const adjustable = Boolean(pod && pod.hasAdjustableBase) || baseType === "adjustable";
    const supportsPartner = fixtureSupportsPartnerNeed(pod);

    if (mattressHandle === shopper.primaryMattressHandle) {
      score += 100;
      reasons.push("primary_mattress_exact");
    } else if (mattressFamily === shopper.primaryMattressFamily) {
      score += 55;
      reasons.push("primary_mattress_family");
    }

    if (shopper.motionCheck.isFullSplit && motionType === "full_split") {
      score += 70;
      reasons.push("requested_full_split");
    } else if (shopper.motionCheck.isHalfSplit && motionType === "half_split") {
      score += 60;
      reasons.push("requested_half_split");
    } else if (!shopper.motionCheck.isAnySplit && shopper.requestedMotionMode === "Standard Motion" && motionType === "standard" && adjustable) {
      score += 28;
      reasons.push("requested_standard_motion");
    }

    if (shopper.motionCheck.isAnySplit && mattressFamily === "dual") {
      score += 35;
      reasons.push("split_requires_dual");
    }

    if (shopper.hasPartner && supportsPartner) {
      score += 18;
      reasons.push("partner_friendly");
    }

    if (shopper.position === "side" && mattressType === "foam12") {
      score += 18;
      reasons.push("side_sleeper_pressure_relief");
    }

    if ((shopper.position === "back" || shopper.position === "stomach") && mattressType === "hybrid14") {
      score += 18;
      reasons.push("back_or_stomach_support");
    }

    if (shopper.firmness === "firm" && mattressType === "hybrid14") {
      score += 12;
      reasons.push("firmness_firm_match");
    }

    if (shopper.firmness === "soft" && (mattressType === "foam12" || mattressType === "dual12")) {
      score += 12;
      reasons.push("firmness_soft_match");
    }

    if (shopper.size && podSize === shopper.size) {
      score += 10;
      reasons.push("fixture_size_match");
    }

    if (!shopper.motionCheck.isAnySplit && !shopper.hasPartner && !adjustable && mattressFamily === "foam") {
      score += 8;
      reasons.push("simple_non_motion_option");
    }

    return {
      score: score,
      scoreReasons: reasons,
    };
  }

  function generateShowroomRecommendations(results) {
    const size = normalizeSize(
      firstNonEmpty(results && results.size, results && results.preferredSize)
    );

    const motionMode = normalizeMotionMode(
      firstNonEmpty(results && results.motionMode, results && results.motion)
    );

    const firmness = normalizeFirmness(
      firstNonEmpty(results && results.firmness, results && results.comfortPreference, "medium")
    );

    const position = normalizePosition(
      firstNonEmpty(results && results.sleepPosition, results && results.position, results && results.primaryPosition, "side")
    );

    const hasPartner = isYes(
      firstNonEmpty(results && results.sleepPartner, results && results.partner, results && results.shareBed)
    );

    const motionCheck = validateMotion({
      size: size,
      motionMode: motionMode,
    });

    const primaryMattressHandle =
      motionCheck.forcedMattressHandle || choosePrimaryMattress({ firmness: firmness, position: position });

    const shopperProfile = {
      size: size,
      requestedMotionMode: motionMode,
      firmness: firmness,
      position: position,
      hasPartner: hasPartner,
      motionCheck: motionCheck,
      primaryMattressHandle: primaryMattressHandle,
      primaryMattressFamily: mattressFamilyFromHandle(primaryMattressHandle),
    };

    const pods = buildShowroomPods()
      .map(function (pod) {
        const ranking = scorePodForShopper(pod, shopperProfile);
        return {
          ...pod,
          diagnostics: {
            score: ranking.score,
            scoreReasons: ranking.scoreReasons,
          },
        };
      })
      .sort(function (a, b) {
        if (b.diagnostics.score !== a.diagnostics.score) {
          return b.diagnostics.score - a.diagnostics.score;
        }
        return Number(a.podId || 999) - Number(b.podId || 999);
      })
      .map(function (pod, index) {
        return {
          ...pod,
          rank: index + 1,
          recommended: index < 3,
        };
      });

    return {
      meta: {
        size: size,
        motionMode: motionMode,
        firmness: firmness,
        position: position,
        hasPartner: hasPartner,
        warnings: motionCheck.warnings,
        primaryMattressHandle: primaryMattressHandle,
      },
      pods: pods,
    };
  }

  function normalizeProductMap(rawMap) {
    const map = rawMap && typeof rawMap === "object" ? rawMap : {};
    const out = {};
    Object.keys(map).forEach(function (key) {
      const handle = normalizeText(key);
      const product = map[key] || {};
      if (!handle || !normalizeText(product.url)) return;
      out[handle] = {
        handle: handle,
        title: normalizeText(product.title) || handle,
        url: normalizeText(product.url),
        image: normalizeText(product.image),
      };
    });
    return out;
  }

  function getMotionMeta(size) {
    const allowed = allowedMotionTypesForSize(size);
    return MOTION_OPTIONS.map(function (option) {
      const key = option === "Full Split Motion" ? "full_split" : option === "Half Split Motion" ? "half_split" : "standard";
      let disabledReason = "";
      if (key === "half_split" && allowed.indexOf("half_split") === -1) {
        disabledReason = "Available in Queen or King";
      } else if (key === "full_split" && allowed.indexOf("full_split") === -1) {
        disabledReason = "Available in King";
      }
      return {
        label: option,
        description: MOTION_DESCRIPTIONS[option],
        disabled: Boolean(disabledReason),
        disabledReason: disabledReason,
      };
    });
  }

  function hasOwn(object, key) {
    return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
  }

  function getResolvedRecommendationMotionMode(answers, recommendation) {
    const recommendationMode = normalizeMotionMode(recommendation && recommendation.meta && recommendation.meta.motionMode);
    return recommendationMode || normalizeMotionMode(answers.motionMode);
  }

  function getResolvedRecommendationBaseType(answers, recommendation) {
    return normalizeText(
      (recommendation && recommendation.meta && recommendation.meta.baseType) || answers.baseType
    );
  }

  function getExplicitRecommendationBaseHandle(recommendation) {
    if (!hasOwn(recommendation && recommendation.meta, "baseHandle")) return null;
    return recommendation.meta.baseHandle == null ? "" : normalizeText(recommendation.meta.baseHandle);
  }

  function buildAssessmentSummary(answers, recommendation) {
    const parts = [];
    const resolvedBaseType = getResolvedRecommendationBaseType(answers, recommendation);
    const resolvedMotionMode = getResolvedRecommendationMotionMode(answers, recommendation);

    if (answers.size) parts.push("Size target: " + normalizeText(answers.size) + ".");
    if (resolvedBaseType) parts.push("Base preference: " + resolvedBaseType + ".");
    if (resolvedMotionMode) parts.push("Motion preference: " + resolvedMotionMode + ".");
    if (answers.sleepPartner) parts.push("Shares the bed: " + normalizeText(answers.sleepPartner) + ".");
    if (answers.sleepPosition) parts.push("Sleeps mostly on their " + normalizeText(answers.sleepPosition).toLowerCase() + ".");
    if (answers.firmness) parts.push("Prefers a " + normalizeText(answers.firmness).toLowerCase() + " feel.");
    if (answers.temperature) parts.push("Sleeps " + normalizeText(answers.temperature).toLowerCase() + ".");

    const painPoints = Array.isArray(answers.painPoints) ? answers.painPoints.filter(Boolean) : [];
    if (painPoints.length) {
      parts.push("Pain or pressure focus: " + painPoints.join(", ") + ".");
    }

    return parts.join(" ");
  }

  function buildResultTags(answers, recommendation) {
    const tags = [];
    const meta = recommendation.meta || {};

    if (meta.size) tags.push(meta.size);
    if (meta.position === "side") tags.push("Side sleeper");
    if (meta.position === "back") tags.push("Back sleeper");
    if (meta.position === "stomach") tags.push("Stomach sleeper");
    if (meta.position === "combo") tags.push("Combination sleeper");
    if (meta.hasPartner) tags.push("Shared sleep");
    if (meta.motionMode === "Half Split Motion") tags.push("Half split motion");
    if (meta.motionMode === "Full Split Motion") tags.push("Full split motion");
    if (meta.motionMode === "Standard Motion") tags.push("Standard motion");
    if (normalizeKey(answers.temperature) === "hot") tags.push("Sleeps hot");
    if (normalizeKey(answers.firmness) === "firm") tags.push("Firm feel");
    if (normalizeKey(answers.firmness) === "soft") tags.push("Soft feel");

    return tags.slice(0, 5);
  }

  function getTopRecommendedPod(recommendation) {
    const pods = Array.isArray(recommendation && recommendation.pods) ? recommendation.pods : [];
    return pods.find(function (pod) { return pod.recommended; }) || pods[0] || null;
  }

  function getTopRecommendedPods(recommendation) {
    const pods = Array.isArray(recommendation && recommendation.pods) ? recommendation.pods : [];
    return pods.filter(function (pod) { return pod.recommended; }).slice(0, 3);
  }

  function mattressDirectionText(handle) {
    if (handle === HANDLES.mattresses.dualComfort) {
      return 'Start with the 12" Dual Comfort Hybrid if shared sleep, split motion, or different comfort needs matter most.';
    }
    if (handle === HANDLES.mattresses.hybrid14) {
      return 'Start with the 14" Hybrid if you need stronger support, lift, or a firmer overall direction.';
    }
    if (handle === HANDLES.mattresses.allFoam12) {
      return 'Start with the 12" All Foam if pressure relief and deeper contouring matter most.';
    }
    if (handle === HANDLES.mattresses.allFoam10) {
      return 'Start with the 10" All Foam if you want a simpler all-foam starting point.';
    }
    return "Start with the mattress direction that best matches your support and comfort needs.";
  }

  function resolveBaseHandle(answers, recommendation, routes) {
    const explicitBaseHandle = getExplicitRecommendationBaseHandle(recommendation);
    if (explicitBaseHandle !== null) return explicitBaseHandle;

    const baseType = getResolvedRecommendationBaseType(answers, recommendation);
    const motionMode = getResolvedRecommendationMotionMode(answers, recommendation);
    const snores = isYes(answers.snore) || isYes(answers.partnerSnore);

    if (baseType === "Adjustable Base" || motionMode || snores) return HANDLES.bases.adjustable;
    if (baseType === "Platform Base") return HANDLES.bases.platform;
    if (baseType === "Storage Base") return HANDLES.bases.storage;
    if (baseType === "Mattress Only") return "";

    const topPod = getTopRecommendedPod(recommendation);
    const topBaseHandle = normalizeText(topPod && topPod.baseHandle);
    if (topBaseHandle) return topBaseHandle;

    return routes && routes.adjustableBase ? HANDLES.bases.adjustable : "";
  }

  function buildBaseDirection(answers, recommendation) {
    const explicitBaseHandle = getExplicitRecommendationBaseHandle(recommendation);
    const baseType = getResolvedRecommendationBaseType(answers, recommendation);
    const motionMode = getResolvedRecommendationMotionMode(answers, recommendation);
    const snores = isYes(answers.snore) || isYes(answers.partnerSnore);

    if (explicitBaseHandle === "") {
      return "You can start mattress-first and add a base later if you decide you want more elevation or support flexibility.";
    }
    if (explicitBaseHandle === HANDLES.bases.platform || baseType === "Platform Base") {
      return "A platform base keeps the setup simpler if you do not need motion features.";
    }
    if (explicitBaseHandle === HANDLES.bases.storage || baseType === "Storage Base") {
      return "A storage base keeps the setup non-motion while adding built-in utility if that foundation style fits your room.";
    }
    if (baseType === "Adjustable Base" || motionMode || snores) {
      return "An adjustable base is worth comparing here so you can test elevation, motion flexibility, and partner comfort in the same setup.";
    }
    if (baseType === "Platform Base") {
      return "A platform base keeps the setup simpler if you do not need motion features.";
    }
    if (baseType === "Mattress Only") {
      return "You can start mattress-first and add a base later if you decide you want more elevation or support flexibility.";
    }

    const topPod = getTopRecommendedPod(recommendation);
    if (topPod && normalizeText(topPod.baseType) === "adjustable") {
      return "An adjustable base is still worth comparing because it lines up with the strongest showroom test path from your answers.";
    }

    return "";
  }

  function buildPartnerDirection(answers, recommendation) {
    const partner = isYes(answers.sleepPartner);
    const motionMode = getResolvedRecommendationMotionMode(answers, recommendation);
    const highMotionSensitivity =
      containsTerm(answers.motionSensitivity, ["high", "wake up easily"]) ||
      containsTerm(answers.partnerMotionSensitivity, ["high", "wake up easily"]);

    if (partner && (motionMode === "Half Split Motion" || motionMode === "Full Split Motion")) {
      return "Shared sleep and split motion make a Dual Comfort path more relevant because each side can stay closer to its own feel.";
    }

    if (partner && highMotionSensitivity) {
      return "Shared sleep and motion sensitivity make motion control more important in your starting setup.";
    }

    if (partner) {
      return "Because you share the bed, it helps to compare setups that keep motion and comfort differences easier to manage.";
    }

    if (motionMode === "Standard Motion") {
      return "A standard adjustable setup lets you compare elevation without splitting the mattress.";
    }

    return "";
  }

  function buildAccessoryDirection(answers) {
    const temperature = normalizeKey(answers.temperature);
    const position = normalizeKey(answers.sleepPosition);
    const painPoints = Array.isArray(answers.painPoints) ? answers.painPoints.map(normalizeKey) : [];

    if (temperature === "hot") {
      return "Cooling pillows and breathable bedding are worth comparing once the mattress direction feels right.";
    }

    if (position.indexOf("side") !== -1 || painPoints.indexOf("shoulders") !== -1 || painPoints.indexOf("neck") !== -1) {
      return "Pillow height and pressure relief are worth comparing alongside the mattress so your shoulders and neck stay supported.";
    }

    return "Once the mattress direction is clear, round out the sleep setup with pillows and bedding that support how you rest.";
  }

  function buildResultDirections(answers, recommendation) {
    const topPod = getTopRecommendedPod(recommendation);
    const directions = [];

    if (topPod && topPod.mattressHandle) {
      directions.push({
        label: "Mattress direction",
        text: mattressDirectionText(topPod.mattressHandle),
      });
    }

    const baseDirection = buildBaseDirection(answers, recommendation);
    if (baseDirection) {
      directions.push({
        label: "Base direction",
        text: baseDirection,
      });
    }

    const partnerDirection = buildPartnerDirection(answers, recommendation);
    if (partnerDirection) {
      directions.push({
        label: "Partner & motion",
        text: partnerDirection,
      });
    }

    directions.push({
      label: "Pillows & accessories",
      text: buildAccessoryDirection(answers),
    });

    return directions;
  }

  function createCollectionCard(key, title, url, blurb) {
    if (!normalizeText(url)) return null;
    return {
      handle: key,
      kind: "Collection",
      title: title,
      url: url,
      image: "",
      blurb: blurb,
    };
  }

  function createProductCard(handle, kind, productMap) {
    const product = productMap[handle];
    if (!product) return null;
    return {
      handle: handle,
      kind: kind,
      title: product.title,
      url: product.url,
      image: product.image,
      blurb: PRODUCT_BLURBS[handle] || "A strong next step from your assessment results.",
    };
  }

  function buildRecommendedProducts(answers, recommendation, productMap, routes) {
    const topPods = getTopRecommendedPods(recommendation);
    const cards = [];
    const seen = new Set();

    function pushCard(card) {
      if (!card || !card.url) return;
      if (seen.has(card.handle)) return;
      seen.add(card.handle);
      cards.push(card);
    }

    topPods.forEach(function (pod) {
      pushCard(createProductCard(normalizeText(pod.mattressHandle), "Mattress", productMap));
    });

    const baseHandle = resolveBaseHandle(answers, recommendation, routes);
    if (baseHandle) {
      const baseCard = createProductCard(baseHandle, "Base", productMap);
      if (baseCard) {
        pushCard(baseCard);
      } else if (baseHandle === HANDLES.bases.adjustable) {
        pushCard(
          createCollectionCard(
            "bases-collection",
            "Adjustable Bases",
            routes.basesCollection || routes.adjustableBase,
            "Compare elevation and motion flexibility alongside your mattress fit."
          )
        );
      }
    }

    const needsAccessoryCard =
      normalizeKey(answers.temperature) === "hot" ||
      normalizeKey(answers.sleepPosition) === "side" ||
      (Array.isArray(answers.painPoints) && answers.painPoints.some(function (item) {
        return containsTerm(item, ["shoulders", "neck"]);
      }));

    if (needsAccessoryCard) {
      pushCard(
        createCollectionCard(
          "pillows-collection",
          "Pillows",
          routes.pillows,
          "Finish the setup with pillows that support how you rest."
        )
      );
    }

    if (!cards.length) {
      pushCard(
        createCollectionCard(
          "mattresses-collection",
          "Mattresses",
          routes.mattresses,
          "Start with the mattress lineup that matches your assessment direction."
        )
      );
    }

    return cards.slice(0, 4);
  }

  function buildPrimaryAction(answers, recommendation, products, routes) {
    const baseHandle = resolveBaseHandle(answers, recommendation, routes);
    if (baseHandle) {
      return {
        label: "Shop Recommended Setup",
        href: (products[0] && products[0].url) || routes.mattresses,
      };
    }

    return {
      label: "Shop Recommended Mattresses",
      href: (products[0] && products[0].url) || routes.mattresses,
    };
  }

  function buildResult(answers, recommendation, productMap, routes) {
    const products = buildRecommendedProducts(answers, recommendation, productMap, routes);
    return {
      title: "Your sleep direction is ready.",
      copy: "Based on your answers, Snoozer can point you toward a better starting mattress, base, and sleep setup.",
      summary: buildAssessmentSummary(answers, recommendation),
      hints: buildResultTags(answers, recommendation),
      directions: buildResultDirections(answers, recommendation),
      recommendedProducts: products,
      primaryAction: buildPrimaryAction(answers, recommendation, products, routes),
    };
  }

  function baseTypeLabelFromCanonicalKey(value) {
    const normalized = lower(value);
    if (normalized === "adjustable") return "Adjustable Base";
    if (normalized === "platform") return "Platform Base";
    if (normalized === "storage") return "Storage Base";
    return "Mattress Only";
  }

  function motionLabelFromCanonicalKey(value) {
    const normalized = lower(value);
    if (normalized === "full_split") return "Full Split Motion";
    if (normalized === "half_split") return "Half Split Motion";
    if (normalized === "standard") return "Standard Motion";
    return NO_MOTION_LABEL;
  }

  function adaptCanonicalRecommendation(resolved) {
    const normalizedAssessment = resolved && resolved.normalizedAssessment ? resolved.normalizedAssessment : {};
    const recommendation = resolved && resolved.recommendation ? resolved.recommendation : {};
    const pods = Array.isArray(resolved && resolved.pods) ? resolved.pods : [];

    return {
      meta: {
        size: normalizeText(normalizedAssessment.size),
        motionMode:
          normalizeText(normalizedAssessment.motionLabel) ||
          motionLabelFromCanonicalKey(normalizedAssessment.motionKey),
        firmness: normalizeText(normalizedAssessment.firmness),
        position: normalizeText(normalizedAssessment.position),
        hasPartner: Boolean(normalizedAssessment.hasPartner),
        warnings: Array.isArray(normalizedAssessment.warnings)
          ? normalizedAssessment.warnings.slice()
          : Array.isArray(recommendation.warnings)
            ? recommendation.warnings.slice()
            : [],
        primaryMattressHandle: normalizeText(recommendation.primaryMattressHandle),
        baseHandle: recommendation.baseHandle == null ? null : normalizeText(recommendation.baseHandle),
        baseType:
          normalizeText(normalizedAssessment.baseTypeLabel) ||
          baseTypeLabelFromCanonicalKey(normalizedAssessment.baseType),
        manifestVersion: normalizeText(resolved && resolved.manifestVersion),
        reasonKeys: Array.isArray(recommendation.reasonKeys) ? recommendation.reasonKeys.slice() : [],
        source: "canonical_resolver",
      },
      pods: pods.map(function (pod, index) {
        return {
          podId: normalizeText(pod && pod.podId) || String(index + 1),
          mattressHandle: normalizeText(pod && pod.mattressHandle),
          baseHandle: normalizeText(pod && pod.baseHandle),
          baseType: normalizeText(pod && pod.baseTypeKey),
          motionType: normalizeText(pod && pod.defaultMotionKey),
          hasAdjustableBase: Boolean(pod && pod.hasAdjustableBase),
          displayMattress: mattressLabelFromHandle(pod && pod.mattressHandle),
          displayedIn: {
            size: normalizeText((pod && pod.displayedIn && pod.displayedIn.size) || normalizedAssessment.size),
            baseLabel:
              normalizeText(pod && pod.displayedIn && pod.displayedIn.baseLabel) ||
              baseTypeLabelFromCanonicalKey(pod && pod.baseTypeKey),
            motion:
              normalizeText(pod && pod.displayedIn && pod.displayedIn.motion) ||
              motionLabelFromCanonicalKey(pod && pod.defaultMotionKey),
          },
          diagnostics: {
            score: Number(pod && pod.score) || 0,
            scoreReasons: Array.isArray(pod && pod.reasonKeys) ? pod.reasonKeys.slice() : [],
          },
          rank: Number(pod && pod.rank) || index + 1,
          recommended: pod ? pod.recommended === true : index < 3,
        };
      }),
    };
  }

  function buildLocalShowroomResult(answers, productMap, routes) {
    const recommendation = generateShowroomRecommendations(answers);
    return {
      recommendation: recommendation,
      result: buildResult(answers, recommendation, productMap, routes),
      source: "local_fallback",
      fallbackUsed: true,
    };
  }

  async function resolveAssessmentRecommendationResult(root, answers, shopperId, productMap, routes) {
    try {
      const resolved = await fetch(buildApiUrl(root, "/recommendations/resolve"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopperId: shopperId,
          assessment: answers,
          includeProducts: true,
          includePods: true,
          source: "shopify_assessment_page",
        }),
      }).then(function (response) {
        if (!response.ok) throw new Error("Canonical recommendations failed");
        return response.json();
      });

      const recommendation = adaptCanonicalRecommendation(resolved);
      return {
        recommendation: recommendation,
        result: buildResult(answers, recommendation, productMap, routes),
        resolved: resolved,
        source: "canonical_resolver",
        fallbackUsed: false,
      };
    } catch (error) {
      console.warn("[snooze-assessment] canonical recommendations unavailable, using local fallback", error);
      return buildLocalShowroomResult(answers, productMap, routes);
    }
  }

  async function saveAssessmentAnswers(root, shopperId, answers) {
    return fetch(buildApiUrl(root, "/assessment"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shopperId: shopperId,
        origin: "shopify_assessment_page",
        answers: answers,
      }),
    }).then(function (response) {
      if (!response.ok) throw new Error("Assessment save failed");
      return response.json();
    });
  }

  function initAssessment(root) {
    if (!root) return;

    const sectionId = normalizeText(root.getAttribute("data-assessment-section-id")) || "assessment";
    const storageKey = STORAGE_NAMESPACE + "." + slugify(sectionId);
    const routes = {
      assessment: normalizeText(root.getAttribute("data-assessment-url")) || "/pages/snooze-assessment",
      booking: normalizeText(root.getAttribute("data-booking-url")) || "/pages/book-a-snooze-session",
      mattresses: normalizeText(root.getAttribute("data-mattresses-url")) || "/collections/mattresses",
      adjustableBase: normalizeText(root.getAttribute("data-adjustable-base-url")) || "/products/premium-motion-adjustable-base",
      basesCollection: normalizeText(root.getAttribute("data-bases-collection-url")) || "/collections/bases",
      pillows: normalizeText(root.getAttribute("data-pillows-url")) || "/collections/pillows",
      bedding: normalizeText(root.getAttribute("data-bedding-url")) || "/collections/bedding",
    };

    const productMapNode = root.querySelector("[data-assessment-product-map]");
    const productMap = normalizeProductMap(
      safeJsonParse(productMapNode ? productMapNode.textContent : "{}", {})
    );

    const els = {
      appAnchor: root.querySelector("[data-assessment-app-anchor]"),
      progressBar: root.querySelector("[data-assessment-progress-bar]"),
      progressLabel: root.querySelector("[data-assessment-progress-label]"),
      questionEyebrow: root.querySelector("[data-assessment-question-eyebrow]"),
      questionTitle: root.querySelector("[data-assessment-question-title]"),
      questionNote: root.querySelector("[data-assessment-question-note]"),
      optionGrid: root.querySelector("[data-assessment-options]"),
      status: root.querySelector("[data-assessment-status]"),
      error: root.querySelector("[data-assessment-error]"),
      backButton: root.querySelector("[data-assessment-back]"),
      skipButton: root.querySelector("[data-assessment-skip]"),
      continueButton: root.querySelector("[data-assessment-continue]"),
      result: root.querySelector("[data-assessment-result]"),
      resultTitle: root.querySelector("[data-assessment-result-title]"),
      resultCopy: root.querySelector("[data-assessment-result-copy]"),
      resultSummary: root.querySelector("[data-assessment-result-summary]"),
      resultTags: root.querySelector("[data-assessment-result-tags]"),
      resultDirections: root.querySelector("[data-assessment-result-directions]"),
      resultProducts: root.querySelector("[data-assessment-result-products]"),
      resultActions: root.querySelector("[data-assessment-result-actions]"),
      retakeButton: root.querySelector("[data-assessment-retake]"),
    };

    const savedState = safeJsonParse(safeSessionGet(storageKey), null);
    const state = {
      loading: true,
      submitting: false,
      questions: [],
      step: Math.max(0, Number(savedState && savedState.step) || 0),
      answers: savedState && savedState.answers && typeof savedState.answers === "object" ? savedState.answers : {},
      completed: false,
      result: null,
      shopperId: normalizeText(savedState && savedState.shopperId) || createShopperId(sectionId),
      savedCompleted: Boolean(savedState && savedState.completed),
    };

    function persist() {
      safeSessionSet(
        storageKey,
        JSON.stringify({
          step: state.step,
          answers: state.answers,
          completed: state.completed,
          result: state.result,
          shopperId: state.shopperId,
        })
      );
    }

    function setStatus(message, isError) {
      if (!els.status || !els.error) return;
      els.status.hidden = true;
      els.error.hidden = true;

      if (!message) return;

      if (isError) {
        els.error.textContent = message;
        els.error.hidden = false;
      } else {
        els.status.textContent = message;
        els.status.hidden = false;
      }
    }

    function scrollToApp() {
      if (!els.appAnchor) return;
      els.appAnchor.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function scrollToResults() {
      if (!els.result) return;
      window.setTimeout(function () {
        els.result.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }

    function renderOptions(question) {
      if (!els.optionGrid) return;
      els.optionGrid.innerHTML = "";

      const motionMeta = question.id === "motionMode" ? getMotionMeta(state.answers.size) : [];

      question.options.forEach(function (option) {
        const normalizedOption = normalizeText(option);
        const selected = isMultiQuestion(question)
          ? Array.isArray(state.answers[question.id]) && state.answers[question.id].indexOf(normalizedOption) !== -1
          : normalizeText(state.answers[question.id]) === normalizedOption;

        const button = document.createElement("button");
        button.type = "button";
        button.className = isMultiQuestion(question)
          ? "snooze-assessment__multi-option"
          : "snooze-assessment__option";
        if (selected) button.classList.add("is-selected");
        button.setAttribute("aria-pressed", selected ? "true" : "false");

        let description = "";
        let disabledReason = "";
        let disabled = false;

        if (question.id === "motionMode") {
          const meta = motionMeta.find(function (item) { return item.label === normalizedOption; });
          description = meta && meta.description ? meta.description : "";
          disabledReason = meta && meta.disabledReason ? meta.disabledReason : "";
          disabled = Boolean(meta && meta.disabled);
          if (disabled) button.disabled = true;
        }

        const head = document.createElement("div");
        head.className = "snooze-assessment__option-head";

        const label = document.createElement("span");
        label.className = "snooze-assessment__option-label";
        label.textContent = normalizedOption;

        const badge = document.createElement("span");
        badge.className = "snooze-assessment__option-badge";
        badge.textContent = selected ? "Selected" : isMultiQuestion(question) ? "Toggle" : "Choose";

        head.appendChild(label);
        head.appendChild(badge);
        button.appendChild(head);

        if (description) {
          const note = document.createElement("p");
          note.className = "snooze-assessment__option-note";
          note.textContent = description;
          button.appendChild(note);
        }

        if (disabledReason) {
          const disabledNote = document.createElement("p");
          disabledNote.className = "snooze-assessment__option-note snooze-assessment__option-note--warning";
          disabledNote.textContent = disabledReason;
          button.appendChild(disabledNote);
        }

        button.addEventListener("click", function () {
          if (disabled) return;

          if (isMultiQuestion(question)) {
            const current = Array.isArray(state.answers[question.id]) ? state.answers[question.id].slice() : [];
            const exists = current.indexOf(normalizedOption) !== -1;
            state.answers[question.id] = exists
              ? current.filter(function (value) { return value !== normalizedOption; })
              : current.concat(normalizedOption);
            persist();
            render();
            return;
          }

          state.answers[question.id] = normalizedOption;
          state.answers = cleanAnswers(state.questions, state.answers);

          const visibleQuestions = getVisibleQuestions(state.questions, state.answers);
          const currentIndex = visibleQuestions.findIndex(function (item) { return item.id === question.id; });

          persist();

          if (currentIndex >= visibleQuestions.length - 1) {
            submitAssessment();
            return;
          }

          state.step = Math.min(visibleQuestions.length - 1, currentIndex + 1);
          persist();
          render();
        });

        els.optionGrid.appendChild(button);
      });

      if (isMultiQuestion(question) && Array.isArray(state.answers[question.id]) && state.answers[question.id].length) {
        const hintWrap = document.createElement("div");
        hintWrap.className = "snooze-assessment__hint-list";
        state.answers[question.id].forEach(function (item) {
          const pill = document.createElement("span");
          pill.className = "snooze-assessment__hint-pill";
          pill.textContent = item;
          hintWrap.appendChild(pill);
        });
        els.optionGrid.appendChild(hintWrap);
      }
    }

    function renderResultDirections(result) {
      if (!els.resultDirections) return;
      els.resultDirections.innerHTML = "";

      (Array.isArray(result.directions) ? result.directions : []).forEach(function (direction) {
        const card = document.createElement("article");
        card.className = "snooze-assessment__direction-card";

        const label = document.createElement("h3");
        label.className = "snooze-assessment__direction-label";
        label.textContent = direction.label;
        card.appendChild(label);

        const text = document.createElement("p");
        text.className = "snooze-assessment__direction-text";
        text.textContent = direction.text;
        card.appendChild(text);

        els.resultDirections.appendChild(card);
      });
    }

    function renderResultActions(result) {
      if (!els.resultActions) return;
      els.resultActions.innerHTML = "";

      const primary = result.primaryAction || {
        label: "Shop Recommended Mattresses",
        href: routes.mattresses,
      };

      [
        {
          label: primary.label,
          href: primary.href,
          primary: true,
        },
        {
          label: "Book A Snooze Session",
          href: routes.booking,
          primary: false,
        },
      ].forEach(function (action) {
        const link = document.createElement("a");
        link.className = action.primary
          ? "snooze-assessment__button snooze-assessment__button--primary"
          : "snooze-assessment__button";
        link.href = action.href;
        link.textContent = action.label;
        els.resultActions.appendChild(link);
      });
    }

    function renderResultProducts(result) {
      if (!els.resultProducts) return;
      els.resultProducts.innerHTML = "";

      const products = Array.isArray(result.recommendedProducts) ? result.recommendedProducts : [];
      if (!products.length) {
        const empty = document.createElement("p");
        empty.className = "snooze-assessment__empty";
        empty.textContent = "Start with the mattress lineup, then compare the base and accessories that fit your direction best.";
        els.resultProducts.appendChild(empty);
        return;
      }

      products.forEach(function (product) {
        const article = document.createElement("article");
        article.className = "snooze-assessment__recommendation-card";

        if (product.image) {
          const media = document.createElement("div");
          media.className = "snooze-assessment__recommendation-media";
          const image = document.createElement("img");
          image.src = product.image;
          image.alt = product.title;
          image.loading = "lazy";
          image.decoding = "async";
          media.appendChild(image);
          article.appendChild(media);
        }

        const kind = document.createElement("p");
        kind.className = "snooze-assessment__recommendation-kind";
        kind.textContent = product.kind;
        article.appendChild(kind);

        const title = document.createElement("h3");
        title.className = "snooze-assessment__recommendation-title";
        title.textContent = product.title;
        article.appendChild(title);

        const copy = document.createElement("p");
        copy.className = "snooze-assessment__recommendation-copy";
        copy.textContent = product.blurb;
        article.appendChild(copy);

        const link = document.createElement("a");
        link.className = "snooze-assessment__product-link";
        link.href = product.url;
        link.textContent = product.kind === "Collection" ? "View collection" : "View product";
        article.appendChild(link);

        els.resultProducts.appendChild(article);
      });
    }

    function renderResult(result) {
      if (!els.result) return;
      els.result.hidden = false;

      if (els.resultTitle) {
        els.resultTitle.textContent = result.title || "Your sleep direction is ready.";
      }
      if (els.resultCopy) {
        els.resultCopy.textContent = result.copy || "";
      }
      if (els.resultSummary) {
        els.resultSummary.textContent = result.summary || "";
      }
      if (els.resultTags) {
        els.resultTags.innerHTML = "";
        (result.hints || []).forEach(function (hint) {
          const pill = document.createElement("span");
          pill.className = "snooze-assessment__tag";
          pill.textContent = hint;
          els.resultTags.appendChild(pill);
        });
      }

      renderResultDirections(result);
      renderResultProducts(result);
      renderResultActions(result);
    }

    function render() {
      if (state.completed && state.result) {
        setStatus("", false);
        renderResult(state.result);
      } else if (els.result) {
        els.result.hidden = true;
      }

      if (state.loading) {
        setStatus("Loading the Snooze Assessment...", false);
      } else if (state.submitting) {
        setStatus("Saving your answers and building your sleep direction...", false);
      } else if (!els.error.hidden) {
        // keep current error visible
      } else {
        setStatus("", false);
      }

      const visibleQuestions = getVisibleQuestions(state.questions, state.answers);
      if (!visibleQuestions.length) return;

      if (state.step >= visibleQuestions.length) {
        state.step = visibleQuestions.length - 1;
      }

      const current = visibleQuestions[state.step];
      const completedCount = visibleQuestions.reduce(function (count, question) {
        return count + (questionIsAnswered(question, state.answers[question.id]) ? 1 : 0);
      }, 0);
      const progressPercent = Math.max(8, Math.round(((state.step + 1) / visibleQuestions.length) * 100));

      if (els.progressBar) {
        els.progressBar.style.width = progressPercent + "%";
      }
      if (els.progressLabel) {
        els.progressLabel.textContent = "Step " + (state.step + 1) + " of " + visibleQuestions.length;
      }
      if (els.questionEyebrow) {
        els.questionEyebrow.textContent = "Question " + (state.step + 1) + " of " + visibleQuestions.length;
      }
      if (els.questionTitle) {
        els.questionTitle.textContent = current.text;
      }
      if (els.questionNote) {
        const notes = [];
        if (current.id === "baseType") {
          notes.push("This keeps the next mattress and base direction grounded in the same showroom flow.");
        }
        if (current.id === "motionMode") {
          notes.push("Split motion changes what mattress and base combinations fit best.");
        }
        if (current.id === "painPoints") {
          notes.push("Choose any that matter, then continue.");
        }
        if (current.note) {
          notes.push(current.note);
        }
        els.questionNote.textContent = notes.join(" ");
      }

      renderOptions(current);

      if (els.backButton) {
        els.backButton.disabled = state.step === 0 || state.loading || state.submitting;
      }
      if (els.skipButton) {
        const showSkip = !isRequired(current);
        els.skipButton.hidden = !showSkip;
        els.skipButton.disabled = state.loading || state.submitting;
      }
      if (els.continueButton) {
        const showContinue = isMultiQuestion(current);
        const answered = questionIsAnswered(current, state.answers[current.id]);
        els.continueButton.hidden = !showContinue;
        els.continueButton.textContent = state.step === visibleQuestions.length - 1 ? "Finish assessment" : "Next question";
        els.continueButton.disabled = !answered || state.loading || state.submitting;
      }

      persist();
    }

    async function submitAssessment() {
      if (state.submitting || state.loading) return;

      state.submitting = true;
      setStatus("Saving your answers and building your sleep direction...", false);
      render();

      const answers = cleanAnswers(state.questions, state.answers);

      try {
        await saveAssessmentAnswers(root, state.shopperId, answers);
        const resolved = await resolveAssessmentRecommendationResult(
          root,
          answers,
          state.shopperId,
          productMap,
          routes
        );
        const result = resolved.result;

        state.answers = answers;
        state.result = result;
        state.completed = true;
        state.submitting = false;

        safeSessionSet(SHARED_ANSWERS_KEY, JSON.stringify(answers));
        safeSessionSet(SHARED_SUMMARY_KEY, result.summary || "");
        safeSessionSet(
          SHARED_RESULTS_KEY,
          JSON.stringify(
            result.recommendedProducts
              .filter(function (product) { return product.kind !== "Collection"; })
              .map(function (product) { return product.handle; })
              .filter(Boolean)
          )
        );

        persist();
        render();
        scrollToResults();
      } catch (error) {
        state.submitting = false;
        setStatus("We could not save the assessment right now. Refresh and try again, or book a Snooze Session.", true);
        render();
      }
    }

    async function loadQuestions() {
      try {
        const payload = await fetch(buildApiUrl(root, "/assessment-questions")).then(function (response) {
          if (!response.ok) throw new Error("Assessment questions failed");
          return response.json();
        });

        state.questions = buildQuestionFlow(payload && payload.questions);
      } catch (error) {
        state.questions = buildQuestionFlow(FALLBACK_QUESTIONS);
        setStatus("The live question set is not loading right now, so I started the showroom assessment path instead.", false);
      }

      state.answers = cleanAnswers(state.questions, state.answers);
      state.loading = false;

      if (state.savedCompleted && Object.keys(state.answers).length) {
        const resolved = await resolveAssessmentRecommendationResult(
          root,
          state.answers,
          state.shopperId,
          productMap,
          routes
        );
        state.result = resolved.result;
        state.completed = true;
      }

      persist();
      render();
    }

    if (els.backButton) {
      els.backButton.addEventListener("click", function () {
        if (state.step === 0) return;
        state.step = Math.max(0, state.step - 1);
        persist();
        render();
      });
    }

    if (els.skipButton) {
      els.skipButton.addEventListener("click", function () {
        const visibleQuestions = getVisibleQuestions(state.questions, state.answers);
        const current = visibleQuestions[state.step];
        if (!current || isRequired(current)) return;

        delete state.answers[current.id];

        if (state.step >= visibleQuestions.length - 1) {
          submitAssessment();
          return;
        }

        state.step += 1;
        state.answers = cleanAnswers(state.questions, state.answers);
        persist();
        render();
      });
    }

    if (els.continueButton) {
      els.continueButton.addEventListener("click", function () {
        const visibleQuestions = getVisibleQuestions(state.questions, state.answers);
        const current = visibleQuestions[state.step];
        if (!current || !questionIsAnswered(current, state.answers[current.id])) return;

        if (state.step >= visibleQuestions.length - 1) {
          submitAssessment();
          return;
        }

        state.step += 1;
        persist();
        render();
      });
    }

    if (els.retakeButton) {
      els.retakeButton.addEventListener("click", function () {
        state.completed = false;
        state.result = null;
        state.savedCompleted = false;
        state.step = 0;
        persist();
        render();
        scrollToApp();
      });
    }

    if (state.completed && state.result) {
      render();
    }

    loadQuestions();
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-assessment-root]").forEach(initAssessment);
  });
})();
