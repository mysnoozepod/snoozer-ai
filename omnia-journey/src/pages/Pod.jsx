// src/pages/Pod.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ShoppingCart,
  CreditCard,
  Timer,
  MessageSquare,
  BedDouble,
  CheckCircle2,
  HelpCircle,
  ImageOff,
  Headphones,
  Sparkles,
} from "lucide-react";

import { api } from "@/lib/api";
import PodBuilder from "@/components/PodBuilder";
import { generateShowroomRecommendations } from "@/lib/utils/recommendations";
import { useStore } from "@/lib/useStore";
import { useShowroomHud } from "@/lib/snoozer/hud/useShowroomHud";

import snoozerRestChoiceImg from "@/assets/avatars/snoozer-rest-choice.png";
import snoozerRestActiveImg from "@/assets/avatars/snoozer-rest-active.png";
import snoozerRestTransitionImg from "@/assets/avatars/snoozer-rest-transition.png";

const PUBLIC_ASSETS = {
  snoozerAvatar: "/snoozer-avatar.png",
  sizeDimensions: "/size-dimensions.png",
  standardMotion: "/standard-motion.png",
  halfSplitMotion: "/half-split-motion.png",
  fullSplitMotion: "/full-split-motion.png",
  noImage: "/no-image.svg",
};

function safeGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, val) {
  try {
    sessionStorage.setItem(key, val);
  } catch {}
}

function safeParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function normalizePodId(v) {
  const n = String(v ?? "").trim();
  return n || "1";
}

function pickFirstVariantId(fullProduct) {
  let v0 = null;

  if (Array.isArray(fullProduct?.variants)) {
    v0 = fullProduct.variants[0] || null;
  } else if (Array.isArray(fullProduct?.variants?.edges)) {
    v0 = fullProduct.variants.edges[0]?.node || null;
  } else if (Array.isArray(fullProduct?.variants?.nodes)) {
    v0 = fullProduct.variants.nodes[0] || null;
  }

  return v0?.id || null;
}

function stripLegacyPodImageFields(pod) {
  if (!pod || typeof pod !== "object") return pod;

  const next = { ...pod };
  delete next.image;
  delete next.imageUrl;
  delete next.image_url;
  delete next.mattressImage;
  delete next.mattressImageUrl;
  delete next.mattress_image;

  return next;
}

function sanitizeRecommendationsPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  const pods = Array.isArray(payload?.pods)
    ? payload.pods.map((p) => stripLegacyPodImageFields(p))
    : [];

  return {
    ...payload,
    pods,
  };
}

function sanitizeImageUrl(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\//i.test(s)) return s;
  if (/^\//.test(s)) return s;
  return "";
}

function normalizeImageCandidates(input) {
  if (Array.isArray(input)) {
    return input.map((value) => sanitizeImageUrl(value)).filter(Boolean);
  }

  const single = sanitizeImageUrl(input);
  return single ? [single] : [];
}

function pickProductImage(product) {
  const candidates = [
    product?.imageUrl,
    product?.image,
    product?.featuredImage?.url,
    product?.featuredImage?.src,
    product?.images?.[0]?.url,
    product?.images?.[0]?.src,
    product?.images?.edges?.[0]?.node?.url,
    product?.media?.[0]?.image?.url,
    product?.media?.[0]?.preview?.image?.url,
  ];

  for (const candidate of candidates) {
    const url = sanitizeImageUrl(candidate);
    if (url) return url;
  }

  return "";
}

function extractPainSignals(assessment = {}) {
  const chips = [];

  const asStr = (v) => (typeof v === "string" ? v.toLowerCase() : "");
  const has = (v, term) => asStr(v).includes(term);

  const position =
    assessment.position ||
    assessment.sleepPosition ||
    assessment.primaryPosition ||
    assessment?.answers?.position ||
    assessment?.answers?.sleepPosition;

  if (position) {
    const p = String(position).toLowerCase();
    if (p.includes("side")) chips.push({ key: "side", label: "side sleeping" });
    else if (p.includes("back")) chips.push({ key: "back", label: "back sleeping" });
    else if (p.includes("stomach")) chips.push({ key: "stomach", label: "stomach sleeping" });
  }

  const pain =
    assessment.pain ||
    assessment.painPoints ||
    assessment?.answers?.pain ||
    assessment?.answers?.painPoints;
  const painList = Array.isArray(pain) ? pain : pain ? [pain] : [];

  for (const item of painList) {
    const v = String(item).toLowerCase();
    if (v.includes("shoulder")) chips.push({ key: "shoulder", label: "shoulder pressure" });
    if (v.includes("hip")) chips.push({ key: "hip", label: "hip pressure" });
    if (v.includes("back") || v.includes("lumbar")) {
      chips.push({ key: "backpain", label: "lower back support" });
    }
    if (v.includes("neck")) chips.push({ key: "neck", label: "neck support" });
  }

  const temp =
    assessment.temperature ||
    assessment.sleepsHot ||
    assessment?.answers?.temperature ||
    assessment?.answers?.sleepsHot;
  if (temp === true || has(temp, "hot") || has(temp, "warm")) {
    chips.push({ key: "hot", label: "sleeping hot" });
  }

  const partner =
    assessment.partner ||
    assessment.shareBed ||
    assessment?.answers?.partner ||
    assessment?.answers?.shareBed;
  if (partner === true || has(partner, "yes") || has(partner, "partner")) {
    chips.push({ key: "partner", label: "sharing the bed" });
  }

  const uniq = [];
  const seen = new Set();
  for (const c of chips) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    uniq.push(c);
  }

  return uniq.slice(0, 4);
}

function buildBenefits(painSignals = []) {
  const keys = new Set((painSignals || []).map((c) => c.key));
  const list = [];

  if (keys.has("shoulder") || keys.has("hip")) list.push("Pressure relief");
  if (keys.has("backpain") || keys.has("back")) list.push("Lower-back support");
  if (keys.has("partner")) list.push("Motion control");
  if (keys.has("hot")) list.push("Breathability");

  if (!list.length) list.push("Balanced comfort");
  return list.slice(0, 4);
}

function buildWhyThisPodReason(painSignals = []) {
  const priority =
    painSignals.find((x) => x?.key === "backpain") ||
    painSignals.find((x) => x?.key === "shoulder") ||
    painSignals.find((x) => x?.key === "hip") ||
    painSignals.find((x) => x?.key === "hot") ||
    painSignals[0] ||
    null;

  return priority?.label || "overall comfort and support";
}

function buildWhyThisPodSentence(painSignals = []) {
  const reason = buildWhyThisPodReason(painSignals);
  return `Because during your Snooze Assessment, you said ${reason} was important.`;
}

function buildHeaderPersonalization(painSignals = []) {
  const reason = buildWhyThisPodReason(painSignals);
  return `Recommended for you because you mentioned ${reason} during your Snooze Assessment.`;
}

function buildNotIdealFor(painSignals = []) {
  const keys = new Set((painSignals || []).map((c) => c.key));
  const list = [];

  if (keys.has("stomach")) list.push("Very firm stomach-sleeper preference");
  if (keys.has("partner")) list.push("Couples focused mainly on motion separation");
  if (!list.length) list.push("Shoppers wanting a very different feel profile");

  return list.slice(0, 3);
}

function buildDetailBullets({ mattressTitle, benefits, painSignals, isRecommended, rank }) {
  const items = [];

  if (mattressTitle) items.push(`${mattressTitle}`);
  if (isRecommended) items.push(`Recommended #${rank || "1"} match from your assessment`);
  if (benefits?.length) items.push(...benefits.slice(0, 3));
  if (painSignals?.length) {
    const labels = painSignals
      .map((x) => x?.label)
      .filter(Boolean)
      .slice(0, 2)
      .join(" and ");
    if (labels) items.push(`Matched for ${labels}`);
  }

  return items.slice(0, 5);
}

function buildPodRestVoice({ title, mattressHeroTitle, painSignals }) {
  const reason = buildWhyThisPodReason(painSignals);
  return [
    `Start with Rest Test in ${title}.`,
    `${mattressHeroTitle}.`,
    `Focus on ${reason}.`,
    "Choose either the 7-minute or 15-minute rest test to begin.",
  ].join(" ");
}

function buildPodDetailsVoice({ title, mattressHeroTitle, benefits, isRecommended, rank }) {
  return [
    `${title}.`,
    `${mattressHeroTitle}.`,
    isRecommended ? `Recommended #${rank || "1"}.` : "Selected for you.",
    benefits?.[0] || "Review the match details.",
  ]
    .filter(Boolean)
    .join(" ");
}

const DETAILS_ACTIONS = [
  { id: "feel", label: "How it feels" },
  { id: "inside", label: "What's inside" },
  { id: "lasts", label: "Why it lasts" },
  { id: "choose", label: "Why choose this" },
];

const DEFAULT_DETAILS_ACTION_ID = "choose";

function normalizeText(value) {
  return String(value || "").trim();
}

function lowerText(value) {
  return normalizeText(value).toLowerCase();
}

function stripHtml(value) {
  return normalizeText(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function joinReadableList(items = []) {
  const list = (Array.isArray(items) ? items : [])
    .map((item) => normalizeText(item))
    .filter(Boolean);

  if (!list.length) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

function detectMattressTruth({ mattressProduct, activePod, baseProduct }) {
  const mattressTitle = normalizeText(
    mattressProduct?.title || activePod?.displayMattress || activePod?.subtitle || "Mattress"
  );
  const mattressHandle = normalizeText(mattressProduct?.handle || activePod?.mattressHandle);
  const mattressDescription = stripHtml(mattressProduct?.description || "");
  const baseTitle = normalizeText(baseProduct?.title || activePod?.displayedIn?.baseLabel || "");
  const combined = `${mattressTitle} ${mattressHandle} ${mattressDescription} ${baseTitle}`.toLowerCase();

  const isDualComfort =
    Boolean(activePod?.flags?.isDualComfortMattress) || combined.includes("dual comfort");
  const family = isDualComfort
    ? "dual"
    : combined.includes("hybrid") || combined.includes("coil")
      ? "hybrid"
      : combined.includes("foam")
        ? "foam"
        : "balanced";

  return {
    mattressTitle,
    mattressDescription,
    baseTitle,
    family,
    isDualComfort,
    hasCoils: family === "hybrid" || family === "dual" || combined.includes("coil"),
    hasCooling:
      combined.includes("cool") ||
      combined.includes("cooling") ||
      combined.includes("breathable") ||
      combined.includes("temperature") ||
      combined.includes("gel"),
    hasPressureRelief:
      combined.includes("pressure") ||
      combined.includes("relief") ||
      combined.includes("cushion") ||
      combined.includes("comfort"),
  };
}

function buildPodReasonContext(pod, recommendationMeta = {}) {
  return {
    hasPartner: recommendationMeta?.hasPartner === true,
    size: normalizeText(recommendationMeta?.size),
    position: lowerText(recommendationMeta?.position),
    firmness: lowerText(recommendationMeta?.firmness),
    isDualComfort: Boolean(pod?.flags?.isDualComfortMattress),
    isAdjustable:
      Boolean(pod?.flags?.isAdjustableFixture) ||
      pod?.hasAdjustableBase === true ||
      lowerText(pod?.baseType) === "adjustable",
  };
}

function getPodReasonVariant(reasonKey, ctx) {
  switch (normalizeText(reasonKey)) {
    case "requested_full_split":
      return "it supports the Full Split motion you asked for";
    case "requested_half_split":
      return "it supports the Half Split motion you asked for";
    case "split_requires_dual":
      return "its Dual Comfort setup lines up with the split-motion path from your assessment";
    case "partner_friendly":
      return ctx.isDualComfort
        ? "its Dual Comfort setup is a strong fit for shared sleep"
        : "it gives you a more partner-friendly setup to test";
    case "primary_mattress_exact":
      return "it matches the mattress style Snoozer would test first for you";
    case "primary_mattress_family":
      return "it stays close to the mattress style Snoozer matched to your assessment";
    case "side_sleeper_pressure_relief":
      return "it may give you the pressure relief side sleepers often notice first";
    case "back_or_stomach_support":
      return "it may give you the support back and stomach sleepers usually need";
    case "firmness_firm_match":
      return "it lines up with the firmer feel you selected";
    case "firmness_soft_match":
      return "it lines up with the softer feel you selected";
    case "requested_standard_motion":
      return "it gives you an adjustable setup with standard motion";
    case "fixture_size_match":
      return ctx.size
        ? `it is shown in ${ctx.size}, which matches the size you selected`
        : "it matches the size path from your assessment";
    case "simple_non_motion_option":
      return "it gives you a simpler non-motion option to anchor your comparison";
    default:
      return "";
  }
}

function getPodFallbackReason(ctx) {
  if (ctx.isDualComfort && ctx.hasPartner) {
    return "its Dual Comfort setup gives shared sleep more flexibility";
  }

  if (ctx.isDualComfort) {
    return "it gives you a flexible Dual Comfort setup to test early";
  }

  if (ctx.isAdjustable) {
    return "it gives you an adjustable setup worth testing early";
  }

  if (ctx.position === "side") {
    return "it gives you another pressure-relief-focused option to test";
  }

  if (ctx.firmness === "firm") {
    return "it gives you another supportive option to test";
  }

  return "it gives you another strong pod to test before deciding";
}

function pickPreferredReasonKeys(reasonKeys = []) {
  const preferredOrder = [
    "requested_full_split",
    "requested_half_split",
    "split_requires_dual",
    "partner_friendly",
    "primary_mattress_exact",
    "primary_mattress_family",
    "side_sleeper_pressure_relief",
    "back_or_stomach_support",
    "firmness_firm_match",
    "firmness_soft_match",
    "requested_standard_motion",
    "fixture_size_match",
    "simple_non_motion_option",
  ];

  return preferredOrder.filter((key) => reasonKeys.includes(key));
}

function buildPodBuildVoice({ title, mattressTitle, isDualComfort }) {
  return [
    `Let's finish your SnoozePod.`,
    mattressTitle
      ? `We will keep ${mattressTitle} as the mattress on this pod.`
      : "We will keep the mattress already on this pod.",
    isDualComfort
      ? "Choose your size, base, motion setup, and comfort on each side, then review everything before you add it to your cart."
      : "Choose your size, base, and motion setup if you want it, then review everything before you add it to your cart.",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildPodCheckoutVoice() {
  return "Checkout options are ready.";
}

function getRestStepScriptKey(stepId) {
  const id = String(stepId || "").trim().toLowerCase();

  if (id.startsWith("head-up")) return "pod.rest.head_up";
  if (id.startsWith("zero-g")) return "pod.rest.zero_g";
  if (id.startsWith("flat-return")) return "pod.rest.return_flat";

  return "";
}

function stageButtonClass(active) {
  return active
    ? "border-indigo-300 bg-indigo-50 text-indigo-900"
    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50";
}

function formatDuration(totalSeconds) {
  const total = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (!minutes) return `${seconds}s`;
  if (!seconds) return `${minutes} min`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const REST_GUIDE_IMAGES = {
  choice: [snoozerRestChoiceImg],
  active: [snoozerRestActiveImg],
  transition: [snoozerRestTransitionImg],
};

const BUILD_VISUALS = {
  size: {
    title: "Choose Your Size",
    image: [PUBLIC_ASSETS.sizeDimensions],
    caption: "Start with the size that fits your room and the way you want to sleep.",
  },
  base: {
    title: "Choose Your Base",
    image: [],
    caption: "Choose the foundation that feels right with this mattress.",
  },
  motion: {
    title: "Choose Your Motion",
    image: [PUBLIC_ASSETS.standardMotion],
    caption: "Pick the motion setup that fits the way you want to relax and adjust.",
  },
  dual: {
    title: "Choose Comfort Setup",
    image: [],
    caption: "Choose the feel on each side so the bed feels right from edge to edge.",
  },
  review: {
    title: "Review Your Setup",
    image: [],
    caption: "Take one last look at your mattress, base, motion, and comfort setup before you add it to cart.",
  },
};

function buildRestTestFlows({ isAdjustableBase, whyThisPodReason }) {
  const focusReason = whyThisPodReason || "comfort and support";

  const quickFlat = [
    {
      id: "flat-normal-7",
      seconds: 120,
      cue: "Lie in your normal sleep position",
      title: "Rest Test",
      body: "Lie down in your normal sleep position and let your body settle into the mattress.",
      voice: "Lie down in your normal sleep position and let your body settle in.",
      startCta: "Start Timer",
      doneCta: "Next",
    },
    {
      id: "flat-focus-7",
      seconds: 120,
      cue: `Notice ${focusReason}`,
      title: "Rest Test",
      body: `Stay here and notice how this mattress feels around the areas that matter most to you. Pay close attention to ${focusReason}.`,
      voice: `Stay here and pay close attention to ${focusReason}.`,
      startCta: "Start Timer",
      doneCta: "Next",
    },
    {
      id: "flat-second-7",
      seconds: 120,
      cue: "Try another position",
      title: "Rest Test",
      body: "Roll into another natural sleep position and notice how the support changes there.",
      voice: "Roll into another natural sleep position and notice how the support changes.",
      startCta: "Start Timer",
      doneCta: "Next",
    },
  ];

  const quickAdjustable = [
    {
      id: "head-up-7",
      seconds: 60,
      cue: "Try Head Up",
      title: "Rest Test",
      body: "Now raise the adjustable base to Head Up. Notice whether this position makes breathing feel easier and may help reduce snoring.",
      voice:
        "Now raise the adjustable base to Head Up and notice whether breathing feels easier.",
      startCta: "Start Timer",
      doneCta: "Next",
    },
    {
      id: "zero-g-7",
      seconds: 60,
      cue: "Try Zero Gravity",
      title: "Rest Test",
      body: "Now try Zero Gravity. This is a popular preset because many shoppers feel pressure relief through the lower back, hips, and legs.",
      voice:
        "Now try Zero Gravity and notice the pressure relief through your lower back, hips, and legs.",
      startCta: "Start Timer",
      doneCta: "Next",
    },
    {
      id: "flat-return-7",
      seconds: 60,
      cue: "Return Flat",
      title: "Rest Test",
      body: "Now as the mattress returns to the flat position, notice how the pressure changes in your lower back. You may even feel the need to shift around to get comfortable again.",
      voice:
        "Now as the mattress returns to the flat position, notice how the pressure changes in your lower back and whether you feel the need to shift around again.",
      startCta: "Start Timer",
      doneCta: "Final Reflection",
    },
  ];

  const quickNonAdjustableTail = [
    {
      id: "final-compare-7",
      seconds: 60,
      cue: "Take one more moment",
      title: "Rest Test",
      body: "Take one more quiet moment before deciding. Notice pressure relief, alignment, and overall support.",
      voice:
        "Take one more quiet moment before deciding and notice pressure relief, alignment, and overall support.",
      startCta: "Start Timer",
      doneCta: "Final Reflection",
    },
  ];

  const deepFlat = [
    {
      id: "flat-normal-15",
      seconds: 180,
      cue: "Lie in your normal sleep position",
      title: "Rest Test",
      body: "Lie down in your normal sleep position and give your body time to settle naturally into the mattress.",
      voice:
        "Lie down in your normal sleep position and give your body time to settle naturally into the mattress.",
      startCta: "Start Timer",
      doneCta: "Next",
    },
    {
      id: "flat-second-15",
      seconds: 180,
      cue: "Try another position",
      title: "Rest Test",
      body: "Now roll into another natural sleep position and compare how the pressure relief and support feel there.",
      voice:
        "Now roll into another natural sleep position and compare how the pressure relief and support feel there.",
      startCta: "Start Timer",
      doneCta: "Next",
    },
  ];

  const deepAdjustable = [
    {
      id: "head-up-15",
      seconds: 180,
      cue: "Try Head Up",
      title: "Rest Test",
      body: "Raise the adjustable base to Head Up. Stay there for a few minutes and notice whether this angle feels easier for breathing and snoring relief.",
      voice:
        "Raise the adjustable base to Head Up and notice whether this angle feels easier for breathing and snoring relief.",
      startCta: "Start Timer",
      doneCta: "Next",
    },
    {
      id: "zero-g-15",
      seconds: 180,
      cue: "Try Zero Gravity",
      title: "Rest Test",
      body: "Now move into Zero Gravity. This is one of the most popular presets because many shoppers feel better pressure relief and weight distribution here.",
      voice:
        "Now move into Zero Gravity and notice the pressure relief and weight distribution here.",
      startCta: "Start Timer",
      doneCta: "Next",
    },
    {
      id: "flat-return-15",
      seconds: 180,
      cue: "Return Flat",
      title: "Rest Test",
      body: "Now as the mattress returns to the flat position, notice how the pressure changes in your lower back. You may even feel the need to shift around to get comfortable again.",
      voice:
        "Now as the mattress returns to the flat position, notice how the pressure changes in your lower back and whether you feel the need to shift around again.",
      startCta: "Start Timer",
      doneCta: "Final Reflection",
    },
  ];

  const deepNonAdjustableTail = [
    {
      id: "reset-15",
      seconds: 240,
      cue: "Reset and compare",
      title: "Rest Test",
      body: `Reset, roll once, and take a little longer to notice pressure relief, alignment, and ${focusReason}.`,
      voice: `Reset, roll once, and take a little longer to notice pressure relief, alignment, and ${focusReason}.`,
      startCta: "Start Timer",
      doneCta: "Next",
    },
    {
      id: "final-compare-15",
      seconds: 60,
      cue: "Take one more moment",
      title: "Rest Test",
      body: "Take one final quiet moment before deciding how this mattress feels overall.",
      voice: "Take one final quiet moment before deciding how this mattress feels overall.",
      startCta: "Start Timer",
      doneCta: "Final Reflection",
    },
  ];

  return {
    quick: {
      id: "quick",
      title: "7-Minute Rest Test",
      totalSeconds: 420,
      rationale:
        "Sleep experts recommend spending several minutes in your usual sleep positions so your body can settle and you can notice pressure relief, alignment, and support.",
      steps: isAdjustableBase
        ? [...quickFlat.slice(0, 2), ...quickAdjustable]
        : [...quickFlat, ...quickNonAdjustableTail],
    },
    deep: {
      id: "deep",
      title: "15-Minute Rest Test",
      totalSeconds: 900,
      rationale:
        "A longer rest test gives your body more time to settle so you can compare support, pressure relief, and overall comfort more honestly.",
      steps: isAdjustableBase
        ? [...deepFlat, ...deepAdjustable]
        : [...deepFlat, ...deepNonAdjustableTail],
    },
  };
}

const REST_COMPLETION_STAGES = {
  reflection: "reflection",
  actions: "actions",
};

const REST_REFLECTION_OPTIONS = [
  {
    id: "pressure_relief",
    label: "Pressure relief felt good",
    icon: CheckCircle2,
  },
  {
    id: "support",
    label: "Support felt good",
    icon: BedDouble,
  },
  {
    id: "not_sure",
    label: "Not sure yet",
    icon: HelpCircle,
  },
  {
    id: "compare_pod",
    label: "Want to compare another pod",
    icon: MessageSquare,
  },
];

function normalizeRestCompletionStage(value) {
  const stage = String(value || "").trim().toLowerCase();
  if (stage === REST_COMPLETION_STAGES.reflection) return REST_COMPLETION_STAGES.reflection;
  if (stage === REST_COMPLETION_STAGES.actions) return REST_COMPLETION_STAGES.actions;
  return "";
}

function buildRestReflectionVoice(modeTitle) {
  const title = String(modeTitle || "Rest Test").trim();
  return `${title} complete. What stood out most?`;
}

function buildRestActionsVoice(modeId, reflectionLabel = "") {
  const intro = reflectionLabel ? `Thanks. ${reflectionLabel}. ` : "";

  if (modeId === "quick") {
    return (
      intro +
      "Next, you can try the 15-minute rest test, learn about this pod, customize your pod, or go back to rest test options."
    );
  }

  return (
    intro +
    "Next, you can retake the 15-minute rest test, learn about this pod, customize your pod, or go back to rest test options."
  );
}

function detectAdjustableBase(activePod, baseProduct, effectiveBaseHandle) {
  if (typeof activePod?.hasAdjustableBase === "boolean") return activePod.hasAdjustableBase;
  if (activePod?.adjustableBase === true) return true;
  if (activePod?.isAdjustableBase === true) return true;
  if (activePod?.baseAdjustable === true) return true;

  const texts = [
    activePod?.baseType,
    activePod?.baseTitle,
    activePod?.baseName,
    activePod?.baseHandle,
    effectiveBaseHandle,
    baseProduct?.title,
    baseProduct?.handle,
    baseProduct?.productType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!texts) return false;

  return /(adjustable|power\s*base|smart\s*base|zero\s*g|head\s*up|ergo)/i.test(texts);
}

function inferMotionVisualFromHandle(handle = "", baseTitle = "") {
  const text = `${String(handle || "")} ${String(baseTitle || "")}`.toLowerCase();

  if (text.includes("full") && text.includes("split")) {
    return {
      image: [PUBLIC_ASSETS.fullSplitMotion],
      label: "Full Split Motion",
      caption: "Two separate sides. King only.",
    };
  }

  if (text.includes("half") && text.includes("split")) {
    return {
      image: [PUBLIC_ASSETS.halfSplitMotion],
      label: "Half Split Motion",
      caption: "Split head with shared foot. Queen or King.",
    };
  }

  return {
    image: [PUBLIC_ASSETS.standardMotion],
    label: "Standard Motion",
    caption: "One-piece motion across the whole base.",
  };
}

function StageButton({ active, icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-extrabold transition",
        stageButtonClass(active),
      ].join(" ")}
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {label}
    </button>
  );
}

function FooterAction({ icon: Icon, label, onClick, tone = "plain" }) {
  const cls =
    tone === "primary"
      ? "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700"
      : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50";

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-extrabold shadow-sm transition",
        cls,
      ].join(" ")}
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {label}
    </button>
  );
}

function ResponsiveImage({ src, alt, className, imgClassName }) {
  const candidates = useMemo(() => {
    const fromProp = normalizeImageCandidates(src);
    const withFallback = [...fromProp];
    if (!withFallback.includes(PUBLIC_ASSETS.noImage)) {
      withFallback.push(PUBLIC_ASSETS.noImage);
    }
    return withFallback;
  }, [src]);

  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [candidates]);

  const activeSrc = candidates[index] || "";

  const handleError = () => {
    setIndex((prev) => {
      if (prev + 1 < candidates.length) return prev + 1;
      return prev;
    });
  };

  const exhausted =
    !activeSrc || (activeSrc === PUBLIC_ASSETS.noImage && index === candidates.length - 1);

  if (exhausted && activeSrc !== PUBLIC_ASSETS.noImage) {
    return (
      <div className={className}>
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-500">
          <ImageOff className="h-6 w-6 text-gray-400" />
          <span className="text-sm font-medium">Image unavailable</span>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <img
        src={activeSrc}
        alt={alt}
        className={imgClassName}
        onError={handleError}
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}

function WhyChosenCard({
  isRecommended,
  rank,
  sentence,
  detailsMode = false,
  detailsIntro = "",
  actions = [],
  activeActionId = "",
  onActionSelect,
}) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm md:p-6">
      <div className="text-sm font-extrabold uppercase tracking-[0.16em] text-gray-500">
        {detailsMode ? "Learn About This Pod" : "Why Snoozer Picked This Pod"}
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
        <img
          src={PUBLIC_ASSETS.snoozerAvatar}
          alt="Snoozer"
          className="h-24 w-24 shrink-0 rounded-full object-cover md:h-28 md:w-28"
          loading="lazy"
          decoding="async"
        />

        <div className="min-w-0">
          <div className="text-xl font-extrabold leading-tight text-gray-900 md:text-2xl">
            {detailsMode
              ? "Tap the part you want Snoozer to explain"
              : isRecommended
                ? `Recommended #${rank || "1"} for you`
                : "Selected for you"}
          </div>
          <div className="mt-2 text-base leading-7 text-gray-700">
            {detailsMode ? detailsIntro || sentence : sentence}
          </div>

          {detailsMode && actions.length ? (
            <div className="mt-4 flex flex-wrap gap-2.5">
              {actions.map((action) => {
                const active = activeActionId === action.id;

                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => onActionSelect?.(action.id)}
                    className={[
                      "rounded-full border px-4 py-2 text-sm font-extrabold transition",
                      active
                        ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
                    ].join(" ")}
                  >
                    {action.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OnThisPodCard({ title, image }) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm md:p-6">
      <div className="text-sm font-extrabold uppercase tracking-[0.16em] text-gray-500">
        On This Pod
      </div>

      <div className="mt-2 text-2xl font-extrabold leading-tight text-gray-900 md:text-3xl">
        {title}
      </div>

      <div className="mt-4 overflow-hidden rounded-3xl border bg-gray-50">
        <ResponsiveImage
          src={[image, PUBLIC_ASSETS.noImage]}
          alt={title}
          className="aspect-[4/3] xl:aspect-[5/4]"
          imgClassName="h-full w-full object-contain"
        />
      </div>
    </div>
  );
}

function RestTestVisualCard({ title, image, caption }) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm md:p-6">
      <div className="text-sm font-extrabold uppercase tracking-[0.16em] text-gray-500">
        Snoozer Guide
      </div>

      <div className="mt-2 text-2xl font-extrabold leading-tight text-gray-900 md:text-3xl">
        {title}
      </div>

      <div className="mt-4 overflow-hidden rounded-3xl border bg-gray-50">
        <ResponsiveImage
          src={image}
          alt={title}
          className="aspect-[4/3] xl:aspect-[5/4]"
          imgClassName="h-full w-full object-cover"
        />
      </div>

      <div className="mt-3 text-base leading-7 text-gray-700">{caption}</div>
    </div>
  );
}

function BuildVisualCard({ title, image, caption, eyebrow = "Setup Preview" }) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm md:p-6">
      <div className="text-sm font-extrabold uppercase tracking-[0.16em] text-gray-500">
        {eyebrow}
      </div>

      <div className="mt-2 text-2xl font-extrabold leading-tight text-gray-900 md:text-3xl">
        {title}
      </div>

      <div className="mt-4 overflow-hidden rounded-3xl border bg-gray-50">
        <ResponsiveImage
          src={image}
          alt={title}
          className="aspect-[4/3] xl:aspect-[5/4]"
          imgClassName="h-full w-full object-contain"
        />
      </div>

      <div className="mt-3 text-base leading-7 text-gray-700">{caption}</div>
    </div>
  );
}

function DetailCard({ title, items = [] }) {
  return (
    <div className="h-full rounded-3xl border bg-white p-5 shadow-sm md:p-6">
      <div className="text-lg font-extrabold text-gray-900 md:text-xl">{title}</div>
      <div className="mt-3 space-y-2.5">
        {items.map((item) => (
          <div key={item} className="text-base leading-7 text-gray-700">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailBodyCard({ title, body, itemsTitle = "", items = [] }) {
  return (
    <div className="h-full rounded-3xl border bg-white p-5 shadow-sm md:p-6">
      <div className="text-lg font-extrabold text-gray-900 md:text-xl">{title}</div>

      {body ? <div className="mt-3 text-base leading-7 text-gray-700">{body}</div> : null}

      {items.length ? (
        <div className="mt-4 space-y-2.5">
          {itemsTitle ? (
            <div className="text-sm font-extrabold uppercase tracking-[0.12em] text-gray-500">
              {itemsTitle}
            </div>
          ) : null}
          {items.map((item) => (
            <div key={item} className="text-base text-gray-700">
              {item}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GuidedRestTest({
  flowOptions,
  activeMode,
  activeStep,
  activeStepIndex,
  timerRemaining,
  timerRunning,
  onChooseMode,
  onStartTimer,
  onAdvanceStep,
  onSkipStep,
  onResetTest,
  onSelectReflection,
  onViewDetails,
  onBuildPod,
  completionStage,
  reflectionChoice,
  hasAdjustableBase,
}) {
  if (!activeMode) {
    return (
      <div className="rounded-3xl border bg-white shadow-sm">
        <div className="border-b bg-slate-50 px-5 py-4 md:px-6 md:py-5">
          <div className="text-xl font-extrabold text-gray-900 md:text-2xl">Rest Test</div>
        </div>

        <div className="p-5 md:p-6">
          <div className="max-w-3xl text-lg leading-8 text-gray-800 md:text-xl">
            Choose a rest test length to begin.
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            {Object.values(flowOptions).map((flow) => (
              <button
                key={flow.id}
                type="button"
                onClick={() => onChooseMode(flow.id)}
                className="rounded-3xl border bg-white p-5 text-left shadow-sm transition hover:bg-gray-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xl font-extrabold text-gray-900">{flow.title}</div>
                  <div className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-extrabold text-indigo-800">
                    {formatDuration(flow.totalSeconds)}
                  </div>
                </div>

                <div className="mt-3 text-base leading-7 text-gray-700">{flow.rationale}</div>

                <div className="mt-4 text-sm font-semibold text-gray-500">
                  {hasAdjustableBase
                    ? "Includes flat positions and adjustable routine when available on this pod."
                    : "Includes flat-position testing only on this pod."}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (completionStage === REST_COMPLETION_STAGES.reflection) {
    return (
      <div className="rounded-3xl border bg-white shadow-sm">
        <div className="border-b bg-slate-50 px-5 py-4 md:px-6 md:py-5">
          <div className="text-xl font-extrabold text-gray-900 md:text-2xl">Rest Test</div>
        </div>

        <div className="p-5 md:p-6">
          <div className="text-lg font-semibold text-gray-700">What stood out most?</div>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            {REST_REFLECTION_OPTIONS.map((option) => {
              const Icon = option.icon;

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSelectReflection(option.id)}
                  className="inline-flex items-center gap-3 rounded-2xl border bg-white px-5 py-4 text-left text-base font-extrabold text-gray-900 hover:bg-gray-50"
                >
                  <Icon className="h-5 w-5 shrink-0 text-indigo-700" />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (completionStage === REST_COMPLETION_STAGES.actions) {
    const primaryActionLabel =
      activeMode?.id === "quick" ? "Try 15-Minute Rest Test" : "Retake 15-Minute Rest Test";
    const primaryActionModeId = activeMode?.id === "quick" ? "deep" : activeMode?.id || "deep";

    return (
      <div className="rounded-3xl border bg-white shadow-sm">
        <div className="border-b bg-slate-50 px-5 py-4 md:px-6 md:py-5">
          <div className="text-xl font-extrabold text-gray-900 md:text-2xl">Rest Test</div>
        </div>

        <div className="p-5 md:p-6">
          <div className="text-lg font-semibold text-gray-700">You finished the {activeMode?.title}.</div>

          {reflectionChoice ? (
            <div className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-900">
              Reflection saved: {reflectionChoice}
            </div>
          ) : null}

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => onChooseMode(primaryActionModeId)}
              className="rounded-2xl bg-indigo-600 px-5 py-3.5 text-base font-extrabold text-white hover:bg-indigo-700"
            >
              {primaryActionLabel}
            </button>

            <button
              type="button"
              onClick={onViewDetails}
              className="rounded-2xl border bg-white px-5 py-3.5 text-base font-extrabold text-gray-900 hover:bg-gray-50"
            >
              Learn About This Pod
            </button>

            <button
              type="button"
              onClick={onBuildPod}
              className="rounded-2xl border bg-white px-5 py-3.5 text-base font-extrabold text-gray-900 hover:bg-gray-50"
            >
              Customize Your Pod
            </button>

            <button
              type="button"
              onClick={onResetTest}
              className="rounded-2xl border bg-white px-5 py-3.5 text-base font-extrabold text-gray-900 hover:bg-gray-50"
            >
              Back to Rest Test Options
            </button>
          </div>
        </div>
      </div>
    );
  }

  const totalSteps = activeMode?.steps?.length || 0;
  const currentNumber = activeStepIndex + 1;
  const isDone = timerRemaining <= 0;
  const isRunning = !!timerRunning;

  let primaryLabel = activeStep?.startCta || "Start Timer";
  if (isRunning) primaryLabel = "Next Now";
  if (isDone) primaryLabel = activeStep?.doneCta || "Next";

  return (
    <div className="rounded-3xl border bg-white shadow-sm">
      <div className="border-b bg-slate-50 px-5 py-4 md:px-6 md:py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xl font-extrabold text-gray-900 md:text-2xl">
            {activeStep?.title}
          </div>

          <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-extrabold text-gray-700 shadow-sm">
            <Timer className="h-4 w-4 text-indigo-700" />
            {formatDuration(timerRemaining)}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm font-semibold text-gray-500">
          <span>{activeMode?.title}</span>
          <span>•</span>
          <span>
            Step {currentNumber} of {totalSteps}
          </span>
        </div>
      </div>

      <div className="p-5 md:p-6">
        <div className="max-w-3xl text-lg leading-8 text-gray-800 md:text-xl">
          {activeStep?.body}
        </div>

        <div className="mt-5 text-sm font-semibold text-gray-500">
          {isRunning
            ? "You can move on early at any time."
            : isDone
              ? "This step is complete."
              : "Timer starts when you are ready."}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {!isRunning && !isDone ? (
            <button
              type="button"
              onClick={onStartTimer}
              className="rounded-2xl bg-indigo-600 px-7 py-3.5 text-lg font-extrabold text-white hover:bg-indigo-700"
            >
              {primaryLabel}
            </button>
          ) : (
            <button
              type="button"
              onClick={onAdvanceStep}
              className="rounded-2xl bg-indigo-600 px-7 py-3.5 text-lg font-extrabold text-white hover:bg-indigo-700"
            >
              {primaryLabel}
            </button>
          )}

          <button
            type="button"
            onClick={onSkipStep}
            className="rounded-2xl border bg-white px-5 py-3.5 text-base font-extrabold text-gray-900 hover:bg-gray-50"
          >
            Skip Step
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Pod() {
  const { podId } = useParams();
  const navigate = useNavigate();
  const { muted, noteUserInteraction, say, sayScript, interruptCurrent, voiceState } =
    useShowroomHud();

  const pid = normalizePodId(podId);
  const storagePrefix = useMemo(() => `snooze.pod.${pid}`, [pid]);

  const plan = useStore((s) => (Array.isArray(s.snoozepod) ? s.snoozepod : []));
  const snoozepodCount = useMemo(() => plan.length, [plan]);

  const [loading, setLoading] = useState(true);
  const [recs, setRecs] = useState(null);
  const [activePod, setActivePod] = useState(null);

  const [mattressProduct, setMattressProduct] = useState(null);
  const [baseProduct, setBaseProduct] = useState(null);

  const [selectedMattressHandle, setSelectedMattressHandle] = useState(undefined);
  const [selectedBaseHandle, setSelectedBaseHandle] = useState(undefined);

  const [cue, setCue] = useState("Rest Test");
  const [cueType, setCueType] = useState("tip");

  const [buildStepKey, setBuildStepKey] = useState(() => {
    const saved = safeGet(`${storagePrefix}.buildStepKey`);
    return saved ? String(saved) || "size" : "size";
  });

  const [openStage, setOpenStage] = useState(() => {
    const saved = safeGet(`${storagePrefix}.openStage`);
    return saved ? String(saved) || "rest" : "rest";
  });

  const [testComplete, setTestComplete] = useState(
    () => safeGet(`${storagePrefix}.testComplete`) === "1"
  );
  const [feelChoice, setFeelChoice] = useState(() => safeGet(`${storagePrefix}.feelChoice`) || "");
  const [restCompletionStage, setRestCompletionStage] = useState(() =>
    normalizeRestCompletionStage(safeGet(`${storagePrefix}.restCompletionStage`))
  );
  const [detailsActionId, setDetailsActionId] = useState(
    () => safeGet(`${storagePrefix}.detailsActionId`) || DEFAULT_DETAILS_ACTION_ID
  );
  const [showCheckoutOptions, setShowCheckoutOptions] = useState(false);

  const [restModeId, setRestModeId] = useState(() => safeGet(`${storagePrefix}.restModeId`) || "");
  const [restStepIndex, setRestStepIndex] = useState(() => {
    const raw = safeGet(`${storagePrefix}.restStepIndex`);
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  const [timerRemaining, setTimerRemaining] = useState(() => {
    const raw = safeGet(`${storagePrefix}.timerRemaining`);
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  const [timerRunning, setTimerRunning] = useState(false);
  const [restPanelPhase, setRestPanelPhase] = useState("normal");

  const lastPodVoiceKeyRef = useRef("");
  const lastRestVoiceKeyRef = useRef("");
  const restAdvanceTimeoutRef = useRef(null);

  const clearTimer = (ref) => {
    if (ref.current) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  };

  useEffect(
    () => safeSet(`${storagePrefix}.openStage`, openStage || "rest"),
    [storagePrefix, openStage]
  );
  useEffect(
    () => safeSet(`${storagePrefix}.buildStepKey`, buildStepKey || "size"),
    [storagePrefix, buildStepKey]
  );
  useEffect(
    () => safeSet(`${storagePrefix}.testComplete`, testComplete ? "1" : "0"),
    [storagePrefix, testComplete]
  );
  useEffect(
    () => safeSet(`${storagePrefix}.feelChoice`, feelChoice || ""),
    [storagePrefix, feelChoice]
  );
  useEffect(
    () => safeSet(`${storagePrefix}.restCompletionStage`, restCompletionStage || ""),
    [storagePrefix, restCompletionStage]
  );
  useEffect(
    () => safeSet(`${storagePrefix}.detailsActionId`, detailsActionId || DEFAULT_DETAILS_ACTION_ID),
    [storagePrefix, detailsActionId]
  );
  useEffect(
    () => safeSet(`${storagePrefix}.restModeId`, restModeId || ""),
    [storagePrefix, restModeId]
  );
  useEffect(
    () => safeSet(`${storagePrefix}.restStepIndex`, String(restStepIndex || 0)),
    [storagePrefix, restStepIndex]
  );
  useEffect(
    () => safeSet(`${storagePrefix}.timerRemaining`, String(Math.max(0, timerRemaining || 0))),
    [storagePrefix, timerRemaining]
  );

  useEffect(() => {
    const prev = window.__SNOOZE_DISABLE_WIDGET;
    window.__SNOOZE_DISABLE_WIDGET = true;
    document.body.classList.add("no-global-chat");
    return () => {
      window.__SNOOZE_DISABLE_WIDGET = prev;
      document.body.classList.remove("no-global-chat");
      clearTimer(restAdvanceTimeoutRef);
    };
  }, []);

  const shopperId = useMemo(() => {
    try {
      return sessionStorage.getItem("snooze.accessCode") || "guest";
    } catch {
      return "guest";
    }
  }, []);

  const assessment = useMemo(() => {
    const raw = safeGet("snooze.assessment");
    const parsed = raw ? safeParseJson(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  }, []);

  const painSignals = useMemo(() => extractPainSignals(assessment), [assessment]);
  const benefits = useMemo(() => buildBenefits(painSignals), [painSignals]);
  const whyThisPodReason = useMemo(() => buildWhyThisPodReason(painSignals), [painSignals]);
  const whyThisPodSentence = useMemo(() => buildWhyThisPodSentence(painSignals), [painSignals]);
  const headerPersonalization = useMemo(() => buildHeaderPersonalization(painSignals), [painSignals]);
  const notIdealFor = useMemo(() => buildNotIdealFor(painSignals), [painSignals]);

  const speakPod = useCallback(
    async (
      text,
      {
        force = false,
        calm = false,
        priority = "normal",
        key = "",
        scriptKey = "",
        actionType = "",
        state = "speaking",
      } = {}
    ) => {
      const phrase = String(text || "").trim();
      if (!phrase || muted) return null;

      const dedupeKey = String(key || phrase).trim();

      if (!force && dedupeKey && lastPodVoiceKeyRef.current === dedupeKey) {
        return null;
      }

      if (dedupeKey) {
        lastPodVoiceKeyRef.current = dedupeKey;
      }

      const payload = {
        speech: phrase,
        captions: phrase,
        state,
        priority: force ? "high" : priority,
        ttlMs: calm ? 6500 : 5000,
        voiceStyle: calm ? "calm" : "default",
        actions: [],
        replaceCurrent: force,
      };

      if (scriptKey) {
        return sayScript({
          scriptKey,
          actionType,
          shopperId,
          fallback: payload,
          overrides: payload,
        });
      }

      return say({
        ...payload,
        actionType,
      });
    },
    [muted, say, sayScript, shopperId]
  );

  const cancelPodVoice = useCallback(
    async ({ resetKeys = true } = {}) => {
      clearTimer(restAdvanceTimeoutRef);

      if (resetKeys) {
        lastPodVoiceKeyRef.current = "";
        lastRestVoiceKeyRef.current = "";
      }

      if (typeof interruptCurrent === "function") {
        await interruptCurrent({
          preserveQueue: false,
          reason: "pod-action-change",
          fadeMs: 0,
        });
      }
    },
    [interruptCurrent]
  );

  useEffect(() => {
    return () => {
      clearTimer(restAdvanceTimeoutRef);
      void cancelPodVoice();
    };
  }, [cancelPodVoice]);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);

      const stored = safeGet("snooze.recommendations");
      const parsed = stored ? safeParseJson(stored) : null;
      const sanitizedStored = sanitizeRecommendationsPayload(parsed);

      if (
        sanitizedStored &&
        typeof sanitizedStored === "object" &&
        Array.isArray(sanitizedStored.pods) &&
        sanitizedStored.pods.length
      ) {
        if (!alive) return;
        setRecs(sanitizedStored);
        setLoading(false);
        return;
      }

      try {
        const generated = await generateShowroomRecommendations(assessment);
        const sanitizedGenerated = sanitizeRecommendationsPayload(generated);

        if (!alive) return;

        setRecs(sanitizedGenerated);
        safeSet("snooze.recommendations", JSON.stringify(sanitizedGenerated || {}));
      } catch {
        // ignore
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [assessment]);

  useEffect(() => {
    if (!recs?.pods?.length) return;

    const found =
      recs.pods.find((p) => String(p.podId ?? p.id ?? "") === String(pid)) || recs.pods[0] || null;

    const sanitizedFound = found ? stripLegacyPodImageFields(found) : null;

    lastPodVoiceKeyRef.current = "";
    lastRestVoiceKeyRef.current = "";

    setActivePod(sanitizedFound || null);
    setSelectedMattressHandle(undefined);
    setSelectedBaseHandle(undefined);
    setShowCheckoutOptions(false);

    const savedOpenStage = safeGet(`${storagePrefix}.openStage`);
    const savedBuildStepKey = safeGet(`${storagePrefix}.buildStepKey`) || "size";
    const savedTestComplete = safeGet(`${storagePrefix}.testComplete`) === "1";
    const savedFeelChoice = safeGet(`${storagePrefix}.feelChoice`) || "";
    const savedRestCompletionStage = normalizeRestCompletionStage(
      safeGet(`${storagePrefix}.restCompletionStage`)
    );
    const savedDetailsActionId =
      safeGet(`${storagePrefix}.detailsActionId`) || DEFAULT_DETAILS_ACTION_ID;
    const savedRestModeId = safeGet(`${storagePrefix}.restModeId`) || "";
    const savedRestStepIndex = Number(safeGet(`${storagePrefix}.restStepIndex`));
    const savedTimerRemaining = Number(safeGet(`${storagePrefix}.timerRemaining`));

    setOpenStage(savedOpenStage ? String(savedOpenStage) || "rest" : "rest");
    setBuildStepKey(savedBuildStepKey);
    setTestComplete(savedTestComplete);
    setFeelChoice(savedFeelChoice);
    setRestCompletionStage(
      savedRestCompletionStage ||
        (savedTestComplete ? REST_COMPLETION_STAGES.actions : "")
    );
    setDetailsActionId(savedDetailsActionId || DEFAULT_DETAILS_ACTION_ID);
    setRestModeId(savedRestModeId);
    setRestStepIndex(Number.isFinite(savedRestStepIndex) && savedRestStepIndex >= 0 ? savedRestStepIndex : 0);
    setTimerRemaining(
      Number.isFinite(savedTimerRemaining) && savedTimerRemaining >= 0 ? savedTimerRemaining : 0
    );
    setTimerRunning(false);
    setRestPanelPhase("normal");

    if (savedTestComplete) {
      setCueType("success");
      setCue(savedFeelChoice ? `Rest Test • ${savedFeelChoice}` : "Rest Test complete");
    } else if (savedRestModeId) {
      setCueType("tip");
      setCue("Rest Test in progress");
    } else {
      setCueType("tip");
      setCue("Choose your Rest Test");
    }

    if (savedTestComplete && savedRestCompletionStage === REST_COMPLETION_STAGES.reflection) {
      setCueType("tip");
      setCue("Final reflection");
    }
  }, [recs, pid, storagePrefix]);

  const effectiveMattressHandle = useMemo(() => {
    if (selectedMattressHandle === undefined) return activePod?.mattressHandle || null;
    return selectedMattressHandle || null;
  }, [selectedMattressHandle, activePod?.mattressHandle]);

  const effectiveBaseHandle = useMemo(() => {
    if (selectedBaseHandle === undefined) return activePod?.baseHandle || null;
    return selectedBaseHandle;
  }, [selectedBaseHandle, activePod?.baseHandle]);

  const [mattressVariantId, setMattressVariantId] = useState(null);
  const [baseVariantId, setBaseVariantId] = useState(null);

  useEffect(() => {
    let alive = true;

    setMattressProduct(null);
    setBaseProduct(null);
    setMattressVariantId(null);
    setBaseVariantId(null);

    (async () => {
      if (!effectiveMattressHandle) return;

      try {
        const [mattress, base] = await Promise.all([
          api.getProductById(effectiveMattressHandle),
          effectiveBaseHandle ? api.getProductById(effectiveBaseHandle) : Promise.resolve(null),
        ]);

        if (!alive) return;

        setMattressProduct(mattress || null);
        setBaseProduct(base || null);

        const mv = mattress ? pickFirstVariantId(mattress) : null;
        const bv = base ? pickFirstVariantId(base) : null;
        setMattressVariantId(mv || null);
        setBaseVariantId(bv || null);
      } catch {
        // ignore
      }
    })();

    return () => {
      alive = false;
    };
  }, [effectiveMattressHandle, effectiveBaseHandle]);

  const onSelectionHandlesChange = useCallback((next = {}) => {
    const hasM = Object.prototype.hasOwnProperty.call(next || {}, "mattressHandle");
    const hasB = Object.prototype.hasOwnProperty.call(next || {}, "baseHandle");

    if (hasM) {
      const raw = next?.mattressHandle;
      const m = typeof raw === "string" ? raw.trim() : raw == null ? null : null;
      setSelectedMattressHandle((prev) => (prev === m ? prev : m));
    }

    if (hasB) {
      const raw = next?.baseHandle;
      const b =
        raw === null ? null : typeof raw === "string" ? raw.trim() : raw == null ? null : null;
      setSelectedBaseHandle((prev) => (prev === b ? prev : b));
    }
  }, []);

  const onBuildStepChange = useCallback((nextStepKey) => {
    const key = String(nextStepKey || "").trim();
    if (!key) return;
    setBuildStepKey(key);
  }, []);

  const title = activePod?.title || `SnoozePod ${pid}`;
  const isRecommended = !!activePod?.recommended;
  const rank = Number(activePod?.rank || 0);

  const mattressImage = useMemo(() => pickProductImage(mattressProduct), [mattressProduct]);
  const mattressHeroTitle = mattressProduct?.title || activePod?.subtitle || "Mattress";

  const hasAdjustableBase = useMemo(
    () => detectAdjustableBase(activePod, baseProduct, effectiveBaseHandle),
    [activePod, baseProduct, effectiveBaseHandle]
  );

  const restFlows = useMemo(
    () =>
      buildRestTestFlows({
        isAdjustableBase: hasAdjustableBase,
        whyThisPodReason,
      }),
    [hasAdjustableBase, whyThisPodReason]
  );

  const activeRestFlow = useMemo(() => {
    if (!restModeId) return null;
    return restFlows[restModeId] || null;
  }, [restFlows, restModeId]);

  const activeRestStep = useMemo(() => {
    if (!activeRestFlow?.steps?.length) return null;
    return activeRestFlow.steps[restStepIndex] || null;
  }, [activeRestFlow, restStepIndex]);

  const recommendationMeta = recs?.meta || {};

  const detailReasonKeys = useMemo(
    () =>
      Array.isArray(activePod?.diagnostics?.scoreReasons)
        ? activePod.diagnostics.scoreReasons
        : [],
    [activePod]
  );

  const detailReasonContext = useMemo(
    () => buildPodReasonContext(activePod, recommendationMeta),
    [activePod, recommendationMeta]
  );

  const mattressTruth = useMemo(
    () => detectMattressTruth({ mattressProduct, activePod, baseProduct }),
    [mattressProduct, activePod, baseProduct]
  );

  const shopperDetailContext = useMemo(() => {
    const focusAreas = painSignals
      .filter((signal) =>
        ["shoulder", "hip", "backpain", "neck"].includes(normalizeText(signal?.key))
      )
      .map((signal) => signal?.label)
      .filter(Boolean);

    const position = lowerText(
      recommendationMeta?.position ||
        assessment?.sleepPosition ||
        assessment?.position ||
        assessment?.primaryPosition
    );

    const firmness = lowerText(
      recommendationMeta?.firmness ||
        assessment?.firmness ||
        assessment?.comfort ||
        assessment?.feel
    );

    const tempValue = lowerText(
      assessment?.temperature || assessment?.sleepTemp || assessment?.sleepsHot
    );

    const partnerValue = lowerText(
      assessment?.sleepPartner || assessment?.partner || assessment?.shareBed
    );

    return {
      focusAreas,
      position,
      firmness,
      sleepsHot:
        painSignals.some((signal) => signal?.key === "hot") ||
        tempValue.includes("hot") ||
        tempValue.includes("warm"),
      hasPartner:
        recommendationMeta?.hasPartner === true ||
        painSignals.some((signal) => signal?.key === "partner") ||
        partnerValue.includes("yes") ||
        partnerValue.includes("partner"),
      wantsSplit: detailReasonKeys.some((key) =>
        ["requested_full_split", "requested_half_split", "split_requires_dual"].includes(key)
      ),
    };
  }, [painSignals, recommendationMeta, assessment, detailReasonKeys]);

  const detailsQuickActionIntro = useMemo(() => {
    const summary = pickPreferredReasonKeys(detailReasonKeys)
      .map((key) => getPodReasonVariant(key, detailReasonContext))
      .find(Boolean);

    const reasonLine = summary || getPodFallbackReason(detailReasonContext);
    return `Snoozer matched this pod because ${reasonLine}. Tap the guide you want next.`;
  }, [detailReasonKeys, detailReasonContext]);

  const detailsContentByAction = useMemo(() => {
    const orderedReasons = pickPreferredReasonKeys(detailReasonKeys);
    const topReason =
      orderedReasons.map((key) => getPodReasonVariant(key, detailReasonContext)).find(Boolean) ||
      getPodFallbackReason(detailReasonContext);

    const reasonBullets = orderedReasons
      .map((key) => getPodReasonVariant(key, detailReasonContext))
      .filter(Boolean)
      .slice(0, 3)
      .map((line) => line.charAt(0).toUpperCase() + line.slice(1) + ".");

    const focusLine = shopperDetailContext.focusAreas.length
      ? `Pay closest attention to ${joinReadableList(shopperDetailContext.focusAreas)}.`
      : "";

    const positionNotice =
      shopperDetailContext.position === "side"
        ? "For side sleeping, notice whether your shoulders and hips settle before the bed starts to feel pushy."
        : shopperDetailContext.position === "back"
          ? "For back sleeping, notice whether your lower back feels supported without the surface feeling stiff."
          : shopperDetailContext.position === "stomach"
            ? "For stomach sleeping, notice whether your midsection stays lifted instead of dipping."
            : "Notice how quickly your body settles into a natural position without needing to readjust.";

    const firmnessNotice =
      shopperDetailContext.firmness === "firm"
        ? "Because you leaned firmer in the assessment, the right sign here is steady lift more than a sink-in feel."
        : shopperDetailContext.firmness === "soft"
          ? "Because you leaned softer in the assessment, the right sign here is cushioning without losing alignment."
          : "Because you landed near the middle on feel, look for a balanced mix of cushioning and support.";

    const coolingNotice = shopperDetailContext.sleepsHot
      ? mattressTruth.hasCooling
        ? "This build shows cooling or breathable cues in the product data, so notice whether it settles temperature more comfortably after a few minutes."
        : "You mentioned sleeping warm, so use this test to judge temperature comfort once you have been on it for a few minutes."
      : "";

    const partnerNotice =
      shopperDetailContext.hasPartner && (mattressTruth.isDualComfort || shopperDetailContext.wantsSplit)
        ? "Because shared sleep came up in your assessment, this pod is worth attention for how it can separate comfort or motion more cleanly."
        : shopperDetailContext.hasPartner
          ? "Because you share the bed, pay attention to how stable and undisturbed the surface feels when you move."
          : "";

    const feelBody =
      mattressTruth.family === "foam"
        ? `${mattressTruth.mattressTitle} should feel quieter and more body-conforming, with a smoother cradle instead of a lifted bounce.`
        : mattressTruth.family === "dual"
          ? `${mattressTruth.mattressTitle} should feel supportive first, then cushioned where pressure builds, with more flexibility for shared comfort decisions later.`
          : mattressTruth.family === "hybrid"
            ? `${mattressTruth.mattressTitle} should feel a little more lifted and supportive than an all-foam bed, while still giving pressure points room to settle.`
            : `${mattressTruth.mattressTitle} is meant to feel balanced: enough give to relieve pressure, with enough pushback to keep you supported.`;

    const insideBody =
      mattressTruth.family === "foam"
        ? `This pod is anchored by an all-foam build, so the feel is more uniform from top to bottom and less springy when you lie down.`
        : mattressTruth.family === "dual"
          ? `This pod uses a Dual Comfort Hybrid build, which means the support structure stays strong while the comfort side can stay more flexible for different sleepers.`
          : mattressTruth.family === "hybrid"
            ? `This pod uses a hybrid-style build, which usually means comfort foams on top with a stronger support core underneath.`
            : `This pod is built to balance comfort layers up top with a more supportive base underneath.`;

    const lastsBody =
      mattressTruth.hasCoils
        ? "The long-term strength here comes from the support core doing the heavy lifting while the comfort layers handle pressure relief up top."
        : "The long-term strength here comes from the support layers underneath keeping the feel more consistent while the top layers handle comfort.";

    const chooseBody = `Snoozer put this pod in front of you because ${topReason}.`;

    return {
      feel: {
        id: "feel",
        title: "How it feels",
        body: feelBody,
        primaryTitle: "What to notice first",
        primaryItems: [positionNotice, firmnessNotice, focusLine].filter(Boolean),
        secondaryTitle: "Why that matters for you",
        secondaryItems: [coolingNotice, partnerNotice].filter(Boolean),
        voiceScript: [feelBody, positionNotice, focusLine || firmnessNotice].filter(Boolean).join(" "),
        cue: "How it feels",
        scriptKey: "pod.details.feel",
      },
      inside: {
        id: "inside",
        title: "What's inside",
        body: insideBody,
        primaryTitle: "What that means on the floor",
        primaryItems: [
          mattressTruth.hasCoils
            ? "A stronger support core usually creates a more lifted, easier-to-move-on feel."
            : "A foam-led build usually creates a quieter, more even surface with less bounce.",
          mattressTruth.hasPressureRelief
            ? "The comfort layers are there to let shoulders, hips, and other pressure points settle more naturally."
            : "",
          hasAdjustableBase && mattressTruth.baseTitle
            ? `This pod is paired with ${mattressTruth.baseTitle}, so you can also judge the mattress through head-up and Zero Gravity positions.`
            : "",
        ].filter(Boolean),
        secondaryTitle: "Why that matters for you",
        secondaryItems: [
          partnerNotice,
          shopperDetailContext.sleepsHot && mattressTruth.hasCooling
            ? "Because temperature comfort matters to you, the cooling-focused materials are worth noticing early."
            : "",
        ].filter(Boolean),
        voiceScript: [insideBody, partnerNotice].filter(Boolean).join(" "),
        cue: "What's inside",
        scriptKey: "pod.details.inside",
      },
      lasts: {
        id: "lasts",
        title: "Why it lasts",
        body: lastsBody,
        primaryTitle: "Why shoppers care about that",
        primaryItems: [
          mattressTruth.hasCoils
            ? "When the support core carries more of the load, the comfort layers are not doing all the work by themselves."
            : "When the support layers stay stable underneath, the comfort feel has a better shot of staying consistent over time.",
          mattressTruth.isDualComfort
            ? "A Dual Comfort setup also gives you flexibility if two sleepers do not want the same feel."
            : "",
          hasAdjustableBase
            ? "Because this pod is shown with an adjustable base, you can also judge how stable the mattress stays through movement and position changes."
            : "",
        ].filter(Boolean),
        secondaryTitle: "What to pay attention to",
        secondaryItems: [
          "Ask yourself whether the bed still feels composed when you move, roll, or change positions.",
          shopperDetailContext.hasPartner
            ? "If you share the bed, notice whether the support still feels dependable when one sleeper shifts."
            : "",
        ].filter(Boolean),
        voiceScript: [lastsBody, partnerNotice].filter(Boolean).join(" "),
        cue: "Why it lasts",
        scriptKey: "pod.details.lasts",
      },
      choose: {
        id: "choose",
        title: "Why choose this",
        body: chooseBody,
        primaryTitle: "What Snoozer saw in your assessment",
        primaryItems: [
          isRecommended ? `This is currently one of the first pods Snoozer wants you to test.` : "",
          ...reasonBullets,
          focusLine,
        ].filter(Boolean),
        secondaryTitle: "Why it could matter more to you than a generic browse",
        secondaryItems: [
          partnerNotice,
          coolingNotice,
          notIdealFor[0] ? `If you want a wider comparison, keep this in mind too: ${notIdealFor[0]}.` : "",
        ].filter(Boolean),
        voiceScript: [chooseBody, reasonBullets[0], partnerNotice].filter(Boolean).join(" "),
        cue: "Why choose this",
        scriptKey: "pod.details.choose",
      },
    };
  }, [
    detailReasonKeys,
    detailReasonContext,
    shopperDetailContext,
    mattressTruth,
    hasAdjustableBase,
    notIdealFor,
    isRecommended,
  ]);

  const activeDetailsContent =
    detailsContentByAction[detailsActionId] || detailsContentByAction[DEFAULT_DETAILS_ACTION_ID] || null;

  useEffect(() => {
    if (!timerRunning) return;
    if (timerRemaining <= 0) {
      setTimerRunning(false);
      return;
    }

    const id = window.setInterval(() => {
      setTimerRemaining((prev) => {
        const next = Math.max(0, prev - 1);
        if (next <= 0) {
          window.clearInterval(id);
        }
        return next;
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [timerRunning, timerRemaining]);

  useEffect(() => {
    if (timerRunning && timerRemaining <= 0) {
      setTimerRunning(false);
      setCueType("tip");
      setCue("Timer complete");
    }
  }, [timerRunning, timerRemaining]);

  const speakForStage = useCallback(
    (id) => {
      if (id === "rest") {
        return Promise.resolve(null);
      }

      if (id === "details") {
        return speakPod(activeDetailsContent?.voiceScript || buildPodDetailsVoice({
          title,
          mattressHeroTitle,
          benefits,
          isRecommended,
          rank,
        }), {
          actionType: "view_details",
          force: true,
          calm: true,
          scriptKey: activeDetailsContent?.scriptKey || "pod.details.default",
          key: `stage-details::${pid}::${activeDetailsContent?.id || DEFAULT_DETAILS_ACTION_ID}`,
        });
      }

      if (id === "build") {
        return speakPod(
          buildPodBuildVoice({
            title,
            mattressTitle: mattressHeroTitle,
            isDualComfort: mattressTruth.isDualComfort,
          }),
          {
            actionType: "build_pod",
            force: true,
            scriptKey: "pod.build.default",
            key: `stage-build::${pid}`,
          }
        );
      }

      return Promise.resolve();
    },
    [
      title,
      mattressHeroTitle,
      benefits,
      isRecommended,
      rank,
      speakPod,
      pid,
      activeDetailsContent,
      mattressTruth.isDualComfort,
    ]
  );

  const activateDetailsAction = useCallback(
    async (actionId = DEFAULT_DETAILS_ACTION_ID, { ensureDetailsStage = false } = {}) => {
      const nextId = normalizeText(actionId) || DEFAULT_DETAILS_ACTION_ID;
      const content =
        detailsContentByAction[nextId] || detailsContentByAction[DEFAULT_DETAILS_ACTION_ID] || null;

      noteUserInteraction?.();
      await cancelPodVoice();

      if (ensureDetailsStage) {
        setOpenStage("details");
      }

      setDetailsActionId(nextId);
      setCueType(nextId === "choose" ? "success" : "tip");
      setCue(content?.cue || "Learn About This Pod");
      setRestPanelPhase("normal");

      if (!content?.voiceScript) return;

      void speakPod(content.voiceScript, {
        actionType: "view_details",
        calm: true,
        force: true,
        scriptKey: content.scriptKey || `pod.details.${nextId}`,
        key: `details-action::${pid}::${nextId}`,
      });
    },
    [detailsContentByAction, noteUserInteraction, cancelPodVoice, speakPod, pid]
  );

  const resetRestTest = useCallback(async () => {
    clearTimer(restAdvanceTimeoutRef);
    await cancelPodVoice();

    setRestModeId("");
    setRestStepIndex(0);
    setTimerRemaining(0);
    setTimerRunning(false);
    setTestComplete(false);
    setFeelChoice("");
    setRestCompletionStage("");
    setCueType("tip");
    setCue("Choose your Rest Test");
    setRestPanelPhase("normal");
    lastRestVoiceKeyRef.current = "";
  }, [cancelPodVoice]);

  const handleChooseRestMode = useCallback(
    async (modeId) => {
      noteUserInteraction?.();

      const flow = restFlows[modeId];
      const firstStep = flow?.steps?.[0] || null;
      if (!flow || !firstStep) return;

      clearTimer(restAdvanceTimeoutRef);
      await cancelPodVoice();

      setRestModeId(modeId);
      setRestStepIndex(0);
      setTimerRemaining(firstStep.seconds);
      setTimerRunning(false);
      setTestComplete(false);
      setFeelChoice("");
      setRestCompletionStage("");
      setCueType("tip");
      setCue(flow.title);
      setRestPanelPhase("normal");
      lastRestVoiceKeyRef.current = "";
      speakPod(`${flow.title}. ${firstStep.voice || firstStep.body}`, {
        actionType: "start_rest_test",
        calm: true,
        force: true,
        scriptKey: modeId === "deep" ? "pod.rest.deep.start" : "pod.rest.quick.start",
        key: `rest-mode::${modeId}::step-0`,
      });
    },
    [cancelPodVoice, restFlows, speakPod, noteUserInteraction]
  );

  const handleStartTimer = useCallback(() => {
    noteUserInteraction?.();

    if (!activeRestStep) return;
    if (timerRunning) return;
    if (timerRemaining <= 0) return;

    setTimerRunning(true);
    setCueType("tip");
    setCue(activeRestStep.cue || "Timer running");
    setRestPanelPhase("normal");
  }, [activeRestStep, timerRunning, timerRemaining, noteUserInteraction]);

  const completeRestRoutine = useCallback(
    (flow) => {
      if (!flow) return;

      setTimerRemaining(0);
      setTimerRunning(false);
      setTestComplete(true);
      setFeelChoice("");
      setRestCompletionStage(REST_COMPLETION_STAGES.reflection);
      setCueType("tip");
      setCue("Final reflection");
      setRestPanelPhase("normal");
      lastRestVoiceKeyRef.current = "";

      void speakPod(buildRestReflectionVoice(flow.title), {
        calm: true,
        force: true,
        scriptKey: flow.id === "deep" ? "pod.rest.deep.reflection" : "pod.rest.quick.reflection",
        key: `rest-reflection::${flow.id}`,
      });
    },
    [speakPod]
  );

  const runRestTransition = useCallback(
    ({ flow, nextIndex, nextStep, nextCue, voiceText }) => {
      clearTimer(restAdvanceTimeoutRef);
      void cancelPodVoice();

      setTimerRunning(false);
      setRestPanelPhase("transition");
      setCueType("tip");
      setCue("Next step");

      restAdvanceTimeoutRef.current = window.setTimeout(() => {
        if (!nextStep) {
          restAdvanceTimeoutRef.current = null;
          completeRestRoutine(flow);
          return;
        }

        setRestStepIndex(nextIndex);
        setTimerRemaining(nextStep.seconds);
        setCueType("tip");
        setCue(nextCue || nextStep.cue || "Next step");
        setRestPanelPhase("normal");
        lastRestVoiceKeyRef.current = "";
        restAdvanceTimeoutRef.current = null;

        if (voiceText) {
          void speakPod(voiceText, {
            calm: true,
            force: true,
            scriptKey: getRestStepScriptKey(nextStep.id),
            key: `rest-step-transition::${nextStep.id}`,
          });
        }
      }, 650);
    },
    [cancelPodVoice, completeRestRoutine, speakPod]
  );

  const handleAdvanceRestStep = useCallback(() => {
    noteUserInteraction?.();

    if (!activeRestFlow?.steps?.length) return;

    const nextIndex = restStepIndex + 1;
    const nextStep = activeRestFlow.steps[nextIndex] || null;

    runRestTransition({
      flow: activeRestFlow,
      nextIndex,
      nextStep,
      nextCue: nextStep?.cue || activeRestFlow.title,
      voiceText: nextStep?.voice || nextStep?.body || "",
    });
  }, [activeRestFlow, restStepIndex, runRestTransition, noteUserInteraction]);

  const handleSkipRestStep = useCallback(() => {
    noteUserInteraction?.();

    if (!activeRestFlow?.steps?.length) return;

    const nextIndex = restStepIndex + 1;
    const nextStep = activeRestFlow.steps[nextIndex] || null;

    runRestTransition({
      flow: activeRestFlow,
      nextIndex,
      nextStep,
      nextCue: nextStep?.cue || activeRestFlow.title,
      voiceText: nextStep?.voice || nextStep?.body || "",
    });
  }, [activeRestFlow, restStepIndex, runRestTransition, noteUserInteraction]);

  const handleSelectRestReflection = useCallback(
    async (choiceId) => {
      noteUserInteraction?.();

      const choice = REST_REFLECTION_OPTIONS.find((option) => option.id === choiceId) || null;
      if (!choice || !activeRestFlow) return;

      await cancelPodVoice();

      setFeelChoice(choice.label);
      setTestComplete(true);
      setRestCompletionStage(REST_COMPLETION_STAGES.actions);
      setTimerRunning(false);
      setCueType(choiceId === "compare_pod" ? "tip" : choiceId === "not_sure" ? "tip" : "success");
      setCue(choice.label);
      setRestPanelPhase("normal");

      void speakPod(buildRestActionsVoice(activeRestFlow.id, choice.label), {
        calm: true,
        force: true,
        scriptKey: activeRestFlow.id === "deep" ? "pod.rest.deep.actions" : "pod.rest.quick.actions",
        key: `rest-actions::${activeRestFlow.id}::${choice.id}`,
      });
    },
    [activeRestFlow, cancelPodVoice, noteUserInteraction, speakPod]
  );

  const stageContent = useMemo(() => {
    if (openStage === "details") {
      const hasSecondary = Boolean(activeDetailsContent?.secondaryItems?.length);

      return (
        <div
          className={[
            "grid gap-4",
            hasSecondary ? "xl:grid-cols-[minmax(0,1.16fr)_minmax(320px,0.84fr)]" : "",
          ].join(" ")}
        >
          <div className="min-w-0">
            <DetailBodyCard
              title={activeDetailsContent?.title || "Learn About This Pod"}
              body={activeDetailsContent?.body || detailsQuickActionIntro}
              itemsTitle={activeDetailsContent?.primaryTitle || ""}
              items={activeDetailsContent?.primaryItems || []}
            />
          </div>

          {hasSecondary ? (
            <div className="min-w-0">
              <DetailCard
                title={activeDetailsContent.secondaryTitle || "Why that matters for you"}
                items={activeDetailsContent.secondaryItems}
              />
            </div>
          ) : null}
        </div>
      );
    }

    if (openStage === "build") {
      return (
        <PodBuilder
          pod={activePod}
          assessment={assessment}
          mattressProduct={mattressProduct}
          baseProduct={baseProduct}
          onSelectionHandlesChange={onSelectionHandlesChange}
          onBuildStepChange={onBuildStepChange}
          onCue={(nextText, nextType = "tip") => {
            setCueType(nextType);
            setCue(nextText);

            if (typeof nextText === "string" && nextText.toLowerCase().includes("added to cart")) {
              setShowCheckoutOptions(true);
            }
          }}
          primaryCtaLabel="Add to Cart"
          onViewSnoozePod={() => navigate("/snoozepod")}
        />
      );
    }

    return (
      <GuidedRestTest
        flowOptions={restFlows}
        activeMode={activeRestFlow}
        activeStep={activeRestStep}
        activeStepIndex={restStepIndex}
        timerRemaining={timerRemaining}
        timerRunning={timerRunning}
        onChooseMode={handleChooseRestMode}
        onStartTimer={handleStartTimer}
        onAdvanceStep={handleAdvanceRestStep}
        onSkipStep={handleSkipRestStep}
        onResetTest={resetRestTest}
        onSelectReflection={handleSelectRestReflection}
        onViewDetails={() => void activateDetailsAction(DEFAULT_DETAILS_ACTION_ID, { ensureDetailsStage: true })}
        onBuildPod={async () => {
          noteUserInteraction?.();
          await cancelPodVoice();
          setOpenStage("build");
          setCueType("success");
          setCue("Finish Your SnoozePod");
          setRestPanelPhase("normal");
          void speakForStage("build");
        }}
        completionStage={restCompletionStage}
        reflectionChoice={feelChoice}
        hasAdjustableBase={hasAdjustableBase}
      />
    );
  }, [
    openStage,
    activeDetailsContent,
    detailsQuickActionIntro,
    assessment,
    mattressProduct,
    baseProduct,
    onSelectionHandlesChange,
    onBuildStepChange,
    navigate,
    restFlows,
    activeRestFlow,
    activeRestStep,
    restStepIndex,
    timerRemaining,
    timerRunning,
    handleChooseRestMode,
    handleStartTimer,
    handleAdvanceRestStep,
    handleSkipRestStep,
    resetRestTest,
    handleSelectRestReflection,
    activateDetailsAction,
    restCompletionStage,
    feelChoice,
    hasAdjustableBase,
    noteUserInteraction,
    cancelPodVoice,
  ]);

  const stageSubtitle = useMemo(() => {
    if (openStage === "build") {
      return "Finish your SnoozePod by choosing the size, base, motion, and comfort setup that feels right, then review everything before adding it to your cart.";
    }
    if (openStage === "details") {
      return "Use the guides above to hear how this pod feels, what is inside, why it lasts, and why Snoozer matched it to you.";
    }
    return headerPersonalization;
  }, [openStage, headerPersonalization]);

  const footerStageLabel = useMemo(() => {
    if (openStage === "details") return "Learn About This Pod";
    if (openStage === "build") return "Customize Your Pod";
    if (restCompletionStage === REST_COMPLETION_STAGES.reflection) return "Final reflection";
    if (testComplete) return "Rest Test complete";
    return "Rest Test";
  }, [openStage, restCompletionStage, testComplete]);

  const goToDetailsStage = useCallback(async () => {
    await activateDetailsAction(DEFAULT_DETAILS_ACTION_ID, { ensureDetailsStage: true });
  }, [activateDetailsAction]);

  const goToBuildStage = useCallback(async () => {
    noteUserInteraction?.();
    await cancelPodVoice();
    setOpenStage("build");
    setCueType("success");
    setCue("Finish Your SnoozePod");
    setRestPanelPhase("normal");
    void speakForStage("build");
  }, [cancelPodVoice, speakForStage, noteUserInteraction]);

  const goToRestStage = useCallback(() => {
    noteUserInteraction?.();
    void cancelPodVoice();
    setOpenStage("rest");
    setCueType("tip");
    setCue(
      restCompletionStage === REST_COMPLETION_STAGES.reflection
        ? "Final reflection"
        : restCompletionStage === REST_COMPLETION_STAGES.actions
          ? feelChoice || "Rest Test complete"
          : restModeId
            ? "Rest Test in progress"
            : "Choose your Rest Test"
    );
    setRestPanelPhase("normal");
  }, [cancelPodVoice, restModeId, restCompletionStage, feelChoice, noteUserInteraction]);

  const restPanelImage = useMemo(() => {
    if (openStage !== "rest") return [];

    if (restPanelPhase === "transition") {
      return REST_GUIDE_IMAGES.transition;
    }

    if (!activeRestFlow) {
      return REST_GUIDE_IMAGES.choice;
    }

    if (restCompletionStage) {
      return REST_GUIDE_IMAGES.active;
    }

    if (timerRunning) {
      return REST_GUIDE_IMAGES.active;
    }

    return REST_GUIDE_IMAGES.choice;
  }, [openStage, restPanelPhase, activeRestFlow, restCompletionStage, timerRunning]);

  const restPanelTitle = useMemo(() => {
    if (openStage !== "rest") return "";

    if (restPanelPhase === "transition") return "Next Step";
    if (!activeRestFlow) return "Choose Your Rest Test";
    if (restCompletionStage === REST_COMPLETION_STAGES.reflection) {
      return "Final Reflection";
    }
    if (restCompletionStage === REST_COMPLETION_STAGES.actions) {
      return "Next Actions";
    }
    if (timerRunning) return activeRestStep?.cue || "Rest Test Active";
    return activeRestFlow?.title || "Rest Test";
  }, [openStage, restPanelPhase, activeRestFlow, restCompletionStage, activeRestStep, timerRunning]);

  const restPanelCaption = useMemo(() => {
    if (openStage !== "rest") return "";

    if (restPanelPhase === "transition") {
      return "Move into the next position when you are ready.";
    }

    if (!activeRestFlow) {
      return "Choose either the 7-minute or 15-minute rest test to begin.";
    }

    if (restCompletionStage === REST_COMPLETION_STAGES.reflection) {
      return "Choose the one thing that stood out most during this rest test.";
    }

    if (restCompletionStage === REST_COMPLETION_STAGES.actions) {
      return "Choose what to do next without losing your place on this pod.";
    }

    if (timerRunning) {
      return activeRestStep?.body || "Follow the current step and notice how the mattress feels.";
    }

    return "Review the step, then start the timer when you are ready.";
  }, [openStage, restPanelPhase, activeRestFlow, restCompletionStage, activeRestStep, timerRunning]);

  const buildPanelVisual = useMemo(() => {
    const baseImage = pickProductImage(baseProduct);
    const motionVisual = inferMotionVisualFromHandle(effectiveBaseHandle, baseProduct?.title || "");
    const step = String(buildStepKey || "size");

    if (step === "base") {
      return {
        title: BUILD_VISUALS.base.title,
        image: [baseImage, mattressImage, PUBLIC_ASSETS.standardMotion],
        caption: BUILD_VISUALS.base.caption,
      };
    }

    if (step === "motion") {
      return {
        title: BUILD_VISUALS.motion.title,
        image: motionVisual.image,
        caption: motionVisual.caption || BUILD_VISUALS.motion.caption,
      };
    }

    if (step === "dual") {
      return {
        title: BUILD_VISUALS.dual.title,
        image: [mattressImage, PUBLIC_ASSETS.noImage],
        caption: BUILD_VISUALS.dual.caption,
      };
    }

    if (step === "review" || step === "mattress") {
      return {
        title: BUILD_VISUALS.review.title,
        image: [mattressImage, baseImage, PUBLIC_ASSETS.sizeDimensions],
        caption: BUILD_VISUALS.review.caption,
      };
    }

    return {
      ...BUILD_VISUALS.size,
      image: [PUBLIC_ASSETS.sizeDimensions],
    };
  }, [buildStepKey, baseProduct, effectiveBaseHandle, mattressImage]);

  const rightPanelContent = useMemo(() => {
    if (openStage === "rest") {
      return (
        <RestTestVisualCard
          title={restPanelTitle}
          image={restPanelImage}
          caption={restPanelCaption}
        />
      );
    }

    if (openStage === "build") {
      return (
        <BuildVisualCard
          title={buildPanelVisual.title}
          image={buildPanelVisual.image}
          caption={buildPanelVisual.caption}
        />
      );
    }

    return <OnThisPodCard title={mattressHeroTitle} image={mattressImage} />;
  }, [
    openStage,
    restPanelTitle,
    restPanelImage,
    restPanelCaption,
    buildPanelVisual,
    mattressHeroTitle,
    mattressImage,
  ]);

  const showInlineStagePanel = !loading && !!activePod;

  return (
    <section className="min-h-screen bg-gradient-to-b from-[#E8ECF5] to-white pb-28 pt-4 md:pt-5">
      <div className="mx-auto max-w-[1500px] px-4 lg:px-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              noteUserInteraction?.();
              navigate("/results");
            }}
            className="inline-flex items-center gap-3 rounded-2xl border bg-white px-5 py-3 text-base font-extrabold text-gray-900 shadow-sm transition hover:shadow"
          >
            <ArrowLeft className="h-5 w-5" />
            Back
          </button>

          <button
            type="button"
            onClick={() => {
              noteUserInteraction?.();
              navigate("/snoozepod");
            }}
            className="inline-flex items-center gap-3 rounded-2xl border bg-white px-5 py-3 shadow-sm transition hover:shadow"
            title="View cart"
          >
            <ShoppingCart className="h-5 w-5 text-indigo-700" />
            <div className="text-left leading-tight">
              <div className="text-xs font-semibold text-gray-500">Cart</div>
              <div className="text-base font-extrabold text-gray-900">
                {snoozepodCount} item{snoozepodCount === 1 ? "" : "s"}
              </div>
            </div>
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-[32px] border border-white/60 bg-white shadow-2xl">
            <div className="p-4 md:p-5">
              <div className="rounded-[28px] border border-indigo-100 bg-gradient-to-r from-[#EEF4FF] to-white p-4 shadow-sm md:p-5">
                <div className="min-w-0">
                  <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 md:text-5xl">
                    {title}
                  </h1>

                  <p className="mt-2.5 max-w-5xl text-base text-gray-700 md:text-lg">
                    {stageSubtitle}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <StageButton
                      active={openStage === "rest"}
                      icon={Timer}
                      label="Rest Test"
                      onClick={goToRestStage}
                    />
                    <StageButton
                      active={openStage === "details"}
                      icon={MessageSquare}
                      label="Learn About This Pod"
                      onClick={goToDetailsStage}
                    />
                    <StageButton
                      active={openStage === "build"}
                      icon={BedDouble}
                      label="Customize Your Pod"
                      onClick={goToBuildStage}
                    />
                  </div>

                  {(voiceState?.blocked || voiceState?.error) && (
                    <div className="mt-3 flex flex-wrap gap-3">
                      {voiceState?.blocked ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                          Audio may require a tap
                        </span>
                      ) : null}

                      {voiceState?.error ? (
                        <span className="rounded-full border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                          Audio unavailable
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.34fr)_minmax(360px,0.96fr)] xl:items-start">
                <div className="min-w-0 space-y-4">
                  {openStage !== "build" ? (
                    <WhyChosenCard
                      isRecommended={isRecommended}
                      rank={rank}
                      sentence={whyThisPodSentence}
                      detailsMode={openStage === "details"}
                      detailsIntro={detailsQuickActionIntro}
                      actions={DETAILS_ACTIONS}
                      activeActionId={detailsActionId}
                      onActionSelect={(actionId) =>
                        void activateDetailsAction(actionId, { ensureDetailsStage: true })
                      }
                    />
                  ) : null}

                  {showInlineStagePanel ? (
                    <div className="overflow-hidden rounded-[32px] border border-white/60 bg-white shadow-xl">
                      <div className="p-0">{stageContent}</div>
                    </div>
                  ) : (
                    <div className="rounded-[32px] border border-white/60 bg-white p-6 shadow-xl">
                      <div className="py-6 text-center text-gray-500">Preparing this pod</div>
                    </div>
                  )}
                </div>

                <div className="min-w-0 space-y-4">{rightPanelContent}</div>
              </div>
            </div>
          </div>

          {showCheckoutOptions ? (
            <div className="rounded-3xl border bg-white p-6 shadow-sm md:p-8">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-3xl border bg-gray-50 p-6">
                  <div className="text-lg font-extrabold text-gray-900">Checkout Kiosk</div>
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => {
                        noteUserInteraction?.();
                        void cancelPodVoice();
                        navigate("/snoozepod");
                      }}
                      className="rounded-2xl bg-indigo-600 px-6 py-4 text-base font-extrabold text-white hover:bg-indigo-700"
                    >
                      Go to Checkout
                    </button>
                  </div>
                </div>

                <div className="rounded-3xl border bg-gray-50 p-6">
                  <div className="text-lg font-extrabold text-gray-900">Continue on Phone</div>
                  <div className="mt-4">
                    {safeGet("snooze.shopify.checkoutUrl") || safeGet("snooze.checkoutUrl") ? (
                      <a
                        href={safeGet("snooze.shopify.checkoutUrl") || safeGet("snooze.checkoutUrl")}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex rounded-2xl border bg-white px-6 py-4 text-base font-extrabold text-gray-900 hover:bg-gray-50"
                        onClick={() => {
                          noteUserInteraction?.();
                          void cancelPodVoice();
                        }}
                      >
                        Open Checkout
                      </a>
                    ) : (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                        Checkout link pending
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {!loading && activePod ? (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-4 py-2.5 lg:px-6 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-gray-900">{title}</div>
              <div className="mt-0.5 text-sm text-gray-600">{footerStageLabel}</div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 md:flex md:flex-wrap">
              <FooterAction
                icon={Headphones}
                label="Talk to Human"
                onClick={() => {
                  noteUserInteraction?.();
                  setCueType("tip");
                  setCue("Ask the showroom team for in-store help when you're ready.");
                }}
              />

              <FooterAction
                icon={MessageSquare}
                label="Ask Snoozer"
                onClick={() => {
                  noteUserInteraction?.();
                  void cancelPodVoice();
                  navigate("/ask-snoozer", { state: { from: `/pod/${pid}` } });
                }}
              />

              <FooterAction
                icon={Sparkles}
                label="My Rewards"
                onClick={() => {
                  noteUserInteraction?.();
                  void cancelPodVoice();
                  navigate("/snoozepod");
                }}
              />

              <FooterAction
                icon={CreditCard}
                label="Checkout"
                tone="primary"
                onClick={() => {
                  noteUserInteraction?.();
                  void cancelPodVoice();
                  setShowCheckoutOptions(true);
                  setCueType("success");
                  setCue("Ready for checkout");
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
