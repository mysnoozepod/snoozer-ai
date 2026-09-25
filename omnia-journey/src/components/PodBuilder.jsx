import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BedDouble,
  CheckCircle2,
  ImageOff,
  Ruler,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/useStore";
import { getShopperId } from "@/state/sessionStore";
import { resolveApprovedVariant } from "@/lib/cart/variantResolution.mjs";
import {
  classifyCoreCartState,
  synchronizeCoreCartLines,
} from "@/lib/cart/podCoreCartSync.mjs";
import {
  isLegacyEmbeddedEssentialsStep,
  normalizeCoreBuildStepCandidate,
  resolveCoreBuildStepKeys,
} from "@/lib/podBuilderFlow.mjs";
import {
  SIZE_OPTIONS,
  BASE_OPTIONS_UI,
  MOTION_TYPES_UI,
  DUAL_COMFORT_OPTIONS,
  getBaseHandleForType,
  getMattressHandleForType,
} from "@/lib/utils/recommendations";

export const VERIFIED_SIZE_DIMENSIONS = Object.freeze({
  Twin: '38" x 75"',
  "Twin XL": '38" x 80"',
  Full: '54" x 75"',
  Queen: '60" x 80"',
  King: '76" x 80"',
});

export const APPROVED_MOTION_VISUALS = Object.freeze({
  standard: "/standard-motion.png",
  half_split: "/half-split-motion.png",
  full_split: "/full-split-motion.png",
});

function SizeDiagram({ size }) {
  const widths = { Twin: "46%", "Twin XL": "46%", Full: "66%", Queen: "76%", King: "94%" };
  return (
    <span className="flex h-11 w-16 shrink-0 items-center justify-center rounded-[10px] bg-[#f2f6ff]" aria-hidden="true">
      <span
        className="block h-7 rounded-[5px] border-2 border-[#315cf6] bg-white shadow-[0_4px_8px_rgba(49,92,246,0.12)]"
        style={{ width: widths[size] || "70%" }}
      />
    </span>
  );
}

function lower(value) {
  return String(value || "").toLowerCase().trim();
}

export function money(value) {
  const amount = Number(value);
  const safe = Number.isFinite(amount) ? amount : 0;

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(safe);
  } catch {
    return `$${safe.toFixed(0)}`;
  }
}

export function monthlyEstimate(total) {
  const value = Number(total);
  return (Number.isFinite(value) ? value : 0) / 12;
}

function sanitizeImageUrl(value) {
  const src = String(value || "").trim();
  if (!src) return "";
  if (/^data:image\//i.test(src)) return src;
  if (/^https?:\/\//i.test(src)) return src;
  if (/^\//.test(src) && /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(src)) return src;
  return "";
}

export function pickFeaturedImage(product) {
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
    const src = sanitizeImageUrl(candidate);
    if (src) return src;
  }

  return "";
}

function normalizeVariants(product) {
  const variants = product?.variants;
  if (Array.isArray(variants)) return variants;
  if (Array.isArray(variants?.edges)) return variants.edges.map((edge) => edge?.node).filter(Boolean);
  if (Array.isArray(variants?.nodes)) return variants.nodes.filter(Boolean);
  return [];
}

export function parseVariantPrice(variant) {
  const amount =
    variant?.price?.amount ??
    variant?.priceV2?.amount ??
    variant?.priceAmount ??
    variant?.price ??
    null;

  const parsed = Number(String(amount ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function pickVariantForSize(product, size) {
  const resolution = resolveApprovedVariant({
    product,
    category: "mattress",
    setupSize: size,
    motionType: "standard",
  });
  return resolution.ok ? resolution.variant : null;
}

export function resolveMattressSizeFromCart({ cartItems, mattressProduct, mattressHandle }) {
  const productVariantIds = new Set(
    normalizeVariants(mattressProduct)
      .map((variant) => safeVariantId(variant))
      .filter(Boolean)
  );
  const canonicalHandle = String(mattressProduct?.handle || mattressHandle || "").trim();
  const matchingLines = (Array.isArray(cartItems) ? cartItems : []).filter((item) => {
    const merchandiseId = String(item?.merchandiseId || item?.variantId || "").trim();
    const handle = String(item?.handle || "").trim();
    return productVariantIds.has(merchandiseId) || (canonicalHandle && handle === canonicalHandle);
  });

  for (const candidateSize of SIZE_OPTIONS) {
    const variant = pickVariantForSize(mattressProduct, candidateSize);
    const variantId = safeVariantId(variant);
    if (variantId && matchingLines.some((item) => String(item?.merchandiseId || item?.variantId || "") === variantId)) {
      return candidateSize;
    }
  }
  return "";
}

function safeVariantId(variant) {
  if (!variant) return null;
  if (
    variant.availableForSale === false ||
    variant.available === false ||
    variant.isAvailable === false ||
    variant.inventoryAvailable === false
  ) {
    return null;
  }

  const id = variant?.id ? String(variant.id).trim() : "";
  if (!id.startsWith("gid://shopify/ProductVariant/")) return null;
  return id;
}

function motionAvailabilityForSelection(size, isDualComfort) {
  const isQueen = size === "Queen";
  const isKing = size === "King";

  return {
    standard: true,
    half_split: Boolean(isDualComfort && (isQueen || isKing)),
    full_split: Boolean(isKing),
  };
}

function allowedMotionTypesForSelection(size, isDualComfort) {
  const availability = motionAvailabilityForSelection(size, isDualComfort);
  return Object.entries(availability)
    .filter(([, allowed]) => allowed)
    .map(([motionType]) => motionType);
}

function labelFor(list, value, fallback = "—") {
  const match = Array.isArray(list) ? list.find((option) => option?.value === value) : null;
  return match?.label || fallback;
}

function isSplitMotion(motionType) {
  return motionType === "half_split" || motionType === "full_split";
}

export function inferBaseTypeFromPod(pod) {
  const handle = lower(pod?.baseHandle);
  const label = lower(pod?.displayedIn?.baseLabel);
  const motion = lower(pod?.displayedIn?.motion);

  if (
    handle.includes("adjust") ||
    handle.includes("motion") ||
    label.includes("adjustable") ||
    motion.includes("motion")
  ) {
    return "adjustable";
  }
  if (handle.includes("storage") || label.includes("storage")) return "storage";
  if (handle.includes("platform") || label.includes("platform")) return "platform";
  return "none";
}

export function inferMotionTypeFromPod(pod) {
  const motion = lower(pod?.displayedIn?.motion);
  if (motion.includes("full split")) return "full_split";
  if (motion.includes("half split")) return "half_split";
  return "standard";
}

function inferMattressTypeFromPod(pod) {
  const handle = lower(pod?.mattressHandle);
  if (handle.includes("dual") && handle.includes("comfort")) return "dual12";
  if (handle.includes("hybrid") && handle.includes("14")) return "hybrid14";
  if (handle.includes("foam") && handle.includes("10")) return "foam10";
  if (handle.includes("foam") && handle.includes("12")) return "foam12";
  if (handle.includes("hybrid")) return "hybrid14";
  if (handle.includes("foam")) return "foam12";
  return "foam12";
}

function storageKeyForPod(pod) {
  const id = String(pod?.podId ?? pod?.id ?? "unknown").trim() || "unknown";
  return `snooze.podBuilder.${id}`;
}

function podLabelFor(pod) {
  const id = String(pod?.podId ?? pod?.id ?? "").trim();
  return id ? `SnoozePod ${id}` : "SnoozePod";
}

function readSavedBuild(pod) {
  try {
    const raw = sessionStorage.getItem(storageKeyForPod(pod));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSavedBuild(pod, value) {
  try {
    sessionStorage.setItem(storageKeyForPod(pod), JSON.stringify(value));
  } catch {}
}

function readShopperKey() {
  return getShopperId() || "guest";
}

function readAssessmentValue(assessment, ...keys) {
  for (const key of keys) {
    const direct = assessment?.[key];
    if (direct !== undefined && direct !== null && String(direct).trim()) return direct;
    const nested = assessment?.answers?.[key];
    if (nested !== undefined && nested !== null && String(nested).trim()) return nested;
  }
  return "";
}

function normalizeSizeChoice(value) {
  const raw = String(value || "").trim();
  return SIZE_OPTIONS.includes(raw) ? raw : "";
}

function normalizeBaseTypeChoice(value) {
  const normalized = lower(value);
  if (
    !normalized ||
    normalized === "no" ||
    normalized === "no base" ||
    normalized === "none" ||
    normalized.includes("mattress only")
  ) {
    return "none";
  }
  if (normalized.includes("adjust")) return "adjustable";
  if (normalized.includes("storage")) return "storage";
  if (normalized.includes("platform")) return "platform";
  return "";
}

function normalizeMotionTypeChoice(value) {
  const normalized = lower(value);
  if (!normalized) return "";
  if (normalized.includes("full split")) return "full_split";
  if (normalized.includes("half split")) return "half_split";
  if (normalized.includes("split")) return "half_split";
  if (normalized.includes("standard")) return "standard";
  if (normalized.includes("no motion")) return "standard";
  return "";
}

function normalizeComfortChoice(value) {
  const normalized = lower(value);
  if (!normalized) return "";
  if (normalized.includes("firm") && !normalized.includes("medium")) return "Firm";
  if (normalized.includes("medium") && normalized.includes("soft")) return "Medium Soft";
  if (normalized.includes("medium") && normalized.includes("firm")) return "Medium Firm";
  if (normalized.includes("soft")) return "Soft";
  if (normalized.includes("medium")) return "Medium Firm";
  return "";
}

function normalizePartnerChoice(value) {
  const normalized = lower(value);
  if (!normalized) return "";
  if (normalized === "yes" || normalized.includes("partner") || normalized.includes("share")) {
    return "yes";
  }
  if (normalized === "no") return "no";
  return normalized;
}

function buildAssessmentPreferenceContext(assessment = {}) {
  return {
    size: normalizeSizeChoice(
      readAssessmentValue(assessment, "size", "interestedSize", "preferredSize")
    ),
    baseType: normalizeBaseTypeChoice(
      readAssessmentValue(assessment, "baseType", "basePreference", "preferredBaseType", "foundation")
    ),
    motionType: normalizeMotionTypeChoice(
      readAssessmentValue(assessment, "motionMode", "motionPreference", "motionType", "motion")
    ),
    firmness: normalizeComfortChoice(
      readAssessmentValue(assessment, "firmness", "comfort", "feel", "comfortPreference")
    ),
    partnerFirmness: normalizeComfortChoice(
      readAssessmentValue(assessment, "partnerFirmness", "secondaryFirmness")
    ),
    sleepPartner: normalizePartnerChoice(
      readAssessmentValue(assessment, "sleepPartner", "partner", "shareBed")
    ),
  };
}

function buildAssessmentSignature(assessment = {}) {
  const context = buildAssessmentPreferenceContext(assessment);
  return JSON.stringify(context);
}

function resolveMotionSelection(candidate, allowedMotion) {
  const allowed = Array.isArray(allowedMotion) && allowedMotion.length ? allowedMotion : ["standard"];
  const normalized = normalizeMotionTypeChoice(candidate);

  if (!normalized) return allowed[0] || "standard";
  if (allowed.includes(normalized)) return normalized;
  return allowed[0] || "standard";
}

export function buildDefaultSelections({ assessment, pod, supportsSplitMotion, isDualComfort, activeJourneyConfiguration }) {
  const context = buildAssessmentPreferenceContext(assessment);
  const journey = activeJourneyConfiguration && typeof activeJourneyConfiguration === "object"
    ? activeJourneyConfiguration
    : {};
  const sizeFromJourney = normalizeSizeChoice(journey.size);
  const baseFromJourney =
    normalizeBaseTypeChoice(String(journey.baseDecision || "").replaceAll("_", " ")) ||
    (journey.baseHandle ? "adjustable" : "");
  const motionFromJourney = normalizeMotionTypeChoice(
    String(journey.motionConfiguration || "").replaceAll("_", " ")
  );
  const sizeFromAssessment = context.size;
  const baseFromAssessment = context.baseType;
  const motionFromAssessment = context.motionType;
  const firmnessFromAssessment = context.firmness;
  const partnerFirmnessFromAssessment = context.partnerFirmness;

  const size = sizeFromJourney || sizeFromAssessment || normalizeSizeChoice(pod?.displayedIn?.size) || "Queen";
  const baseType = baseFromJourney || baseFromAssessment || inferBaseTypeFromPod(pod) || "none";
  const allowedMotion = allowedMotionTypesForSelection(size, isDualComfort);
  const motionFallback = inferMotionTypeFromPod(pod) || "standard";
  const motionType =
    baseType === "adjustable"
      ? resolveMotionSelection(motionFromJourney || motionFromAssessment || motionFallback, allowedMotion)
      : "standard";

  return {
    size,
    baseType,
    motionType,
    dcLeft:
      (isDualComfort && firmnessFromAssessment) ||
      pod?.displayedIn?.dualComfort?.left ||
      "Medium Firm",
    dcRight:
      (isDualComfort && (partnerFirmnessFromAssessment || firmnessFromAssessment)) ||
      pod?.displayedIn?.dualComfort?.right ||
      "Medium Soft",
    sources: {
      size: sizeFromJourney ? "journey" : sizeFromAssessment ? "assessment" : "pod",
      baseType: baseFromJourney ? "journey" : baseFromAssessment ? "assessment" : "pod",
      motionType:
        motionFromJourney && baseType === "adjustable"
          ? "journey"
          : motionFromAssessment && baseType === "adjustable"
            ? "assessment"
            : "pod",
      comfort:
        isDualComfort && (firmnessFromAssessment || partnerFirmnessFromAssessment)
          ? "assessment"
          : "pod",
    },
  };
}

function sanitizeSelections(savedBuild, defaults, supportsSplitMotion, isDualComfort) {
  const preserveLegacyCoreSelections = isLegacyEmbeddedEssentialsStep(savedBuild?.stepKey);
  const size =
    preserveLegacyCoreSelections
      ? normalizeSizeChoice(savedBuild?.size) || defaults.size
      : ["journey", "assessment"].includes(defaults.sources?.size)
      ? defaults.size
      : normalizeSizeChoice(savedBuild?.size) || defaults.size;
  const baseType =
    preserveLegacyCoreSelections
      ? normalizeBaseTypeChoice(savedBuild?.baseType) || defaults.baseType
      : ["journey", "assessment"].includes(defaults.sources?.baseType)
      ? defaults.baseType
      : normalizeBaseTypeChoice(savedBuild?.baseType) || defaults.baseType;
  const allowedMotion = allowedMotionTypesForSelection(size, isDualComfort);
  const motionType =
    baseType === "adjustable"
      ? resolveMotionSelection(
          preserveLegacyCoreSelections
            ? normalizeMotionTypeChoice(savedBuild?.motionType) || defaults.motionType
            : ["journey", "assessment"].includes(defaults.sources?.motionType)
            ? defaults.motionType
            : normalizeMotionTypeChoice(savedBuild?.motionType) || defaults.motionType,
          allowedMotion
        )
      : "standard";

  return {
    size,
    baseType,
    motionType,
    dcLeft:
      isDualComfort
        ? preserveLegacyCoreSelections
          ? normalizeComfortChoice(savedBuild?.dcLeft) || defaults.dcLeft
          : defaults.sources?.comfort === "assessment"
          ? defaults.dcLeft
          : normalizeComfortChoice(savedBuild?.dcLeft) || defaults.dcLeft
        : "",
    dcRight:
      isDualComfort
        ? preserveLegacyCoreSelections
          ? normalizeComfortChoice(savedBuild?.dcRight) || defaults.dcRight
          : defaults.sources?.comfort === "assessment"
          ? defaults.dcRight
          : normalizeComfortChoice(savedBuild?.dcRight) || defaults.dcRight
        : "",
  };
}

function ChoiceCard({ title, subtitle, active, disabled = false, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "w-full rounded-[24px] border p-4 text-left shadow-sm transition",
        disabled ? "cursor-not-allowed opacity-50" : "hover:-translate-y-0.5 hover:shadow-md",
        active ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-extrabold text-gray-900 md:text-[1.05rem]">{title}</div>
          {subtitle ? <div className="mt-1.5 text-sm text-gray-600">{subtitle}</div> : null}
        </div>
        <div
          className={[
            "mt-1 h-6 w-6 shrink-0 rounded-full border",
            active ? "border-indigo-600 bg-indigo-600" : "border-gray-300 bg-white",
          ].join(" ")}
        >
          {active ? <div className="mx-auto mt-1 h-2.5 w-2.5 rounded-full bg-white" /> : null}
        </div>
      </div>
    </button>
  );
}

function BuilderOptionButton({ title, subtitle, active, disabled = false, onClick, compact = false }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "w-full rounded-[18px] border px-[12px] py-[8px] text-left shadow-sm transition",
        compact ? "min-h-[44px]" : "min-h-[70px]",
        disabled ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 opacity-60" : "hover:-translate-y-0.5 hover:shadow-md",
        active ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className={[
              "font-extrabold leading-tight text-gray-900",
              compact ? "text-[clamp(0.82rem,1vw,0.96rem)]" : "text-[clamp(0.92rem,1.15vw,1.02rem)]",
            ].join(" ")}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              className={[
                "text-gray-600",
                compact ? "mt-[3px] text-[0.68rem] leading-[1rem]" : "mt-[5px] text-[0.8rem] leading-[1.15rem]",
              ].join(" ")}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
        <div
          className={[
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
            active ? "border-indigo-600 bg-indigo-600" : "border-gray-300 bg-white",
          ].join(" ")}
        >
          {active ? <div className="h-2 w-2 rounded-full bg-white" /> : null}
        </div>
      </div>
    </button>
  );
}

function GuidedChoiceButton({
  title,
  subtitle,
  badge,
  active,
  confirming = false,
  disabled = false,
  visual = null,
  onClick,
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-pod-build-choice={title}
      data-pod-build-choice-active={active ? "true" : "false"}
      data-pod-build-choice-badge={badge || undefined}
      className={[
        "group flex min-h-[58px] w-full items-center justify-between gap-3 rounded-[16px] border px-3.5 py-2.5 text-left shadow-sm transition motion-reduce:transition-none",
        disabled
          ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 opacity-60"
          : "hover:-translate-y-0.5 hover:shadow-md",
        active
          ? "border-[#315cf6] bg-[#eef3ff] text-slate-950"
          : "border-[#dfe7fb] bg-white/96 text-slate-900",
        confirming ? "scale-[0.985] ring-2 ring-[#315cf6]/25" : "",
      ].join(" ")}
    >
      {visual}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="block text-[clamp(1rem,1.2vw,1.12rem)] font-black leading-tight">
            {title}
          </span>
          {badge ? (
            <span className="rounded-full border border-[#ffe0bf] bg-[#fff7ed] px-2 py-0.5 text-[0.62rem] font-black uppercase tracking-[0.12em] text-[#f97316]">
              {badge}
            </span>
          ) : null}
        </span>
        {subtitle ? (
          <span className="mt-1 block text-[clamp(0.78rem,1vw,0.88rem)] font-semibold leading-snug text-slate-600">
            {subtitle}
          </span>
        ) : null}
      </span>
      <span
        className={[
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
          active || confirming ? "border-[#315cf6] bg-[#315cf6] text-white" : "border-slate-300 bg-white",
        ].join(" ")}
      >
        {active || confirming ? <CheckCircle2 className="h-4 w-4" /> : null}
      </span>
    </button>
  );
}

export function subtitleForSize(option) {
  switch (option) {
    case "Twin":
      return "Compact spaces";
    case "Twin XL":
      return "Extra length";
    case "Full":
      return "More room";
    case "Queen":
      return "Most popular";
    case "King":
      return "Maximum space";
    default:
      return "";
  }
}

export function subtitleForBase(option) {
  switch (option) {
    case "none":
      return "Mattress feel only";
    case "adjustable":
      return "Lift and recline";
    case "platform":
      return "Simple support";
    case "storage":
      return "Built-in storage";
    default:
      return "";
  }
}

function subtitleForMotion(option) {
  switch (option) {
    case "standard":
      return "One-piece movement";
    case "half_split":
      return "Split head, shared foot";
    case "full_split":
      return "Independent sides";
    default:
      return "";
  }
}

function titleForMotion(option) {
  switch (option) {
    case "standard":
      return "Standard Motion";
    case "half_split":
      return "Half Split";
    case "full_split":
      return "Full Split / Split King";
    default:
      return labelFor(MOTION_TYPES_UI, option, "Motion");
  }
}

function disabledReasonForMotion(option, size, isDualComfort) {
  if (option === "half_split") {
    return "Dual Comfort Queen or King only.";
  }
  if (option === "full_split") {
    return "King only.";
  }
  if (!isDualComfort && option === "standard") {
    return "Available when Adjustable Base is selected.";
  }
  return `Unavailable with ${size || "this size"}.`;
}

function BuilderFallbackArt({ icon: Icon = BedDouble }) {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-[18px] bg-[radial-gradient(circle_at_top,_rgba(84,120,255,0.18),_transparent_55%),linear-gradient(180deg,#f6f9ff_0%,#eef3ff_100%)] text-[#2f57e8]">
      <Icon className="h-8 w-8 opacity-90" />
    </div>
  );
}

function BuilderMediaPreview({
  src,
  alt,
  icon: Icon = BedDouble,
  className = "",
  imgClassName = "h-full w-full object-cover",
  ...props
}) {
  const safeSrc = sanitizeImageUrl(src);

  return (
    <div className={className} {...props}>
      {safeSrc ? (
        <img src={safeSrc} alt={alt} className={imgClassName} loading="lazy" decoding="async" />
      ) : (
        <BuilderFallbackArt icon={Icon} />
      )}
    </div>
  );
}

function BuilderStepButton({ step, index, active, unlocked, onClick }) {
  const Icon = step.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!unlocked}
      className={[
        "flex w-full items-center gap-2.5 rounded-[18px] border px-3 py-2.5 text-left transition",
        active
          ? "border-indigo-200 bg-indigo-50 text-[#1f40c7] shadow-[0_12px_28px_rgba(47,87,232,0.12)]"
          : unlocked
            ? "border-slate-200 bg-white text-slate-800 hover:border-indigo-100 hover:bg-slate-50"
            : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400",
      ].join(" ")}
      >
        <div
          className={[
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[0.74rem] font-black",
            active
              ? "border-indigo-200 bg-white text-[#2f57e8]"
              : unlocked
                ? "border-slate-200 bg-slate-50 text-slate-600"
                : "border-slate-200 bg-white text-slate-400",
        ].join(" ")}
      >
        {index + 1}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
        <span className="truncate text-[0.82rem] font-extrabold">{step.label}</span>
      </div>
    </button>
  );
}

function BuilderSelectionCard({
  step,
  label,
  value,
  subtitle = "",
  image,
  icon: Icon = BedDouble,
  imageFit = "contain",
  onChange,
}) {
  return (
    <div className="rounded-[22px] border border-[#dfe7ff] bg-white/96 px-3 py-2.5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#eef3ff] text-[0.74rem] font-black text-[#2f57e8]">
            {step}
          </div>
          <div className="truncate text-[0.74rem] font-black uppercase tracking-[0.16em] text-slate-500">
            {label}
          </div>
        </div>

        {onChange ? (
          <button
            type="button"
            onClick={onChange}
            className="shrink-0 text-xs font-extrabold uppercase tracking-[0.14em] text-[#2f57e8]"
          >
            Change
          </button>
        ) : null}
      </div>

      <div className="mt-2.5 flex min-h-[66px] items-center gap-3">
        <div className="flex h-[60px] w-[60px] shrink-0 overflow-hidden rounded-[16px] border border-[#e5ebff] bg-[#fbfcff]">
          <BuilderMediaPreview
            src={image}
            alt={value}
            icon={Icon}
            className="h-full w-full"
            imgClassName={
              imageFit === "cover" ? "h-full w-full object-cover" : "h-full w-full object-contain p-2"
            }
          />
        </div>

        <div className="min-w-0">
          <div className="text-[0.96rem] font-extrabold leading-tight text-slate-900">{value}</div>
          {subtitle ? <div className="mt-1 text-[0.8rem] leading-5 text-slate-600">{subtitle}</div> : null}
        </div>
      </div>
    </div>
  );
}

function BuilderMetricCard({ label, value }) {
  return (
    <div className="rounded-[20px] border border-[#dbe5ff] bg-white px-3.5 py-3.5 shadow-sm">
      <div className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 text-[1.55rem] font-black tracking-tight text-slate-900">{value}</div>
    </div>
  );
}

export default function PodBuilder({
  pod,
  assessment,
  mattressProduct,
  baseProduct,
  activeJourneyConfiguration,
  onCue,
  onSelectionHandlesChange,
  onBuildStepChange,
  onPreviewChange,
  onStateChange,
  primaryCtaLabel = "Add to Cart",
  onViewSnoozePod,
  onViewResults,
  requestedStepKey,
  mattressAlreadyInCart = false,
}) {
  const addLinesToAuthoritativeCart = useStore(
    (state) => state.addLinesToAuthoritativeCart
  );
  const cartItems = useStore((state) => state.cart || []);
  const removeFromCart = useStore((state) => state.removeFromCart);
  const updateCart = useStore((state) => state.updateCart);
  const syncCartFromShopify = useStore((state) => state.syncCartFromShopify);

  const fixedMattressType = useMemo(() => inferMattressTypeFromPod(pod), [pod]);
  const fixedMattressHandle = useMemo(
    () => pod?.mattressHandle || getMattressHandleForType(fixedMattressType) || null,
    [pod?.mattressHandle, fixedMattressType]
  );
  const isDualComfort = fixedMattressType === "dual12";
  const supportsSplitMotion = isDualComfort;
  const shopperKey = useMemo(() => readShopperKey(), []);
  const assessmentSignature = useMemo(() => buildAssessmentSignature(assessment), [assessment]);

  const savedBuild = useMemo(() => readSavedBuild(pod), [pod]);
  const isLegacyEmbeddedEssentialsBuild = isLegacyEmbeddedEssentialsStep(savedBuild?.stepKey);
  const compatibleSavedBuild = useMemo(() => {
    if (!savedBuild || typeof savedBuild !== "object") return null;

    const savedShopperKey = String(savedBuild?.shopperKey || "").trim();
    const savedSignature = String(savedBuild?.assessmentSignature || "").trim();

    if (savedShopperKey && savedShopperKey !== shopperKey) return null;
    if (!isLegacyEmbeddedEssentialsBuild) {
      if (savedSignature && savedSignature !== assessmentSignature) return null;
      if (!savedSignature && assessmentSignature) return null;
    }

    return savedBuild;
  }, [savedBuild, shopperKey, assessmentSignature, isLegacyEmbeddedEssentialsBuild]);
  const defaults = useMemo(
    () => buildDefaultSelections({ assessment, pod, supportsSplitMotion, isDualComfort, activeJourneyConfiguration }),
    [assessment, pod, supportsSplitMotion, isDualComfort, activeJourneyConfiguration]
  );
  const initialSelections = useMemo(
    () => sanitizeSelections(compatibleSavedBuild, defaults, supportsSplitMotion, isDualComfort),
    [compatibleSavedBuild, defaults, supportsSplitMotion, isDualComfort]
  );
  const cartMattressSize = useMemo(
    () => resolveMattressSizeFromCart({
      cartItems,
      mattressProduct,
      mattressHandle: fixedMattressHandle,
    }),
    [cartItems, fixedMattressHandle, mattressProduct]
  );

  const [size, setSize] = useState(
    isLegacyEmbeddedEssentialsBuild ? initialSelections.size : cartMattressSize || initialSelections.size
  );
  const [baseType, setBaseType] = useState(initialSelections.baseType);
  const [motionType, setMotionType] = useState(initialSelections.motionType);
  const [dcLeft, setDcLeft] = useState(initialSelections.dcLeft);
  const [dcRight, setDcRight] = useState(initialSelections.dcRight);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [cartError, setCartError] = useState("");
  const [confirmationKey, setConfirmationKey] = useState("");
  const autoAdvanceTimerRef = useRef(null);

  const showMotion = baseType === "adjustable";
  const wantsBase = baseType !== "none";
  const steps = useMemo(
    () => {
      const metadata = {
        size: { label: "Size", icon: Ruler },
        base: { label: "Base", icon: BedDouble },
        motion: { label: "Motion", icon: SlidersHorizontal },
        comfort: { label: "Comfort", icon: Sparkles },
        review: { label: "Review", icon: CheckCircle2 },
        success: { label: "Added", icon: CheckCircle2 },
      };
      return resolveCoreBuildStepKeys({ showMotion, isDualComfort }).map((key) => ({ key, ...metadata[key] }));
    },
    [showMotion, isDualComfort]
  );

  const requestedNormalizedStepKey = useMemo(
    () => normalizeCoreBuildStepCandidate(requestedStepKey),
    [requestedStepKey]
  );
  const isLayoutSeededStep = Boolean(requestedNormalizedStepKey && requestedNormalizedStepKey !== "size");

  const [stepKey, setStepKey] = useState(() => {
    if (steps.some((step) => step.key === requestedNormalizedStepKey)) {
      return requestedNormalizedStepKey;
    }

    const candidate = normalizeCoreBuildStepCandidate(compatibleSavedBuild?.stepKey);
    return steps.some((step) => step.key === candidate) ? candidate : "size";
  });
  const appliedRequestedStepRef = useRef(requestedNormalizedStepKey || "size");
  const [confirmedSelections, setConfirmedSelections] = useState(() => {
    const savedConfirmed =
      compatibleSavedBuild?.confirmed && typeof compatibleSavedBuild.confirmed === "object"
        ? compatibleSavedBuild.confirmed
        : {};

    return {
      size: Boolean(
        (!isLegacyEmbeddedEssentialsBuild && cartMattressSize) ||
        savedConfirmed.size ||
        compatibleSavedBuild?.sizeConfirmed ||
        isLayoutSeededStep
      ),
      base: Boolean(savedConfirmed.base || isLayoutSeededStep),
      motion: Boolean(savedConfirmed.motion || isLayoutSeededStep),
      comfortLeft: Boolean(savedConfirmed.comfortLeft || isLayoutSeededStep),
      comfortRight: Boolean(savedConfirmed.comfortRight || isLayoutSeededStep),
    };
  });

  useEffect(() => {
    if (!cartMattressSize || isLegacyEmbeddedEssentialsBuild) return;
    setSize((current) => current === cartMattressSize ? current : cartMattressSize);
    setConfirmedSelections((current) => current.size ? current : { ...current, size: true });
  }, [cartMattressSize, isLegacyEmbeddedEssentialsBuild]);

  const motionAvailability = useMemo(
    () => motionAvailabilityForSelection(size, isDualComfort),
    [size, isDualComfort]
  );
  const allowedMotion = useMemo(
    () => allowedMotionTypesForSelection(size, isDualComfort),
    [size, isDualComfort]
  );

  useEffect(() => {
    if (!showMotion && motionType !== "standard") {
      setMotionType("standard");
    }
  }, [showMotion, motionType]);

  useEffect(() => {
    if (showMotion && !allowedMotion.includes(motionType)) {
      setMotionType(allowedMotion[0] || "standard");
    }
  }, [showMotion, allowedMotion, motionType]);

  useEffect(() => () => {
    if (autoAdvanceTimerRef.current) window.clearTimeout(autoAdvanceTimerRef.current);
  }, []);

  useEffect(() => {
    if (requestedNormalizedStepKey !== "motion") return;
    if (baseType === "adjustable") return;
    setBaseType("adjustable");
  }, [requestedNormalizedStepKey, baseType]);

  useEffect(() => {
    if (steps.some((step) => step.key === stepKey)) return;
    if (stepKey === "motion") {
      setStepKey("base");
      return;
    }
    if (stepKey === "comfort") {
      setStepKey("review");
      return;
    }
    setStepKey("size");
  }, [steps, stepKey]);

  useEffect(() => {
    if (!requestedNormalizedStepKey) return;
    if (appliedRequestedStepRef.current === requestedNormalizedStepKey) return;
    appliedRequestedStepRef.current = requestedNormalizedStepKey;
    if (!steps.some((step) => step.key === requestedNormalizedStepKey)) return;
    if (requestedNormalizedStepKey === stepKey) return;
    setStepKey(requestedNormalizedStepKey);
  }, [requestedNormalizedStepKey, stepKey, steps]);

  useEffect(() => {
    onBuildStepChange?.(stepKey);
  }, [stepKey, onBuildStepChange]);

  const selectedBaseHandle = useMemo(
    () => (baseType === "none" ? null : getBaseHandleForType(baseType) || null),
    [baseType]
  );

  useEffect(() => {
    onSelectionHandlesChange?.({
      mattressHandle: fixedMattressHandle,
      baseHandle: selectedBaseHandle,
    });
  }, [onSelectionHandlesChange, fixedMattressHandle, selectedBaseHandle]);

  useEffect(() => {
    writeSavedBuild(pod, {
      size,
      baseType,
      motionType,
      dcLeft,
      dcRight,
      stepKey,
      confirmed: confirmedSelections,
      shopperKey,
      assessmentSignature,
    });
  }, [
    pod,
    size,
    baseType,
    motionType,
    dcLeft,
    dcRight,
    stepKey,
    confirmedSelections,
    shopperKey,
    assessmentSignature,
  ]);

  const configuredMotionType = showMotion ? motionType : "standard";
  const mattressResolution = useMemo(
    () =>
      resolveApprovedVariant({
        product: mattressProduct,
        category: "mattress",
        setupSize: size,
        motionType: configuredMotionType,
      }),
    [configuredMotionType, mattressProduct, size]
  );
  const baseResolution = useMemo(
    () =>
      wantsBase
        ? resolveApprovedVariant({
            product: baseProduct,
            category: baseType === "adjustable" ? "adjustable_base" : "base",
            setupSize: size,
            motionType: configuredMotionType,
          })
        : { ok: true, variant: null, variantId: null, actualOption: "" },
    [baseProduct, baseType, configuredMotionType, size, wantsBase]
  );
  const mattressVariant = mattressResolution.ok ? mattressResolution.variant : null;
  const baseVariant = baseResolution.ok ? baseResolution.variant : null;
  const mattressMerchId = useMemo(() => safeVariantId(mattressVariant), [mattressVariant]);
  const baseMerchId = useMemo(() => safeVariantId(baseVariant), [baseVariant]);
  const mattressPrice = useMemo(() => parseVariantPrice(mattressVariant), [mattressVariant]);
  const basePrice = useMemo(() => parseVariantPrice(baseVariant), [baseVariant]);
  const previewTotal = useMemo(
    () => mattressPrice + (wantsBase ? basePrice : 0),
    [mattressPrice, basePrice, wantsBase]
  );
  const monthly = useMemo(() => monthlyEstimate(previewTotal), [previewTotal]);
  const sizeConfirmed = Boolean(confirmedSelections.size);
  const baseConfirmed = Boolean(confirmedSelections.base);
  const motionConfirmed = !showMotion || Boolean(confirmedSelections.motion);
  const comfortConfirmed =
    !isDualComfort || Boolean(confirmedSelections.comfortLeft && confirmedSelections.comfortRight);
  const requiredSelectionsConfirmed =
    sizeConfirmed && baseConfirmed && motionConfirmed && comfortConfirmed;

  const selectedBaseLabel =
    baseType === "none" ? "Mattress Only" : labelFor(BASE_OPTIONS_UI, baseType, "Mattress Only");
  const selectedMotionLabel = titleForMotion(motionType);
  const mattressLabel = mattressProduct?.title || pod?.displayMattress || pod?.subtitle || "Mattress";
  const podLabel = useMemo(() => podLabelFor(pod), [pod]);
  const availableMotionLabel = useMemo(
    () => allowedMotion.map((value) => titleForMotion(value)).join(", "),
    [allowedMotion]
  );
  const currentStepIndex = Math.max(0, steps.findIndex((step) => step.key === stepKey));
  const nextStep = steps[currentStepIndex + 1] || null;
  const canGoBack = currentStepIndex > 0;
  const mattressImage = pickFeaturedImage(mattressProduct);
  const selectedBaseImage = pickFeaturedImage(baseProduct);
  const mattressCommerceReady = Boolean(mattressMerchId);
  const baseCommerceReady = !wantsBase || Boolean(baseMerchId);
  const commerceReady = mattressCommerceReady && baseCommerceReady;
  const commerceUnavailableMessage = useMemo(() => {
    if (!requiredSelectionsConfirmed) return "";
    if (!mattressCommerceReady) {
      return `The required ${mattressResolution.requestedOption || size} mattress option is unavailable. Your selections are saved so you can choose another size or pod.`;
    }
    if (!baseCommerceReady) {
      return `The required ${baseResolution.requestedOption || size} base option is unavailable. Your selections are saved so you can choose another base or size.`;
    }
    return "";
  }, [
    baseCommerceReady,
    baseResolution.requestedOption,
    mattressCommerceReady,
    mattressResolution.requestedOption,
    requiredSelectionsConfirmed,
    size,
  ]);

  useEffect(() => {
    if (!requiredSelectionsConfirmed) return;
    for (const rejection of [
      !mattressResolution.ok
        ? { handle: fixedMattressHandle, category: "mattress", ...mattressResolution }
        : null,
      wantsBase && !baseResolution.ok
        ? { handle: selectedBaseHandle, category: "base", ...baseResolution }
        : null,
    ].filter(Boolean)) {
      console.warn("[commerce]", {
        event: "variant_resolution_rejected",
        handle: rejection.handle || "unknown",
        category: rejection.category,
        requestedOption: rejection.requestedOption,
        availableOptions: rejection.availableOptions,
        reason: rejection.reason,
      });
    }
  }, [
    baseResolution,
    fixedMattressHandle,
    mattressResolution,
    requiredSelectionsConfirmed,
    selectedBaseHandle,
    wantsBase,
  ]);
  const canAdd =
    requiredSelectionsConfirmed &&
    commerceReady &&
    (!isDualComfort || Boolean(dcLeft && dcRight));
  const desiredCartSpecs = useMemo(() => {
    if (!mattressMerchId) return [];
    const podIdValue = String(pod?.podId ?? pod?.id ?? "").trim();
    const specs = [
      {
        key: "mattress",
        handle: fixedMattressHandle,
        line: {
          merchandiseId: mattressMerchId,
          quantity: 1,
          attributes: [
            { key: "Size", value: mattressResolution.actualOption },
            { key: "_Setup Size", value: size },
            { key: "_Variant Option", value: mattressResolution.actualOption },
            { key: "_Mattress", value: mattressLabel },
            ...(showMotion ? [{ key: "Motion", value: selectedMotionLabel }] : []),
            ...(isDualComfort
              ? [
                  { key: "Left Feel", value: dcLeft },
                  { key: "Right Feel", value: dcRight },
                ]
              : []),
            ...(podIdValue ? [{ key: "_SnoozePod", value: `SnoozePod ${podIdValue}` }] : []),
          ],
        },
      },
    ];

    if (wantsBase && baseMerchId) {
      specs.push({
        key: "base",
        handle: selectedBaseHandle,
        line: {
          merchandiseId: baseMerchId,
          quantity: 1,
          attributes: [
            { key: "Size", value: baseResolution.actualOption },
            { key: "_Setup Size", value: size },
            { key: "_Variant Option", value: baseResolution.actualOption },
            { key: "_Base", value: selectedBaseLabel },
            ...(showMotion ? [{ key: "Motion", value: selectedMotionLabel }] : []),
            ...(podIdValue ? [{ key: "_SnoozePod", value: `SnoozePod ${podIdValue}` }] : []),
          ],
        },
      });
    }

    return specs;
  }, [
    baseMerchId,
    baseResolution.actualOption,
    dcLeft,
    dcRight,
    fixedMattressHandle,
    isDualComfort,
    mattressLabel,
    mattressMerchId,
    mattressResolution.actualOption,
    pod?.id,
    pod?.podId,
    selectedBaseHandle,
    selectedBaseLabel,
    selectedMotionLabel,
    showMotion,
    size,
    wantsBase,
  ]);
  const desiredCartState = useMemo(
    () => classifyCoreCartState(cartItems, desiredCartSpecs),
    [cartItems, desiredCartSpecs]
  );
  const reviewCartCtaLabel =
    desiredCartState === "exact"
      ? "Continue to Cart"
      : desiredCartState === "partial"
        ? "Add Missing Items / Update Cart"
        : primaryCtaLabel;
  const selectionSummary = useMemo(
    () => [
      `Mattress: ${mattressLabel}`,
      `Base: ${selectedBaseLabel}`,
      `Size: ${size || "Not selected"}`,
      showMotion ? `Motion: ${selectedMotionLabel}` : "",
      isDualComfort ? `Comfort: ${dcLeft || "Not selected"} / ${dcRight || "Not selected"}` : "",
    ].filter(Boolean),
    [
      mattressLabel,
      selectedBaseLabel,
      size,
      showMotion,
      selectedMotionLabel,
      isDualComfort,
      dcLeft,
      dcRight,
    ]
  );
  const coreReviewRows = useMemo(
    () => [
      {
        label: "Mattress",
        value: isDualComfort
          ? `${mattressLabel} · ${dcLeft || "Left"} / ${dcRight || "Right"}`
          : mattressLabel,
        price: mattressPrice,
      },
      { label: "Size", value: size || "Not selected", price: null },
      {
        label: "Base",
        value: selectedBaseLabel,
        price: wantsBase ? basePrice : null,
      },
      {
        label: "Motion",
        value: showMotion ? selectedMotionLabel : "Not included",
        price: null,
      },
    ],
    [
      basePrice,
      dcLeft,
      dcRight,
      isDualComfort,
      mattressLabel,
      mattressPrice,
      selectedBaseLabel,
      selectedMotionLabel,
      showMotion,
      size,
      wantsBase,
    ]
  );
  const successSummaryRows = useMemo(
    () => [
      { label: "Mattress", value: mattressLabel },
      { label: "Core setup", value: `${size || "No size"} · ${selectedBaseLabel}` },
      {
        label: "Motion",
        value: showMotion ? selectedMotionLabel : "Not included",
      },
    ],
    [
      mattressLabel,
      selectedBaseLabel,
      selectedMotionLabel,
      showMotion,
      size,
    ]
  );
  const sizeReady = Boolean(size && sizeConfirmed);
  const baseReady = Boolean(baseType && baseConfirmed);
  const motionReady = Boolean(motionConfirmed && motionType);
  const comfortReady = Boolean(comfortConfirmed && (!isDualComfort || (dcLeft && dcRight)));
  const currentStepMeta = useMemo(() => {
    if (stepKey === "size") {
      return {
        title: "Choose your mattress size.",
        description: "Queen is most popular, but nothing is selected until you tap.",
      };
    }
    if (stepKey === "base") {
      return {
        title: "Choose your base.",
        description: "Pick mattress only or the foundation for this setup.",
      };
    }
    if (stepKey === "motion") {
      return {
        title: "Choose motion style.",
        description: `${availableMotionLabel} available for ${size}.`,
      };
    }
    if (stepKey === "comfort") {
      return {
        title: "Choose each side's comfort.",
        description: "Pick the left feel, then the right feel.",
      };
    }
    if (stepKey === "success") {
      return {
        title: "Your setup is in the cart.",
        description: "",
      };
    }
    return {
      title: "Review Your SnoozePod",
      description: commerceUnavailableMessage || "Confirm your setup before adding it to the cart.",
    };
  }, [stepKey, size, availableMotionLabel, commerceUnavailableMessage]);
  const canProceed =
    stepKey === "size"
      ? sizeReady
      : stepKey === "base"
        ? baseReady
        : stepKey === "motion"
          ? motionReady
          : stepKey === "comfort"
            ? comfortReady
            : stepKey === "success"
              ? true
              : canAdd;

  useEffect(() => {
    if (!onPreviewChange) return;

    const preview = (() => {
      if (stepKey === "size") {
        return {
          title: size ? `${size} setup` : "Choose your size",
          caption: size ? `Selected size: ${size}.` : "Choose a size to begin.",
          items: [
            size ? `Size: ${size}` : "Choose a size to begin.",
            size ? subtitleForSize(size) : "",
            size && allowedMotion.length
              ? `Adjustable Base unlocks: ${availableMotionLabel}.`
              : "",
          ].filter(Boolean),
          nextAction: "Next: Choose your base",
        };
      }

      if (stepKey === "base") {
        return {
          title: selectedBaseLabel,
          caption: wantsBase
            ? `${selectedBaseLabel} is selected for this setup.`
            : "Mattress only is selected right now.",
          items: [
            `Base: ${selectedBaseLabel}`,
            showMotion ? `Motion: ${selectedMotionLabel}` : "",
            size ? `Size: ${size}` : "",
            size && showMotion ? `Available motion for ${size}: ${availableMotionLabel}.` : "",
          ].filter(Boolean),
          nextAction: "Next: Review your setup",
        };
      }

      if (stepKey === "motion") {
        return {
          title: selectedMotionLabel,
          caption: "Choose how the adjustable base should move.",
          items: [
            `Motion: ${selectedMotionLabel}`,
            `Available motion for ${size}: ${availableMotionLabel}.`,
            `Base: ${selectedBaseLabel}`,
          ].filter(Boolean),
          nextAction: isDualComfort ? "Next: Choose comfort sides" : "Next: Review your setup",
        };
      }

      if (stepKey === "comfort") {
        return {
          title: "Dual Comfort",
          caption: "Choose the feel on each side before review.",
          items: [`Left side: ${dcLeft}`, `Right side: ${dcRight}`].filter(Boolean),
          nextAction: "Next: Review your setup",
        };
      }

      if (stepKey === "success") {
        return {
          title: "Added to cart",
          caption: "This setup has been added to the shared showroom cart.",
          items: selectionSummary,
          nextAction: "Open cart",
        };
      }

      return {
        title: `Review ${podLabel}`,
        caption: "Ready to review this setup before you add it to cart.",
        items: [
          ...selectionSummary,
          commerceReady ? `Estimated monthly: ${money(monthly)}/mo` : "Availability: not ready to add",
          commerceReady ? `Estimated total: ${money(previewTotal)}` : commerceUnavailableMessage,
        ],
        nextAction: primaryCtaLabel,
      };
    })();

    onPreviewChange(preview);
  }, [
    onPreviewChange,
    stepKey,
    size,
    availableMotionLabel,
    allowedMotion.length,
    selectedBaseLabel,
    wantsBase,
    showMotion,
    selectedMotionLabel,
    isDualComfort,
    dcLeft,
    dcRight,
    podLabel,
    mattressLabel,
    monthly,
    previewTotal,
    primaryCtaLabel,
    selectionSummary,
    mattressMerchId,
    commerceReady,
    commerceUnavailableMessage,
  ]);

  useEffect(() => {
    if (!onStateChange) return;

    onStateChange({
      podLabel,
      stepKey,
      size,
      baseType,
      motionType,
      dcLeft,
      dcRight,
      mattressLabel,
      fixedMattressHandle,
      selectedBaseHandle,
      selectedBaseLabel,
      selectedMotionLabel,
      sizeSubtitle: subtitleForSize(size),
      baseSubtitle: subtitleForBase(baseType),
      mattressImage,
      baseImage: selectedBaseImage,
      wantsBase,
      showMotion,
      isDualComfort,
      canProceed,
      canAdd,
      commerceReady,
      commerceUnavailableMessage,
      monthly,
      previewTotal,
    });
  }, [
    onStateChange,
    podLabel,
    stepKey,
    size,
    baseType,
    motionType,
    dcLeft,
    dcRight,
    mattressLabel,
    fixedMattressHandle,
    selectedBaseHandle,
    selectedBaseLabel,
    selectedMotionLabel,
    mattressImage,
    selectedBaseImage,
    wantsBase,
    showMotion,
    isDualComfort,
    canProceed,
    canAdd,
    commerceReady,
    commerceUnavailableMessage,
    monthly,
    previewTotal,
  ]);

  const setGuidedStep = useCallback(
    (nextKey, cue) => {
      if (!nextKey) return;
      setStepKey(nextKey);
      if (cue) onCue?.(cue, "tip");
    },
    [onCue]
  );

  const queueSelectionAdvance = useCallback(
    (confirmKey, nextKey, cue) => {
      setCartError("");
      setConfirmationKey(confirmKey);
      if (autoAdvanceTimerRef.current) window.clearTimeout(autoAdvanceTimerRef.current);

      const reduceMotion =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      const delay = reduceMotion ? 0 : 260;

      autoAdvanceTimerRef.current = window.setTimeout(() => {
        setConfirmationKey("");
        setGuidedStep(nextKey, cue);
      }, delay);
    },
    [setGuidedStep]
  );

  const goNext = useCallback(() => {
    if (!canProceed) return;
    if (stepKey === "review") {
      addToPlan();
      return;
    }
    if (!nextStep || nextStep.key === "success") return;
    setGuidedStep(
      nextStep.key,
      nextStep.key === "review" ? "Take one last look before you add it to cart." : ""
    );
  }, [nextStep, canProceed, setGuidedStep, stepKey]);

  const goBack = useCallback(() => {
    if (!canGoBack) return;
    setConfirmationKey("");
    setStepKey(steps[currentStepIndex - 1].key);
  }, [canGoBack, currentStepIndex, steps]);

  const resetBuild = useCallback(() => {
    setSize(defaults.size);
    setBaseType(defaults.baseType);
    setMotionType(defaults.motionType);
    setDcLeft(defaults.dcLeft);
    setDcRight(defaults.dcRight);
    setStepKey("size");
    setConfirmationKey("");
    setConfirmedSelections({
      size: false,
      base: false,
      motion: false,
      comfortLeft: false,
      comfortRight: false,
    });
    onCue?.("Your setup has been reset.", "tip");
  }, [defaults, onCue]);

  const addToPlan = useCallback(async () => {
    if (isAddingToCart) return;

    if (!canAdd) {
      const message =
        commerceUnavailableMessage ||
        "Complete each required selection before adding this setup.";
      setCartError(message);
      onCue?.(message, "warning");
      return;
    }

    if (desiredCartState === "exact") {
      onCue?.("Your selected setup is already in your cart.", "tip");
      onViewSnoozePod?.();
      return;
    }

    setCartError("");
    setIsAddingToCart(true);

    try {
      const synced = await syncCartFromShopify?.({ sourcePage: "pod-build-review" });
      const authoritativeCart = Array.isArray(synced?.items)
        ? synced.items
        : useStore.getState().cart || [];
      await synchronizeCoreCartLines({
        cartItems: authoritativeCart,
        specs: desiredCartSpecs,
        removeLine: (lineId) => removeFromCart?.(lineId),
        updateLine: (lineId, quantity) => updateCart?.(lineId, quantity),
        addLines: (lines) => addLinesToAuthoritativeCart?.({
          lines,
          sourcePage: "pod-build-review",
        }),
      });
      setGuidedStep("success");
      onCue?.("Your selected setup is now correct in your cart.", "success");
    } catch (err) {
      const errorCode = err?.code || err?.name || err?.status || "CART_MUTATION_FAILED";
      console.warn("[cart] pod build add failed", {
        operation: "cart_line_add",
        sourcePage: "pod-build-review",
        requestedLineCount: desiredCartSpecs.length,
        mattressMerchId,
        baseMerchId: wantsBase ? baseMerchId : null,
        errorCode,
      });
      const message =
        "We couldn't add that setup. Your selections are still here so you can try again.";
      setCartError(message);
      onCue?.(message, "warning");
    } finally {
      setIsAddingToCart(false);
    }
  }, [
    addLinesToAuthoritativeCart,
    removeFromCart,
    syncCartFromShopify,
    updateCart,
    baseMerchId,
    canAdd,
    commerceUnavailableMessage,
    desiredCartSpecs,
    desiredCartState,
    isAddingToCart,
    mattressMerchId,
    onCue,
    onViewSnoozePod,
    setGuidedStep,
    wantsBase,
  ]);

  const viewCart = useCallback(() => {
    onCue?.("Opening your cart.", "tip");
    onViewSnoozePod?.();
  }, [onCue, onViewSnoozePod]);

  const nextAfterSize = "base";
  const nextAfterBase = showMotion ? "motion" : isDualComfort ? "comfort" : "review";
  const nextAfterMotion = isDualComfort ? "comfort" : "review";
  const visibleProgressSteps = steps.filter((step) => step.key !== "success" || stepKey === "success");
  const isStepComplete = useCallback(
    (key) => {
      if (key === "size") return sizeReady;
      if (key === "base") return baseReady;
      if (key === "motion") return motionReady;
      if (key === "comfort") return comfortReady;
      if (key === "review") return stepKey === "success";
      if (key === "success") return stepKey === "success";
      return false;
    },
    [
      baseReady,
      comfortReady,
      motionReady,
      sizeReady,
      stepKey,
    ]
  );
  const canVisitStep = useCallback(
    (key) => key === stepKey || isStepComplete(key) || key === "size",
    [isStepComplete, stepKey]
  );

  const renderStageControls = ({
    primaryLabel = nextStep ? `Continue to ${nextStep.label}` : "Continue",
    onPrimary = goNext,
    primaryDisabled = !canProceed,
    showPrimary = stepKey !== "success",
    secondaryLabel = "",
    onSecondary,
    reserveSpace = false,
  } = {}) => (
    <div
      className={[
        "flex min-h-[52px] items-center justify-between gap-3 border-t border-[#dfe7fb] pt-2",
        reserveSpace ? "shrink-0" : "mt-auto",
      ].join(" ")}
      data-pod-builder-action-row="true"
      data-pod-builder-action-row-reserved={reserveSpace ? "true" : undefined}
    >
      <button
        type="button"
        onClick={goBack}
        disabled={!canGoBack || stepKey === "success"}
        className={[
          "inline-flex min-h-[44px] items-center justify-center rounded-[12px] border px-4 text-[0.84rem] font-black transition",
          !canGoBack || stepKey === "success"
            ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300"
            : "border-[#dfe7fb] bg-white text-slate-800 hover:border-[#315cf6]",
        ].join(" ")}
      >
        Back
      </button>

      <div className="flex items-center gap-2">
        {secondaryLabel && onSecondary ? (
          <button
            type="button"
            onClick={onSecondary}
            className="inline-flex min-h-[44px] items-center justify-center rounded-[12px] px-4 text-[0.84rem] font-black text-[#315cf6]"
          >
            {secondaryLabel}
          </button>
        ) : null}
        {showPrimary ? (
          <Button
            type="button"
            onClick={onPrimary}
            disabled={primaryDisabled}
            data-pod-layout-build-action={stepKey === "review" ? "true" : undefined}
            data-pod-layout-primary-action={stepKey === "review" ? "build-add" : "build-next"}
            className="min-h-[48px] min-w-[190px] rounded-[14px] px-5 text-[0.9rem] font-black"
          >
            <span>{primaryLabel}</span>
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );

  const renderCurrentStep = () => {
    if (stepKey === "size") {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {SIZE_OPTIONS.map((option) => (
              <GuidedChoiceButton
                key={option}
                title={option}
                subtitle={VERIFIED_SIZE_DIMENSIONS[option] || subtitleForSize(option)}
                visual={<SizeDiagram size={option} />}
                badge={option === "Queen" && !sizeConfirmed ? "Most Popular" : ""}
                active={sizeConfirmed && size === option}
                confirming={confirmationKey === `size:${option}`}
                onClick={() => {
                  setSize(option);
                  setConfirmedSelections((current) => ({
                    ...current,
                    size: true,
                    motion: current.motion && allowedMotionTypesForSelection(option, isDualComfort).includes(motionType),
                  }));
                  queueSelectionAdvance(`size:${option}`, nextAfterSize, "Choose your base next.");
                }}
              />
            ))}
          </div>
          {renderStageControls({
            primaryLabel: "Continue to Base",
            onPrimary: () => setGuidedStep(nextAfterSize, "Choose your base next."),
            primaryDisabled: !sizeReady,
          })}
        </div>
      );
    }

    if (stepKey === "base") {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {BASE_OPTIONS_UI.map((option) => (
              <GuidedChoiceButton
                key={option.value}
                title={option.value === "none" ? "Mattress Only" : option.label}
                subtitle={subtitleForBase(option.value)}
                active={baseConfirmed && baseType === option.value}
                confirming={confirmationKey === `base:${option.value}`}
                onClick={() => {
                  setBaseType(option.value);
                  setConfirmedSelections((current) => ({
                    ...current,
                    base: true,
                    motion: option.value === "adjustable" ? false : current.motion,
                  }));
                  const nextKey =
                    option.value === "adjustable"
                      ? "motion"
                      : isDualComfort
                        ? "comfort"
                        : "review";
                  queueSelectionAdvance(
                    `base:${option.value}`,
                    nextKey,
                    option.value === "adjustable"
                      ? "Adjustable base selected. Choose your motion style next."
                      : isDualComfort
                        ? "Choose each side's comfort next."
                        : "Review your setup next."
                  );
                }}
              />
            ))}
          </div>
          {renderStageControls({
            primaryLabel: `Continue to ${steps.find((step) => step.key === nextAfterBase)?.label || "Review"}`,
            onPrimary: () => setGuidedStep(nextAfterBase, "Keep building this setup."),
            primaryDisabled: !baseReady,
          })}
        </div>
      );
    }

    if (stepKey === "motion") {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="grid gap-2.5 lg:grid-cols-3">
            {MOTION_TYPES_UI.map((option) => {
              const allowed = Boolean(motionAvailability[option.value]);
              return (
                <GuidedChoiceButton
                  key={option.value}
                  title={titleForMotion(option.value)}
                  subtitle={
                    allowed
                      ? subtitleForMotion(option.value)
                      : disabledReasonForMotion(option.value, size, isDualComfort)
                  }
                  active={confirmedSelections.motion && motionType === option.value}
                  confirming={confirmationKey === `motion:${option.value}`}
                  disabled={!allowed}
                  visual={(
                    <img
                      src={APPROVED_MOTION_VISUALS[option.value]}
                      alt=""
                      className="h-12 w-20 shrink-0 rounded-[10px] bg-white object-contain"
                    />
                  )}
                  onClick={() => {
                    if (!allowed) return;
                    setMotionType(option.value);
                    setConfirmedSelections((current) => ({
                      ...current,
                      motion: true,
                    }));
                    queueSelectionAdvance(
                      `motion:${option.value}`,
                      nextAfterMotion,
                      nextAfterMotion === "comfort"
                        ? "Now choose each side's comfort."
                        : "Review your setup next."
                    );
                  }}
                />
              );
            })}
          </div>
          {renderStageControls({
            primaryLabel: `Continue to ${steps.find((step) => step.key === nextAfterMotion)?.label || "Review"}`,
            onPrimary: () => setGuidedStep(nextAfterMotion, "Keep building this setup."),
            primaryDisabled: !motionReady,
          })}
        </div>
      );
    }

    if (stepKey === "comfort") {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-[18px] border border-[#dfe7fb] bg-white/96 p-3 shadow-sm">
              <div className="text-[0.7rem] font-black uppercase tracking-[0.16em] text-slate-500">
                Left Side
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {DUAL_COMFORT_OPTIONS.map((option) => (
                  <GuidedChoiceButton
                    key={`left-${option}`}
                    title={option}
                    active={confirmedSelections.comfortLeft && dcLeft === option}
                    confirming={confirmationKey === `left:${option}`}
                    onClick={() => {
                      setDcLeft(option);
                      const shouldAdvance = confirmedSelections.comfortRight && dcRight;
                      setConfirmedSelections((current) => ({
                        ...current,
                        comfortLeft: true,
                      }));
                      if (shouldAdvance) {
                        queueSelectionAdvance(
                          `left:${option}`,
                          "review",
                          "Review your setup next."
                        );
                      }
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="rounded-[18px] border border-[#dfe7fb] bg-white/96 p-3 shadow-sm">
              <div className="text-[0.7rem] font-black uppercase tracking-[0.16em] text-slate-500">
                Right Side
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {DUAL_COMFORT_OPTIONS.map((option) => (
                  <GuidedChoiceButton
                    key={`right-${option}`}
                    title={option}
                    active={confirmedSelections.comfortRight && dcRight === option}
                    confirming={confirmationKey === `right:${option}`}
                    onClick={() => {
                      setDcRight(option);
                      const shouldAdvance = confirmedSelections.comfortLeft && dcLeft;
                      setConfirmedSelections((current) => ({
                        ...current,
                        comfortRight: true,
                      }));
                      if (shouldAdvance) {
                        queueSelectionAdvance(
                          `right:${option}`,
                          "review",
                          "Review your setup next."
                        );
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
          {renderStageControls({
            primaryLabel: "Continue to Review",
            onPrimary: () => setGuidedStep("review", "Review your setup next."),
            primaryDisabled: !comfortReady,
          })}
        </div>
      );
    }

    if (stepKey === "success") {
      return (
        <div
          className="grid h-full min-h-0 gap-3 rounded-[22px] border border-[#dfe7fb] bg-[linear-gradient(145deg,#f7faff,#ffffff)] p-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.95fr)]"
          data-pod-builder-success-layout="balanced"
        >
          <div className="flex min-h-0 flex-col gap-2">
            <div
              className="flex min-h-[88px] shrink-0 items-center gap-4 rounded-[18px] border border-emerald-200 bg-emerald-50/80 px-5 py-3"
              data-pod-builder-success-banner="true"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <div className="text-[clamp(1.35rem,2vw,1.75rem)] font-black tracking-tight text-slate-950">
                  Your setup is in the cart.
                </div>
                <p className="mt-1 text-[0.82rem] font-semibold leading-snug text-slate-600">
                  Review your selections, then continue when you are ready.
                </p>
              </div>
            </div>
            <div
              className="grid min-h-0 flex-1 content-center gap-2 sm:grid-cols-2"
              data-pod-builder-success-summary="true"
            >
              {successSummaryRows.map((item) => (
                <div
                  key={item.label}
                  className="flex min-h-[58px] min-w-0 items-center gap-2.5 rounded-[14px] border border-[#dfe7fb] bg-white px-3.5 py-2"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#315cf6]" />
                  <div className="min-w-0 leading-tight">
                    <div className="text-[0.56rem] font-black uppercase tracking-[0.1em] text-slate-500">
                      {item.label}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[0.76rem] font-bold leading-tight text-slate-900">{item.value}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div
            className="flex min-h-0 flex-col justify-center gap-3 rounded-[18px] border border-[#cbd9ff] bg-white p-5 shadow-[0_16px_34px_rgba(49,92,246,0.1)]"
            data-pod-builder-success-actions="true"
          >
            <Button
              type="button"
              onClick={viewCart}
              data-pod-layout-primary-action="build-open-cart"
              className="min-h-[62px] w-full rounded-[16px] px-6 text-[1.05rem] font-black shadow-[0_14px_30px_rgba(49,92,246,0.22)]"
            >
              Open Cart
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <button
              type="button"
              onClick={resetBuild}
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-[14px] border border-[#dfe7fb] bg-[#f8faff] px-4 text-[0.92rem] font-black text-slate-800"
            >
              Build Another
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]" data-pod-builder-review-layout="decision">
        <section className="flex min-h-0 flex-col justify-center rounded-[20px] border border-[#dfe7fb] bg-white p-3 shadow-sm" data-pod-builder-review-summary="true">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[clamp(1.15rem,1.7vw,1.5rem)] font-black tracking-tight text-slate-950">Your SnoozePod</h3>
            <span className="rounded-full bg-[#edf2ff] px-3 py-1 text-[0.7rem] font-black uppercase tracking-[0.12em] text-[#315cf6]">Ready to review</span>
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-2" data-pod-builder-summary-group="core">
            <div className="flex min-w-0 items-center gap-3 rounded-[16px] border border-[#e2e8f7] bg-[#f8faff] p-2.5" data-pod-builder-summary-row="mattress">
              <BuilderMediaPreview src={mattressImage} alt={mattressLabel} icon={BedDouble} className="h-[clamp(52px,8vh,78px)] w-[clamp(72px,9vw,105px)] shrink-0 overflow-hidden rounded-[12px] bg-white" imgClassName="h-full w-full object-contain p-1.5" data-pod-builder-summary-image="core" />
              <div className="min-w-0 flex-1">
                <div className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-[#315cf6]">Mattress</div>
                <div className="mt-0.5 line-clamp-2 text-[clamp(0.9rem,1.15vw,1.05rem)] font-black leading-tight text-slate-950">{mattressLabel}</div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[0.84rem] font-bold text-slate-600"><span>{size}</span><span className="font-black text-slate-950">{mattressPrice > 0 ? money(mattressPrice) : "Unavailable"}</span></div>
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-3 rounded-[16px] border border-[#e2e8f7] bg-[#f8faff] p-2.5" data-pod-builder-summary-row="base-motion">
              <BuilderMediaPreview src={selectedBaseImage} alt={selectedBaseLabel} icon={SlidersHorizontal} className="h-[clamp(52px,8vh,78px)] w-[clamp(72px,9vw,105px)] shrink-0 overflow-hidden rounded-[12px] bg-white" imgClassName="h-full w-full object-contain p-1.5" data-pod-builder-summary-image="core" />
              <div className="min-w-0 flex-1">
                <div className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-[#315cf6]">Base / Motion</div>
                <div className="mt-0.5 line-clamp-2 text-[clamp(0.9rem,1.15vw,1.05rem)] font-black leading-tight text-slate-950">{selectedBaseLabel}</div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[0.82rem] font-bold text-slate-600"><span>{showMotion ? selectedMotionLabel : "No motion"}</span>{wantsBase && basePrice > 0 ? <span className="font-black text-slate-950">{money(basePrice)}</span> : null}</div>
              </div>
            </div>
          </div>

        </section>

        <aside className="flex min-h-0 flex-col justify-center rounded-[20px] border border-[#ccd9ff] bg-[linear-gradient(145deg,#f7f9ff,#ffffff)] p-4 shadow-[0_16px_36px_rgba(49,92,246,0.1)]" data-pod-builder-commerce-summary="true">
          {commerceReady ? (
            <>
              <div className="text-[0.7rem] font-black uppercase tracking-[0.16em] text-slate-500">Est. Monthly</div>
              <div className="mt-0.5 text-[clamp(1.8rem,3.2vw,2.65rem)] font-black leading-none tracking-tight text-[#315cf6]">{money(monthly)}<span className="text-[0.9rem] text-slate-500">/mo</span></div>
              <div className="mt-3 border-t border-[#dfe7fb] pt-3 text-[0.7rem] font-black uppercase tracking-[0.16em] text-slate-500">Est. Total</div>
              <div className="mt-0.5 text-[clamp(1.65rem,2.8vw,2.35rem)] font-black leading-none tracking-tight text-slate-950">{money(previewTotal)}</div>
            </>
          ) : (
            <div className="rounded-[14px] border border-amber-200 bg-amber-50 px-3 py-3 text-[0.86rem] font-semibold leading-snug text-amber-900">{commerceUnavailableMessage || "This setup is not ready to add yet."}</div>
          )}
          {cartError && cartError !== commerceUnavailableMessage ? <div className="mt-3 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2 text-[0.78rem] font-semibold text-amber-900">{cartError}</div> : null}
          <Button type="button" onClick={addToPlan} disabled={!canAdd || isAddingToCart} data-pod-layout-build-action="true" data-pod-layout-primary-action="build-add" className="mt-4 min-h-[54px] w-full rounded-[15px] px-4 text-[0.95rem] font-black">
            {isAddingToCart ? "Updating Cart..." : reviewCartCtaLabel}<ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <button type="button" onClick={goBack} className="mt-2 min-h-[44px] w-full rounded-[12px] text-[0.82rem] font-black text-slate-600">Back to {steps[currentStepIndex - 1]?.label || "Base"}</button>
        </aside>
      </div>
    );
  };

  return (
    <div
      className="flex min-h-0 w-full flex-1 flex-col gap-2"
      data-pod-builder-state={stepKey}
    >
      <div className="flex min-h-0 flex-1 flex-col rounded-[22px] border border-[#dfe7fb] bg-white/96 p-3 shadow-[0_18px_46px_rgba(45,71,136,0.09)]">
        {mattressAlreadyInCart && stepKey !== "success" ? (
          <div className="mb-2 shrink-0 rounded-[14px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-[0.8rem] font-bold text-emerald-800" data-mattress-cart-continuity="true">
            Your mattress is already in your cart — let’s finish your setup.
          </div>
        ) : null}
        <div className="mb-2 flex shrink-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[clamp(1.18rem,1.75vw,1.62rem)] font-black leading-tight tracking-tight text-slate-950">
              {stepKey === "review" ? "Review Your SnoozePod" : "Customize Your SnoozePod"}
            </h2>
            {stepKey !== "review" && stepKey !== "success" ? (
              <div className="mt-0.5 text-[0.76rem] font-black text-[#315cf6]">{currentStepMeta.title}</div>
            ) : null}
          </div>
          {stepKey === "review" ? (
            <p className="max-w-[34rem] text-right text-[clamp(0.74rem,0.9vw,0.84rem)] font-semibold leading-snug text-slate-600" data-pod-builder-review-description="true">
              {currentStepMeta.description}
            </p>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-1" data-pod-builder-step-content="true">{renderCurrentStep()}</div>
      </div>
    </div>
  );
}
