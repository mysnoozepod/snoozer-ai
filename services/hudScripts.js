const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { validateHudContract, enforceHudContract } = require("../utils/responseContract");

const REGION = process.env.AWS_REGION || "us-east-1";
const HUD_SCRIPT_BUCKET = process.env.HUD_SCRIPT_BUCKET || "snoozer-assets-prod";
const HUD_SCRIPT_PREFIX = String(process.env.HUD_SCRIPT_PREFIX || "scripts/hud")
  .replace(/^\/+/, "")
  .replace(/\/+$/, "");
const HUD_SCRIPT_SAFE_TIMEOUT_MS = Math.max(
  50,
  Number(process.env.HUD_SCRIPT_SAFE_TIMEOUT_MS || process.env.S3_RETRIEVAL_TIMEOUT_MS || 300)
);
const HUD_SCRIPT_CACHE_MAX_KEYS = 256;

const s3 = new S3Client({ region: REGION });

const hudScriptCache = new Map();
const inflightLoads = new Map();

const PAGE_ALIASES = {
  welcome: "welcome",
  whattoexpect: "what_to_expect",
  what_to_expect: "what_to_expect",
  assessment: "assessment",
  results: "results",
  pod: "pod",
  rest: "rest_test",
  resttest: "rest_test",
  rest_test: "rest_test",
  build: "build",
  cart: "cart",
  checkout: "checkout",
  global: "global",
};

const SCRIPT_KEY_ALIASES = {
  "welcome.entry.new": { page: "welcome", event: "enter" },
  "welcome.enter": { page: "welcome", event: "enter" },
  "whattoexpect.default": { page: "what_to_expect", event: "enter" },
  "whattoexpect.assessment_complete": { page: "what_to_expect", event: "assessment_complete" },
  "what_to_expect.enter": { page: "what_to_expect", event: "enter" },
  "assessment.intro": { page: "assessment", event: "intro" },
  "assessment.progress.halfway": { page: "assessment", event: "halfway" },
  "assessment.complete": { page: "assessment", event: "completion" },
  "assessment.saving": { page: "assessment", event: "saving" },
  "assessment.motion.half_split_invalid": {
    page: "assessment",
    event: "motion_half_split_invalid",
  },
  "assessment.motion.full_split_invalid": {
    page: "assessment",
    event: "motion_full_split_invalid",
  },
  "results.intro": { page: "results", event: "enter" },
  "pod.enter": { page: "pod", event: "enter" },
  "pod.details.default": { page: "pod", event: "details_default" },
  "pod.details.feel": { page: "pod", event: "details_feel" },
  "pod.details.inside": { page: "pod", event: "details_inside" },
  "pod.details.lasts": { page: "pod", event: "details_lasts" },
  "pod.details.choose": { page: "pod", event: "details_choose" },
  "pod.build.default": { page: "build", event: "intro" },
  "build.intro": { page: "build", event: "intro" },
  "pod.rest.quick.start": { page: "rest_test", event: "start" },
  "pod.rest.deep.start": { page: "rest_test", event: "deep_start" },
  "pod.rest.quick.reflection": { page: "rest_test", event: "reflection" },
  "pod.rest.deep.reflection": { page: "rest_test", event: "deep_reflection" },
  "pod.rest.quick.actions": { page: "rest_test", event: "actions" },
  "pod.rest.deep.actions": { page: "rest_test", event: "deep_actions" },
  "pod.rest.head_up": { page: "rest_test", event: "head_up" },
  "pod.rest.zero_g": { page: "rest_test", event: "zero_g" },
  "pod.rest.return_flat": { page: "rest_test", event: "return_flat" },
  "cart.enter": { page: "cart", event: "enter" },
  "checkout.handoff": { page: "checkout", event: "handoff" },
  "global.retrieval_warning": { page: "global", event: "retrieval_warning" },
  "global.offline_mode": { page: "global", event: "offline_mode" },
  "global.tts_failure": { page: "global", event: "tts_failure" },
};

const HARD_CODED_FALLBACKS = {
  "welcome/enter": {
    speech:
      "Hi, welcome to MySnoozePod. I'm Snoozer, your personal sleep assistant. Let's get you sleeping better.",
    captions:
      "Hi, welcome to MySnoozePod. I'm Snoozer, your personal sleep assistant. Let's get you sleeping better.",
    state: "speaking",
    priority: "high",
    ttlMs: 5200,
    actions: [],
    voiceStyle: "default",
  },
  "what_to_expect/enter": {
    speech:
      "Here is what to expect. We'll guide you through a quick assessment, show you your recommended pods, and help you test what fits you best.",
    captions:
      "Here is what to expect. We'll guide you through a quick assessment, show you your recommended pods, and help you test what fits you best.",
    state: "speaking",
    priority: "normal",
    ttlMs: 5600,
    actions: [],
    voiceStyle: "default",
  },
  "what_to_expect/assessment_complete": {
    speech:
      "You're already set with an assessment, so you can go straight to your recommended pods or retake the assessment if you want a fresh pass.",
    captions:
      "You're already set with an assessment, so you can go straight to your recommended pods or retake the assessment if you want a fresh pass.",
    state: "speaking",
    priority: "normal",
    ttlMs: 5600,
    actions: [],
    voiceStyle: "default",
  },
  "assessment/intro": {
    speech: "Let's begin your Snooze Assessment.",
    captions: "Let's begin your Snooze Assessment.",
    state: "speaking",
    priority: "high",
    ttlMs: 4000,
    actions: [],
    voiceStyle: "calm",
  },
  "assessment/halfway": {
    speech: "Nice progress. You're halfway through the Snooze Assessment.",
    captions: "Nice progress. You're halfway through the Snooze Assessment.",
    state: "celebrate",
    priority: "normal",
    ttlMs: 3600,
    actions: [],
    voiceStyle: "calm",
  },
  "assessment/completion": {
    speech: "Assessment complete.",
    captions: "Assessment complete.",
    state: "celebrate",
    priority: "normal",
    ttlMs: 3600,
    actions: [],
    voiceStyle: "calm",
  },
  "assessment/saving": {
    speech: "Saving your results.",
    captions: "Saving your results.",
    state: "thinking",
    priority: "normal",
    ttlMs: 2600,
    actions: [],
    voiceStyle: "calm",
  },
  "assessment/motion_half_split_invalid": {
    speech: "Half split is not available with that size.",
    captions: "Half split is not available with that size.",
    state: "warning",
    priority: "high",
    ttlMs: 3600,
    actions: [],
    voiceStyle: "default",
  },
  "assessment/motion_full_split_invalid": {
    speech: "Full split is only available on supported king configurations.",
    captions: "Full split is only available on supported king configurations.",
    state: "warning",
    priority: "high",
    ttlMs: 3600,
    actions: [],
    voiceStyle: "default",
  },
  "results/enter": {
    speech:
      "These are the pods Snoozer wants you to test first. Start with the strongest match and I'll help explain why.",
    captions:
      "These are the pods Snoozer wants you to test first. Start with the strongest match and I'll help explain why.",
    state: "speaking",
    priority: "high",
    ttlMs: 5400,
    actions: [],
    voiceStyle: "default",
  },
  "pod/enter": {
    speech:
      "This is your pod. You can start a rest test, hear the details, or finish your setup when you're ready.",
    captions:
      "This is your pod. You can start a rest test, hear the details, or finish your setup when you're ready.",
    state: "speaking",
    priority: "normal",
    ttlMs: 5600,
    actions: [],
    voiceStyle: "default",
  },
  "pod/details_default": {
    speech:
      "Use these guides to hear how this pod feels, what is inside, why it lasts, and why Snoozer matched it to you.",
    captions:
      "Use these guides to hear how this pod feels, what is inside, why it lasts, and why Snoozer matched it to you.",
    state: "speaking",
    priority: "normal",
    ttlMs: 5600,
    actions: [],
    voiceStyle: "default",
  },
  "pod/details_feel": {
    speech:
      "Start by noticing how the top layers handle pressure, support, and overall balance as you settle in.",
    captions:
      "Start by noticing how the top layers handle pressure, support, and overall balance as you settle in.",
    state: "speaking",
    priority: "normal",
    ttlMs: 5200,
    actions: [],
    voiceStyle: "calm",
  },
  "pod/details_inside": {
    speech:
      "This guide explains what is inside the pod and what those materials change about the feel on the bed.",
    captions:
      "This guide explains what is inside the pod and what those materials change about the feel on the bed.",
    state: "speaking",
    priority: "normal",
    ttlMs: 5200,
    actions: [],
    voiceStyle: "calm",
  },
  "pod/details_lasts": {
    speech:
      "This guide explains why the support structure matters over time and what to notice about long-term stability.",
    captions:
      "This guide explains why the support structure matters over time and what to notice about long-term stability.",
    state: "speaking",
    priority: "normal",
    ttlMs: 5200,
    actions: [],
    voiceStyle: "calm",
  },
  "pod/details_choose": {
    speech:
      "This is why Snoozer put this pod in front of you first based on the needs you shared in your assessment.",
    captions:
      "This is why Snoozer put this pod in front of you first based on the needs you shared in your assessment.",
    state: "speaking",
    priority: "high",
    ttlMs: 5200,
    actions: [],
    voiceStyle: "calm",
  },
  "rest_test/start": {
    speech:
      "Choose the rest test that fits how long you want to stay with this pod, and I'll guide you step by step.",
    captions:
      "Choose the rest test that fits how long you want to stay with this pod, and I'll guide you step by step.",
    state: "speaking",
    priority: "normal",
    ttlMs: 5400,
    actions: [],
    voiceStyle: "calm",
  },
  "rest_test/deep_start": {
    speech:
      "We'll take a longer rest test here so you can settle in, change position, and notice how support holds up over time.",
    captions:
      "We'll take a longer rest test here so you can settle in, change position, and notice how support holds up over time.",
    state: "speaking",
    priority: "normal",
    ttlMs: 5600,
    actions: [],
    voiceStyle: "calm",
  },
  "rest_test/head_up": {
    speech: "Raise the head slightly and notice how your shoulders, neck, and lower back respond.",
    captions: "Raise the head slightly and notice how your shoulders, neck, and lower back respond.",
    state: "speaking",
    priority: "normal",
    ttlMs: 4800,
    actions: [],
    voiceStyle: "calm",
  },
  "rest_test/zero_g": {
    speech: "Try Zero Gravity and notice whether pressure eases off your lower back and hips.",
    captions: "Try Zero Gravity and notice whether pressure eases off your lower back and hips.",
    state: "speaking",
    priority: "normal",
    ttlMs: 4800,
    actions: [],
    voiceStyle: "calm",
  },
  "rest_test/return_flat": {
    speech: "Come back to flat and notice what changes once the bed returns to a neutral position.",
    captions: "Come back to flat and notice what changes once the bed returns to a neutral position.",
    state: "speaking",
    priority: "normal",
    ttlMs: 4800,
    actions: [],
    voiceStyle: "calm",
  },
  "rest_test/reflection": {
    speech: "What stood out most during that rest test?",
    captions: "What stood out most during that rest test?",
    state: "speaking",
    priority: "normal",
    ttlMs: 4200,
    actions: [],
    voiceStyle: "calm",
  },
  "rest_test/deep_reflection": {
    speech: "What stood out most after the full rest test?",
    captions: "What stood out most after the full rest test?",
    state: "speaking",
    priority: "normal",
    ttlMs: 4200,
    actions: [],
    voiceStyle: "calm",
  },
  "rest_test/actions": {
    speech: "You can try the longer test, view pod details, build your pod, or go back to the rest test options.",
    captions:
      "You can try the longer test, view pod details, build your pod, or go back to the rest test options.",
    state: "speaking",
    priority: "normal",
    ttlMs: 5600,
    actions: [],
    voiceStyle: "calm",
  },
  "rest_test/deep_actions": {
    speech: "You can retake this test, view pod details, build your pod, or go back to the rest test options.",
    captions:
      "You can retake this test, view pod details, build your pod, or go back to the rest test options.",
    state: "speaking",
    priority: "normal",
    ttlMs: 5600,
    actions: [],
    voiceStyle: "calm",
  },
  "build/intro": {
    speech:
      "Let's finish your SnoozePod. Choose your size, base, and comfort setup, then review everything before you add it to your cart.",
    captions:
      "Let's finish your SnoozePod. Choose your size, base, and comfort setup, then review everything before you add it to your cart.",
    state: "speaking",
    priority: "high",
    ttlMs: 6200,
    actions: [],
    voiceStyle: "default",
  },
  "cart/enter": {
    speech:
      "Here's your cart. Review what's inside, then continue when you're ready for checkout.",
    captions:
      "Here's your cart. Review what's inside, then continue when you're ready for checkout.",
    state: "speaking",
    priority: "normal",
    ttlMs: 5000,
    actions: [],
    voiceStyle: "default",
  },
  "checkout/handoff": {
    speech:
      "You're ready for checkout. Review the details and continue when you're ready to finish.",
    captions:
      "You're ready for checkout. Review the details and continue when you're ready to finish.",
    state: "celebrate",
    priority: "high",
    ttlMs: 5200,
    actions: [],
    voiceStyle: "default",
  },
  "global/retrieval_warning": {
    speech:
      "I can keep guiding you, but the script service is temporarily unavailable, so I'm using a safe backup.",
    captions:
      "I can keep guiding you, but the script service is temporarily unavailable, so I'm using a safe backup.",
    state: "warning",
    priority: "high",
    ttlMs: 7000,
    actions: [],
    voiceStyle: "default",
  },
  "global/offline_mode": {
    speech:
      "Snoozer is in offline mode right now. Captions will keep working, and I'll stay on the safest scripted fallback.",
    captions:
      "Snoozer is in offline mode right now. Captions will keep working, and I'll stay on the safest scripted fallback.",
    state: "warning",
    priority: "high",
    ttlMs: 7000,
    actions: [],
    voiceStyle: "default",
  },
  "global/tts_failure": {
    speech:
      "Audio is unavailable right now, but the captions are still here and the next step on screen is still correct.",
    captions:
      "Audio is unavailable right now, but the captions are still here and the next step on screen is still correct.",
    state: "warning",
    priority: "high",
    ttlMs: 7000,
    actions: [],
    voiceStyle: "default",
  },
};

function lower(value) {
  return String(value || "").toLowerCase().trim();
}

function normalizeVoiceStyle(value, fallback = "default") {
  return lower(value) === "calm" ? "calm" : fallback;
}

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w.-]+/g, "_")
    .replace(/[.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizePage(value) {
  const normalized = normalizeToken(value);
  return PAGE_ALIASES[normalized] || normalized;
}

function normalizeEvent(value) {
  return normalizeToken(value);
}

function canonicalScriptKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, ".")
    .replace(/_+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.|\.$/g, "");
}

function withTimeout(promise, timeoutMs, code, message, extra = {}) {
  let timer = null;

  return Promise.race([
    Promise.resolve().then(() => promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message);
        error.code = code;
        error.timeoutMs = timeoutMs;
        Object.assign(error, extra);
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function elapsedMs(startedAtMs) {
  return Math.max(0, Date.now() - Number(startedAtMs || Date.now()));
}

async function streamToString(stream) {
  if (!stream) return "";

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf-8");
}

function isMissingKeyError(error) {
  const code = String(error?.name || error?.code || "").toLowerCase();
  const httpStatus = Number(error?.$metadata?.httpStatusCode || 0);
  return code.includes("nosuchkey") || code.includes("notfound") || httpStatus === 404;
}

function buildS3Key(page, event) {
  return `${HUD_SCRIPT_PREFIX}/${page}/${event}.json`;
}

function getHudScriptFromCache(cacheKey) {
  const cached = hudScriptCache.get(cacheKey);
  if (!cached) return null;

  hudScriptCache.delete(cacheKey);
  hudScriptCache.set(cacheKey, cached);
  return cached;
}

function setHudScriptCache(cacheKey, script) {
  hudScriptCache.delete(cacheKey);
  hudScriptCache.set(cacheKey, {
    script,
    cachedAt: Date.now(),
  });

  while (hudScriptCache.size > HUD_SCRIPT_CACHE_MAX_KEYS) {
    const oldest = hudScriptCache.keys().next().value;
    hudScriptCache.delete(oldest);
  }
}

function normalizeValidatedPayload(raw, fallbackVoiceStyle = "default") {
  const validation = validateHudContract(raw);
  if (!validation.valid) {
    return {
      payload: null,
      validation,
    };
  }

  return {
    payload: {
      ...validation.value,
      voiceStyle: normalizeVoiceStyle(raw?.voiceStyle, fallbackVoiceStyle),
    },
    validation,
  };
}

function buildHardcodedFallback(page, event) {
  const normalizedPage = normalizePage(page);
  const normalizedEvent = normalizeEvent(event);
  const exactKey = `${normalizedPage}/${normalizedEvent}`;

  const candidates = [
    exactKey,
    normalizedPage === "what_to_expect" ? "what_to_expect/enter" : null,
    normalizedPage === "results" ? "results/enter" : null,
    normalizedPage === "pod" ? "pod/enter" : null,
    normalizedPage === "rest_test" ? "rest_test/start" : null,
    normalizedPage === "build" ? "build/intro" : null,
    normalizedPage === "cart" ? "cart/enter" : null,
    normalizedPage === "checkout" ? "checkout/handoff" : null,
    "global/retrieval_warning",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const fallback = HARD_CODED_FALLBACKS[candidate];
    if (!fallback) continue;

    const normalized = enforceHudContract(fallback);
    return {
      ...normalized,
      voiceStyle: normalizeVoiceStyle(fallback?.voiceStyle, "default"),
    };
  }

  const emergency = enforceHudContract({
    speech: "I'm here if you need me.",
    captions: "I'm here if you need me.",
    state: "warning",
    priority: "high",
    ttlMs: 5000,
    actions: [],
  });

  return {
    ...emergency,
    voiceStyle: "default",
  };
}

function resolveFromScriptKey(scriptKey) {
  const canonical = canonicalScriptKey(scriptKey);
  if (!canonical) return null;

  const aliased = SCRIPT_KEY_ALIASES[canonical];
  if (aliased) {
    return {
      page: aliased.page,
      event: aliased.event,
      source: "alias",
      scriptKey: canonical,
    };
  }

  const parts = canonical.split(".").filter(Boolean);
  if (parts.length < 2) return null;

  return {
    page: normalizePage(parts[0]),
    event: normalizeEvent(parts.slice(1).join("_")),
    source: "derived",
    scriptKey: canonical,
  };
}

function resolveHudScriptRequest(request = {}) {
  const page = normalizePage(request?.page);
  const event = normalizeEvent(request?.event);
  const rawScriptKey = request?.scriptKey || request?.hudScriptKey || "";
  const scriptKey = canonicalScriptKey(rawScriptKey);

  if (page && event) {
    return {
      page,
      event,
      source: "page_event",
      scriptKey,
      requestedScriptKey: String(rawScriptKey || "").trim() || null,
    };
  }

  const derived = resolveFromScriptKey(rawScriptKey);
  if (derived?.page && derived?.event) {
    return {
      page: derived.page,
      event: derived.event,
      source: derived.source,
      scriptKey: derived.scriptKey,
      requestedScriptKey: String(rawScriptKey || "").trim() || null,
    };
  }

  return {
    page: "global",
    event: "retrieval_warning",
    source: "fallback_default",
    scriptKey,
    requestedScriptKey: String(rawScriptKey || "").trim() || null,
  };
}

async function fetchHudScriptFromS3(bucket, key) {
  const out = await withTimeout(
    s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    ),
    HUD_SCRIPT_SAFE_TIMEOUT_MS,
    "HUD_SCRIPT_TIMEOUT",
    `HUD script retrieval exceeded ${HUD_SCRIPT_SAFE_TIMEOUT_MS}ms`,
    { bucket, key }
  );

  const raw = await streamToString(out?.Body);
  return JSON.parse(raw || "{}");
}

function logHudScriptResolution({
  traceId = null,
  page,
  event,
  resolvedS3Key,
  cacheHit,
  retrievalMs,
  validationPassed,
  fallbackUsed,
  fallbackTier,
  totalMs,
  source,
  requestedScriptKey = null,
  error = null,
}) {
  console.log(
    JSON.stringify({
      source: "hud_script",
      eventName: "resolve",
      time: new Date().toISOString(),
      traceId,
      page,
      hudEvent: event,
      requestedScriptKey,
      requestSource: source,
      resolvedS3Key,
      cacheHit: Boolean(cacheHit),
      retrievalMs: Number(retrievalMs || 0),
      validationPassed: Boolean(validationPassed),
      fallbackUsed: Boolean(fallbackUsed),
      fallbackTier: fallbackTier || "hardcoded",
      totalMs: Number(totalMs || 0),
      errorCode: error?.code || null,
      errorMessage: error?.message || null,
    })
  );
}

async function getHudScript(request = {}, opts = {}) {
  const startedAt = Date.now();
  const resolved = resolveHudScriptRequest(request);
  const page = resolved.page;
  const event = resolved.event;
  const bucket = HUD_SCRIPT_BUCKET;
  const resolvedKey = buildS3Key(page, event);
  const resolvedS3Key = `${bucket}/${resolvedKey}`;
  const cacheKey = resolvedS3Key.trim().toLowerCase();
  const inflightKey = cacheKey;
  const cacheHasKeyBeforeRead = hudScriptCache.has(cacheKey);

  let retrievalMs = 0;
  let error = null;
  let validationPassed = false;

  const finalize = ({ payload, cacheHit, fallbackTier, fallbackUsed, validationPassed }) => {
    const totalMs = elapsedMs(startedAt);

    logHudScriptResolution({
      traceId: opts.traceId || null,
      page,
      event,
      resolvedS3Key,
      cacheHit,
      retrievalMs,
      validationPassed,
      fallbackUsed,
      fallbackTier,
      totalMs,
      source: resolved.source,
      requestedScriptKey: resolved.requestedScriptKey,
      error,
    });

    return {
      script: payload,
      meta: {
        page,
        event,
        requestedScriptKey: resolved.requestedScriptKey,
        resolvedS3Key,
        cacheHit,
        retrievalMs,
        validationPassed,
        fallbackUsed,
        fallbackTier,
        totalMs,
        source: resolved.source,
        error: error
          ? {
              code: error.code || "HUD_SCRIPT_RESOLVE_FAILED",
              message: error.message || "HUD script resolution failed",
            }
          : null,
      },
    };
  };

  const cached = cacheHasKeyBeforeRead ? getHudScriptFromCache(cacheKey) : null;
  if (cached?.script) {
    return finalize({
      payload: cached.script,
      cacheHit: true,
      fallbackTier: "cache",
      fallbackUsed: false,
      validationPassed: true,
    });
  }

  try {
    if (!inflightLoads.has(inflightKey)) {
      inflightLoads.set(
        inflightKey,
        (async () => {
          const s3StartedAt = Date.now();
          try {
            const parsed = await fetchHudScriptFromS3(bucket, resolvedKey);
            return {
              parsed,
              retrievalMs: elapsedMs(s3StartedAt),
            };
          } catch (err) {
            err.retrievalMs = elapsedMs(s3StartedAt);
            throw err;
          }
        })()
      );
    }

    const { parsed, retrievalMs: fetchedRetrievalMs } = await inflightLoads.get(inflightKey);
    retrievalMs = fetchedRetrievalMs;
    const normalized = normalizeValidatedPayload(parsed, "default");

    if (normalized.payload) {
      validationPassed = true;
      setHudScriptCache(cacheKey, normalized.payload);
      return finalize({
        payload: normalized.payload,
        cacheHit: false,
        fallbackTier: "s3",
        fallbackUsed: false,
        validationPassed,
      });
    }

    validationPassed = false;
    error = new Error(
      normalized.validation.errors.length
        ? normalized.validation.errors.join("; ")
        : "HUD script validation failed"
    );
    error.code = "HUD_SCRIPT_INVALID";
  } catch (err) {
    retrievalMs = Number(err?.retrievalMs || retrievalMs || 0);
    if (isMissingKeyError(err) && !err.code) {
      err.code = "HUD_SCRIPT_NOT_FOUND";
    }
    error = err;
  } finally {
    inflightLoads.delete(inflightKey);
  }

  return finalize({
    payload: buildHardcodedFallback(page, event),
    cacheHit: false,
    fallbackTier: "hardcoded",
    fallbackUsed: true,
    validationPassed,
  });
}

async function getHudScriptPayload(request = {}, opts = {}) {
  const normalizedRequest =
    typeof request === "string" ? { scriptKey: request } : request && typeof request === "object" ? request : {};

  const out = await getHudScript(normalizedRequest, opts);

  return {
    ...out.script,
    scriptMeta: out.meta,
  };
}

module.exports = {
  HUD_SCRIPT_BUCKET,
  HUD_SCRIPT_PREFIX,
  HUD_SCRIPT_SAFE_TIMEOUT_MS,
  resolveHudScriptRequest,
  getHudScript,
  getHudScriptPayload,
};
