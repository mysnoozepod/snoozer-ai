// src/pages/Pod.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  House,
  Timer,
  MessageSquare,
  BedDouble,
  CheckCircle2,
  HelpCircle,
  Heart,
  ImageOff,
  Headphones,
  Pause,
  Scale,
  Smile,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { api } from "@/lib/api";
import PodBuilder, {
  buildDefaultSelections,
  money,
  monthlyEstimate,
  parseVariantPrice,
  pickFeaturedImage,
  pickVariantForSize,
  subtitleForBase,
  subtitleForSize,
} from "@/components/PodBuilder";
import {
  ShowroomBrandMark,
  ShowroomCartBadge,
  ShowroomEyebrow,
  ShowroomFrame,
  ShowroomPageShell,
  ShowroomPanel,
} from "@/components/showroom/ShowroomPrimitives";
import {
  BASE_OPTIONS_UI,
  generateShowroomRecommendations,
  getBaseHandleForType,
  SIZE_OPTIONS,
} from "@/lib/utils/recommendations";
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

const SHOWROOM_MATTRESS_HERO_FALLBACKS = {
  "12-dual-comfort-hybrid":
    "https://cdn.shopify.com/s/files/1/0590/9807/1101/files/12InchDualComfortHybridMaatressAngledOnFurniture.webp?v=1720198706",
  "14-hybrid":
    "https://cdn.shopify.com/s/files/1/0590/9807/1101/files/14InchHybridMattressFrontView.jpg?v=1711500930",
  "12-all-foam-mattress":
    "https://cdn.shopify.com/s/files/1/0590/9807/1101/files/10InchAllFoamMattress.webp?v=1719414511",
  "10-all-foam-mattress":
    "https://cdn.shopify.com/s/files/1/0590/9807/1101/files/10InchAllFoamMattress.webp?v=1719414511",
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

  const fallbackImageUrl = pickPodFallbackImage(pod);
  const next = { ...pod };
  if (fallbackImageUrl && !next.fallbackImageUrl) {
    next.fallbackImageUrl = fallbackImageUrl;
  }
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
    product?.image?.url,
    product?.image?.src,
    product?.featured_image?.url,
    product?.featured_image?.src,
    product?.featuredImage?.url,
    product?.featuredImage?.src,
    product?.featuredImage?.originalSrc,
    product?.featuredImage?.transformedSrc,
    product?.images?.[0]?.url,
    product?.images?.[0]?.src,
    product?.images?.[0]?.originalSrc,
    product?.images?.[0]?.transformedSrc,
    product?.images?.edges?.[0]?.node?.url,
    product?.images?.edges?.[0]?.node?.src,
    product?.images?.edges?.[0]?.node?.originalSrc,
    product?.media?.[0]?.image?.url,
    product?.media?.[0]?.image?.src,
    product?.media?.[0]?.preview?.image?.url,
    product?.media?.[0]?.preview?.image?.src,
    product?.previewImage?.url,
    product?.previewImage?.src,
    product?.previewUrl,
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
  return `This pod matches your comfort profile around ${reason}.`;
}

function buildHeaderPersonalization(painSignals = []) {
  const reason = buildWhyThisPodReason(painSignals);
  return `Start by noticing ${reason}, then compare from there.`;
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
  if (isRecommended) items.push(`Top ${rank || "1"} match from your assessment`);
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
  return "Let's look at the features and benefits of this mattress so you can understand why it may fit your sleep needs.";
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

function startCase(value) {
  return normalizeText(value).replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function humanizeHandleLabel(value) {
  const raw = normalizeText(value);
  if (!raw) return "";

  return raw
    .replace(/[-_]+/g, " ")
    .replace(/\b\d+\b/g, (match) => match)
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
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

function formatBaseChoiceLabel(baseType, baseProduct) {
  if (baseType === "none") return "Mattress Only";
  const match = Array.isArray(BASE_OPTIONS_UI)
    ? BASE_OPTIONS_UI.find((option) => option?.value === baseType)
    : null;
  return normalizeText(baseProduct?.title || match?.label || humanizeHandleLabel(baseType) || "Base");
}

function formatFeatureLabelForFamily(family) {
  if (family === "dual") return "Dual Comfort";
  if (family === "hybrid") return "Hybrid";
  if (family === "foam") return "All Foam";
  return "Balanced";
}

function formatHeroFeelBadge(family) {
  if (family === "dual") return "Dual Comfort";
  if (family === "hybrid") return "Hybrid Feel";
  if (family === "foam") return "All-Foam Feel";
  return "Balanced Feel";
}

function formatBenefitBadge(benefits = [], reason = "") {
  const text = `${joinReadableList(benefits)} ${reason}`.toLowerCase();
  if (text.includes("pressure")) return "Pressure Relief";
  if (text.includes("back")) return "Lower Back Support";
  if (text.includes("cool")) return "Cooling";
  if (text.includes("motion")) return "Motion Control";
  return "Comfort Match";
}

function inferHeightLabel(mattressTitle = "") {
  const match = String(mattressTitle || "").match(/(\d{1,2}")/);
  return match ? `${match[1]} Height` : "Mattress Height";
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
      return "it matches the mattress style your assessment points to first";
    case "primary_mattress_family":
      return "it stays close to the mattress style that matched your assessment";
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
  return "Now choose your size and base. I'll keep the mattress matched to this pod and update your monthly estimate as you build.";
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

function pickPodFallbackImage(pod) {
  const candidates = [
    pod?.fallbackImageUrl,
    pod?.mattressImageUrl,
    pod?.mattressImage,
    pod?.imageUrl,
    pod?.image,
    pod?.image?.url,
    pod?.image?.src,
    pod?.image_url,
    pod?.mattress_image,
    pod?.featured_image?.url,
    pod?.featured_image?.src,
    pod?.featuredImage?.url,
    pod?.featuredImage?.src,
    pod?.featuredImage?.originalSrc,
    pod?.images?.[0]?.url,
    pod?.images?.[0]?.src,
    pod?.images?.[0]?.originalSrc,
    pod?.product?.imageUrl,
    pod?.product?.image,
    pod?.product?.image?.url,
    pod?.product?.image?.src,
    pod?.product?.featured_image?.url,
    pod?.product?.featured_image?.src,
    pod?.product?.featuredImage?.url,
    pod?.product?.featuredImage?.src,
    pod?.product?.featuredImage?.originalSrc,
    pod?.product?.images?.[0]?.url,
    pod?.product?.images?.[0]?.src,
    pod?.product?.images?.[0]?.originalSrc,
    pod?.previewUrl,
    pod?.product?.previewUrl,
  ];

  for (const candidate of candidates) {
    const url = sanitizeImageUrl(candidate);
    if (url) return url;
  }

  return "";
}

function formatDuration(totalSeconds) {
  const total = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (!minutes) return `${seconds}s`;
  if (!seconds) return `${minutes} min`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRestCountdown(totalSeconds) {
  const total = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function labelRestStep(step = {}) {
  const id = lowerText(step?.id);

  if (id.startsWith("head-up")) return "Head Up";
  if (id.startsWith("zero-g")) return "Zero Gravity";
  if (id.startsWith("flat-return")) return "Flat";
  if (id.startsWith("flat-normal")) return "Settle In";
  if (id.startsWith("flat-focus")) return "Notice Support";
  if (id.startsWith("flat-second")) return "Try Another Position";
  if (id.startsWith("final-compare")) return "Final Check";
  if (id.startsWith("reset")) return "Reset + Compare";

  return normalizeText(step?.cue || step?.title || "Next Step");
}

function buildRestComfortMeters(activeStepIndex = 0) {
  const presets = [
    [72, 46, 54, 58],
    [78, 40, 50, 66],
    [69, 52, 58, 62],
    [75, 44, 48, 68],
    [71, 50, 56, 70],
  ];

  const values = presets[Math.max(0, Math.min(activeStepIndex, presets.length - 1))];

  return [
    {
      label: "Lower Back Support",
      left: "Not Supported",
      right: "Fully Supported",
      value: values[0],
    },
    {
      label: "Shoulder Pressure",
      left: "High Pressure",
      right: "No Pressure",
      value: values[1],
    },
    {
      label: "Hip Pressure",
      left: "High Pressure",
      right: "No Pressure",
      value: values[2],
    },
    {
      label: "Overall Comfort",
      left: "Not Comfortable",
      right: "Very Comfortable",
      value: values[3],
    },
  ];
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
      body: "Lie in your normal sleep position and let your body settle in.",
      voice: "Lie down in your normal sleep position and let your body settle in.",
      startCta: "Start Timer",
      doneCta: "Next",
    },
    {
      id: "flat-focus-7",
      seconds: 120,
      cue: `Notice ${focusReason}`,
      title: "Rest Test",
      body: `Stay here and pay close attention to ${focusReason}.`,
      voice: `Stay here and pay close attention to ${focusReason}.`,
      startCta: "Start Timer",
      doneCta: "Next",
    },
    {
      id: "flat-second-7",
      seconds: 120,
      cue: "Try another position",
      title: "Rest Test",
      body: "Try another natural position and notice what changes.",
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
      body: "Raise the base to Head Up and notice how the position feels.",
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
      body: "Try Zero Gravity and notice pressure relief through your lower back, hips, and legs.",
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
      body: "Return to flat and notice how the pressure changes again.",
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
      body: "Take one more quiet moment before deciding.",
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
      body: "Lie in your normal sleep position and give your body more time to settle.",
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
      body: "Try another natural position and compare the feel there.",
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
      body: "Raise the base to Head Up and stay there long enough to settle in.",
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
      body: "Move into Zero Gravity and notice pressure relief and weight distribution.",
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
      body: "Return to flat and notice how the pressure changes again.",
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
      body: `Reset, roll once, and take a little longer to notice ${focusReason}.`,
      voice: `Reset, roll once, and take a little longer to notice pressure relief, alignment, and ${focusReason}.`,
      startCta: "Start Timer",
      doneCta: "Next",
    },
    {
      id: "final-compare-15",
      seconds: 60,
      cue: "Take one more moment",
      title: "Rest Test",
      body: "Take one final quiet moment before you decide.",
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
      rationale: "Quick comfort check.",
      steps: isAdjustableBase
        ? [...quickFlat.slice(0, 2), ...quickAdjustable]
        : [...quickFlat, ...quickNonAdjustableTail],
    },
    deep: {
      id: "deep",
      title: "15-Minute Rest Test",
      totalSeconds: 900,
      rationale: "More time to settle in.",
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
    id: "love_it",
    label: "Loved it",
    icon: Heart,
    tone: "blue",
  },
  {
    id: "compare_it",
    label: "Maybe — compare next",
    icon: Scale,
    tone: "orange",
  },
  {
    id: "not_for_me",
    label: "Not for me",
    icon: X,
    tone: "red",
  },
];

function normalizeRestCompletionStage(value) {
  const stage = String(value || "").trim().toLowerCase();
  if (stage === REST_COMPLETION_STAGES.reflection) return REST_COMPLETION_STAGES.reflection;
  if (stage === REST_COMPLETION_STAGES.actions) return REST_COMPLETION_STAGES.actions;
  return "";
}

function buildRestReflectionVoice(modeTitle) {
  return "Rest test complete. How did this pod feel?";
}

function buildRestActionsVoice(modeId, reflectionLabel = "") {
  const intro = reflectionLabel ? `Thanks. ${reflectionLabel}. ` : "";
  return (
    intro +
    "Rest Test saved. You can compare another pod, learn about this pod, build this setup, or go back to rest test options."
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

function ResponsiveImage({ src, alt, className, imgClassName }) {
  const candidates = useMemo(() => normalizeImageCandidates(src), [src]);

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

  if (!activeSrc) {
    return (
      <div className={className}>
        <div className="flex h-full w-full items-center justify-center rounded-[24px] bg-[radial-gradient(circle_at_top,_rgba(84,120,255,0.18),_transparent_55%),linear-gradient(180deg,#f6f9ff_0%,#eef3ff_100%)] text-[#2f57e8]">
          <ImageOff className="h-8 w-8 opacity-80" aria-hidden="true" />
          <span className="sr-only">{alt || "Product preview"}</span>
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
        loading="eager"
        fetchPriority="high"
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
    <ShowroomPanel className="p-5 md:p-6" tone="frost">
      <div className="text-sm font-black uppercase tracking-[0.18em] text-[#2f57e8]">
        {detailsMode ? "Learn About This Pod" : "Why This Pod Fits"}
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
          <div className="text-2xl font-extrabold leading-tight text-slate-900 md:text-[2rem]">
            {detailsMode
              ? "Choose what you want to understand."
              : isRecommended
                ? "Start here, then compare from there."
                : "A strong pod to compare."}
          </div>
          <div className="mt-2 text-base leading-7 text-slate-700 md:text-[1.05rem]">
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
    </ShowroomPanel>
  );
}

function OnThisPodCard({ title, image }) {
  return (
    <ShowroomPanel className="p-5 md:p-6" tone="soft">
      <div className="text-sm font-black uppercase tracking-[0.18em] text-[#2f57e8]">
        On This Pod
      </div>

      <div className="mt-2 text-2xl font-extrabold leading-tight text-slate-900 md:text-3xl">
        {title}
      </div>

      <div className="mt-4 overflow-hidden rounded-[28px] border border-white/75 bg-white/95 shadow-inner">
        <ResponsiveImage
          src={image}
          alt={title}
          className="aspect-[5/4]"
          imgClassName="h-full w-full object-contain p-3"
        />
      </div>
    </ShowroomPanel>
  );
}

function RestMeterRow({ label, left, right, value = 50 }) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));

  return (
    <div className="space-y-1.5 rounded-[18px] border border-white/80 bg-white/92 px-3.5 py-3 shadow-sm">
      <div className="text-sm font-extrabold text-slate-900">{label}</div>
      <div className="relative h-2 rounded-full bg-[#dfe7ff]">
        <div className="absolute inset-y-0 left-0 rounded-full bg-[#9fb6ff]" style={{ width: "100%" }} />
        <div
          className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-4 border-white bg-[#2f57e8] shadow"
          style={{ left: `calc(${clamped}% - 10px)` }}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

function RestTestVisualCard({ title, image, caption, items = [], meters = [] }) {
  return (
    <ShowroomPanel className="p-4 md:p-5" tone="soft">
      <div className="text-xs font-black uppercase tracking-[0.2em] text-[#2f57e8]">
        Live Comfort Check-In
      </div>

      <div className="mt-2 text-[1.55rem] font-extrabold leading-tight text-slate-900 md:text-[1.8rem]">
        {title}
      </div>

      <div className="mt-3 overflow-hidden rounded-[24px] border border-white/75 bg-white/95 shadow-inner">
        <ResponsiveImage
          src={image}
          alt={title}
          className="aspect-[16/10]"
          imgClassName="h-full w-full object-cover"
        />
      </div>

      <div className="mt-3 text-sm leading-6 text-slate-700">{caption}</div>

      {meters.length ? (
        <div className="mt-3 space-y-2.5">
          {meters.map((meter) => (
            <RestMeterRow key={meter.label} {...meter} />
          ))}
        </div>
      ) : items.length ? (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-700">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-600" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </ShowroomPanel>
  );
}

function BuildVisualCard({
  title,
  image,
  caption,
  eyebrow = "Setup Preview",
  items = [],
  nextAction = "",
}) {
  return (
    <ShowroomPanel className="p-5 md:p-6" tone="soft">
      <div className="text-sm font-black uppercase tracking-[0.18em] text-[#2f57e8]">
        {eyebrow}
      </div>

      <div className="mt-2 text-2xl font-extrabold leading-tight text-slate-900 md:text-3xl">
        {title}
      </div>

      <div className="mt-4 overflow-hidden rounded-[28px] border border-white/75 bg-white/95 shadow-inner">
        <ResponsiveImage
          src={image}
          alt={title}
          className="aspect-[16/10]"
          imgClassName="h-full w-full object-contain p-3"
        />
      </div>

      <div className="mt-3 text-base leading-7 text-slate-700">{caption}</div>

      {items.length ? (
        <ul className="mt-4 space-y-2 text-sm leading-6 text-gray-700">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-600" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {nextAction ? (
        <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-900">
          {nextAction}
        </div>
      ) : null}
    </ShowroomPanel>
  );
}

function DetailCard({ title, items = [] }) {
  return (
    <ShowroomPanel className="h-full p-5 md:p-6" tone="frost">
      <div className="text-lg font-extrabold text-slate-900 md:text-xl">{title}</div>
      <div className="mt-3 space-y-2.5">
        {items.map((item) => (
          <div key={item} className="text-base leading-7 text-slate-700">
            {item}
          </div>
        ))}
      </div>
    </ShowroomPanel>
  );
}

function DetailBodyCard({ title, body, itemsTitle = "", items = [] }) {
  return (
    <ShowroomPanel className="h-full p-5 md:p-6" tone="frost">
      <div className="text-lg font-extrabold text-slate-900 md:text-xl">{title}</div>

      {body ? <div className="mt-3 text-base leading-7 text-slate-700">{body}</div> : null}

      {items.length ? (
        <div className="mt-4 space-y-2.5">
          {itemsTitle ? <ShowroomEyebrow className="text-xs">{itemsTitle}</ShowroomEyebrow> : null}
          {items.map((item) => (
            <div key={item} className="text-base text-slate-700">
              {item}
            </div>
          ))}
        </div>
      ) : null}
    </ShowroomPanel>
  );
}

function DashboardInfoRow({ icon: Icon, title, body }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[18px] border border-white/70 bg-white/78 px-3 py-2 shadow-sm">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[#2f57e8]">
        {Icon ? <Icon className="h-4 w-4" /> : null}
      </div>

      <div className="min-w-0">
        <div className="text-[0.95rem] font-extrabold leading-tight text-slate-900">{title}</div>
        <div className="mt-1 text-[0.84rem] leading-5 text-slate-700">{body}</div>
      </div>
    </div>
  );
}

function DefaultWhyPodFitsCard({ title, intro, items = [] }) {
  return (
    <ShowroomPanel className="h-full p-3.5" tone="frost">
      <ShowroomEyebrow>Why This Pod Fits</ShowroomEyebrow>

      <div className="mt-2.5 grid gap-3 md:grid-cols-[64px_minmax(0,1fr)] md:items-start">
        <img
          src={PUBLIC_ASSETS.snoozerAvatar}
          alt="Snoozer"
          className="h-14 w-14 shrink-0 rounded-full object-cover md:h-16 md:w-16"
          loading="lazy"
          decoding="async"
        />

        <div className="min-w-0">
          <div className="text-[1.26rem] font-extrabold leading-[1.04] tracking-tight text-slate-900 md:text-[1.42rem]">
            {title}
          </div>
          <div className="mt-1.5 max-w-xl text-[0.9rem] leading-5 text-slate-700">
            {intro}
          </div>
        </div>
      </div>

      <div className="mt-2.5 space-y-2">
        {items.map((item) => (
          <DashboardInfoRow
            key={`${item.title}-${item.body}`}
            icon={item.icon || CheckCircle2}
            title={item.title}
            body={item.body}
          />
        ))}
      </div>
    </ShowroomPanel>
  );
}

function DefaultTestingGuideCard({
  items = [],
  flowOptions = [],
  onChooseMode,
  hasAdjustableBase = false,
}) {
  return (
    <ShowroomPanel className="h-full p-3.5" tone="frost">
      <ShowroomEyebrow>Testing Guide</ShowroomEyebrow>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-2.5">
        <div>
          <div className="text-[1.26rem] font-extrabold leading-[1.04] tracking-tight text-slate-900 md:text-[1.42rem]">
            How to test this pod
          </div>
          <div className="mt-1.5 max-w-xl text-[0.9rem] leading-5 text-slate-700">
            Test this first. Compare next.
          </div>
        </div>

        <div className="rounded-[18px] border border-indigo-100 bg-indigo-50/80 px-3 py-2 text-[11px] font-semibold text-indigo-900 md:max-w-[210px]">
          {hasAdjustableBase
            ? "Includes adjustable positions."
            : "Focused on flat-position testing."}
        </div>
      </div>

      <div className="mt-2.5 grid gap-2.5 md:grid-cols-[minmax(0,1fr)_170px]">
        <div className="space-y-2.5">
          {items.map((item) => (
            <DashboardInfoRow
              key={`${item.title}-${item.body}`}
              icon={item.icon || Timer}
              title={item.title}
              body={item.body}
            />
          ))}

          <div className="rounded-[18px] border border-slate-200 bg-white/80 px-3 py-2 text-[0.84rem] font-semibold text-slate-700">
            Compare one pod at a time.
          </div>
        </div>

        {flowOptions.length ? (
          <div className="space-y-2">
            {flowOptions.map((flow) => (
              <button
                key={flow.id}
                type="button"
                onClick={() => onChooseMode?.(flow.id)}
                className="w-full rounded-[20px] border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm transition hover:border-indigo-200 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[0.88rem] font-extrabold text-slate-900">{flow.title}</div>
                  <div className="rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-extrabold text-indigo-800">
                    {formatDuration(flow.totalSeconds)}
                  </div>
                </div>

                <div className="mt-1 text-[11px] leading-4 text-slate-600">
                  {lowerText(flow.id).includes("quick")
                    ? "Quick comfort check."
                    : "More time to settle in."}
                </div>

                <div className="mt-2 text-xs font-bold uppercase tracking-[0.16em] text-[#2f57e8]">
                  Start this test
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </ShowroomPanel>
  );
}

function ScoreDots({ value = 3, total = 5 }) {
  const safeValue = Math.max(0, Math.min(total, Number(value) || 0));
  return (
    <div className="mt-1 flex items-center gap-1">
      {Array.from({ length: total }).map((_, index) => (
        <span
          key={index}
          className={[
            "h-2 w-2 rounded-full border border-[#b9c8f6]",
            index < safeValue ? "bg-[#233dc0]" : "bg-white",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

function HeroFeatureChip({ title, value = 3, subtitle = "", image, compact = false }) {
  return (
    <div
      className={[
        "rounded-[18px] border border-[#dbe5ff] bg-white/94 px-2.5 py-2 shadow-sm",
        compact ? "min-w-[118px]" : "min-w-[142px]",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-[#eef3ff]">
          {image ? (
            <img src={image} alt="" className="h-5 w-5 object-contain" loading="lazy" decoding="async" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-[#2f57e8]" />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-[0.86rem] font-extrabold leading-tight text-slate-900">{title}</div>
          {subtitle ? <div className="mt-0.5 text-[0.72rem] font-semibold text-slate-500">{subtitle}</div> : null}
        </div>
      </div>
      <ScoreDots value={value} />
    </div>
  );
}

function SetupSummaryCard({
  step,
  label,
  value,
  subtitle = "",
  image,
  imageFit = "contain",
  onChange,
}) {
  return (
    <div className="rounded-[24px] border border-[#e0e8fb] bg-white px-4 py-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-black text-slate-900">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#eef3ff] text-[#2f57e8]">
          {step}
        </span>
        <span>{label}</span>
      </div>

      <div className="mt-4 flex gap-4">
        <div className="flex h-[92px] w-[92px] shrink-0 items-center justify-center overflow-hidden rounded-[22px] border border-[#e3eafc] bg-[#fbfcff]">
          {image ? (
            <img
              src={image}
              alt=""
              className={imageFit === "cover" ? "h-full w-full object-cover" : "h-full w-full object-contain p-2"}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <BedDouble className="h-8 w-8 text-[#2f57e8]" />
          )}
        </div>

        <div className="min-w-0">
          <div className="text-[1.1rem] font-extrabold leading-tight text-slate-900">{value}</div>
          {subtitle ? <div className="mt-1.5 text-[0.95rem] leading-6 text-slate-600">{subtitle}</div> : null}
          {onChange ? (
            <button
              type="button"
              onClick={onChange}
              className="mt-3 inline-flex items-center gap-2 text-sm font-extrabold text-[#2f57e8]"
            >
              Change
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SetupPricingCard({ label, value }) {
  return (
    <div className="rounded-[22px] border border-[#dbe5ff] bg-white px-4 py-4 text-right shadow-sm">
      <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1.5 text-[1.85rem] font-black tracking-tight text-slate-900">{value}</div>
    </div>
  );
}

function SetupValueNote({ title, body }) {
  return (
    <div className="flex items-center gap-3 rounded-[18px] border border-[#e0e8fb] bg-white px-3 py-2.5 shadow-sm">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#eef3ff] text-[#2f57e8]">
        <CheckCircle2 className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[0.9rem] font-extrabold leading-tight text-slate-900">{title}</div>
        <div className="mt-0.5 text-[0.78rem] leading-4 text-slate-500">{body}</div>
      </div>
    </div>
  );
}

function LearnAtGlanceCard({ title, body }) {
  return (
    <ShowroomPanel className="p-4" tone="frost">
      <ShowroomEyebrow className="text-[11px]">{title}</ShowroomEyebrow>
      <div className="mt-2 text-[1.08rem] font-extrabold leading-tight text-slate-900">{body}</div>
    </ShowroomPanel>
  );
}

function HeaderBadge({ label, tone = "soft" }) {
  const toneClass =
    tone === "primary"
      ? "border-[#d6e4ff] bg-[#eef3ff] text-[#2f57e8]"
      : tone === "accent"
        ? "border-[#ffe0bf] bg-[#fff5ea] text-[#ff8f1f]"
        : "border-white/85 bg-white/96 text-slate-700";

  return (
    <div
      className={[
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[0.7rem] font-extrabold uppercase tracking-[0.1em] shadow-[0_10px_24px_rgba(40,63,126,0.08)] md:px-3",
        toneClass,
      ].join(" ")}
    >
      {label}
    </div>
  );
}

function SnoozerCoachBubble({ copy }) {
  if (!copy) return null;

  return (
    <div className="mt-2 flex max-w-[188px] items-start gap-2 rounded-[18px] border border-white/85 bg-white/96 px-2.25 py-2 shadow-[0_14px_28px_rgba(40,63,126,0.12)] md:mt-0 md:max-w-[198px] md:px-2.5 md:py-2.25">
      <img
        src={PUBLIC_ASSETS.snoozerAvatar}
        alt="Snoozer"
        className="h-8 w-8 shrink-0 rounded-full object-cover ring-2 ring-[#eef3ff] md:h-9 md:w-9"
        loading="eager"
        decoding="async"
      />
      <div className="min-w-0">
        <div className="text-[0.84rem] font-black leading-none text-slate-900 md:text-[0.9rem]">
          I&apos;m Snoozer.
        </div>
        <div className="mt-0.75 text-[0.76rem] font-medium leading-[1.3] text-slate-700 md:text-[0.82rem]">
          {copy}
        </div>
      </div>
    </div>
  );
}

function PodRouteHeroHeader({
  eyebrow,
  podTitle,
  mattressTitle,
  helperText,
  isRecommended = false,
  mattressImage,
  voiceState,
  badges = [],
  coachBubble = "",
}) {
  const hasCoachBubble = Boolean(coachBubble);

  return (
    <div
      data-pod-route-header="true"
      className={[
        "grid items-stretch gap-0 overflow-hidden md:h-[182px] lg:h-[190px]",
        hasCoachBubble
          ? "md:grid-cols-[minmax(0,0.86fr)_minmax(172px,0.32fr)_minmax(0,1.16fr)] lg:grid-cols-[minmax(0,0.84fr)_minmax(188px,0.34fr)_minmax(0,1.18fr)]"
          : "md:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]",
      ].join(" ")}
    >
      <div
        className="relative flex min-h-[114px] flex-col justify-center px-5 py-3 md:h-full md:min-h-0 md:px-5 md:py-3"
      >
        {eyebrow ? (
          <ShowroomEyebrow className="text-[0.78rem] tracking-[0.24em]">{eyebrow}</ShowroomEyebrow>
        ) : null}

        <div className={[eyebrow ? "mt-1" : "mt-0", "text-[1.08rem] font-black tracking-tight text-[#2f57e8] md:text-[1.18rem]"].join(" ")}>
          {podTitle}
        </div>

        <h1 className="mt-0.5 max-w-[10.2ch] text-[1.92rem] font-black leading-[0.9] tracking-tight text-slate-900 md:text-[2.12rem] lg:text-[2.28rem]">
          {mattressTitle}
        </h1>

        {badges.length ? (
          <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {badges.map((badge) => (
              <HeaderBadge key={`${badge.label}-${badge.tone || "soft"}`} label={badge.label} tone={badge.tone} />
            ))}
          </div>
        ) : isRecommended ? (
          <div className="mt-2.5">
            <HeaderBadge label="Best First Match" tone="primary" />
          </div>
        ) : null}

        {helperText ? (
          <div className="mt-1.5 text-[0.84rem] font-medium text-slate-600 md:text-[0.88rem]">{helperText}</div>
        ) : null}

        {voiceState?.blocked || voiceState?.error ? (
          <div className="mt-3 flex flex-wrap gap-2.5">
            {voiceState?.blocked ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-800">
                Audio may require a tap
              </span>
            ) : null}
            {voiceState?.error ? (
              <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-700">
                Audio unavailable
              </span>
            ) : null}
          </div>
        ) : null}

        {coachBubble ? (
          <div className="mt-2 md:hidden">
            <SnoozerCoachBubble copy={coachBubble} />
          </div>
        ) : null}
      </div>

      {hasCoachBubble ? (
        <div className="hidden border-l border-white/70 bg-[radial-gradient(circle_at_left_center,_rgba(236,242,255,0.95),_rgba(236,242,255,0.72)_32%,_transparent_82%)] px-2 py-2 md:flex md:h-full md:items-center md:justify-center">
          <div className="w-full max-w-[236px]">
            <SnoozerCoachBubble copy={coachBubble} />
          </div>
        </div>
      ) : null}

      <div className="relative min-h-[114px] overflow-hidden border-t border-white/70 md:h-full md:min-h-0 md:border-l md:border-t-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_left_center,_rgba(232,239,255,0.92),_rgba(232,239,255,0.55)_26%,_transparent_58%)]" />
        <ResponsiveImage
          src={mattressImage}
          alt={mattressTitle}
          className="flex h-full min-h-[114px] w-full items-center justify-end px-0 py-0 md:min-h-0"
          imgClassName="h-full w-full max-h-full scale-[1.08] object-contain object-center md:scale-[1.2] lg:scale-[1.24]"
        />
      </div>
    </div>
  );
}

function PodHomeActionCard({
  icon: Icon,
  title,
  microcopy,
  accent = "blue",
  onClick,
}) {
  const barClass =
    accent === "orange"
      ? "bg-[linear-gradient(90deg,#ff9f1c_0%,#ff8a1e_100%)]"
      : "bg-[linear-gradient(90deg,#2f57e8_0%,#1f7cff_100%)]";
  const rootClass =
    accent === "orange"
      ? "bg-[radial-gradient(circle_at_top,_rgba(255,158,66,0.16),_transparent_56%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,248,241,0.98))] shadow-[0_20px_52px_rgba(255,143,31,0.14)]"
      : accent === "soft"
        ? "bg-[radial-gradient(circle_at_top,_rgba(84,120,255,0.06),_transparent_55%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,251,255,0.98))] shadow-[0_18px_46px_rgba(39,69,134,0.1)]"
        : "bg-[radial-gradient(circle_at_top,_rgba(84,120,255,0.08),_transparent_55%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,250,255,0.98))] shadow-[0_18px_46px_rgba(39,69,134,0.12)]";
  const iconTone =
    accent === "orange"
      ? "text-[#ff8f1f]"
      : accent === "soft"
        ? "text-[#5a71c8]"
        : "text-[#2f57e8]";
  const microcopyTone =
    accent === "orange"
      ? "text-[#ff8f1f]"
      : accent === "soft"
        ? "text-slate-500"
        : "text-[#2f57e8]";

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group flex h-full min-h-[118px] flex-col rounded-[24px] border border-white/85 p-3 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_52px_rgba(39,69,134,0.16)] md:min-h-[128px] md:p-3.25",
        rootClass,
      ].join(" ")}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/90 bg-white/96 shadow-[0_16px_32px_rgba(45,71,136,0.12)] md:h-[46px] md:w-[46px]">
        {Icon ? <Icon className={["h-5 w-5 md:h-[1.3rem] md:w-[1.3rem]", iconTone].join(" ")} /> : null}
      </div>

      <div className="mt-2.5 text-[1.18rem] font-black leading-none tracking-tight text-slate-900 md:text-[1.28rem]">
        {title}
      </div>

      <div className={["mt-1 text-[0.78rem] font-semibold md:text-[0.82rem]", microcopyTone].join(" ")}>
        {microcopy}
      </div>

      <div
        className={[
          "mt-auto flex h-8.5 items-center justify-center rounded-full text-white shadow-[0_18px_34px_rgba(47,87,232,0.24)] transition group-hover:scale-[1.01] md:h-[36px]",
          barClass,
        ].join(" ")}
      >
        <ArrowRight className="h-5 w-5" />
      </div>
    </button>
  );
}

function ExperienceFooterButton({
  icon: Icon,
  label,
  onClick,
  accent = "default",
}) {
  const accentClass =
    accent === "orange"
      ? "text-[#ff8f1f]"
      : accent === "blue"
        ? "text-[#2f57e8]"
        : "text-slate-900";

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[30px] items-center justify-center gap-1.5 rounded-[12px] border border-white/85 bg-white/96 px-2.5 text-[0.74rem] font-extrabold text-slate-900 shadow-[0_10px_24px_rgba(45,71,136,0.1)] transition hover:-translate-y-0.5 hover:bg-slate-50 md:min-w-[102px]"
    >
      {Icon ? <Icon className={["h-[0.85rem] w-[0.85rem] shrink-0", accentClass].join(" ")} /> : null}
      <span>{label}</span>
    </button>
  );
}

function RestCountdownRing({ remainingSeconds, totalSeconds }) {
  const safeTotal = Math.max(1, Number(totalSeconds) || 1);
  const safeRemaining = Math.max(0, Number(remainingSeconds) || 0);
  const progress = safeRemaining / safeTotal;
  const radius = 108;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - progress);

  return (
    <div className="relative flex h-[132px] w-[132px] items-center justify-center md:h-[144px] md:w-[144px]">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 248 248" aria-hidden="true">
        <circle
          cx="124"
          cy="124"
          r={radius}
          fill="none"
          stroke="rgba(219,229,255,0.92)"
          strokeWidth="10"
        />
        <circle
          cx="124"
          cy="124"
          r={radius}
          fill="none"
          stroke="#355ff1"
          strokeLinecap="round"
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={strokeOffset}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[2rem] font-black leading-none tracking-tight text-slate-900 md:text-[2.2rem]">
          {formatRestCountdown(safeRemaining)}
        </div>
        <div className="mt-1 text-[0.76rem] font-medium text-slate-500">remaining</div>
      </div>
    </div>
  );
}

function RestLengthCard({
  title,
  subtitle,
  durationLabel,
  accent = "orange",
  buttonLabel = "Start Test",
  onClick,
}) {
  const iconTone = accent === "blue" ? "text-[#355ff1]" : "text-[#ff8f1f]";
  const durationTone =
    accent === "blue"
      ? "bg-[#edf2ff] text-[#355ff1]"
      : "bg-[#fff1e2] text-[#ff8f1f]";
  const buttonTone =
    accent === "blue"
      ? "bg-[linear-gradient(90deg,#2f57e8_0%,#1f7cff_100%)] shadow-[0_18px_36px_rgba(47,87,232,0.24)]"
      : "bg-[linear-gradient(90deg,#ff9f1c_0%,#ff7a1a_100%)] shadow-[0_18px_36px_rgba(255,143,31,0.26)]";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full cursor-pointer flex-col rounded-[22px] border border-white/85 bg-white/96 p-3 text-left shadow-[0_18px_46px_rgba(45,71,136,0.1)] transition duration-200 hover:-translate-y-0.5 hover:border-[#d8e2ff] hover:shadow-[0_24px_54px_rgba(45,71,136,0.14)] md:min-h-[126px] md:p-3.25"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/90 bg-[#f7faff] shadow-[0_12px_28px_rgba(45,71,136,0.08)]">
          <Timer className={["h-6 w-6", iconTone].join(" ")} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[1rem] font-black leading-none tracking-tight text-slate-900 md:text-[1.08rem]">
                {title}
              </div>
              <div className="mt-1 text-[0.8rem] leading-5 text-slate-600 md:text-[0.84rem]">{subtitle}</div>
            </div>
            <div className={["shrink-0 rounded-full px-3 py-1 text-[0.76rem] font-black", durationTone].join(" ")}>
              {durationLabel}
            </div>
          </div>
        </div>
      </div>

      <div
        className={[
          "mt-3 flex h-10 items-center justify-center rounded-full text-[0.86rem] font-black text-white transition group-hover:scale-[1.01]",
          buttonTone,
        ].join(" ")}
      >
        {buttonLabel} <ArrowRight className="ml-2 inline h-5 w-5" />
      </div>
    </button>
  );
}

function PodRestStartSection({
  podLabel,
  flowOptions = [],
  onChooseMode,
}) {
  const cards = flowOptions.length
    ? flowOptions.slice(0, 2).map((flow, index) => ({
        id: flow.id,
        title: lowerText(flow.id).includes("deep") ? "15-Minute Test" : "7-Minute Test",
        subtitle: lowerText(flow.id).includes("deep") ? "More time to settle in" : "Quick feel check",
        durationLabel: lowerText(flow.id).includes("deep") ? "15 min" : "7 min",
        buttonLabel: lowerText(flow.id).includes("deep")
          ? "Start 15-Minute Test"
          : "Start 7-Minute Test",
        accent: lowerText(flow.id).includes("deep") ? "blue" : "orange",
      }))
    : [
        {
          id: "quick",
          title: "7-Minute Test",
          subtitle: "Quick feel check",
          durationLabel: "7 min",
          buttonLabel: "Start 7-Minute Test",
          accent: "orange",
        },
        {
          id: "deep",
          title: "15-Minute Test",
          subtitle: "More time to settle in",
          durationLabel: "15 min",
          buttonLabel: "Start 15-Minute Test",
          accent: "blue",
        },
      ];

  return (
    <ShowroomPanel className="overflow-hidden p-3 md:p-3.5" tone="frost">
      <div className="max-w-[780px]">
        <div className="text-[1.44rem] font-black leading-[0.96] tracking-tight text-slate-900 md:text-[1.68rem]">
          Start Your Rest Test
        </div>
        <div className="mt-1 text-[0.88rem] leading-5 text-slate-600 md:text-[0.92rem]">
          Try {podLabel} your way. Start with 7 minutes for a quick feel check, or choose 15 minutes if you want more time to settle in.
        </div>
      </div>

      <div className="mt-2.5 grid gap-2 md:grid-cols-2">
        {cards.map((card) => (
          <RestLengthCard
            key={card.id}
            title={card.title}
            subtitle={card.subtitle}
            durationLabel={card.durationLabel}
            accent={card.accent}
            buttonLabel={card.buttonLabel}
            onClick={() => onChooseMode?.(card.id)}
          />
        ))}
      </div>

      <div className="mt-2.5 flex items-center justify-center gap-2 text-[0.78rem] font-medium text-slate-500">
        <CheckCircle2 className="h-4 w-4 text-slate-400" />
        <span>You can end or pause your test at any time.</span>
      </div>
    </ShowroomPanel>
  );
}

function RestRatingCard({ option, selected = false, onClick }) {
  const Icon = option.icon;
  const toneClasses =
    option.tone === "orange"
      ? selected
        ? "border-[#ffbe85] bg-[#fff5eb] text-[#d76a09] shadow-[0_18px_34px_rgba(255,143,31,0.18)]"
        : "border-[#ffdcb9] bg-white text-slate-900 hover:bg-[#fff9f2]"
      : option.tone === "red"
        ? selected
          ? "border-[#ffc8c8] bg-[#fff3f3] text-[#d84545] shadow-[0_18px_34px_rgba(220,80,80,0.12)]"
          : "border-[#ffd7d7] bg-white text-slate-900 hover:bg-[#fff8f8]"
        : selected
          ? "border-[#b8cbff] bg-[#eef3ff] text-[#2f57e8] shadow-[0_18px_34px_rgba(47,87,232,0.16)]"
          : "border-[#d6e4ff] bg-white text-slate-900 hover:bg-[#f7faff]";
  const iconTone =
    option.tone === "orange"
      ? "text-[#ff8f1f]"
      : option.tone === "red"
        ? "text-[#ef5b5b]"
        : "text-[#355ff1]";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={[
        "flex min-h-[134px] cursor-pointer flex-col rounded-[22px] border px-3.5 py-3.5 text-center transition duration-200 hover:-translate-y-0.5 md:min-h-[146px] md:px-4 md:py-4",
        toneClasses,
      ].join(" ")}
    >
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/82 shadow-[0_10px_24px_rgba(45,71,136,0.08)] md:h-16 md:w-16">
        {Icon ? <Icon className={["h-7 w-7 md:h-8 md:w-8", iconTone].join(" ")} /> : null}
      </div>

      <div className="mt-3 text-[0.94rem] font-black leading-tight text-slate-900 md:mt-4 md:text-[1.04rem]">
        {option.label}
      </div>

      {selected ? (
        <div className="mt-3 text-[0.8rem] font-extrabold uppercase tracking-[0.18em] text-[#2f57e8] md:mt-4">
          Selected
        </div>
      ) : null}
    </button>
  );
}

function RestInstructionCard({
  id,
  title,
  body,
  icon: Icon = CheckCircle2,
  accent = "blue",
  selected = false,
  onClick,
}) {
  const accentClass =
    accent === "orange"
      ? "border-[#ffe0bf] bg-[#fff7ef] text-[#ff8f1f]"
      : "border-[#dbe5ff] bg-white text-[#355ff1]";

  return (
    <button
      type="button"
      onClick={() => onClick?.(id)}
      aria-pressed={selected}
      className={[
        "rounded-[18px] border bg-white/96 p-2.5 text-left shadow-[0_14px_30px_rgba(45,71,136,0.08)] transition hover:-translate-y-0.5",
        selected
          ? "border-[#b8cbff] bg-[#f7faff] shadow-[0_20px_40px_rgba(47,87,232,0.16)]"
          : "border-white/80 hover:border-[#d6e4ff]",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <div className={["flex h-8 w-8 shrink-0 items-center justify-center rounded-full border", accentClass].join(" ")}>
          {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        </div>
        <div className="min-w-0">
          <div className="text-[0.86rem] font-black leading-tight text-slate-900">{title}</div>
          <div className="mt-0.5 text-[0.74rem] leading-[1.05rem] text-slate-600">{body}</div>
        </div>
      </div>
    </button>
  );
}

function buildActiveRestInstructionCards({ hasAdjustableBase }) {
  return [
    {
      id: "back",
      title: "Try Your Back",
      body: "Lie flat and notice lower-back support.",
      focusTitle: "Try your back",
      focusBody: "Lie flat and notice lower-back support through the middle of the mattress.",
      icon: BedDouble,
      accent: "blue",
    },
    {
      id: "side",
      title: "Try Your Side",
      body: "Check shoulder and hip pressure.",
      focusTitle: "Try your side",
      focusBody: "Pay attention to shoulder and hip pressure relief while you settle in.",
      icon: CheckCircle2,
      accent: "blue",
    },
    hasAdjustableBase
      ? {
          id: "motion",
          title: "Try Motion",
          body: "Try Zero Gravity, Snore, or Head Up.",
          focusTitle: "Try motion",
          focusBody: "Use the adjustable positions and notice whether support or pressure relief changes.",
          icon: SlidersHorizontal,
          accent: "orange",
        }
      : {
          id: "relax",
          title: "Relax & Notice",
          body: "Let your body settle and notice pressure points.",
          focusTitle: "Relax and notice",
          focusBody: "Stay still for a moment and notice comfort, pressure points, and overall support.",
          icon: Heart,
          accent: "orange",
        },
  ];
}

function GuidedRestTest({
  podLabel = "this pod",
  flowOptions,
  activeMode,
  activeStep,
  activeStepIndex,
  timerRemaining,
  timerRunning,
  onChooseMode,
  onStartTimer,
  onPauseTimer,
  onAdvanceStep,
  onSkipStep,
  onResetTest,
  onChooseReflection,
  onSelectReflection,
  onViewDetails,
  onBuildPod,
  onCompareAnotherPod,
  onSwitchToLongerMode,
  completionStage,
  reflectionChoice,
  testComplete = false,
  hasAdjustableBase,
  selectedInstructionId,
  onSelectInstruction,
  onEndAndRate,
}) {
  if (!activeMode) {
    return (
      <PodRestStartSection
        podLabel={podLabel}
        flowOptions={Object.values(flowOptions || {})}
        onChooseMode={onChooseMode}
      />
    );
  }

  if (completionStage === REST_COMPLETION_STAGES.actions) {
    return (
      <ShowroomPanel className="overflow-hidden p-3.5 md:p-4" tone="frost">
        <div className="text-[1.82rem] font-black leading-tight tracking-tight text-slate-900 md:text-[2rem]">
          Rest Test saved
        </div>

        {reflectionChoice ? (
          <div className="mt-3 rounded-[18px] border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-900">
            Saved rating: {reflectionChoice}
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-3">
          <button
            type="button"
            onClick={onCompareAnotherPod}
            className="rounded-[18px] bg-indigo-600 px-4 py-2.5 text-[0.9rem] font-extrabold text-white transition hover:bg-indigo-700"
          >
            Compare Another Pod
          </button>

          <button
            type="button"
            onClick={onViewDetails}
            className="rounded-[18px] border bg-white px-4 py-2.5 text-[0.9rem] font-extrabold text-gray-900 transition hover:bg-gray-50"
          >
            Learn About This Pod
          </button>

          <button
            type="button"
            onClick={onBuildPod}
            className="rounded-[18px] border bg-white px-4 py-2.5 text-[0.9rem] font-extrabold text-gray-900 transition hover:bg-gray-50"
          >
            Build This Setup
          </button>
        </div>

        <button
          type="button"
          onClick={onResetTest}
          className="mt-3 inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 transition hover:text-slate-900"
        >
          Back to Rest Test Options
        </button>
      </ShowroomPanel>
    );
  }

  const stepTotalSeconds = Math.max(1, Number(activeStep?.seconds) || 1);
  const activeTitle =
    activeMode?.id === "deep" ? "15-Minute Test in Progress" : "7-Minute Test in Progress";
  const pauseLabel = timerRunning ? "Pause Test" : "Resume Test";
  const showLongerModeSwitch = activeMode?.id === "quick";
  const instructionCards = buildActiveRestInstructionCards({ hasAdjustableBase });
  const selectedInstruction =
    instructionCards.find((card) => card.id === selectedInstructionId) || null;
  const currentFocusTitle = selectedInstruction?.focusTitle || activeStep?.cue || "Keep settling in";
  const currentFocusBody =
    selectedInstruction?.focusBody ||
    activeStep?.body ||
    "Stay in the position and notice comfort, support, and pressure relief.";

  if (completionStage === REST_COMPLETION_STAGES.reflection) {
    return (
      <ShowroomPanel className="overflow-hidden p-3.5 md:p-4" tone="frost">
        <div className="text-[1.72rem] font-black leading-tight tracking-tight text-slate-900 md:text-[1.95rem]">
          How did this pod feel?
        </div>

        <div className="mt-3 grid gap-2.5 md:grid-cols-3">
          {REST_REFLECTION_OPTIONS.map((option) => (
            <RestRatingCard
              key={option.id}
              option={option}
              selected={false}
              onClick={() => onSelectReflection(option.id)}
            />
          ))}
        </div>
      </ShowroomPanel>
    );
  }

  return (
      <ShowroomPanel className="overflow-hidden p-3 md:p-3.5" tone="frost">
        <div className="text-[1.42rem] font-black leading-[0.98] tracking-tight text-slate-900 md:text-[1.56rem]">
          {activeTitle}
        </div>

      <div className="mt-2 grid gap-2 xl:grid-cols-[148px_minmax(0,1fr)] xl:items-start">
        <div className="flex justify-center xl:justify-start">
          <RestCountdownRing
            remainingSeconds={timerRemaining}
            totalSeconds={stepTotalSeconds}
          />
        </div>

        <div className="space-y-2">
          <div className="rounded-[16px] border border-[#dbe5ff] bg-white/96 px-3 py-2 shadow-sm">
            <div className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">
              Current Focus
            </div>
            <div className="mt-1 text-[0.9rem] font-black text-slate-900">
              {currentFocusTitle}
            </div>
            <div className="mt-0.5 text-[0.76rem] leading-[1.05rem] text-slate-600">
              {currentFocusBody}
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            {instructionCards.map((card) => (
              <RestInstructionCard
                key={card.id}
                {...card}
                selected={card.id === selectedInstructionId}
                onClick={onSelectInstruction}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onPauseTimer}
          className="inline-flex min-h-[36px] min-w-[144px] items-center justify-center gap-2 rounded-[14px] border border-[#dbe5ff] bg-white px-3.5 text-[0.8rem] font-black text-[#355ff1] shadow-sm transition hover:bg-slate-50"
        >
          <Pause className="h-4 w-4" />
          {pauseLabel}
        </button>

        <button
          type="button"
          onClick={onEndAndRate}
          className="inline-flex min-h-[36px] min-w-[144px] items-center justify-center gap-2 rounded-[14px] border border-[#ffd7d7] bg-white px-3.5 text-[0.8rem] font-black text-[#ef5b5b] shadow-sm transition hover:bg-[#fff8f8]"
        >
          <X className="h-4 w-4" />
          End & Rate
        </button>

        {showLongerModeSwitch ? (
          <button
            type="button"
            onClick={onSwitchToLongerMode}
            className="inline-flex min-h-[36px] flex-1 items-center justify-center gap-2 rounded-[14px] border border-[#dbe5ff] bg-[#f8faff] px-3.5 text-[0.76rem] font-extrabold text-[#355ff1] shadow-sm transition hover:bg-white xl:min-w-[206px] xl:flex-none"
          >
            Need more time? Switch to 15 min
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </ShowroomPanel>
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
  const snoozepodCount = useMemo(
    () => plan.reduce((sum, item) => sum + Math.max(0, Number(item?.quantity) || 0), 0),
    [plan]
  );
  const [cartNotice, setCartNotice] = useState("");
  const [cartPulse, setCartPulse] = useState(false);

  const [loading, setLoading] = useState(true);
  const [recs, setRecs] = useState(null);
  const [activePod, setActivePod] = useState(null);

  const [mattressProduct, setMattressProduct] = useState(null);
  const [baseProduct, setBaseProduct] = useState(null);
  const [mattressImageFallback, setMattressImageFallback] = useState("");

  const [selectedMattressHandle, setSelectedMattressHandle] = useState(undefined);
  const [selectedBaseHandle, setSelectedBaseHandle] = useState(undefined);
  const [buildPreviewData, setBuildPreviewData] = useState(null);
  const [buildSelectionState, setBuildSelectionState] = useState(null);

  const [cue, setCue] = useState("Rest Test");
  const [cueType, setCueType] = useState("tip");

  const [buildStepKey, setBuildStepKey] = useState("size");

  const [openStage, setOpenStage] = useState("rest");

  const [testComplete, setTestComplete] = useState(false);
  const [feelChoice, setFeelChoice] = useState("");
  const [restCompletionStage, setRestCompletionStage] = useState("");
  const [detailsActionId, setDetailsActionId] = useState(DEFAULT_DETAILS_ACTION_ID);
  const [showCheckoutOptions, setShowCheckoutOptions] = useState(false);

  const [restModeId, setRestModeId] = useState("");
  const [restStepIndex, setRestStepIndex] = useState(0);
  const [timerRemaining, setTimerRemaining] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [selectedRestInstructionId, setSelectedRestInstructionId] = useState("");
  const [restPanelPhase, setRestPanelPhase] = useState("normal");
  const [showRestChooser, setShowRestChooser] = useState(false);

  const lastPodVoiceKeyRef = useRef("");
  const lastRestVoiceKeyRef = useRef("");
  const restAdvanceTimeoutRef = useRef(null);
  const cartFeedbackTimeoutRef = useRef(null);
  const lastCartCountRef = useRef(snoozepodCount);
  const stagePanelRef = useRef(null);

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
      clearTimer(cartFeedbackTimeoutRef);
    };
  }, []);

  const showCartFeedback = useCallback((message = "Added to cart") => {
    clearTimer(cartFeedbackTimeoutRef);
    setCartNotice(message);
    setCartPulse(true);
    cartFeedbackTimeoutRef.current = window.setTimeout(() => {
      setCartNotice("");
      setCartPulse(false);
      cartFeedbackTimeoutRef.current = null;
    }, 2200);
  }, []);

  useEffect(() => {
    if (snoozepodCount > lastCartCountRef.current) {
      showCartFeedback("Added to cart");
    }

    lastCartCountRef.current = snoozepodCount;
  }, [snoozepodCount, showCartFeedback]);

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
    setBuildPreviewData(null);
    setBuildSelectionState(null);
    setMattressImageFallback(sanitizedFound?.fallbackImageUrl || "");
    setShowCheckoutOptions(false);

    setOpenStage("rest");
    setBuildStepKey("size");
    setTestComplete(false);
    setFeelChoice("");
    setRestCompletionStage("");
    setDetailsActionId(DEFAULT_DETAILS_ACTION_ID);
    setRestModeId("");
    setRestStepIndex(0);
    setTimerRemaining(0);
    setTimerRunning(false);
    setRestPanelPhase("normal");
    setShowRestChooser(false);
    setCueType("tip");
    setCue("Choose your Rest Test");
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

  useEffect(() => {
    let alive = true;

    if (activePod?.fallbackImageUrl) {
      setMattressImageFallback(activePod.fallbackImageUrl);
      return () => {
        alive = false;
      };
    }

    if (!effectiveMattressHandle) {
      setMattressImageFallback("");
      return () => {
        alive = false;
      };
    }

    (async () => {
      try {
        const index = await api.getProductsIndexByHandle({ limit: 250, lite: true });
        if (!alive) return;

        const indexedImage = pickProductImage(index?.[effectiveMattressHandle]);
        if (indexedImage) {
          setMattressImageFallback(indexedImage);
          return;
        }

        const fullProduct = await api.getProductById(effectiveMattressHandle);
        if (!alive) return;

        setMattressImageFallback(pickProductImage(fullProduct));
      } catch {
        if (alive) {
          setMattressImageFallback("");
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [effectiveMattressHandle, activePod?.fallbackImageUrl]);

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

  const podLabel = `SnoozePod ${pid}`;
  const title = activePod?.title || podLabel;
  const isRecommended = !!activePod?.recommended;
  const rank = Number(activePod?.rank || 0);

  const mattressImage = useMemo(
    () =>
      pickProductImage(mattressProduct) ||
      mattressImageFallback ||
      activePod?.fallbackImageUrl ||
      SHOWROOM_MATTRESS_HERO_FALLBACKS[effectiveMattressHandle] ||
      SHOWROOM_MATTRESS_HERO_FALLBACKS[activePod?.mattressHandle] ||
      "",
    [
      mattressProduct,
      mattressImageFallback,
      activePod?.fallbackImageUrl,
      activePod?.mattressHandle,
      effectiveMattressHandle,
    ]
  );
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

  useEffect(() => {
    if (openStage !== "rest") return;
    if (!activeRestFlow && !restCompletionStage) return;

    const node = stagePanelRef.current;
    if (!node) return;

    const id = window.setTimeout(() => {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);

    return () => window.clearTimeout(id);
  }, [openStage, activeRestFlow, restCompletionStage]);

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
  const mattressDisplayTitle = /mattress/i.test(mattressTruth.mattressTitle || mattressHeroTitle)
    ? (mattressTruth.mattressTitle || mattressHeroTitle)
    : `${mattressTruth.mattressTitle || mattressHeroTitle} Mattress`;
  const headerBadges = useMemo(() => {
    const items = [];

    if (isRecommended) {
      items.push({ label: "Best First Match", tone: "primary" });
    }

    items.push({
      label: formatHeroFeelBadge(mattressTruth.family),
      tone: "soft",
    });

    items.push({
      label: formatBenefitBadge(benefits, whyThisPodReason),
      tone: "accent",
    });

    items.push({
      label: isRecommended ? "Compare Next" : "Compare Pod",
      tone: "soft",
    });

    return items.slice(0, 4);
  }, [isRecommended, mattressTruth.family, benefits, whyThisPodReason]);
  const podHomeBadges = useMemo(() => {
    const prioritized = headerBadges.filter(
      (badge) => badge.label === "Best First Match" || /feel$/i.test(badge.label)
    );

    if (prioritized.length >= 2) return prioritized.slice(0, 2);
    if (prioritized.length === 1) {
      const fallback = headerBadges.find((badge) => badge.label !== prioritized[0].label);
      return fallback ? [prioritized[0], fallback] : prioritized;
    }
    return headerBadges.slice(0, 2);
  }, [headerBadges]);
  const restCoachCopy =
    "Start with 7 minutes for a quick check, or choose 15 if you want more time to settle in.";

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

  const defaultBuildSelections = useMemo(
    () =>
      buildDefaultSelections({
        assessment,
        pod: activePod,
        supportsSplitMotion: mattressTruth.isDualComfort,
        isDualComfort: mattressTruth.isDualComfort,
      }),
    [assessment, activePod, mattressTruth.isDualComfort]
  );

  useEffect(() => {
    if (!activePod) return;

    const defaultBaseHandle =
      defaultBuildSelections.baseType === "none"
        ? null
        : getBaseHandleForType(defaultBuildSelections.baseType) || null;

    setSelectedBaseHandle((prev) => (prev === undefined ? defaultBaseHandle : prev));
  }, [activePod, defaultBuildSelections.baseType]);

  const defaultMattressVariant = useMemo(
    () => pickVariantForSize(mattressProduct, defaultBuildSelections.size),
    [mattressProduct, defaultBuildSelections.size]
  );
  const defaultBaseVariant = useMemo(
    () =>
      defaultBuildSelections.baseType !== "none"
        ? pickVariantForSize(baseProduct, defaultBuildSelections.size)
        : null,
    [baseProduct, defaultBuildSelections.baseType, defaultBuildSelections.size]
  );
  const defaultPreviewTotal = useMemo(
    () =>
      parseVariantPrice(defaultMattressVariant) +
      (defaultBuildSelections.baseType !== "none" ? parseVariantPrice(defaultBaseVariant) : 0),
    [defaultMattressVariant, defaultBuildSelections.baseType, defaultBaseVariant]
  );

  const setupSummaryState = useMemo(() => {
    if (buildSelectionState) {
      return {
        ...buildSelectionState,
        monthlyLabel: money(buildSelectionState.monthly),
        totalLabel: money(buildSelectionState.previewTotal),
      };
    }

    const baseType = defaultBuildSelections.baseType;
    return {
      size: defaultBuildSelections.size,
      baseType,
      motionType: defaultBuildSelections.motionType,
      mattressLabel: mattressTruth.mattressTitle || mattressHeroTitle,
      selectedBaseLabel: formatBaseChoiceLabel(baseType, baseProduct),
      selectedMotionLabel:
        baseType === "adjustable"
          ? lowerText(defaultBuildSelections.motionType).includes("full")
            ? "Full Split Motion"
            : lowerText(defaultBuildSelections.motionType).includes("half")
              ? "Half Split Motion"
              : "Standard Motion"
          : "No Motion",
      mattressImage: pickFeaturedImage(mattressProduct),
      baseImage: pickFeaturedImage(baseProduct),
      sizeSubtitle: subtitleForSize(defaultBuildSelections.size),
      baseSubtitle:
        baseType === "adjustable"
          ? "Adjustable support."
          : subtitleForBase(baseType),
      wantsBase: baseType !== "none",
      showMotion: baseType === "adjustable",
      monthly: monthlyEstimate(defaultPreviewTotal),
      previewTotal: defaultPreviewTotal,
      monthlyLabel: money(monthlyEstimate(defaultPreviewTotal)),
      totalLabel: money(defaultPreviewTotal),
    };
  }, [
    baseProduct,
    buildSelectionState,
    defaultBuildSelections,
    defaultPreviewTotal,
    mattressProduct,
    mattressTruth.mattressTitle,
    mattressHeroTitle,
  ]);

  const detailsQuickActionIntro = useMemo(() => {
    const summary = pickPreferredReasonKeys(detailReasonKeys)
      .map((key) => getPodReasonVariant(key, detailReasonContext))
      .find(Boolean);

    const reasonLine = summary || getPodFallbackReason(detailReasonContext);
    return `This is a strong first test because ${reasonLine}. Choose what you want to understand.`;
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

    const chooseBody = `This is a strong first test because ${topReason}.`;

    return {
      feel: {
        id: "feel",
        title: "How it feels",
        body: feelBody,
        primaryTitle: "What to notice first",
        primaryItems: [positionNotice, firmnessNotice, focusLine].filter(Boolean),
        secondaryTitle: "Why it matters for your sleep",
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
        secondaryTitle: "Why it matters for your sleep",
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
        secondaryTitle: "What to notice when you lie down",
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
        primaryTitle: "What matched in your assessment",
        primaryItems: [
          isRecommended ? "Start here, then compare from there." : "",
          ...reasonBullets,
          focusLine,
        ].filter(Boolean),
        secondaryTitle: "Why it matters for your sleep",
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
      const detailsIntroVoice =
        "Let's look at the features and benefits of this mattress so you can understand why it may fit your sleep needs.";

      noteUserInteraction?.();
      await cancelPodVoice();

      if (ensureDetailsStage) {
        setOpenStage("details");
      }

      setDetailsActionId(nextId);
      setCueType(nextId === "choose" ? "success" : "tip");
      setCue(content?.cue || "Learn About This Pod");
      setRestPanelPhase("normal");

      if (!content?.voiceScript && !ensureDetailsStage) return;

      void speakPod(ensureDetailsStage ? detailsIntroVoice : content.voiceScript, {
        actionType: "view_details",
        calm: true,
        force: true,
        scriptKey: ensureDetailsStage ? "pod.details.learn_intro" : content.scriptKey || `pod.details.${nextId}`,
        key: ensureDetailsStage ? `details-stage::${pid}` : `details-action::${pid}::${nextId}`,
      });
    },
    [detailsContentByAction, noteUserInteraction, cancelPodVoice, speakPod, pid]
  );

  const resetRestTest = useCallback(async () => {
    clearTimer(restAdvanceTimeoutRef);
    await cancelPodVoice();

    setShowRestChooser(true);
    setRestModeId("");
    setRestStepIndex(0);
    setTimerRemaining(0);
    setTimerRunning(false);
    setSelectedRestInstructionId("");
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

      setShowRestChooser(true);
      setRestModeId(modeId);
      setRestStepIndex(0);
      setTimerRemaining(firstStep.seconds);
      setTimerRunning(true);
      setSelectedRestInstructionId("");
      setTestComplete(false);
      setFeelChoice("");
      setRestCompletionStage("");
      setCueType("tip");
      setCue(firstStep.cue || flow.title);
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

  const handlePauseRestTimer = useCallback(() => {
    noteUserInteraction?.();

    if (!activeRestFlow || testComplete) return;
    if (timerRemaining <= 0) return;

    setTimerRunning((prev) => {
      const next = !prev;
      setCueType("tip");
      setCue(next ? activeRestStep?.cue || "Timer running" : "Rest Test paused");
      return next;
    });
    setRestPanelPhase("normal");
  }, [activeRestFlow, testComplete, timerRemaining, activeRestStep, noteUserInteraction]);

  const handleSelectRestInstruction = useCallback(
    (instructionId) => {
      if (!instructionId) return;

      noteUserInteraction?.();
      setSelectedRestInstructionId(String(instructionId));

      const selectedCard = buildActiveRestInstructionCards({ hasAdjustableBase }).find(
        (card) => card.id === instructionId
      );

      if (selectedCard) {
        setCueType("tip");
        setCue(selectedCard.focusTitle || selectedCard.title);
      }
    },
    [hasAdjustableBase, noteUserInteraction]
  );

  const handleChooseRestFeedback = useCallback(
    (choiceId) => {
      noteUserInteraction?.();

      const choice = REST_REFLECTION_OPTIONS.find((option) => option.id === choiceId) || null;
      if (!choice) return;

      setFeelChoice(choice.label);
      setCueType("success");
      setCue(choice.label);
      setRestPanelPhase("normal");
    },
    [noteUserInteraction]
  );

  const completeRestRoutine = useCallback(
    (flow) => {
      if (!flow) return;

      setTimerRemaining(0);
      setTimerRunning(false);
      setSelectedRestInstructionId("");
      setTestComplete(true);
      setRestCompletionStage(REST_COMPLETION_STAGES.reflection);
      setCueType("tip");
      setCue("How did this pod feel?");
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
        setSelectedRestInstructionId("");
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

  useEffect(() => {
    if (!timerRunning || timerRemaining > 0 || !activeRestFlow) return;

    const nextIndex = restStepIndex + 1;
    const nextStep = activeRestFlow.steps[nextIndex] || null;

    if (!nextStep) {
      completeRestRoutine(activeRestFlow);
      return;
    }

    runRestTransition({
      flow: activeRestFlow,
      nextIndex,
      nextStep,
      nextCue: nextStep.cue || activeRestFlow.title,
      voiceText: nextStep.voice || nextStep.body || "",
    });
  }, [
    timerRunning,
    timerRemaining,
    activeRestFlow,
    restStepIndex,
    completeRestRoutine,
    runRestTransition,
  ]);

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

  const handleEndAndRate = useCallback(async () => {
    noteUserInteraction?.();
    clearTimer(restAdvanceTimeoutRef);
    await cancelPodVoice();

    if (!activeRestFlow) {
      setTimerRunning(false);
      setTimerRemaining(0);
      setRestCompletionStage(REST_COMPLETION_STAGES.reflection);
      setCueType("tip");
      setCue("How did this pod feel?");
      return;
    }

    completeRestRoutine(activeRestFlow);
  }, [activeRestFlow, cancelPodVoice, completeRestRoutine, noteUserInteraction]);

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
      setSelectedRestInstructionId("");
      setCueType(choiceId === "not_for_me" ? "tip" : "success");
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

  const learnSpecsItems = useMemo(() => {
    const firmnessValue = String(
      recommendationMeta?.firmness || assessment?.firmness || assessment?.comfort || assessment?.feel || "Medium"
    ).trim();
    const items = [
      `Feel: ${firmnessValue || "Medium"}.`,
      `Construction: ${
        mattressTruth.family === "dual"
          ? "Dual Comfort Hybrid"
          : mattressTruth.family === "hybrid"
            ? "Hybrid"
            : mattressTruth.family === "foam"
              ? "All-foam"
              : "Balanced comfort build"
      }.`,
      `Height: ${inferHeightLabel(mattressTruth.mattressTitle || mattressDisplayTitle)}.`,
      mattressTruth.hasCoils
        ? "Support core: coil-supported design for a steadier, more lifted feel."
        : "Support core: foam support layers for a quieter, more even feel.",
      mattressTruth.hasCooling
        ? "Cooling cues: breathable or cooling-focused materials appear in the current product data."
        : "Comfort cues: designed to balance support and pressure relief through a full showroom test.",
    ];
    return items.filter(Boolean).slice(0, 4);
  }, [recommendationMeta?.firmness, assessment, mattressTruth, mattressDisplayTitle]);

  const learnPricingRows = useMemo(() => {
    return SIZE_OPTIONS.map((option) => {
      const variant = pickVariantForSize(mattressProduct, option);
      const price = parseVariantPrice(variant);
      return {
        size: option,
        price: price > 0 ? money(price) : "Unavailable",
      };
    }).filter((row) => row.price !== "Unavailable");
  }, [mattressProduct]);

  const learnFitItems = useMemo(() => {
    const items = [];

    if (shopperDetailContext.position === "side") {
      items.push("Side-sleeper fit: pay closest attention to shoulder and hip pressure relief.");
    } else if (shopperDetailContext.position === "back") {
      items.push("Back-sleeper fit: notice whether your lower back feels supported and aligned.");
    } else if (shopperDetailContext.position === "stomach") {
      items.push("Stomach-sleeper fit: check whether the surface keeps your midsection from dipping too far.");
    }

    if (shopperDetailContext.sleepsHot) {
      items.push(
        mattressTruth.hasCooling
          ? "Hot-sleeper fit: this mattress shows cooling cues worth noticing after a few quiet minutes."
          : "Hot-sleeper fit: use this pod to judge temperature comfort once you have settled in."
      );
    }

    if (shopperDetailContext.hasPartner) {
      items.push(
        mattressTruth.isDualComfort
          ? "Couples fit: the Dual Comfort setup gives you a stronger compare point for shared sleep."
          : "Couples fit: pay attention to surface stability and motion when one sleeper moves."
      );
    }

    if (!items.length && benefits.length) {
      items.push(`${benefits[0].charAt(0).toUpperCase()}${benefits[0].slice(1)}.`);
    }

    items.push(
      lowerText(whyThisPodReason).includes("back")
        ? "Support language here is about comfort and alignment, not medical treatment."
        : `Match reason: ${whyThisPodSentence}`
    );

    return items.filter(Boolean).slice(0, 3);
  }, [shopperDetailContext, mattressTruth, benefits, whyThisPodReason, whyThisPodSentence]);

  const goToDetailsStage = useCallback(async () => {
    setShowRestChooser(false);
    await activateDetailsAction(DEFAULT_DETAILS_ACTION_ID, { ensureDetailsStage: true });
  }, [activateDetailsAction]);

  const goToBuildStage = useCallback(async (nextStepKey = "size") => {
    noteUserInteraction?.();
    await cancelPodVoice();
    setShowRestChooser(false);
    setOpenStage("build");
    setBuildStepKey(String(nextStepKey || "size"));
    setCueType("success");
    setCue(`Build ${podLabel}`);
    setRestPanelPhase("normal");
    void speakForStage("build");
  }, [cancelPodVoice, speakForStage, noteUserInteraction, podLabel]);

  const goToRestStage = useCallback(() => {
    noteUserInteraction?.();
    void cancelPodVoice();
    setOpenStage("rest");
    setShowRestChooser(true);
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

  const goToPodHome = useCallback(async () => {
    noteUserInteraction?.();
    await cancelPodVoice();
    setOpenStage("rest");
    setShowRestChooser(false);
    setRestModeId("");
    setRestStepIndex(0);
    setTimerRemaining(0);
    setTimerRunning(false);
    setSelectedRestInstructionId("");
    setRestCompletionStage("");
    setFeelChoice("");
    setTestComplete(false);
    setRestPanelPhase("normal");
    setCueType("tip");
    setCue(`Explore ${podLabel}`);
  }, [cancelPodVoice, noteUserInteraction, podLabel]);

  const stageContent = useMemo(() => {
    if (openStage === "details") {
      return (
        <div className="flex min-h-0 flex-col">
          <div className="grid min-h-0 items-start gap-2.5 xl:grid-cols-3">
            <ShowroomPanel className="p-2.75 md:p-3.25" tone="frost">
              <div className="text-[0.7rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">
                Specs
              </div>
              <div className="mt-1 text-[1.02rem] font-black leading-tight tracking-tight text-slate-900 md:text-[1.12rem]">
                What's Inside
              </div>
              <div className="mt-1.75 space-y-1.25 pr-0.5">
                {learnSpecsItems.map((item) => (
                  <div key={item} className="flex gap-2 text-[0.8rem] leading-[1.25rem] text-slate-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2f57e8]" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </ShowroomPanel>

            <ShowroomPanel className="p-2.75 md:p-3.25" tone="frost">
              <div className="text-[0.7rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">
                Pricing
              </div>
              <div className="mt-1 text-[1.02rem] font-black leading-tight tracking-tight text-slate-900 md:text-[1.12rem]">
                Mattress Only
              </div>
              {learnPricingRows.length ? (
                <div className="mt-1.75 pr-0.5">
                  <div className="grid gap-1 sm:grid-cols-2">
                    {learnPricingRows.map((row) => (
                      <div
                        key={row.size}
                        className="flex items-center justify-between rounded-[15px] border border-[#dbe5ff] bg-white/96 px-2.5 py-1.35 shadow-sm"
                      >
                        <div className="text-[0.8rem] font-extrabold text-slate-900">{row.size}</div>
                        <div className="text-[0.8rem] font-black text-[#2f57e8]">{row.price}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1.75 text-[0.74rem] leading-5 text-slate-500">
                    Prices may vary by retailer.
                  </div>
                </div>
              ) : (
                <div className="mt-1.75 rounded-[16px] border border-dashed border-[#dbe5ff] bg-white/90 px-3 py-3 text-[0.78rem] leading-5 text-slate-600">
                  Mattress-only pricing will appear here when the current product pricing finishes loading.
                </div>
              )}
            </ShowroomPanel>

            <ShowroomPanel className="p-2.75 md:p-3.25" tone="frost">
              <div className="text-[0.7rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">
                Why It Fits You
              </div>
              <div className="mt-1 text-[1.02rem] font-black leading-tight tracking-tight text-slate-900 md:text-[1.12rem]">
                Why this mattress may fit
              </div>
              <div className="mt-1.75 space-y-1.25 pr-0.5">
                {learnFitItems.map((item) => (
                  <div key={item} className="flex gap-2 text-[0.8rem] leading-[1.25rem] text-slate-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2f57e8]" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </ShowroomPanel>
          </div>
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
          onPreviewChange={setBuildPreviewData}
          onStateChange={setBuildSelectionState}
          onCue={(nextText, nextType = "tip") => {
            setCueType(nextType);
            setCue(nextText);

            if (typeof nextText === "string" && nextText.toLowerCase().includes("added to cart")) {
              showCartFeedback("Added to cart");
              setShowCheckoutOptions(true);
            }
          }}
          primaryCtaLabel="Add This Setup"
          onViewSnoozePod={() => navigate("/snoozepod")}
          onViewResults={() => navigate("/results")}
          requestedStepKey={buildStepKey}
        />
      );
    }

    return (
      <GuidedRestTest
        podLabel={podLabel}
        flowOptions={restFlows}
        activeMode={activeRestFlow}
        activeStep={activeRestStep}
        activeStepIndex={restStepIndex}
        timerRemaining={timerRemaining}
        timerRunning={timerRunning}
        onChooseMode={handleChooseRestMode}
        onStartTimer={handleStartTimer}
        onPauseTimer={handlePauseRestTimer}
        onAdvanceStep={handleAdvanceRestStep}
        onSkipStep={handleSkipRestStep}
        onResetTest={resetRestTest}
        onChooseReflection={handleChooseRestFeedback}
        onSelectReflection={handleSelectRestReflection}
        onViewDetails={() => void activateDetailsAction(DEFAULT_DETAILS_ACTION_ID, { ensureDetailsStage: true })}
        onBuildPod={async () => {
          noteUserInteraction?.();
          await cancelPodVoice();
          setShowRestChooser(false);
          setOpenStage("build");
          setBuildStepKey("size");
          setCueType("success");
          setCue(`Build ${podLabel}`);
          setRestPanelPhase("normal");
          void speakForStage("build");
        }}
        onCompareAnotherPod={() => navigate("/results")}
        completionStage={restCompletionStage}
        reflectionChoice={feelChoice}
        onSwitchToLongerMode={() => handleChooseRestMode("deep")}
        testComplete={testComplete}
        hasAdjustableBase={hasAdjustableBase}
        selectedInstructionId={selectedRestInstructionId}
        onSelectInstruction={handleSelectRestInstruction}
        onEndAndRate={handleEndAndRate}
      />
    );
  }, [
    openStage,
    mattressTruth.mattressTitle,
    title,
    assessment,
    mattressProduct,
    baseProduct,
    onSelectionHandlesChange,
    onBuildStepChange,
    setBuildSelectionState,
    navigate,
    showCartFeedback,
    restFlows,
    activeRestFlow,
    activeRestStep,
    restStepIndex,
    timerRemaining,
    timerRunning,
    handleChooseRestMode,
    handleStartTimer,
    handlePauseRestTimer,
    handleAdvanceRestStep,
    handleSkipRestStep,
    handleSelectRestInstruction,
    handleEndAndRate,
    resetRestTest,
    handleChooseRestFeedback,
    handleSelectRestReflection,
    activateDetailsAction,
    restCompletionStage,
    feelChoice,
    testComplete,
    hasAdjustableBase,
    selectedRestInstructionId,
    noteUserInteraction,
    cancelPodVoice,
    buildStepKey,
    podLabel,
    pid,
    mattressDisplayTitle,
    learnSpecsItems,
    learnPricingRows,
    learnFitItems,
  ]);

  const isDefaultPodDashboard =
    openStage === "rest" &&
    !showRestChooser &&
    !activeRestFlow &&
    !restCompletionStage &&
    !testComplete;
  const isRestTaskStage = openStage === "rest" && !isDefaultPodDashboard;
  const isRestSelectionStage =
    openStage === "rest" &&
    showRestChooser &&
    !activeRestFlow &&
    !restCompletionStage &&
    !testComplete;
  const activeStageEyebrow = useMemo(() => {
    if (openStage === "details") return "Learn";
    if (openStage === "build") return "Build";
    return "Rest Test";
  }, [openStage]);

  const activeStageHelper = useMemo(() => {
    if (openStage === "details") return "Specs, pricing, and fit.";
    if (openStage === "build") return "Choose size, base, and review.";
    if (restCompletionStage === REST_COMPLETION_STAGES.reflection) return "Tell us how it felt.";
    if (restCompletionStage === REST_COMPLETION_STAGES.actions) return "Choose your next step.";
    if (activeRestFlow) return "Stay with one pod at a time.";
    return "Choose your test.";
  }, [openStage, restCompletionStage, activeRestFlow]);

  const dashboardReasonItems = useMemo(() => {
    const rows = [];
    const lowerReasonSet = new Set(detailReasonKeys.map((key) => lowerText(key)));
    const firmnessValue = lowerText(
      recommendationMeta?.firmness || assessment?.firmness || assessment?.comfort || assessment?.feel
    );

    const pushRow = (title, body, icon = CheckCircle2) => {
      if (!title || !body) return;
      if (rows.some((item) => item.title === title)) return;
      rows.push({ title, body, icon });
    };

    if (
      lowerReasonSet.has("back_or_stomach_support") ||
      lowerText(benefits[0]).includes("back")
    ) {
      pushRow(
        "Lower back support match",
        "Designed to keep your lower back more supported while you settle into the bed.",
        BedDouble
      );
    }

    if (
      lowerReasonSet.has("side_sleeper_pressure_relief") ||
      lowerText(benefits.join(" ")).includes("pressure")
    ) {
      pushRow(
        "Pressure-relief focus",
        "Worth noticing first around your shoulders and hips as you relax into your normal position.",
        CheckCircle2
      );
    }

    if (firmnessValue) {
      pushRow(
        `${firmnessValue.charAt(0).toUpperCase() + firmnessValue.slice(1)}-feel match`,
        `This pod stays close to the ${firmnessValue} feel you selected in the assessment.`,
        MessageSquare
      );
    }

    if (shopperDetailContext.sleepsHot) {
      pushRow(
        "Cooling-aware test",
        "Give it a few quiet minutes and notice whether the surface settles temperature more comfortably.",
        Timer
      );
    }

    if (shopperDetailContext.hasPartner || mattressTruth.isDualComfort) {
      pushRow(
        "Great compare point",
        "A useful pod to evaluate first before you compare shared-sleep comfort or motion with the next option.",
        CheckCircle2
      );
    }

    pushRow(
      "Strong all-around fit",
      "A balanced first stop that helps you learn quickly what your body wants before the next pod.",
      CheckCircle2
    );

    return rows.slice(0, 2);
  }, [
    detailReasonKeys,
    benefits,
    recommendationMeta?.firmness,
    assessment,
    shopperDetailContext.sleepsHot,
    shopperDetailContext.hasPartner,
    mattressTruth.isDualComfort,
  ]);

  const dashboardTestingItems = useMemo(
    () => [
      {
        title: "Rest for 5 to 10 minutes",
        body: "Give your body time to settle and adjust.",
        icon: Timer,
      },
      {
        title: "Try your usual positions",
        body: "Back, side, and stomach positions tell you quickly what this pod does best.",
        icon: BedDouble,
      },
    ],
    []
  );

  const dashboardTestingModes = useMemo(
    () => Object.values(restFlows || {}).filter(Boolean).slice(0, 2),
    [restFlows]
  );

  const podHomeContent = useMemo(
    () => (
      <div className="flex h-full min-h-0 flex-col gap-2.5">
        <ShowroomPanel className="shrink-0 overflow-hidden p-0" tone="soft">
          <PodRouteHeroHeader
            eyebrow=""
            podTitle={title}
            mattressTitle={mattressDisplayTitle}
            helperText=""
            isRecommended={isRecommended}
            mattressImage={mattressImage}
            voiceState={voiceState}
            badges={podHomeBadges}
            coachBubble={restCoachCopy}
          />
        </ShowroomPanel>

        <PodRestStartSection
          podLabel={title}
          flowOptions={dashboardTestingModes}
          onChooseMode={handleChooseRestMode}
        />
      </div>
    ),
    [
      title,
      mattressDisplayTitle,
      isRecommended,
      mattressImage,
      podHomeBadges,
      restCoachCopy,
      dashboardTestingModes,
      handleChooseRestMode,
    ]
  );

  const activePanelContent = useMemo(() => {
    if (loading || !activePod) {
      return (
        <ShowroomPanel className="h-full p-6 md:p-8">
          <div className="py-6 text-center text-slate-500">Preparing this pod</div>
        </ShowroomPanel>
      );
    }

    if (isDefaultPodDashboard) {
      return podHomeContent;
    }

    return stageContent;
  }, [loading, activePod, isDefaultPodDashboard, podHomeContent, stageContent]);

  return (
    <ShowroomPageShell className="flex min-h-0 flex-col overflow-hidden pb-0">
      <div className="mx-auto w-full max-w-[1380px] shrink-0 px-4 pt-0.5 md:px-6 md:pt-1">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-[24px] border border-white/80 bg-white/94 px-4 py-1.25 shadow-[0_22px_58px_rgba(40,63,126,0.12)] backdrop-blur md:px-5 md:py-1.5">
          <button
            type="button"
            onClick={() => {
              noteUserInteraction?.();
              navigate("/results");
            }}
            className="justify-self-start inline-flex items-center gap-3 rounded-[18px] border border-transparent bg-transparent px-2 py-1.5 text-sm font-extrabold text-slate-900 transition hover:text-[#2f57e8]"
          >
            <ArrowLeft className="h-5 w-5" />
            Back to results
          </button>

          <ShowroomBrandMark
            className="justify-self-center"
            imageClassName="w-[180px] md:w-[220px]"
          />

          <div className="justify-self-end flex flex-col items-end gap-2">
            <ShowroomCartBadge
              count={snoozepodCount}
              quiet
              className={cartPulse ? "scale-[1.01] border-indigo-300 ring-4 ring-indigo-100" : ""}
              onClick={() => {
                noteUserInteraction?.();
                navigate("/snoozepod");
              }}
            />

            {cartNotice ? (
              <div className="rounded-2xl border border-indigo-100 bg-white/95 px-3 py-2 text-sm font-semibold text-indigo-900 shadow-sm backdrop-blur">
                {cartNotice}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-[1380px] flex-1 flex-col overflow-hidden px-4 pb-0.5 pt-0.75 md:px-6 md:pb-1 md:pt-1">
        {isDefaultPodDashboard ? (
          <ShowroomFrame className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain p-1 md:p-1.25">
            {podHomeContent}
          </ShowroomFrame>
        ) : (
            <ShowroomFrame className={["flex min-h-0 flex-1 flex-col overflow-hidden", isRestTaskStage ? "p-1 md:p-1.25" : "p-1.25 md:p-1.5"].join(" ")}>
            <ShowroomPanel className="shrink-0 overflow-hidden p-0" tone="soft">
              <PodRouteHeroHeader
                eyebrow=""
                podTitle={title}
                mattressTitle={mattressDisplayTitle}
                helperText=""
                isRecommended={isRecommended}
                mattressImage={mattressImage}
                voiceState={voiceState}
                badges={openStage === "details" || openStage === "build" ? headerBadges : headerBadges.slice(0, isRecommended ? 2 : 1)}
                coachBubble={isRestSelectionStage ? restCoachCopy : ""}
              />
            </ShowroomPanel>

            <div
              ref={stagePanelRef}
              className={[
                "mt-1.5 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain pr-1 pb-2 md:pr-1.25 md:pb-2.5",
                isRestTaskStage ? "" : openStage === "details" || openStage === "build" ? "mt-2.5 md:mt-3" : "md:mt-2",
              ].join(" ")}
            >
              {activePanelContent}
            </div>
          </ShowroomFrame>
        )}
      </div>

      {!loading && activePod ? (
          <div className="mx-auto mt-0 w-full max-w-[1380px] shrink-0 px-4 pb-0.75 pt-0.75 md:px-6 md:pb-1 md:pt-0.75">
            <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-[16px] border border-white/85 bg-white/96 px-2 py-0.75 shadow-[0_18px_40px_rgba(40,63,126,0.12)]">
              <div className="flex flex-wrap items-center gap-1.5">
                <ExperienceFooterButton
                  icon={House}
                  label="Pod Home"
                  accent="blue"
                  onClick={() => void goToPodHome()}
                />

                {openStage !== "rest" ? (
                  <ExperienceFooterButton
                    icon={Timer}
                    label="Rest Test"
                    accent="blue"
                    onClick={goToRestStage}
                  />
                ) : null}

                {openStage !== "details" ? (
                  <ExperienceFooterButton
                    icon={BookOpen}
                    label="Learn"
                    accent="blue"
                    onClick={goToDetailsStage}
                  />
                ) : null}

                {openStage !== "build" ? (
                  <ExperienceFooterButton
                    icon={SlidersHorizontal}
                    label="Build"
                    accent="blue"
                    onClick={() => void goToBuildStage("size")}
                  />
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <ExperienceFooterButton
                  icon={MessageSquare}
                  label="Ask Snoozer"
                  onClick={() => {
                    noteUserInteraction?.();
                    void cancelPodVoice();
                    navigate("/ask-snoozer", { state: { from: `/pod/${pid}` } });
                  }}
                />

                <ExperienceFooterButton
                  icon={Headphones}
                  label="Talk to Human"
                  onClick={() => {
                    noteUserInteraction?.();
                    setCueType("tip");
                    setCue("Ask the showroom team for in-store help when you're ready.");
                  }}
                />
              </div>
            </div>
          </div>
      ) : null}
    </ShowroomPageShell>
  );
}


