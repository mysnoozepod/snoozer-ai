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
  XCircle,
  ImageOff,
  Headphones,
  Info,
} from "lucide-react";

import { api } from "@/lib/api";
import PodBuilder from "@/components/PodBuilder";
import { generateShowroomRecommendations } from "@/lib/utils/recommendations";
import { useStore } from "@/lib/useStore";
import { useSnoozer } from "@/Layout.jsx";

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

function buildPodBuildVoice({ title, baseProductTitle }) {
  return [title, "Build your setup.", baseProductTitle || ""].filter(Boolean).join(" ");
}

function buildPodCheckoutVoice() {
  return "Checkout options are ready.";
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
    caption: "Choose the size that fits your room, sleep setup, and comfort needs.",
  },
  base: {
    title: "Choose Your Base",
    image: [],
    caption: "Choose mattress only, a platform base, or an adjustable base.",
  },
  motion: {
    title: "Choose Your Motion",
    image: [PUBLIC_ASSETS.standardMotion],
    caption: "Motion options only apply when adjustable base is selected.",
  },
  mattress: {
    title: "Choose Your Mattress",
    image: [],
    caption: "Choose the mattress feel and build that fits this setup.",
  },
  dual: {
    title: "Choose Dual Comfort",
    image: [],
    caption: "Choose the left and right comfort feel separately.",
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
      doneCta: "See Final Question",
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
      doneCta: "See Final Question",
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
      doneCta: "See Final Question",
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
      doneCta: "See Final Question",
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
        "inline-flex items-center justify-center gap-2 rounded-2xl border px-5 py-3 text-sm font-extrabold shadow-sm transition",
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

function WhyChosenCard({ isRecommended, rank, sentence }) {
  return (
    <div className="rounded-3xl border bg-white p-4 shadow-sm md:p-5">
      <div className="text-sm font-extrabold uppercase tracking-[0.16em] text-gray-500">
        Why this pod was chosen
      </div>

      <div className="mt-3 flex items-center gap-4">
        <img
          src={PUBLIC_ASSETS.snoozerAvatar}
          alt="Snoozer"
          className="h-24 w-24 shrink-0 rounded-full object-cover md:h-28 md:w-28"
          loading="lazy"
          decoding="async"
        />

        <div className="min-w-0">
          <div className="text-xl font-extrabold leading-tight text-gray-900 md:text-2xl">
            {isRecommended ? `Recommended #${rank || "1"} for you` : "Selected for you"}
          </div>
          <div className="mt-2 text-base leading-7 text-gray-700">{sentence}</div>
        </div>
      </div>
    </div>
  );
}

function OnThisPodCard({ title, image }) {
  return (
    <div className="rounded-3xl border bg-white p-4 shadow-sm md:p-5">
      <div className="text-sm font-extrabold uppercase tracking-[0.16em] text-gray-500">
        On This Pod
      </div>

      <div className="mt-2 text-2xl font-extrabold leading-tight text-gray-900 md:text-3xl">
        {title}
      </div>

      <div className="mt-3 overflow-hidden rounded-3xl border bg-gray-50">
        <ResponsiveImage
          src={[image, PUBLIC_ASSETS.noImage]}
          alt={title}
          className="aspect-[16/10]"
          imgClassName="h-full w-full object-contain"
        />
      </div>
    </div>
  );
}

function RestTestVisualCard({ title, image, caption }) {
  return (
    <div className="rounded-3xl border bg-white p-4 shadow-sm md:p-5">
      <div className="text-sm font-extrabold uppercase tracking-[0.16em] text-gray-500">
        Snoozer Guide
      </div>

      <div className="mt-2 text-2xl font-extrabold leading-tight text-gray-900 md:text-3xl">
        {title}
      </div>

      <div className="mt-3 overflow-hidden rounded-3xl border bg-gray-50">
        <ResponsiveImage
          src={image}
          alt={title}
          className="aspect-[16/10]"
          imgClassName="h-full w-full object-cover"
        />
      </div>

      <div className="mt-3 text-base leading-7 text-gray-700">{caption}</div>
    </div>
  );
}

function BuildVisualCard({ title, image, caption, eyebrow = "Build Guide" }) {
  return (
    <div className="rounded-3xl border bg-white p-4 shadow-sm md:p-5">
      <div className="text-sm font-extrabold uppercase tracking-[0.16em] text-gray-500">
        {eyebrow}
      </div>

      <div className="mt-2 text-2xl font-extrabold leading-tight text-gray-900 md:text-3xl">
        {title}
      </div>

      <div className="mt-3 overflow-hidden rounded-3xl border bg-gray-50">
        <ResponsiveImage
          src={image}
          alt={title}
          className="aspect-[16/10]"
          imgClassName="h-full w-full object-contain"
        />
      </div>

      <div className="mt-3 text-base leading-7 text-gray-700">{caption}</div>
    </div>
  );
}

function DetailCard({ title, items = [] }) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm md:p-6">
      <div className="text-lg font-extrabold text-gray-900 md:text-xl">{title}</div>
      <div className="mt-3 space-y-2.5">
        {items.map((item) => (
          <div key={item} className="text-base text-gray-700">
            {item}
          </div>
        ))}
      </div>
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
  onGreat,
  onUnsure,
  onNo,
  isComplete,
  feelChoice,
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

  if (isComplete || activeStep?.id === "response") {
    return (
      <div className="rounded-3xl border bg-white shadow-sm">
        <div className="border-b bg-slate-50 px-5 py-4 md:px-6 md:py-5">
          <div className="text-xl font-extrabold text-gray-900 md:text-2xl">Rest Test</div>
        </div>

        <div className="p-5 md:p-6">
          <div className="text-lg font-semibold text-gray-700">What was your first impression?</div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onGreat}
              className="inline-flex items-center gap-2 rounded-2xl border bg-white px-5 py-3.5 text-base font-extrabold text-gray-900 hover:bg-gray-50"
            >
              <CheckCircle2 className="h-5 w-5 text-indigo-700" />
              Felt Great
            </button>

            <button
              type="button"
              onClick={onUnsure}
              className="inline-flex items-center gap-2 rounded-2xl border bg-white px-5 py-3.5 text-base font-extrabold text-gray-900 hover:bg-gray-50"
            >
              <HelpCircle className="h-5 w-5 text-indigo-700" />
              Not Sure
            </button>

            <button
              type="button"
              onClick={onNo}
              className="inline-flex items-center gap-2 rounded-2xl border bg-white px-5 py-3.5 text-base font-extrabold text-gray-900 hover:bg-gray-50"
            >
              <XCircle className="h-5 w-5 text-indigo-700" />
              Not For Me
            </button>
          </div>

          {(isComplete || feelChoice) && (
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onResetTest}
                className="rounded-2xl border bg-white px-5 py-3 text-sm font-extrabold text-gray-900 hover:bg-gray-50"
              >
                Restart Rest Test
              </button>
            </div>
          )}
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
          <div className="text-xl font-extrabold text-gray-900 md:text-2xl">{activeStep?.title}</div>

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
        <div className="max-w-3xl text-lg leading-8 text-gray-800 md:text-xl">{activeStep?.body}</div>

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
  const snoozer = useSnoozer();

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
  const [feelChoice, setFeelChoice] = useState(
    () => safeGet(`${storagePrefix}.feelChoice`) || ""
  );
  const [showCheckoutOptions, setShowCheckoutOptions] = useState(false);

  const [restModeId, setRestModeId] = useState(
    () => safeGet(`${storagePrefix}.restModeId`) || ""
  );
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

  const voiceState = snoozer?.voiceState || {
    blocked: false,
    error: "",
    loading: false,
    playing: false,
    lastText: "",
  };

  const lastPodVoiceRef = useRef("");
  const lastPodVoiceAtRef = useRef(0);
  const lastRequestedVoiceRef = useRef("");
  const lastRestVoiceKeyRef = useRef("");
  const restAdvanceTimeoutRef = useRef(null);

  useEffect(() => safeSet(`${storagePrefix}.openStage`, openStage || "rest"), [storagePrefix, openStage]);
  useEffect(() => safeSet(`${storagePrefix}.buildStepKey`, buildStepKey || "size"), [storagePrefix, buildStepKey]);
  useEffect(() => safeSet(`${storagePrefix}.testComplete`, testComplete ? "1" : "0"), [storagePrefix, testComplete]);
  useEffect(() => safeSet(`${storagePrefix}.feelChoice`, feelChoice || ""), [storagePrefix, feelChoice]);
  useEffect(() => safeSet(`${storagePrefix}.restModeId`, restModeId || ""), [storagePrefix, restModeId]);
  useEffect(() => safeSet(`${storagePrefix}.restStepIndex`, String(restStepIndex || 0)), [storagePrefix, restStepIndex]);
  useEffect(() => safeSet(`${storagePrefix}.timerRemaining`, String(Math.max(0, timerRemaining || 0))), [storagePrefix, timerRemaining]);

  useEffect(() => {
    const prev = window.__SNOOZE_DISABLE_WIDGET;
    window.__SNOOZE_DISABLE_WIDGET = true;
    document.body.classList.add("no-global-chat");
    return () => {
      window.__SNOOZE_DISABLE_WIDGET = prev;
      document.body.classList.remove("no-global-chat");
    };
  }, []);

  useEffect(() => {
    return () => {
      if (restAdvanceTimeoutRef.current) {
        window.clearTimeout(restAdvanceTimeoutRef.current);
        restAdvanceTimeoutRef.current = null;
      }
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
    async (text, { force = false, calm = false, priority = "normal" } = {}) => {
      const phrase = String(text || "").trim();
      if (!phrase) return;

      const now = Date.now();
      const sameAsLastPhrase = phrase === lastPodVoiceRef.current;
      const tooSoon = now - lastPodVoiceAtRef.current < 1200;

      if (!force && sameAsLastPhrase && tooSoon) {
        return;
      }

      if (!force && voiceState.loading && sameAsLastPhrase) {
        return;
      }

      if (!force && voiceState.playing && sameAsLastPhrase) {
        return;
      }

      lastPodVoiceRef.current = phrase;
      lastPodVoiceAtRef.current = now;
      lastRequestedVoiceRef.current = phrase;

      await snoozer?.sayHud?.({
        speech: phrase,
        captions: phrase,
        state: "speaking",
        priority: force ? "high" : priority,
        ttlMs: calm ? 6500 : 5000,
        voiceStyle: calm ? "calm" : "default",
        actions: [],
      });
    },
    [snoozer, voiceState.loading, voiceState.playing]
  );

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
      recs.pods.find((p) => String(p.podId ?? p.id ?? "") === String(pid)) ||
      recs.pods[0] ||
      null;

    const sanitizedFound = found ? stripLegacyPodImageFields(found) : null;

    setActivePod(sanitizedFound || null);
    setSelectedMattressHandle(undefined);
    setSelectedBaseHandle(undefined);
    setShowCheckoutOptions(false);

    const savedOpenStage = safeGet(`${storagePrefix}.openStage`);
    const savedBuildStepKey = safeGet(`${storagePrefix}.buildStepKey`) || "size";
    const savedTestComplete = safeGet(`${storagePrefix}.testComplete`) === "1";
    const savedFeelChoice = safeGet(`${storagePrefix}.feelChoice`) || "";
    const savedRestModeId = safeGet(`${storagePrefix}.restModeId`) || "";
    const savedRestStepIndex = Number(safeGet(`${storagePrefix}.restStepIndex`));
    const savedTimerRemaining = Number(safeGet(`${storagePrefix}.timerRemaining`));

    setOpenStage(savedOpenStage ? String(savedOpenStage) || "rest" : "rest");
    setBuildStepKey(savedBuildStepKey);
    setTestComplete(savedTestComplete);
    setFeelChoice(savedFeelChoice);
    setRestModeId(savedRestModeId);
    setRestStepIndex(Number.isFinite(savedRestStepIndex) && savedRestStepIndex >= 0 ? savedRestStepIndex : 0);
    setTimerRemaining(Number.isFinite(savedTimerRemaining) && savedTimerRemaining >= 0 ? savedTimerRemaining : 0);
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

    lastRestVoiceKeyRef.current = "";
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
      speakPod("That step is complete.", { priority: "low", calm: true });
    }
  }, [timerRunning, timerRemaining, speakPod]);

  useEffect(() => {
    if (openStage !== "rest") return;

    if (!activeRestFlow) {
      const key = "mode-select";
      if (lastRestVoiceKeyRef.current === key) return;
      lastRestVoiceKeyRef.current = key;
      speakPod("Choose either the 7-minute or 15-minute rest test.", {
        calm: true,
      });
      return;
    }

    if (!activeRestStep) return;
    if (restPanelPhase === "transition") return;

    const shouldSpeakAtStepBoundary =
      timerRemaining === activeRestStep.seconds || timerRemaining === 0;

    if (!shouldSpeakAtStepBoundary) return;

    const key = `${activeRestFlow.id}:${activeRestStep.id}:${timerRunning ? "run" : "stop"}:${timerRemaining}`;
    if (lastRestVoiceKeyRef.current === key) return;

    lastRestVoiceKeyRef.current = key;
    speakPod(activeRestStep.voice || activeRestStep.body, {
      calm: true,
      priority: timerRemaining === 0 ? "low" : "normal",
    });
  }, [openStage, activeRestFlow, activeRestStep, timerRemaining, timerRunning, restPanelPhase, speakPod]);

  const speakForStage = useCallback(
    (id) => {
      if (id === "rest") {
        return speakPod(
          buildPodRestVoice({
            title,
            mattressHeroTitle,
            painSignals,
          }),
          { force: true, calm: true }
        );
      }

      if (id === "details") {
        return speakPod(
          buildPodDetailsVoice({
            title,
            mattressHeroTitle,
            benefits,
            isRecommended,
            rank,
          }),
          { force: true }
        );
      }

      if (id === "build") {
        return speakPod(
          buildPodBuildVoice({
            title,
            baseProductTitle: baseProduct?.title || "",
          }),
          { force: true }
        );
      }

      return Promise.resolve();
    },
    [
      title,
      mattressHeroTitle,
      painSignals,
      benefits,
      isRecommended,
      rank,
      baseProduct?.title,
      speakPod,
    ]
  );

  const resetRestTest = useCallback(() => {
    if (restAdvanceTimeoutRef.current) {
      window.clearTimeout(restAdvanceTimeoutRef.current);
      restAdvanceTimeoutRef.current = null;
    }

    setRestModeId("");
    setRestStepIndex(0);
    setTimerRemaining(0);
    setTimerRunning(false);
    setTestComplete(false);
    setFeelChoice("");
    setCueType("tip");
    setCue("Choose your Rest Test");
    setRestPanelPhase("normal");
    lastRestVoiceKeyRef.current = "";
    speakPod("Choose either the 7-minute or 15-minute rest test.", {
      calm: true,
      force: true,
    });
  }, [speakPod]);

  const handleChooseRestMode = useCallback(
    (modeId) => {
      snoozer?.noteUserInteraction?.();

      const flow = restFlows[modeId];
      const firstStep = flow?.steps?.[0] || null;
      if (!flow || !firstStep) return;

      if (restAdvanceTimeoutRef.current) {
        window.clearTimeout(restAdvanceTimeoutRef.current);
        restAdvanceTimeoutRef.current = null;
      }

      setRestModeId(modeId);
      setRestStepIndex(0);
      setTimerRemaining(firstStep.seconds);
      setTimerRunning(false);
      setTestComplete(false);
      setFeelChoice("");
      setCueType("tip");
      setCue(flow.title);
      setRestPanelPhase("normal");
      lastRestVoiceKeyRef.current = "";
      speakPod(`${flow.title}. ${firstStep.voice || firstStep.body}`, {
        calm: true,
        force: true,
      });
    },
    [restFlows, speakPod, snoozer]
  );

  const handleStartTimer = useCallback(() => {
    snoozer?.noteUserInteraction?.();

    if (!activeRestStep) return;
    if (timerRunning) return;
    if (timerRemaining <= 0) return;

    setTimerRunning(true);
    setCueType("tip");
    setCue(activeRestStep.cue || "Timer running");
    setRestPanelPhase("normal");
  }, [activeRestStep, timerRunning, timerRemaining, snoozer]);

  const runRestTransition = useCallback(
    ({ nextIndex, nextStep, finalCue, nextCue, voiceText }) => {
      if (restAdvanceTimeoutRef.current) {
        window.clearTimeout(restAdvanceTimeoutRef.current);
        restAdvanceTimeoutRef.current = null;
      }

      setTimerRunning(false);
      setRestPanelPhase("transition");
      setCueType("tip");
      setCue("Next step");

      restAdvanceTimeoutRef.current = window.setTimeout(() => {
        if (!nextStep) {
          setTimerRemaining(0);
          setCueType("tip");
          setCue(finalCue || "How did it feel?");
          setRestPanelPhase("normal");
          lastRestVoiceKeyRef.current = "";
          restAdvanceTimeoutRef.current = null;
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
          speakPod(voiceText, { calm: true, force: true });
        }
      }, 650);
    },
    [speakPod]
  );

  const handleAdvanceRestStep = useCallback(() => {
    snoozer?.noteUserInteraction?.();

    if (!activeRestFlow?.steps?.length) return;

    const nextIndex = restStepIndex + 1;
    const nextStep = activeRestFlow.steps[nextIndex] || null;

    runRestTransition({
      nextIndex,
      nextStep,
      finalCue: "How did it feel?",
      nextCue: nextStep?.cue || activeRestFlow.title,
      voiceText: nextStep?.voice || nextStep?.body || "",
    });
  }, [activeRestFlow, restStepIndex, runRestTransition, snoozer]);

  const handleSkipRestStep = useCallback(() => {
    snoozer?.noteUserInteraction?.();

    if (!activeRestFlow?.steps?.length) return;

    const nextIndex = restStepIndex + 1;
    const nextStep = activeRestFlow.steps[nextIndex] || null;

    runRestTransition({
      nextIndex,
      nextStep,
      finalCue: "How did it feel?",
      nextCue: nextStep?.cue || activeRestFlow.title,
      voiceText: nextStep?.voice || nextStep?.body || "",
    });
  }, [activeRestFlow, restStepIndex, runRestTransition, snoozer]);

  const handleFeelGreat = useCallback(() => {
    snoozer?.noteUserInteraction?.();
    setFeelChoice("Great");
    setTestComplete(true);
    setTimerRunning(false);
    setCueType("success");
    setCue("Move to Build");
    setOpenStage("build");
    setRestPanelPhase("normal");
    speakPod("Build this bed.", { force: true });
  }, [speakPod, snoozer]);

  const handleFeelUnsure = useCallback(() => {
    snoozer?.noteUserInteraction?.();
    setFeelChoice("Not sure");
    setTestComplete(true);
    setTimerRunning(false);
    setCueType("tip");
    setCue("Review details");
    setOpenStage("details");
    setRestPanelPhase("normal");
    speakPod("Review the details.", { force: true });
  }, [speakPod, snoozer]);

  const handleFeelNo = useCallback(() => {
    snoozer?.noteUserInteraction?.();
    setFeelChoice("Not for me");
    setTestComplete(true);
    setTimerRunning(false);
    setCueType("warning");
    setCue("Try another pod from your results");
    setRestPanelPhase("normal");
    speakPod("Try another pod from your results.", { force: true });
  }, [speakPod, snoozer]);

  const stageContent = useMemo(() => {
    if (openStage === "details") {
      return (
        <div className="space-y-4">
          <DetailCard
            title="Why it matched you"
            items={[
              `Recommended because you mentioned ${whyThisPodReason}.`,
              ...buildDetailBullets({
                mattressTitle: mattressHeroTitle,
                benefits,
                painSignals,
                isRecommended,
                rank,
              }),
            ].filter(Boolean)}
          />

          <DetailCard title="Compare if" items={notIdealFor} />
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

            if (typeof nextText === "string" && nextText.trim()) {
              speakPod(nextText, { priority: "low" });
            }
          }}
          primaryCtaLabel="Add to Cart"
          secondaryCtaLabel="Save Build"
          onViewSnoozePod={() => navigate("/snoozepod")}
        />
      );
    }

    return (
      <GuidedRestTest
        flowOptions={restFlows}
        activeMode={activeRestFlow}
        activeStep={activeRestStep || { id: "response" }}
        activeStepIndex={restStepIndex}
        timerRemaining={timerRemaining}
        timerRunning={timerRunning}
        onChooseMode={handleChooseRestMode}
        onStartTimer={handleStartTimer}
        onAdvanceStep={handleAdvanceRestStep}
        onSkipStep={handleSkipRestStep}
        onResetTest={resetRestTest}
        onGreat={handleFeelGreat}
        onUnsure={handleFeelUnsure}
        onNo={handleFeelNo}
        isComplete={testComplete}
        feelChoice={feelChoice}
        hasAdjustableBase={hasAdjustableBase}
      />
    );
  }, [
    openStage,
    whyThisPodReason,
    mattressHeroTitle,
    benefits,
    painSignals,
    isRecommended,
    rank,
    notIdealFor,
    activePod,
    assessment,
    mattressProduct,
    baseProduct,
    onSelectionHandlesChange,
    onBuildStepChange,
    navigate,
    speakPod,
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
    handleFeelGreat,
    handleFeelUnsure,
    handleFeelNo,
    testComplete,
    feelChoice,
    hasAdjustableBase,
  ]);

  const stageSubtitle = useMemo(() => {
    if (openStage === "build") return "Build your setup one step at a time.";
    return headerPersonalization;
  }, [openStage, headerPersonalization]);

  const footerStageLabel = useMemo(() => {
    if (openStage === "details") return "Details";
    if (openStage === "build") return "Build Your Pod";
    if (testComplete) return "Rest Test complete";
    return "Rest Test";
  }, [openStage, testComplete]);

  const goToDetailsStage = useCallback(() => {
    snoozer?.noteUserInteraction?.();
    setOpenStage("details");
    setCueType("tip");
    setCue("Review this match");
    setRestPanelPhase("normal");
    speakForStage("details");
  }, [speakForStage, snoozer]);

  const goToBuildStage = useCallback(() => {
    snoozer?.noteUserInteraction?.();
    setOpenStage("build");
    setCueType("success");
    setCue("Build this bed");
    setRestPanelPhase("normal");
    speakForStage("build");
  }, [speakForStage, snoozer]);

  const goToRestStage = useCallback(() => {
    snoozer?.noteUserInteraction?.();
    setOpenStage("rest");
    setCueType("tip");
    setCue(restModeId ? "Rest Test in progress" : "Choose your Rest Test");
    setRestPanelPhase("normal");
    speakForStage("rest");
  }, [restModeId, speakForStage, snoozer]);

  const restPanelImage = useMemo(() => {
    if (openStage !== "rest") return [];

    if (restPanelPhase === "transition") {
      return REST_GUIDE_IMAGES.transition;
    }

    if (!activeRestFlow) {
      return REST_GUIDE_IMAGES.choice;
    }

    if (testComplete || (activeRestStep && activeRestStep.id === "response")) {
      return REST_GUIDE_IMAGES.active;
    }

    if (timerRunning) {
      return REST_GUIDE_IMAGES.active;
    }

    return REST_GUIDE_IMAGES.choice;
  }, [openStage, restPanelPhase, activeRestFlow, testComplete, activeRestStep, timerRunning]);

  const restPanelTitle = useMemo(() => {
    if (openStage !== "rest") return "";

    if (restPanelPhase === "transition") return "Next Step";
    if (!activeRestFlow) return "Choose Your Rest Test";
    if (testComplete || (activeRestStep && activeRestStep.id === "response")) {
      return "Final Impression";
    }
    if (timerRunning) return activeRestStep?.cue || "Rest Test Active";
    return activeRestFlow?.title || "Rest Test";
  }, [openStage, restPanelPhase, activeRestFlow, testComplete, activeRestStep, timerRunning]);

  const restPanelCaption = useMemo(() => {
    if (openStage !== "rest") return "";

    if (restPanelPhase === "transition") {
      return "Move into the next position when you are ready.";
    }

    if (!activeRestFlow) {
      return "Choose either the 7-minute or 15-minute rest test to begin.";
    }

    if (testComplete || (activeRestStep && activeRestStep.id === "response")) {
      return "Give your first impression before moving on.";
    }

    if (timerRunning) {
      return activeRestStep?.body || "Follow the current step and notice how the mattress feels.";
    }

    return "Review the step, then start the timer when you are ready.";
  }, [openStage, restPanelPhase, activeRestFlow, testComplete, activeRestStep, timerRunning]);

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

    if (step === "mattress" || step === "dual") {
      return {
        title: step === "dual" ? BUILD_VISUALS.dual.title : BUILD_VISUALS.mattress.title,
        image: [mattressImage, PUBLIC_ASSETS.noImage],
        caption: step === "dual" ? BUILD_VISUALS.dual.caption : BUILD_VISUALS.mattress.caption,
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

  const currentPageVoiceState = useMemo(() => {
    const currentRequested = String(lastRequestedVoiceRef.current || "").trim();
    const currentLastText = String(voiceState?.lastText || "").trim();
    const rawError = String(voiceState?.error || "").trim();

    const interruptedByReplace = /interrupted by a call to pause\(\)/i.test(rawError);
    const isCurrentAttempt =
      !!currentRequested &&
      !!currentLastText &&
      currentRequested === currentLastText;

    return {
      blocked: isCurrentAttempt ? Boolean(voiceState?.blocked) : false,
      error: isCurrentAttempt && !interruptedByReplace ? rawError : "",
    };
  }, [voiceState]);

  return (
    <section className="min-h-screen bg-gradient-to-b from-[#E8ECF5] to-white pb-28 pt-4 md:pt-5">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              snoozer?.noteUserInteraction?.();
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
              snoozer?.noteUserInteraction?.();
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
                      label="Details"
                      onClick={goToDetailsStage}
                    />
                    <StageButton
                      active={openStage === "build"}
                      icon={BedDouble}
                      label="Build Your Pod"
                      onClick={goToBuildStage}
                    />
                  </div>

                  {(currentPageVoiceState.blocked || currentPageVoiceState.error) && (
                    <div className="mt-3 flex flex-wrap gap-3">
                      {currentPageVoiceState.blocked ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                          Audio may require a tap
                        </span>
                      ) : null}

                      {currentPageVoiceState.error ? (
                        <span className="rounded-full border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                          Audio unavailable
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.03fr_0.97fr]">
                <div className="space-y-4">
                  <WhyChosenCard
                    isRecommended={isRecommended}
                    rank={rank}
                    sentence={whyThisPodSentence}
                  />

                  {showInlineStagePanel ? (
                    <div className="rounded-[32px] border border-white/60 bg-white shadow-xl">
                      <div className="p-0">{stageContent}</div>
                    </div>
                  ) : (
                    <div className="rounded-[32px] border border-white/60 bg-white p-6 shadow-xl">
                      <div className="py-6 text-center text-gray-500">Loading</div>
                    </div>
                  )}
                </div>

                <div className="space-y-4">{rightPanelContent}</div>
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
                        snoozer?.noteUserInteraction?.();
                        speakPod(buildPodCheckoutVoice(), { force: true });
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
                          snoozer?.noteUserInteraction?.();
                          speakPod("Phone checkout ready.", { force: true });
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
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-gray-900">{title}</div>
              <div className="mt-1 text-sm text-gray-600">{footerStageLabel}</div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap">
              <FooterAction
                icon={Headphones}
                label="Talk to a Human"
                onClick={() => {
                  snoozer?.noteUserInteraction?.();
                  setCueType("tip");
                  setCue("Human support handoff can be added next.");
                }}
              />

              <FooterAction
                icon={ShoppingCart}
                label="View Cart"
                onClick={() => {
                  snoozer?.noteUserInteraction?.();
                  speakPod("Opening cart.", { force: true });
                  navigate("/snoozepod");
                }}
              />

              <FooterAction
                icon={Info}
                label="Pod Details"
                onClick={goToDetailsStage}
              />

              <FooterAction
                icon={CreditCard}
                label="Checkout"
                tone="primary"
                onClick={() => {
                  snoozer?.noteUserInteraction?.();
                  setShowCheckoutOptions(true);
                  setCueType("success");
                  setCue("Ready for checkout");
                  speakPod(buildPodCheckoutVoice(), { force: true });
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}