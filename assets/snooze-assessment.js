(function () {
  const STORAGE_NAMESPACE = "snooze.assessment.page.v1";
  const SHARED_RESULTS_KEY = "snooze.recommendedProductHandles";
  const SHARED_ANSWERS_KEY = "snooze.assessment";
  const SHARED_SUMMARY_KEY = "snooze.assessmentSummary";
  const DEFAULT_SHOPPER_KEY = "snooze.assessmentShopperId";
  const MOTION_DESCRIPTIONS = {
    "Standard Motion": "Both sides elevate together in sync.",
    "Half Split Motion": "Separate head adjustment with the feet moving together.",
    "Full Split Motion": "Each side moves independently at the head and foot.",
    "No Motion": "A simpler mattress-only or non-adjustable setup.",
  };
  const PRODUCT_BLURBS = {
    "14-hybrid": "A stronger starting point if you want lift, airflow, and support together.",
    "12-dual-comfort-hybrid": "A better couple-friendly option when both sides need more flexibility.",
    "12-all-foam-mattress": "A contouring all-foam option when pressure relief matters most.",
    "10-all-foam-mattress": "A simpler value-first all-foam option for a steadier feel.",
    "premium-motion-adjustable-base": "The base path to compare when elevation or split movement matters.",
  };
  const DEFAULT_QUESTIONS = [
    {
      id: "size",
      text: "First up: what mattress size are you leaning toward?",
      options: ["Twin", "Full", "Queen", "King"],
      required: true,
    },
    {
      id: "motionMode",
      text: "What kind of motion setup sounds closest to what you want?",
      options: ["Standard Motion", "Half Split Motion", "Full Split Motion", "No Motion"],
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
      text: "How do you mostly sleep?",
      options: ["Side", "Back", "Stomach", "Mix / Combination"],
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
      id: "painPoints",
      text: "Any pressure points or support issues you want the mattress to help with?",
      options: ["Lower back", "Upper back", "Hips", "Shoulders", "Neck", "General pressure relief"],
      multi: true,
      required: false,
    },
    {
      id: "budget",
      text: "What price range feels comfortable for your mattress or mattress + base?",
      options: ["Under $1,500", "$1,500-$2,500", "$2,500-$3,500", "Over $3,500", "Not sure yet"],
      required: false,
    },
  ];

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  function normalizeKey(value) {
    return normalizeText(value).toLowerCase();
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
    const generated = ["shopify-assessment", sectionId || "page", Date.now(), Math.random().toString(36).slice(2, 8)].join("-");
    safeSessionSet(DEFAULT_SHOPPER_KEY, generated);
    return generated;
  }

  function isMultiQuestion(question) {
    return Boolean(question && (question.multi === true || normalizeKey(question.zohoType) === "multiselect"));
  }

  function isRequired(question) {
    return Boolean(question && question.required === true);
  }

  function dependsOnMatches(question, answers) {
    if (!question || !question.dependsOn) return true;
    const dependency = question.dependsOn;
    const current = answers[dependency.question];
    const expected = dependency.value;

    if (Array.isArray(current)) {
      return current.includes(expected);
    }

    return normalizeKey(current) === normalizeKey(expected);
  }

  function buildQuestionFlow(rawQuestions) {
    const source = Array.isArray(rawQuestions) && rawQuestions.length ? rawQuestions : DEFAULT_QUESTIONS;
    return source
      .map(function (question) {
        return {
          id: normalizeText(question.id),
          text: normalizeText(question.text),
          options: Array.isArray(question.options) ? question.options.map(normalizeText).filter(Boolean) : [],
          required: question.required === true,
          multi: isMultiQuestion(question),
          dependsOn: question.dependsOn || null,
          note: normalizeText(question.note || ""),
        };
      })
      .filter(function (question) {
        return question.id && question.text && question.options.length;
      });
  }

  function getVisibleQuestions(questions, answers) {
    return questions.filter(function (question) {
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
    const keep = new Set(visible.map(function (question) { return question.id; }));
    const next = {};

    Object.keys(answers || {}).forEach(function (key) {
      if (!keep.has(key)) return;
      const question = visible.find(function (item) { return item.id === key; });
      const value = answers[key];
      if (!questionIsAnswered(question, value)) return;
      next[key] = Array.isArray(value) ? value.slice() : value;
    });

    return next;
  }

  function buildSummary(answers) {
    const parts = [];
    if (answers.size) parts.push("Size: " + normalizeText(answers.size) + ".");
    if (answers.motionMode) parts.push("Motion: " + normalizeText(answers.motionMode) + ".");
    if (answers.sleepPosition) parts.push("Position: " + normalizeText(answers.sleepPosition) + ".");
    if (answers.temperature) parts.push("Sleeps " + normalizeText(answers.temperature).toLowerCase() + ".");
    if (answers.firmness) parts.push("Leans " + normalizeText(answers.firmness).toLowerCase() + ".");

    const painPoints = Array.isArray(answers.painPoints) ? answers.painPoints.filter(Boolean) : [];
    if (painPoints.length) {
      parts.push("Focus areas: " + painPoints.slice(0, 3).join(", ") + ".");
    }

    return parts.join(" ");
  }

  function buildDirection(answers, hints) {
    const direction = [];
    const hintList = Array.isArray(hints) ? hints.filter(Boolean) : [];
    const position = normalizeKey(answers.sleepPosition);
    const temperature = normalizeKey(answers.temperature);
    const firmness = normalizeKey(answers.firmness);
    const motion = normalizeKey(answers.motionMode);

    if (position.includes("side")) direction.push("pressure relief with enough support underneath");
    else if (position.includes("back")) direction.push("steadier support through the middle");
    else if (position.includes("stomach")) direction.push("support first so the bed does not feel too soft");
    else direction.push("balanced support and feel");

    if (temperature.includes("hot")) direction.push("better airflow");
    if (firmness.includes("firm")) direction.push("a firmer comfort direction");
    if (firmness.includes("soft")) direction.push("more cushioning");
    if (motion.includes("split") || motion.includes("standard motion")) direction.push("motion/base flexibility");

    if (!direction.length && hintList.length) {
      return hintList.slice(0, 2).join(" and ");
    }

    return direction.slice(0, 3).join(", ");
  }

  function buildResultCopy(answers, hints) {
    const direction = buildDirection(answers, hints);
    if (!direction) {
      return "Based on your answers, Snoozer can point you toward a better starting mattress, base, and sleep setup.";
    }

    return "Based on your answers, Snoozer can point you toward a better starting mattress, base, and sleep setup.";
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

  function getProductBlurb(handle) {
    return PRODUCT_BLURBS[handle] || "A verified next step to compare from the current lineup.";
  }

  function serializeState(state) {
    return JSON.stringify({
      step: state.step,
      answers: state.answers,
      completed: state.completed,
      result: state.result,
      shopperId: state.shopperId,
    });
  }

  function openSnoozerPanel() {
    const trigger = document.querySelector("[data-snoozer-anchor-trigger]");
    if (!trigger) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(function () {
      trigger.click();
    }, 220);
  }

  function initAssessment(root) {
    if (!root) return;

    const sectionId = normalizeText(root.getAttribute("data-assessment-section-id")) || "assessment";
    const storageKey = STORAGE_NAMESPACE + "." + slugify(sectionId);
    const routes = {
      assessment: normalizeText(root.getAttribute("data-assessment-url")) || "/pages/snooze-assessment",
      booking: normalizeText(root.getAttribute("data-booking-url")) || "/pages/book-a-snooze-session",
      mattresses: normalizeText(root.getAttribute("data-mattresses-url")) || "/collections/mattresses",
      base: normalizeText(root.getAttribute("data-adjustable-base-url")) || "/products/premium-motion-adjustable-base",
    };

    const productMapNode = root.querySelector("[data-assessment-product-map]");
    const productMap = normalizeProductMap(
      safeJsonParse(productMapNode ? productMapNode.textContent : "{}", {})
    );

    const els = {
      heroJump: root.querySelector("[data-assessment-jump]"),
      heroAsk: root.querySelector("[data-assessment-open-snoozer]"),
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
      resultProducts: root.querySelector("[data-assessment-result-products]"),
      resultActions: root.querySelector("[data-assessment-result-actions]"),
      retakeButton: root.querySelector("[data-assessment-retake]"),
      bottomAsk: root.querySelector("[data-assessment-bottom-open-snoozer]"),
    };

    const savedState = safeJsonParse(safeSessionGet(storageKey), null);
    const state = {
      loading: true,
      submitting: false,
      questions: [],
      step: Math.max(0, Number(savedState && savedState.step) || 0),
      answers: savedState && savedState.answers && typeof savedState.answers === "object" ? savedState.answers : {},
      completed: Boolean(savedState && savedState.completed),
      result: savedState && savedState.result && typeof savedState.result === "object" ? savedState.result : null,
      shopperId: normalizeText(savedState && savedState.shopperId) || createShopperId(sectionId),
    };

    function persist() {
      safeSessionSet(storageKey, serializeState(state));
    }

    function scrollToApp() {
      if (!els.appAnchor) return;
      els.appAnchor.scrollIntoView({ behavior: "smooth", block: "start" });
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

    function renderOptions(question, visibleQuestions) {
      if (!els.optionGrid) return;
      els.optionGrid.innerHTML = "";

      question.options.forEach(function (option) {
        const normalizedOption = normalizeText(option);
        const button = document.createElement("button");
        button.type = "button";
        button.className = isMultiQuestion(question)
          ? "snooze-assessment__multi-option"
          : "snooze-assessment__option";

        const selected = isMultiQuestion(question)
          ? Array.isArray(state.answers[question.id]) && state.answers[question.id].includes(normalizedOption)
          : normalizeText(state.answers[question.id]) === normalizedOption;

        if (selected) button.classList.add("is-selected");
        button.setAttribute("aria-pressed", selected ? "true" : "false");

        const optionHead = document.createElement("div");
        optionHead.className = "snooze-assessment__option-head";

        const label = document.createElement("span");
        label.className = "snooze-assessment__option-label";
        label.textContent = normalizedOption;

        const badge = document.createElement("span");
        badge.className = "snooze-assessment__option-badge";
        badge.textContent = selected ? "Selected" : isMultiQuestion(question) ? "Toggle" : "Choose";

        optionHead.appendChild(label);
        optionHead.appendChild(badge);
        button.appendChild(optionHead);

        const description =
          question.id === "motionMode"
            ? MOTION_DESCRIPTIONS[normalizedOption]
            : "";

        if (description) {
          const note = document.createElement("p");
          note.className = "snooze-assessment__option-note";
          note.textContent = description;
          button.appendChild(note);
        }

        button.addEventListener("click", function () {
          if (isMultiQuestion(question)) {
            const current = Array.isArray(state.answers[question.id]) ? state.answers[question.id].slice() : [];
            const exists = current.includes(normalizedOption);
            state.answers[question.id] = exists
              ? current.filter(function (value) { return value !== normalizedOption; })
              : current.concat(normalizedOption);
            persist();
            render();
            return;
          }

          state.answers[question.id] = normalizedOption;
          const cleaned = cleanAnswers(state.questions, state.answers);
          state.answers = cleaned;
          const nextVisible = getVisibleQuestions(state.questions, cleaned);
          const currentIndex = nextVisible.findIndex(function (item) { return item.id === question.id; });

          persist();

          if (currentIndex >= nextVisible.length - 1) {
            submitAssessment();
            return;
          }

          state.step = Math.min(nextVisible.length - 1, currentIndex + 1);
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

    function renderResultActions(result) {
      if (!els.resultActions) return;
      els.resultActions.innerHTML = "";

      const primaryProduct = Array.isArray(result.recommendedProducts) ? result.recommendedProducts[0] : null;
      const actionConfig = [
        {
          label: "Shop Recommended Mattresses",
          href: primaryProduct && primaryProduct.url ? primaryProduct.url : routes.mattresses,
          primary: true,
        },
        {
          label: "Book A Snooze Session",
          href: routes.booking,
          primary: false,
        },
      ];

      actionConfig.forEach(function (action) {
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
        empty.textContent = "Your assessment is saved. Use the mattress lineup or book a Snooze Session for the next step.";
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
        link.textContent = "View product";
        article.appendChild(link);

        els.resultProducts.appendChild(article);
      });
    }

    function renderResult(result) {
      if (!els.result) return;
      els.result.hidden = false;
      if (els.resultTitle) {
        els.resultTitle.textContent = "Your sleep direction is ready.";
      }
      if (els.resultCopy) {
        els.resultCopy.textContent = result.copy;
      }
      if (els.resultSummary) {
        els.resultSummary.textContent = result.summary;
      }
      if (els.resultTags) {
        els.resultTags.innerHTML = "";
        (result.hints || []).slice(0, 4).forEach(function (hint) {
          const pill = document.createElement("span");
          pill.className = "snooze-assessment__tag";
          pill.textContent = hint;
          els.resultTags.appendChild(pill);
        });
      }

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
        setStatus("Saving your answers and building your next step...", false);
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
        const detail = completedCount ? completedCount + " answered" : "Start here";
        els.questionEyebrow.textContent = detail;
      }
      if (els.questionTitle) {
        els.questionTitle.textContent = current.text;
      }
      if (els.questionNote) {
        const noteParts = [];
        if (current.id === "motionMode") noteParts.push("This helps narrow your mattress and base direction.");
        if (current.id === "budget") noteParts.push("A ballpark is enough here.");
        if (current.id === "painPoints") noteParts.push("Choose any that matter, then continue.");
        if (current.note) noteParts.push(current.note);
        els.questionNote.textContent = noteParts.join(" ");
      }

      renderOptions(current, visibleQuestions);

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

    function buildRecommendedProducts(answers, recommendationPayload) {
      const products = Array.isArray(recommendationPayload && recommendationPayload.products)
        ? recommendationPayload.products
        : [];

      const handles = products
        .map(function (item) { return normalizeText(item && item.handle); })
        .filter(Boolean);

      if (normalizeKey(answers.motionMode) !== "no motion" && handles.indexOf("premium-motion-adjustable-base") === -1) {
        handles.push("premium-motion-adjustable-base");
      }

      return handles
        .map(function (handle) {
          const product = productMap[handle];
          if (!product) return null;
          return {
            handle: handle,
            title: product.title,
            url: product.url,
            image: product.image,
            blurb: getProductBlurb(handle),
          };
        })
        .filter(Boolean)
        .slice(0, 4);
    }

    function buildResult(answers, recommendationPayload) {
      const hints = Array.isArray(recommendationPayload && recommendationPayload.hints)
        ? recommendationPayload.hints.filter(Boolean)
        : [];
      return {
        summary: buildSummary(answers),
        copy: buildResultCopy(answers, hints),
        hints: hints,
        recommendedProducts: buildRecommendedProducts(answers, recommendationPayload),
      };
    }

    async function submitAssessment() {
      if (state.submitting || state.loading) return;
      state.submitting = true;
      setStatus("Saving your answers and building your next step...", false);
      render();

      const answers = cleanAnswers(state.questions, state.answers);

      try {
        await fetch(buildApiUrl(root, "/assessment"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shopperId: state.shopperId,
            origin: "shopify_assessment_page",
            answers: answers,
          }),
        }).then(function (response) {
          if (!response.ok) throw new Error("Assessment save failed");
          return response.json();
        });

        const recommendationPayload = await fetch(
          buildApiUrl(root, "/recommendations/" + encodeURIComponent(state.shopperId))
        ).then(function (response) {
          if (!response.ok) throw new Error("Recommendations failed");
          return response.json();
        });

        const result = buildResult(answers, recommendationPayload);

        state.answers = answers;
        state.result = result;
        state.completed = true;
        state.submitting = false;

        safeSessionSet(SHARED_ANSWERS_KEY, JSON.stringify(answers));
        safeSessionSet(SHARED_SUMMARY_KEY, result.summary || "");
        safeSessionSet(
          SHARED_RESULTS_KEY,
          JSON.stringify(result.recommendedProducts.map(function (product) { return product.handle; }))
        );

        persist();
        render();
        if (els.result) {
          window.setTimeout(function () {
            els.result.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 120);
        }
      } catch (error) {
        state.submitting = false;
        setStatus("We could not save the assessment right now. You can refresh and try again, or book a Snooze Session.", true);
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
        state.loading = false;
        persist();
        render();
      } catch (error) {
        state.questions = buildQuestionFlow(DEFAULT_QUESTIONS);
        state.loading = false;
        setStatus("The full question set is not loading right now, so I started the core assessment path instead.", false);
        persist();
        render();
      }
    }

    if (els.heroJump) {
      els.heroJump.addEventListener("click", function () {
        scrollToApp();
      });
    }

    if (els.heroAsk) {
      els.heroAsk.addEventListener("click", function () {
        openSnoozerPanel();
      });
    }

    if (els.bottomAsk) {
      els.bottomAsk.addEventListener("click", function () {
        openSnoozerPanel();
      });
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
