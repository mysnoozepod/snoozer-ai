// src/pages/Pod.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  MessageSquare,
  BedDouble,
  CheckCircle2,
  Heart,
  HelpCircle,
  Headphones,
  Scale,
  Smile,
  X,
} from "lucide-react";

import { api } from "@/lib/api";
import {
  getPodNumber,
  makePodRoute,
  normalizePodId as normalizeCanonicalPodId,
} from "@/device/podRouteUtils";
import {
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
  ShowroomFrame,
  ShowroomPageShell,
  ShowroomPanel,
} from "@/components/showroom/ShowroomPrimitives";
import BuildYourPodPanel from "@/components/pod/BuildYourPodPanel";
import { PodFooterNav } from "@/components/pod/PodFooterNav";
import { PodRouteHeroHeader } from "@/components/pod/PodHeader";
import { PodHome } from "@/components/pod/PodHome";
import { PodLearnPanel } from "@/components/pod/PodLearnPanel";
import { GuidedRestTest, buildActiveRestInstructionCards } from "@/components/pod/PodRestPanels";
import {
  BASE_OPTIONS_UI,
  generateShowroomRecommendations,
  getBaseHandleForType,
  SIZE_OPTIONS,
} from "@/lib/utils/recommendations";
import { useStore } from "@/lib/useStore";
import { getShopperId } from "@/state/sessionStore";
import { canViewAdminDiagnostics } from "@/device/deviceActionGuards";
import { emitDeviceRestTestActive } from "@/device/deviceActivityTracker";
import { useDeviceMode } from "@/device/useDeviceMode";
import { usePodCart } from "@/hooks/usePodCart";
import { usePodExperience } from "@/hooks/usePodExperience";
import { usePodHudGuidance } from "@/hooks/usePodHudGuidance";
import { createAmbientAudioController } from "@/iot/ambientAudioController";
import {
  REST_TEST_OPENING_HUD_PAYLOAD,
  getIotExperienceConfig,
} from "@/iot/iotExperienceConfig";
import {
  LIGHTING_STATES,
  shouldCompleteRestTestForVacancy,
} from "@/iot/showroomExperienceState";
import { usePhysicalControl } from "@/iot/usePhysicalControl";
import { useShowroomZoneExperience } from "@/iot/useShowroomZoneExperience";
import { POD_LAYOUT_CONTRACT, normalizePodLabState } from "@/lib/podLayoutContract";
import { measurePodLayout } from "@/lib/podLayoutMeasurement";

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

const IOT_EXPERIENCE_CONFIG = getIotExperienceConfig(import.meta.env || {});

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

function safeParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
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

function getPodLabStateFromSearch(search) {
  const params = new URLSearchParams(search || "");
  return params.get("podLayoutState") || params.get("podLabState") || params.get("state") || "";
}

export default function Pod({ labMode = false, labPodId = "", labState = "" }) {
  const { podId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const deviceState = useDeviceMode();
  const canUseLayoutHarness = canViewAdminDiagnostics(deviceState);
  const shopperId = useMemo(() => {
    return getShopperId() || "guest";
  }, []);
  const storedAssessment = useStore((state) => state.assessment);
  const storedRecommendations = useStore((state) => state.recommendations);
  const setRecommendations = useStore((state) => state.setRecommendations);
  const { noteUserInteraction, voiceState, speakPod, cancelPodVoice, resetPodVoiceKeys } =
    usePodHudGuidance({ shopperId });

  const effectivePodId = labPodId || podId;
  const rawLayoutState = labState || getPodLabStateFromSearch(location.search);
  const effectiveLabState =
    labMode || (canUseLayoutHarness && rawLayoutState)
      ? normalizePodLabState(rawLayoutState)
      : "";
  const pid = normalizeCanonicalPodId(effectivePodId) || "pod-1";
  const podNumber = getPodNumber(pid) || "1";
  const currentPodRoute = makePodRoute(pid) || "/pod/pod-1";
  const storagePrefix = useMemo(() => `snooze.pod.${pid}`, [pid]);

  const { snoozepodCount, cartNotice, cartPulse, showCartFeedback } = usePodCart();

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

  const {
    buildStepKey,
    setBuildStepKey,
    openStage,
    setOpenStage,
    testComplete,
    setTestComplete,
    feelChoice,
    setFeelChoice,
    restCompletionStage,
    setRestCompletionStage,
    detailsActionId,
    setDetailsActionId,
    restModeId,
    setRestModeId,
    restStepIndex,
    setRestStepIndex,
    timerRemaining,
    setTimerRemaining,
    timerRunning,
    setTimerRunning,
    selectedRestInstructionId,
    setSelectedRestInstructionId,
    showRestChooser,
    setShowRestChooser,
    resetForPodChange,
  } = usePodExperience({
    storagePrefix,
    defaultDetailsActionId: DEFAULT_DETAILS_ACTION_ID,
  });

  const restAdvanceTimeoutRef = useRef(null);
  const restVacancyTimeoutRef = useRef(null);
  const lightingReadyTimeoutRef = useRef(null);
  const restOpeningSpokenRef = useRef(false);
  const ambientAudioRef = useRef(null);
  const lastPhysicalLightingRef = useRef("");
  const lastPhysicalAudioRef = useRef("");
  const stagePanelRef = useRef(null);
  const [podLightingState, setPodLightingState] = useState(LIGHTING_STATES.READY);

  if (!ambientAudioRef.current) {
    ambientAudioRef.current = createAmbientAudioController({
      track: IOT_EXPERIENCE_CONFIG.defaultRestTestAudioTrack,
    });
  }

  const clearTimer = (ref) => {
    if (ref.current) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  };

  useEffect(() => {
    const prev = window.__SNOOZE_DISABLE_WIDGET;
    window.__SNOOZE_DISABLE_WIDGET = true;
    document.body.classList.add("no-global-chat");
    return () => {
      window.__SNOOZE_DISABLE_WIDGET = prev;
      document.body.classList.remove("no-global-chat");
      clearTimer(restAdvanceTimeoutRef);
      clearTimer(restVacancyTimeoutRef);
      clearTimer(lightingReadyTimeoutRef);
      ambientAudioRef.current?.stop();
      emitDeviceRestTestActive(false, { reason: "rest-test-active", podId: pid });
    };
  }, [pid]);

  const assessment = useMemo(() => {
    if (storedAssessment && typeof storedAssessment === "object") return storedAssessment;
    const raw = safeGet("snooze.assessment");
    const parsed = raw ? safeParseJson(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  }, [storedAssessment]);

  const painSignals = useMemo(() => extractPainSignals(assessment), [assessment]);
  const benefits = useMemo(() => buildBenefits(painSignals), [painSignals]);
  const whyThisPodReason = useMemo(() => buildWhyThisPodReason(painSignals), [painSignals]);
  const whyThisPodSentence = useMemo(() => buildWhyThisPodSentence(painSignals), [painSignals]);
  const headerPersonalization = useMemo(() => buildHeaderPersonalization(painSignals), [painSignals]);
  const notIdealFor = useMemo(() => buildNotIdealFor(painSignals), [painSignals]);

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

      const stored = storedRecommendations || safeParseJson(safeGet("snooze.recommendations"));
      const parsed = stored && typeof stored === "object" ? stored : null;
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
        setRecommendations?.(sanitizedGenerated || {});
      } catch {
        // ignore
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [assessment, setRecommendations, storedRecommendations]);

  useEffect(() => {
    if (!recs?.pods?.length) return;

    const found =
      recs.pods.find((p) => normalizeCanonicalPodId(p.podId ?? p.id) === pid) ||
      recs.pods[0] ||
      null;

    const sanitizedFound = found ? stripLegacyPodImageFields(found) : null;

    resetPodVoiceKeys();
    setActivePod(sanitizedFound || null);
    setSelectedMattressHandle(undefined);
    setSelectedBaseHandle(undefined);
    setBuildPreviewData(null);
    setBuildSelectionState(null);
    setMattressImageFallback(sanitizedFound?.fallbackImageUrl || "");
    resetForPodChange();
  }, [recs, pid, resetForPodChange, resetPodVoiceKeys]);

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

  const podLabel = `SnoozePod ${podNumber}`;
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

  useEffect(() => {
    if (!effectiveLabState || !activePod) return;

    setTestComplete(false);
    setFeelChoice("");
    setRestCompletionStage("");
    setSelectedRestInstructionId("");

    if (effectiveLabState === "pod-home") {
      setOpenStage("rest");
      setShowRestChooser(false);
      setRestModeId("");
      setRestStepIndex(0);
      setTimerRemaining(0);
      setTimerRunning(false);
      return;
    }

    if (effectiveLabState === "learn") {
      setOpenStage("details");
      setShowRestChooser(false);
      setRestModeId("");
      setTimerRunning(false);
      setTimerRemaining(0);
      return;
    }

    if (effectiveLabState.startsWith("build")) {
      const requestedStep = effectiveLabState.replace(/^build-/, "") || "size";

      setOpenStage("build");
      setShowRestChooser(false);
      setRestModeId("");
      setTimerRunning(false);
      setTimerRemaining(0);
      setBuildStepKey(requestedStep);
      return;
    }

    setOpenStage("rest");

    if (effectiveLabState === "rest-active") {
      setShowRestChooser(true);
      setRestModeId("quick");
      setRestStepIndex(0);
      setTimerRemaining(410);
      setTimerRunning(false);
      setSelectedRestInstructionId("side");
      return;
    }

    setShowRestChooser(true);
    setRestModeId("");
    setRestStepIndex(0);
    setTimerRemaining(0);
    setTimerRunning(false);
  }, [
    activePod,
    effectiveLabState,
    setBuildStepKey,
    setFeelChoice,
    setOpenStage,
    setRestCompletionStage,
    setRestModeId,
    setRestStepIndex,
    setSelectedRestInstructionId,
    setShowRestChooser,
    setTestComplete,
    setTimerRemaining,
    setTimerRunning,
  ]);

  const restTestActive = Boolean(activeRestFlow && !testComplete && !restCompletionStage);
  const zoneExperience = useShowroomZoneExperience({
    podId: pid,
    restTestActive,
    restTestComplete: testComplete || Boolean(restCompletionStage),
    sourceSurface: "pod",
  });
  const physicalControl = usePhysicalControl({
    zoneId: zoneExperience.zoneId || pid,
    sourceSurface: "pod",
    enabled: IOT_EXPERIENCE_CONFIG.enableIotExperiences,
  });

  const activeRestStep = useMemo(() => {
    if (!activeRestFlow?.steps?.length) return null;
    return activeRestFlow.steps[restStepIndex] || null;
  }, [activeRestFlow, restStepIndex]);

  const requestPhysicalLighting = useCallback(
    (lightingState, metadata = {}) => {
      if (!lightingState || !IOT_EXPERIENCE_CONFIG.enableIotExperiences) return;
      if (lastPhysicalLightingRef.current === lightingState) return;
      lastPhysicalLightingRef.current = lightingState;
      void physicalControl.requestLightingState(lightingState, {
        podId: pid,
        ...metadata,
      });
    },
    [physicalControl, pid]
  );

  const requestPhysicalAudio = useCallback(
    (audioState, metadata = {}) => {
      if (!audioState || !IOT_EXPERIENCE_CONFIG.enableIotExperiences) return;
      if (lastPhysicalAudioRef.current === audioState) return;
      lastPhysicalAudioRef.current = audioState;
      void physicalControl.requestAudioState(audioState, {
        podId: pid,
        ...metadata,
      });
    },
    [physicalControl, pid]
  );

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

  useEffect(() => {
    emitDeviceRestTestActive(restTestActive, {
      reason: "rest-test-active",
      podId: pid,
      zoneId: zoneExperience.zoneId,
    });

    return () => {
      emitDeviceRestTestActive(false, {
        reason: "rest-test-active",
        podId: pid,
        zoneId: zoneExperience.zoneId,
      });
    };
  }, [restTestActive, pid, zoneExperience.zoneId]);

  useEffect(() => {
    if (!IOT_EXPERIENCE_CONFIG.enableIotExperiences) return;
    if (restTestActive) return;

    if (zoneExperience.hasFault) {
      setPodLightingState(LIGHTING_STATES.FAULT);
      requestPhysicalLighting(LIGHTING_STATES.FAULT, { reason: "zone-fault" });
      return;
    }

    if (zoneExperience.isPresent && !zoneExperience.isStale) {
      setPodLightingState(LIGHTING_STATES.ACTIVE);
      requestPhysicalLighting(LIGHTING_STATES.ACTIVE, { reason: "zone-present" });
      return;
    }

    setPodLightingState(LIGHTING_STATES.READY);
    requestPhysicalLighting(LIGHTING_STATES.READY, { reason: "zone-ready" });
  }, [
    restTestActive,
    zoneExperience.hasFault,
    zoneExperience.isPresent,
    zoneExperience.isStale,
    requestPhysicalLighting,
  ]);

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
    clearTimer(restVacancyTimeoutRef);
    clearTimer(lightingReadyTimeoutRef);
    await cancelPodVoice();
    ambientAudioRef.current?.stop({ fadeMs: 700 });
    restOpeningSpokenRef.current = false;
    setPodLightingState(
      zoneExperience.isPresent && !zoneExperience.isStale
        ? LIGHTING_STATES.ACTIVE
        : LIGHTING_STATES.READY
    );
    requestPhysicalAudio("stopped", { reason: "rest-reset" });
    requestPhysicalLighting(
      zoneExperience.isPresent && !zoneExperience.isStale
        ? LIGHTING_STATES.ACTIVE
        : LIGHTING_STATES.READY,
      { reason: "rest-reset" }
    );

    setShowRestChooser(true);
    setRestModeId("");
    setRestStepIndex(0);
    setTimerRemaining(0);
    setTimerRunning(false);
    setSelectedRestInstructionId("");
    setTestComplete(false);
    setFeelChoice("");
    setRestCompletionStage("");
    resetPodVoiceKeys();
  }, [
    cancelPodVoice,
    resetPodVoiceKeys,
    requestPhysicalAudio,
    requestPhysicalLighting,
    zoneExperience.isPresent,
    zoneExperience.isStale,
  ]);

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
      resetPodVoiceKeys();
      setPodLightingState(LIGHTING_STATES.REST_TEST);
      requestPhysicalLighting(LIGHTING_STATES.REST_TEST, {
        reason: "rest-test-start",
        restModeId: modeId,
      });
      ambientAudioRef.current?.start(IOT_EXPERIENCE_CONFIG.defaultRestTestAudioTrack);
      requestPhysicalAudio("playing", {
        reason: "rest-test-start",
        restModeId: modeId,
        track: IOT_EXPERIENCE_CONFIG.defaultRestTestAudioTrack,
      });

      if (!restOpeningSpokenRef.current) {
        restOpeningSpokenRef.current = true;
        speakPod(REST_TEST_OPENING_HUD_PAYLOAD.speech, {
          actionType: "start_rest_test",
          captions: REST_TEST_OPENING_HUD_PAYLOAD.captions,
          state: REST_TEST_OPENING_HUD_PAYLOAD.state,
          priority: REST_TEST_OPENING_HUD_PAYLOAD.priority,
          ttlMs: REST_TEST_OPENING_HUD_PAYLOAD.ttlMs,
          actions: REST_TEST_OPENING_HUD_PAYLOAD.actions,
          preservePriority: true,
          calm: true,
          force: true,
          scriptKey: modeId === "deep" ? "pod.rest.deep.start" : "pod.rest.quick.start",
          key: `rest-opening::${pid}`,
        });
      }
    },
    [
      cancelPodVoice,
      restFlows,
      speakPod,
      noteUserInteraction,
      pid,
      requestPhysicalAudio,
      requestPhysicalLighting,
    ]
  );

  const handleStartTimer = useCallback(() => {
    noteUserInteraction?.();

    if (!activeRestStep) return;
    if (timerRunning) return;
    if (timerRemaining <= 0) return;

    setTimerRunning(true);
  }, [activeRestStep, timerRunning, timerRemaining, noteUserInteraction]);

  const handlePauseRestTimer = useCallback(() => {
    noteUserInteraction?.();

    if (!activeRestFlow || testComplete) return;
    if (timerRemaining <= 0) return;

    setTimerRunning((prev) => {
      return !prev;
    });
  }, [activeRestFlow, testComplete, timerRemaining, activeRestStep, noteUserInteraction]);

  const handleSelectRestInstruction = useCallback(
    (instructionId) => {
      if (!instructionId) return;

      noteUserInteraction?.();
      setSelectedRestInstructionId(String(instructionId));

      const selectedCard = buildActiveRestInstructionCards({ hasAdjustableBase }).find(
        (card) => card.id === instructionId
      );

      if (!selectedCard) return;
    },
    [hasAdjustableBase, noteUserInteraction]
  );

  const handleChooseRestFeedback = useCallback(
    (choiceId) => {
      noteUserInteraction?.();

      const choice = REST_REFLECTION_OPTIONS.find((option) => option.id === choiceId) || null;
      if (!choice) return;

      setFeelChoice(choice.label);
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
      resetPodVoiceKeys();
      ambientAudioRef.current?.stop({ fadeMs: 1200 });
      requestPhysicalAudio("fading", { reason: "rest-test-complete" });
      setPodLightingState(LIGHTING_STATES.COMPLETE);
      requestPhysicalLighting(LIGHTING_STATES.COMPLETE, { reason: "rest-test-complete" });
      clearTimer(lightingReadyTimeoutRef);
      lightingReadyTimeoutRef.current = window.setTimeout(() => {
        const nextLightingState =
          zoneExperience.isPresent && !zoneExperience.isStale
            ? LIGHTING_STATES.ACTIVE
            : LIGHTING_STATES.READY;
        setPodLightingState(nextLightingState);
        requestPhysicalLighting(nextLightingState, { reason: "rest-test-complete-reset" });
        requestPhysicalAudio("stopped", { reason: "rest-test-complete-reset" });
        lightingReadyTimeoutRef.current = null;
      }, 1800);

      void speakPod(buildRestReflectionVoice(flow.title), {
        calm: true,
        force: true,
        scriptKey: flow.id === "deep" ? "pod.rest.deep.reflection" : "pod.rest.quick.reflection",
        key: `rest-reflection::${flow.id}`,
      });
    },
    [
      resetPodVoiceKeys,
      speakPod,
      requestPhysicalAudio,
      requestPhysicalLighting,
      zoneExperience.isPresent,
      zoneExperience.isStale,
    ]
  );

  const runRestTransition = useCallback(
    ({ flow, nextIndex, nextStep }) => {
      clearTimer(restAdvanceTimeoutRef);
      void cancelPodVoice();

      setTimerRunning(false);

      restAdvanceTimeoutRef.current = window.setTimeout(() => {
        if (!nextStep) {
          restAdvanceTimeoutRef.current = null;
          completeRestRoutine(flow);
          return;
        }

        setRestStepIndex(nextIndex);
        setTimerRemaining(nextStep.seconds);
        setSelectedRestInstructionId("");
        resetPodVoiceKeys();
        restAdvanceTimeoutRef.current = null;
      }, 650);
    },
    [cancelPodVoice, completeRestRoutine, resetPodVoiceKeys]
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

  useEffect(() => {
    clearTimer(restVacancyTimeoutRef);

    if (!IOT_EXPERIENCE_CONFIG.enableIotExperiences) return undefined;
    if (!restTestActive || testComplete || !activeRestFlow) return undefined;
    if (!zoneExperience.hasFreshOccupancySignal || zoneExperience.isStale) return undefined;
    if (zoneExperience.isOccupied) return undefined;

    const lastVacatedAt = zoneExperience.zoneState?.lastOccupancyEventAt
      ? new Date(zoneExperience.zoneState.lastOccupancyEventAt).getTime()
      : Date.now();

    const elapsed = Date.now() - lastVacatedAt;
    const remainingGrace = Math.max(
      IOT_EXPERIENCE_CONFIG.restTestVacancyGraceMs - elapsed,
      0
    );

    restVacancyTimeoutRef.current = window.setTimeout(() => {
      if (
        shouldCompleteRestTestForVacancy({
          restTestActive: true,
          isOccupied: false,
          hasFreshOccupancySignal: true,
          isStale: false,
          vacatedAt: lastVacatedAt,
          nowMs: Date.now(),
          graceMs: IOT_EXPERIENCE_CONFIG.restTestVacancyGraceMs,
        })
      ) {
        completeRestRoutine(activeRestFlow);
      }
    }, remainingGrace);

    return () => clearTimer(restVacancyTimeoutRef);
  }, [
    activeRestFlow,
    completeRestRoutine,
    restTestActive,
    testComplete,
    zoneExperience.hasFreshOccupancySignal,
    zoneExperience.isOccupied,
    zoneExperience.isStale,
    zoneExperience.zoneState?.lastOccupancyEventAt,
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
    void speakForStage("build");
  }, [cancelPodVoice, speakForStage, noteUserInteraction, podLabel]);

  const goToRestStage = useCallback(() => {
    noteUserInteraction?.();
    void cancelPodVoice();
    setOpenStage("rest");
    setShowRestChooser(true);
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
  }, [cancelPodVoice, noteUserInteraction, podLabel]);

  const stageContent = useMemo(() => {
    if (openStage === "details") {
      return (
        <PodLearnPanel
          learnSpecsItems={learnSpecsItems}
          learnPricingRows={learnPricingRows}
          learnFitItems={learnFitItems}
        />
      );
    }

    if (openStage === "build") {
      return (
        <BuildYourPodPanel
          pod={activePod}
          assessment={assessment}
          mattressProduct={mattressProduct}
          baseProduct={baseProduct}
          onSelectionHandlesChange={onSelectionHandlesChange}
          onBuildStepChange={onBuildStepChange}
          onPreviewChange={setBuildPreviewData}
          onStateChange={setBuildSelectionState}
          onCue={(nextText) => {
            if (typeof nextText === "string" && nextText.toLowerCase().includes("added to cart")) {
              showCartFeedback("Added to cart");
            }
          }}
          primaryCtaLabel="Add This Setup"
          onViewSnoozePod={() => navigate("/cart")}
          onViewResults={null}
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
        onBuildPod={() => void goToBuildStage("size")}
        onCompareAnotherPod={() => navigate(currentPodRoute)}
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
    buildStepKey,
    learnSpecsItems,
    learnPricingRows,
    learnFitItems,
    goToBuildStage,
    currentPodRoute,
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
  const activeNavKey = isDefaultPodDashboard
    ? "home"
    : openStage === "details"
      ? "learn"
      : openStage === "build"
        ? "build"
        : "rest";
  const podShellVars = {
    "--pod-header-height": `${POD_LAYOUT_CONTRACT.verticalBudget.header}px`,
    "--pod-nav-height": `${POD_LAYOUT_CONTRACT.verticalBudget.navigation}px`,
    "--pod-hero-height": `clamp(${POD_LAYOUT_CONTRACT.compactVerticalBudget.productHero}px, 20dvh, ${POD_LAYOUT_CONTRACT.verticalBudget.productHero}px)`,
    "--pod-outer-x": `${POD_LAYOUT_CONTRACT.spacing.outerHorizontalPadding}px`,
    "--pod-main-gap": `${POD_LAYOUT_CONTRACT.spacing.mainGap}px`,
    "--pod-card-padding": `${POD_LAYOUT_CONTRACT.spacing.cardPadding}px`,
    "--pod-touch-target": `${POD_LAYOUT_CONTRACT.sizing.touchTargetMin}px`,
  };

  useEffect(() => {
    if (!(labMode || canUseLayoutHarness)) return undefined;

    const state = effectiveLabState || activeNavKey || "pod-home";
    const reader = () => measurePodLayout({ state, contract: POD_LAYOUT_CONTRACT });
    window.__getPodLayoutMeasurement = reader;
    window.__SNOOZE_POD_LAYOUT_READY = !loading && Boolean(activePod);

    return () => {
      if (window.__getPodLayoutMeasurement === reader) {
        delete window.__getPodLayoutMeasurement;
      }
      if (window.__SNOOZE_POD_LAYOUT_READY !== undefined) {
        delete window.__SNOOZE_POD_LAYOUT_READY;
      }
    };
  }, [activeNavKey, activePod, canUseLayoutHarness, effectiveLabState, labMode, loading]);

  const dashboardTestingModes = useMemo(
    () => Object.values(restFlows || {}).filter(Boolean).slice(0, 2),
    [restFlows]
  );

  const podHomeContent = useMemo(
    () => (
      <PodHome
        title={title}
        mattressDisplayTitle={mattressDisplayTitle}
        isRecommended={isRecommended}
        mattressImage={mattressImage}
        voiceState={voiceState}
        badges={podHomeBadges}
        coachCopy={restCoachCopy}
        dashboardTestingModes={dashboardTestingModes}
        onChooseMode={handleChooseRestMode}
      />
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
    <ShowroomPageShell
      className="flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col overflow-hidden pb-0 pt-0 md:pt-0"
      style={podShellVars}
      data-pod-layout-shell="true"
      data-pod-lab-mode={labMode ? "true" : "false"}
      data-pod-lab-state={effectiveLabState || undefined}
      data-pod-layout-ready={!loading && activePod ? "true" : "false"}
      data-pod-lighting-state={podLightingState}
      data-physical-control-status={physicalControl.status}
      data-physical-control-fault={physicalControl.fault ? "true" : "false"}
      data-physical-applied-lighting-state={physicalControl.appliedState?.lightingState || ""}
      data-physical-reported-lighting-state={physicalControl.reportedState?.lightingState || ""}
      data-zone-id={zoneExperience.zoneId || undefined}
      data-zone-present={zoneExperience.isPresent ? "true" : "false"}
      data-zone-occupied={zoneExperience.isOccupied ? "true" : "false"}
      data-rest-test-eligible={zoneExperience.restTestEligible ? "true" : "false"}
    >
      <div
        data-pod-layout-region="top-header"
        className="mx-auto h-[var(--pod-header-height)] w-full max-w-[1380px] shrink-0 px-[var(--pod-outer-x)] py-[6px]"
      >
        <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-[20px] border border-white/80 bg-white/94 px-[14px] shadow-[0_18px_46px_rgba(40,63,126,0.1)] backdrop-blur md:px-[18px]">
          <button
            type="button"
            onClick={() => {
              noteUserInteraction?.();
              void goToPodHome();
            }}
            className="inline-flex min-h-[var(--pod-touch-target)] items-center gap-3 justify-self-start rounded-[14px] border border-transparent bg-transparent px-2 text-sm font-extrabold text-slate-900 transition hover:text-[#2f57e8]"
          >
            <ArrowLeft className="h-5 w-5" />
            Pod Home
          </button>

          <ShowroomBrandMark
            className="justify-self-center"
            imageClassName="w-[clamp(170px,18vw,220px)]"
          />

          <div className="justify-self-end flex flex-col items-end gap-2">
            <ShowroomCartBadge
              count={snoozepodCount}
              quiet
              className={cartPulse ? "scale-[1.01] border-indigo-300 ring-4 ring-indigo-100" : ""}
              onClick={() => {
                noteUserInteraction?.();
                navigate("/cart");
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

      {!loading && activePod ? (
        <div
          data-pod-layout-region="pod-nav"
          className="mx-auto h-[var(--pod-nav-height)] w-full max-w-[1380px] shrink-0 px-[var(--pod-outer-x)] py-[4px]"
        >
          <PodFooterNav
            openStage={openStage}
            activeKey={activeNavKey}
            onGoHome={() => void goToPodHome()}
            onGoRest={goToRestStage}
            onGoLearn={goToDetailsStage}
            onGoBuild={() => void goToBuildStage("size")}
            onAskSnoozer={() => {
              noteUserInteraction?.();
              void cancelPodVoice({ resetKeys: true });
              navigate("/ask-snoozer", { state: { from: currentPodRoute } });
            }}
            onTalkToHuman={() => {
              noteUserInteraction?.();
              void cancelPodVoice({ resetKeys: true });
              navigate("/ask-snoozer", {
                state: {
                  from: currentPodRoute,
                  prefill: "I need human help.",
                  autoSend: true,
                },
              });
            }}
          />
        </div>
      ) : null}

      <div className="mx-auto flex min-h-0 w-full max-w-[1380px] flex-1 flex-col overflow-hidden px-[var(--pod-outer-x)] pb-[12px] pt-[8px]">
        <ShowroomFrame className={["flex min-h-0 flex-1 flex-col overflow-visible", isRestTaskStage ? "p-[8px]" : "p-[10px]"].join(" ")}>
          {!loading && activePod ? (
            <div data-pod-layout-region="product-hero" className="h-[var(--pod-hero-height)] shrink-0">
              <ShowroomPanel className="h-full overflow-hidden p-0" tone="soft">
                <PodRouteHeroHeader
                  eyebrow=""
                  podTitle={title}
                  mattressTitle={mattressDisplayTitle}
                  helperText=""
                  isRecommended={isRecommended}
                  mattressImage={mattressImage}
                  voiceState={voiceState}
                  badges={openStage === "details" || openStage === "build" ? headerBadges : headerBadges.slice(0, isRecommended ? 2 : 1)}
                  coachBubble={isDefaultPodDashboard || isRestSelectionStage ? restCoachCopy : ""}
                />
              </ShowroomPanel>
            </div>
          ) : null}

          <div
            ref={stagePanelRef}
            data-pod-layout-region="active-content"
            className={[
              "mt-[var(--pod-main-gap)] flex min-h-0 flex-1 flex-col overflow-visible pr-[4px] pb-[4px]",
              isRestTaskStage ? "" : "",
            ].join(" ")}
          >
            {activePanelContent}
          </div>
        </ShowroomFrame>
      </div>
    </ShowroomPageShell>
  );
}


