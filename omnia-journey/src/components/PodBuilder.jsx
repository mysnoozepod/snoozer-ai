import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BedDouble,
  CheckCircle2,
  ImageOff,
  Minus,
  PackageCheck,
  Plus,
  Ruler,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import * as api from "@/lib/api";
import {
  buildPodCustomizeReturnPath,
  buildSleepEssentialsPath,
  getSleepEssentialsJourneyId,
} from "@/lib/sleepEssentials";
import { useStore } from "@/lib/useStore";
import { getShopperId } from "@/state/sessionStore";
import { refreshRewardsState } from "@/state/rewardsStore";
import {
  listIndependentPillowChoices,
  resolveApprovedVariant,
} from "@/lib/cart/variantResolution.mjs";
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

const ESSENTIAL_STEP_KEYS = Object.freeze(["pillows", "sheets", "protector"]);
const ESSENTIAL_CARD_KEYS = Object.freeze(["pillows", "sheets", "protector"]);
const CANONICAL_ESSENTIAL_CATEGORY_IDS = Object.freeze({
  pillows: "pillows",
  sheets: "sheets_bedding",
  protector: "protectors",
});
const ESSENTIAL_CATEGORY_CONFIG = Object.freeze({
  pillows: {
    label: "Pillows",
    recommendationLabel: "Recommended Pillow",
    singular: "Pillow",
    max: 3,
  },
  sheets: {
    label: "Sheets",
    recommendationLabel: "Recommended Sheets / Bedding",
    singular: "Sheet set",
    max: 3,
  },
  protector: {
    label: "Mattress Protectors",
    recommendationLabel: "Recommended Mattress Protector",
    singular: "Mattress protector",
    max: 2,
  },
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

function normalizeCartMatchValue(value) {
  return String(value || "").trim().toLowerCase();
}

function cartLineHasDesiredAttributes(item, spec) {
  const current = new Map(
    (Array.isArray(item?.attributes) ? item.attributes : []).map((attribute) => [
      String(attribute?.key || "").trim(),
      String(attribute?.value || "").trim(),
    ])
  );

  return spec.line.attributes.every(
    (attribute) =>
      current.get(String(attribute.key || "").trim()) ===
      String(attribute.value || "").trim()
  );
}

function relatedCartLines(cartItems, spec) {
  const desiredHandle = normalizeCartMatchValue(spec.handle);
  const desiredVariant = String(spec.line.merchandiseId || "").trim();
  return (Array.isArray(cartItems) ? cartItems : []).filter((item) => {
    const itemHandle = normalizeCartMatchValue(item?.handle);
    const itemVariant = String(item?.merchandiseId || "").trim();
    return itemVariant === desiredVariant || (desiredHandle && itemHandle === desiredHandle);
  });
}

function exactCartLines(cartItems, spec) {
  const desiredVariant = String(spec.line.merchandiseId || "").trim();
  return relatedCartLines(cartItems, spec).filter(
    (item) =>
      String(item?.merchandiseId || "").trim() === desiredVariant &&
      cartLineHasDesiredAttributes(item, spec)
  );
}

function classifyDesiredCartState(cartItems, specs) {
  if (!Array.isArray(specs) || !specs.length) return "none";
  let hasRelatedLine = false;

  const exact = specs.every((spec) => {
    const related = relatedCartLines(cartItems, spec);
    const matching = exactCartLines(cartItems, spec);
    if (related.length) hasRelatedLine = true;
    return (
      related.length === 1 &&
      matching.length === 1 &&
      Number(matching[0]?.quantity || 0) === Number(spec.line.quantity || 0)
    );
  });

  if (exact) return "exact";
  return hasRelatedLine ? "partial" : "none";
}

function normalizeSavedEssentials(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    ESSENTIAL_STEP_KEYS.map((key) => {
      const item = source[key];
      if (!item || typeof item !== "object") return [key, null];
      const handle = String(item.handle || "").trim();
      const variantId = String(item.variantId || "").trim();
      if (!handle || !variantId.startsWith("gid://shopify/ProductVariant/")) return [key, null];
      return [
        key,
        {
          handle,
          variantId,
          quantity: key === "pillows" ? Math.min(4, Math.max(1, Number(item.quantity) || 1)) : 1,
        },
      ];
    })
  );
}

function normalizeSavedEssentialSkips(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(ESSENTIAL_STEP_KEYS.map((key) => [key, Boolean(source[key])]));
}

function stripProductCopy(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEssentialChoice(product, variant, actualOption) {
  if (!product || product.available === false || product.availableForSale === false) return null;
  const variantId = safeVariantId(variant);
  if (!variantId) return null;

  const handle = String(product?.handle || "").trim();
  const title = String(product?.title || "").trim();
  if (!handle || !title) return null;

  return {
    handle,
    title,
    description: stripProductCopy(product?.description).split(/(?<=[.!?])\s+/)[0] || "",
    image: pickFeaturedImage(product),
    price: parseVariantPrice(variant),
    variantId,
    variantTitle: String(variant?.title || "").trim(),
    actualOption: String(actualOption || variant?.title || "").trim(),
  };
}

function resolveCuratedSheetVariant(product, size) {
  const requestedSize = String(size || "").trim().toLowerCase();
  if (!requestedSize) return null;

  return normalizeVariants(product).find((variant) => {
    if (!safeVariantId(variant)) return false;
    const selectedValues = Array.isArray(variant?.selectedOptions)
      ? variant.selectedOptions.map((option) => String(option?.value || "").trim().toLowerCase())
      : [];
    if (selectedValues.includes(requestedSize)) return true;

    const title = String(variant?.title || "").trim().toLowerCase();
    return title === requestedSize || title.startsWith(`${requestedSize} /`);
  }) || null;
}

function buildEssentialChoices(products, category, size, motionType) {
  const config = ESSENTIAL_CATEGORY_CONFIG[category];
  if (!config) return [];

  const choices = [];
  for (const product of Array.isArray(products) ? products : []) {
    if (category === "pillows") {
      for (const resolved of listIndependentPillowChoices(product)) {
        const choice = buildEssentialChoice(product, resolved.variant, resolved.actualOption);
        if (choice) choices.push(choice);
      }
      continue;
    }

    const resolution = resolveApprovedVariant({
      product,
      category: category === "protector" ? "protector" : "sheets",
      setupSize: size,
      motionType,
    });
    const curatedSheetVariant =
      category === "sheets" && !resolution.ok
        ? resolveCuratedSheetVariant(product, size)
        : null;
    if (resolution.ok || curatedSheetVariant) {
      const variant = resolution.ok ? resolution.variant : curatedSheetVariant;
      const choice = buildEssentialChoice(
        product,
        variant,
        resolution.ok ? resolution.actualOption : variant?.title
      );
      if (choice) choices.push(choice);
    }
  }
  return choices;
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

export function buildDefaultSelections({ assessment, pod, supportsSplitMotion, isDualComfort }) {
  const context = buildAssessmentPreferenceContext(assessment);
  const sizeFromAssessment = context.size;
  const baseFromAssessment = context.baseType;
  const motionFromAssessment = context.motionType;
  const firmnessFromAssessment = context.firmness;
  const partnerFirmnessFromAssessment = context.partnerFirmness;

  const size = sizeFromAssessment || normalizeSizeChoice(pod?.displayedIn?.size) || "Queen";
  const baseType = baseFromAssessment || inferBaseTypeFromPod(pod) || "none";
  const allowedMotion = allowedMotionTypesForSelection(size, isDualComfort);
  const motionFallback = inferMotionTypeFromPod(pod) || "standard";
  const motionType =
    baseType === "adjustable"
      ? resolveMotionSelection(motionFromAssessment || motionFallback, allowedMotion)
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
      size: sizeFromAssessment ? "assessment" : "pod",
      baseType: baseFromAssessment ? "assessment" : "pod",
      motionType: motionFromAssessment && baseType === "adjustable" ? "assessment" : "pod",
      comfort:
        isDualComfort && (firmnessFromAssessment || partnerFirmnessFromAssessment)
          ? "assessment"
          : "pod",
    },
  };
}

function sanitizeSelections(savedBuild, defaults, supportsSplitMotion, isDualComfort) {
  const size =
    defaults.sources?.size === "assessment"
      ? defaults.size
      : normalizeSizeChoice(savedBuild?.size) || defaults.size;
  const baseType =
    defaults.sources?.baseType === "assessment"
      ? defaults.baseType
      : normalizeBaseTypeChoice(savedBuild?.baseType) || defaults.baseType;
  const allowedMotion = allowedMotionTypesForSelection(size, isDualComfort);
  const motionType =
    baseType === "adjustable"
      ? resolveMotionSelection(
          defaults.sources?.motionType === "assessment"
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
        ? defaults.sources?.comfort === "assessment"
          ? defaults.dcLeft
          : normalizeComfortChoice(savedBuild?.dcLeft) || defaults.dcLeft
        : "",
    dcRight:
      isDualComfort
        ? defaults.sources?.comfort === "assessment"
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

function normalizeBuildStepCandidate(value) {
  const normalized = lower(value);
  if (!normalized) return "";
  if (normalized === "dual") return "comfort";
  if (normalized === "mattress") return "size";
  if (normalized === "pillows" || normalized === "sheets" || normalized === "protector") return "essentials";
  if (
    normalized === "base" ||
    normalized === "size" ||
    normalized === "motion" ||
    normalized === "comfort" ||
    normalized === "essentials" ||
    normalized === "review" ||
    normalized === "success"
  ) {
    return normalized;
  }
  return "";
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
  const navigate = useNavigate();
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
  const sleepEssentialsJourneyId = useMemo(
    () => getSleepEssentialsJourneyId(getShopperId()),
    [shopperKey]
  );
  const canonicalPodId = useMemo(() => {
    const raw = String(pod?.podId ?? pod?.id ?? "").trim().toLowerCase();
    if (/^pod-[1-5]$/.test(raw)) return raw;
    const numeric = raw.replace(/^pod-/, "");
    return /^[1-5]$/.test(numeric) ? `pod-${numeric}` : "";
  }, [pod?.id, pod?.podId]);
  const assessmentSignature = useMemo(() => buildAssessmentSignature(assessment), [assessment]);

  const savedBuild = useMemo(() => readSavedBuild(pod), [pod]);
  const compatibleSavedBuild = useMemo(() => {
    if (!savedBuild || typeof savedBuild !== "object") return null;

    const savedShopperKey = String(savedBuild?.shopperKey || "").trim();
    const savedSignature = String(savedBuild?.assessmentSignature || "").trim();

    if (savedShopperKey && savedShopperKey !== shopperKey) return null;
    if (savedSignature && savedSignature !== assessmentSignature) return null;
    if (!savedSignature && assessmentSignature) return null;

    return savedBuild;
  }, [savedBuild, shopperKey, assessmentSignature]);
  const defaults = useMemo(
    () => buildDefaultSelections({ assessment, pod, supportsSplitMotion, isDualComfort }),
    [assessment, pod, supportsSplitMotion, isDualComfort]
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

  const [size, setSize] = useState(cartMattressSize || initialSelections.size);
  const [baseType, setBaseType] = useState(initialSelections.baseType);
  const [motionType, setMotionType] = useState(initialSelections.motionType);
  const [dcLeft, setDcLeft] = useState(initialSelections.dcLeft);
  const [dcRight, setDcRight] = useState(initialSelections.dcRight);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [cartError, setCartError] = useState("");
  const [confirmationKey, setConfirmationKey] = useState("");
  const [essentialProducts, setEssentialProducts] = useState({
    status: "loading",
    itemsByCategory: {},
    error: "",
  });
  const [essentialProgressBusy, setEssentialProgressBusy] = useState("");
  const [selectedEssentials, setSelectedEssentials] = useState(() =>
    normalizeSavedEssentials(compatibleSavedBuild?.selectedEssentials)
  );
  const [skippedEssentials, setSkippedEssentials] = useState(() =>
    normalizeSavedEssentialSkips(compatibleSavedBuild?.skippedEssentials)
  );
  const autoAdvanceTimerRef = useRef(null);

  const showMotion = baseType === "adjustable";
  const wantsBase = baseType !== "none";
  const steps = useMemo(
    () =>
      [
        { key: "size", label: "Size", icon: Ruler },
        { key: "base", label: "Base", icon: BedDouble },
        showMotion ? { key: "motion", label: "Motion", icon: SlidersHorizontal } : null,
        isDualComfort ? { key: "comfort", label: "Comfort", icon: Sparkles } : null,
        { key: "essentials", label: "Essentials", icon: PackageCheck },
        { key: "review", label: "Review", icon: CheckCircle2 },
        { key: "success", label: "Added", icon: CheckCircle2 },
      ].filter(Boolean),
    [showMotion, isDualComfort]
  );

  const requestedNormalizedStepKey = useMemo(
    () => normalizeBuildStepCandidate(requestedStepKey),
    [requestedStepKey]
  );
  const isLayoutSeededStep = Boolean(requestedNormalizedStepKey && requestedNormalizedStepKey !== "size");

  const [stepKey, setStepKey] = useState(() => {
    if (steps.some((step) => step.key === requestedNormalizedStepKey)) {
      return requestedNormalizedStepKey;
    }

    const candidate = normalizeBuildStepCandidate(compatibleSavedBuild?.stepKey);
    if (candidate === "review" && compatibleSavedBuild?.essentialsVersion !== 2) return "essentials";
    return steps.some((step) => step.key === candidate) ? candidate : "size";
  });
  const appliedRequestedStepRef = useRef(requestedNormalizedStepKey || "size");
  const [confirmedSelections, setConfirmedSelections] = useState(() => {
    const savedConfirmed =
      compatibleSavedBuild?.confirmed && typeof compatibleSavedBuild.confirmed === "object"
        ? compatibleSavedBuild.confirmed
        : {};

    return {
      size: Boolean(cartMattressSize || savedConfirmed.size || compatibleSavedBuild?.sizeConfirmed || isLayoutSeededStep),
      base: Boolean(savedConfirmed.base || isLayoutSeededStep),
      motion: Boolean(savedConfirmed.motion || isLayoutSeededStep),
      comfortLeft: Boolean(savedConfirmed.comfortLeft || isLayoutSeededStep),
      comfortRight: Boolean(savedConfirmed.comfortRight || isLayoutSeededStep),
    };
  });

  useEffect(() => {
    if (!cartMattressSize) return;
    setSize((current) => current === cartMattressSize ? current : cartMattressSize);
    setConfirmedSelections((current) => current.size ? current : { ...current, size: true });
  }, [cartMattressSize]);

  const openSleepEssentials = useCallback(
    (category) => {
      const returnStep = stepKey === "essentials" ? "essentials" : "review";
      const returnTo = buildPodCustomizeReturnPath(canonicalPodId, returnStep);
      navigate(buildSleepEssentialsPath({ category, returnTo }));
    },
    [canonicalPodId, navigate, stepKey]
  );

  const recordEssentialProgress = useCallback(
    async ({ category, action, choice = null }) => {
      const categoryId = CANONICAL_ESSENTIAL_CATEGORY_IDS[category];
      if (!sleepEssentialsJourneyId || !categoryId) {
        return false;
      }

      setEssentialProgressBusy(category);
      try {
        await api.recordRewardAccessoriesProgress({
          journeyId: sleepEssentialsJourneyId,
          categoryId,
          action,
          productHandle: choice?.handle || null,
          variantId: choice?.variantId || null,
          sourceSurface: "pod_customize",
        });
        return true;
      } catch (error) {
        const message = "Your selection is still here, but Sleep Essentials progress could not be saved.";
        console.warn("[rewards] Sleep Essentials progress was not recorded", {
          categoryId,
          code: error?.code || "REWARD_ACCESSORIES_PROGRESS_FAILED",
        });
        onCue?.(message, "warning");
        return false;
      } finally {
        setEssentialProgressBusy("");
      }
    },
    [onCue, sleepEssentialsJourneyId]
  );

  const motionAvailability = useMemo(
    () => motionAvailabilityForSelection(size, isDualComfort),
    [size, isDualComfort]
  );
  const allowedMotion = useMemo(
    () => allowedMotionTypesForSelection(size, isDualComfort),
    [size, isDualComfort]
  );

  useEffect(() => {
    let active = true;

    api.getSleepEssentialsCatalog()
      .then((catalog) => {
        if (!active) return;
        const categories = Array.isArray(catalog?.categories) ? catalog.categories : [];
        const byId = new Map(categories.map((category) => [category.id, category.products || []]));
        setEssentialProducts({
          status: "ready",
          itemsByCategory: Object.fromEntries(
            ESSENTIAL_STEP_KEYS.map((category) => [
              category,
              byId.get(CANONICAL_ESSENTIAL_CATEGORY_IDS[category]) || [],
            ])
          ),
          error: "",
        });
      })
      .catch((error) => {
        if (!active) return;
        console.warn("[pod-builder] Sleep Essentials catalog unavailable", {
          errorCode: error?.code || error?.name || "PRODUCT_LOOKUP_FAILED",
        });
        setEssentialProducts({
          status: "error",
          itemsByCategory: {},
          error: "Sleep Essentials are unavailable right now. You can skip and finish your core setup.",
        });
      });

    return () => {
      active = false;
    };
  }, []);

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
      essentialsVersion: 2,
      selectedEssentials,
      skippedEssentials,
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
    selectedEssentials,
    skippedEssentials,
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
  const essentialChoicesByCategory = useMemo(
    () =>
      Object.fromEntries(
        ESSENTIAL_STEP_KEYS.map((category) => [
          category,
          buildEssentialChoices(
            essentialProducts.itemsByCategory?.[category],
            category,
            size,
            configuredMotionType
          ),
        ])
      ),
    [configuredMotionType, essentialProducts.itemsByCategory, size]
  );
  const cartVariantIds = useMemo(
    () => new Set(cartItems.map((item) => String(item?.merchandiseId || item?.variantId || "")).filter(Boolean)),
    [cartItems]
  );
  const recommendedEssentialChoices = useMemo(
    () => Object.fromEntries(
      ESSENTIAL_STEP_KEYS.map((category) => {
        const choices = essentialChoicesByCategory[category] || [];
        return [category, choices.find((choice) => cartVariantIds.has(choice.variantId)) || choices[0] || null];
      })
    ),
    [cartVariantIds, essentialChoicesByCategory]
  );
  const selectedEssentialChoices = useMemo(
    () =>
      Object.fromEntries(
        ESSENTIAL_STEP_KEYS.map((category) => {
          const selection = selectedEssentials[category];
          const choice = selection
            ? essentialChoicesByCategory[category]?.find(
                (candidate) =>
                  candidate.handle === selection.handle && candidate.variantId === selection.variantId
              )
            : null;
          return [
            category,
            choice
              ? {
                  ...choice,
                  quantity: category === "pillows" ? Math.min(4, Math.max(1, selection.quantity || 1)) : 1,
                }
              : null,
          ];
        })
      ),
    [essentialChoicesByCategory, selectedEssentials]
  );
  const essentialsReady = ESSENTIAL_STEP_KEYS.every(
    (category) => Boolean(selectedEssentialChoices[category] || skippedEssentials[category])
  );
  const essentialsTotal = useMemo(
    () =>
      ESSENTIAL_STEP_KEYS.reduce((sum, category) => {
        const choice = selectedEssentialChoices[category];
        return sum + (choice ? choice.price * choice.quantity : 0);
      }, 0),
    [selectedEssentialChoices]
  );
  const previewTotal = useMemo(
    () => mattressPrice + (wantsBase ? basePrice : 0) + essentialsTotal,
    [mattressPrice, basePrice, wantsBase, essentialsTotal]
  );
  const monthly = useMemo(() => monthlyEstimate(previewTotal), [previewTotal]);

  useEffect(() => {
    if (essentialProducts.status !== "ready") return;
    setSelectedEssentials((current) => {
      let changed = false;
      const next = { ...current };
      for (const category of ESSENTIAL_STEP_KEYS) {
        if (current[category] && !selectedEssentialChoices[category]) {
          next[category] = null;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [essentialProducts.status, selectedEssentialChoices]);

  useEffect(() => {
    if (essentialProducts.status !== "ready") return;
    setSelectedEssentials((current) => {
      let changed = false;
      const next = { ...current };
      for (const category of ESSENTIAL_STEP_KEYS) {
        const cartChoice = (essentialChoicesByCategory[category] || []).find((choice) =>
          cartVariantIds.has(choice.variantId)
        );
        if (!cartChoice) continue;
        if (current[category]?.variantId === cartChoice.variantId) continue;
        next[category] = {
          handle: cartChoice.handle,
          variantId: cartChoice.variantId,
          quantity: category === "pillows" ? current[category]?.quantity || 1 : 1,
        };
        changed = true;
      }
      return changed ? next : current;
    });
    setSkippedEssentials((current) => {
      let changed = false;
      const next = { ...current };
      for (const category of ESSENTIAL_STEP_KEYS) {
        if (!(essentialChoicesByCategory[category] || []).some((choice) => cartVariantIds.has(choice.variantId))) continue;
        if (!current[category]) continue;
        next[category] = false;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [cartVariantIds, essentialChoicesByCategory, essentialProducts.status]);
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
    essentialsReady &&
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

    for (const category of ESSENTIAL_STEP_KEYS) {
      const choice = selectedEssentialChoices[category];
      if (!choice) continue;
      specs.push({
        key: category,
        handle: choice.handle,
        line: {
          merchandiseId: choice.variantId,
          quantity: choice.quantity,
          attributes: [
            { key: "_Sleep Essential", value: ESSENTIAL_CATEGORY_CONFIG[category].singular },
            { key: "_Product", value: choice.title },
            { key: "_Option", value: choice.actualOption },
            { key: "_Variant Option", value: choice.actualOption },
            ...(category === "pillows" ? [{ key: "Pillow Size", value: choice.actualOption }] : []),
            ...(category !== "pillows" ? [{ key: "_Setup Size", value: size }] : []),
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
    selectedEssentialChoices,
    selectedMotionLabel,
    showMotion,
    size,
    wantsBase,
  ]);
  const desiredCartState = useMemo(
    () => classifyDesiredCartState(cartItems, desiredCartSpecs),
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
      ...ESSENTIAL_STEP_KEYS.map((category) => {
        const choice = selectedEssentialChoices[category];
        if (choice) {
          const quantity = category === "pillows" && choice.quantity > 1 ? ` x${choice.quantity}` : "";
          return `${ESSENTIAL_CATEGORY_CONFIG[category].singular}: ${choice.title}${quantity}`;
        }
        return `${ESSENTIAL_CATEGORY_CONFIG[category].singular}: Skipped`;
      }),
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
      selectedEssentialChoices,
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
  const essentialReviewRows = useMemo(
    () =>
      ESSENTIAL_STEP_KEYS.map((category) => {
        const choice = selectedEssentialChoices[category];
        const quantity = category === "pillows" ? choice?.quantity || 1 : 1;
        return {
          category,
          label: ESSENTIAL_CATEGORY_CONFIG[category].singular,
          value: choice
            ? `${choice.title}${quantity > 1 ? ` ×${quantity}` : ""}`
            : "Skipped",
          price: choice ? choice.price * quantity : null,
          image: choice?.image || "",
        };
      }),
    [selectedEssentialChoices]
  );
  const successSummaryRows = useMemo(
    () => [
      { label: "Mattress", value: mattressLabel },
      { label: "Core setup", value: `${size || "No size"} · ${selectedBaseLabel}` },
      {
        label: "Motion",
        value: showMotion ? selectedMotionLabel : "Not included",
      },
      {
        label: "Sleep essentials",
        value: essentialReviewRows
          .filter((item) => item.value !== "Skipped")
          .map((item) => item.label)
          .join(", ") || "Skipped",
      },
    ],
    [
      essentialReviewRows,
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
    if (stepKey === "essentials") {
      return {
        title: "Complete Your Sleep Setup",
        description: "Choose from a small set of approved essentials, or continue with your core setup.",
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
            : stepKey === "essentials"
              ? essentialProducts.status !== "loading"
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

      if (stepKey === "essentials") {
        const chosen = ESSENTIAL_STEP_KEYS.map((key) => selectedEssentialChoices[key]).filter(Boolean);
        return {
          title: "Complete Your Sleep Setup",
          caption: "Only approved, available Shopify options are shown.",
          items: chosen.map((choice) => `${choice.title} · ${money(choice.price)}`),
          nextAction: "Review your setup",
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
    selectedEssentialChoices,
    skippedEssentials,
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
      selectedEssentials: ESSENTIAL_STEP_KEYS.map((category) => selectedEssentialChoices[category]?.title).filter(Boolean),
      skippedEssentials: ESSENTIAL_STEP_KEYS.filter((category) => skippedEssentials[category]),
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
    selectedEssentialChoices,
    skippedEssentials,
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
    setSelectedEssentials(normalizeSavedEssentials(null));
    setSkippedEssentials(normalizeSavedEssentialSkips(null));
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
      onCue?.("Your selected setup is already in the Shopify cart.", "tip");
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
      const removedLineIds = new Set();
      const missingLines = [];

      for (const spec of desiredCartSpecs) {
        const related = relatedCartLines(authoritativeCart, spec).filter(
          (item) => !removedLineIds.has(String(item?.lineId || item?.id || ""))
        );
        const matching = related.filter((item) =>
          exactCartLines([item], spec).length === 1
        );
        const keeper = matching[0] || null;
        const keeperId = String(keeper?.lineId || keeper?.id || "");

        for (const item of related) {
          const lineId = String(item?.lineId || item?.id || "");
          if (keeper && lineId === keeperId) continue;
          await removeFromCart?.(lineId);
          removedLineIds.add(lineId);
        }

        if (!keeper) {
          missingLines.push(spec.line);
        } else if (Number(keeper.quantity || 0) !== Number(spec.line.quantity || 0)) {
          await updateCart?.(keeperId, spec.line.quantity);
        }
      }

      if (missingLines.length) {
        await addLinesToAuthoritativeCart?.({
          lines: missingLines,
          sourcePage: "pod-build-review",
        });
      }
      setGuidedStep("success");
      onCue?.("Your selected setup is now exact in the Shopify cart.", "success");

      if (sleepEssentialsJourneyId && essentialsReady) {
        void api
          .completeRewardAccessories({
            journeyId: sleepEssentialsJourneyId,
            sourceSurface: "pod_customize",
          })
          .then(async () => {
            await refreshRewardsState({ force: true });
            onCue?.("Sleep Essentials complete. Your reward is confirmed.", "success");
          })
          .catch((error) => {
            console.warn("[rewards] Sleep Essentials completion was not recorded", {
              code: error?.code || "REWARD_ACCESSORIES_COMPLETION_FAILED",
            });
          });
      }
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
    sleepEssentialsJourneyId,
    essentialsReady,
    setGuidedStep,
    wantsBase,
  ]);

  const viewCart = useCallback(() => {
    onCue?.("Opening your Shopify cart.", "tip");
    onViewSnoozePod?.();
  }, [onCue, onViewSnoozePod]);

  const nextAfterSize = "base";
  const nextAfterBase = showMotion ? "motion" : isDualComfort ? "comfort" : "essentials";
  const nextAfterMotion = isDualComfort ? "comfort" : "essentials";
  const visibleProgressSteps = steps.filter((step) => step.key !== "success" || stepKey === "success");
  const isStepComplete = useCallback(
    (key) => {
      if (key === "size") return sizeReady;
      if (key === "base") return baseReady;
      if (key === "motion") return motionReady;
      if (key === "comfort") return comfortReady;
      if (key === "essentials") return essentialsReady;
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
      selectedEssentialChoices,
      skippedEssentials,
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
                        : "essentials";
                  queueSelectionAdvance(
                    `base:${option.value}`,
                    nextKey,
                    option.value === "adjustable"
                      ? "Adjustable base selected. Choose your motion style next."
                      : "Choose your Sleep Essentials next."
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
                        : "Choose your Sleep Essentials next."
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
                          "essentials",
                          "Complete your sleep setup next."
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
                          "essentials",
                          "Complete your sleep setup next."
                        );
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
          {renderStageControls({
            primaryLabel: "Continue to Sleep Essentials",
            onPrimary: () => setGuidedStep("essentials", "Complete your sleep setup next."),
            primaryDisabled: !comfortReady,
          })}
        </div>
      );
    }

    if (stepKey === "essentials") {
      const visibleCategories = ESSENTIAL_CARD_KEYS
        .map((category) => ({ category, choice: recommendedEssentialChoices[category] || null }));

      const selectChoice = (category, choice) => {
        setSelectedEssentials((current) => ({
          ...current,
          [category]: {
            handle: choice.handle,
            variantId: choice.variantId,
            quantity: category === "pillows" ? current[category]?.quantity || 1 : 1,
          },
        }));
        setSkippedEssentials((current) => ({ ...current, [category]: false }));
        setCartError("");
      };

      const continueEssentials = async () => {
        if (essentialProgressBusy) return;
        const categoriesToSkip = ESSENTIAL_STEP_KEYS.filter((category) => !selectedEssentialChoices[category]);
        setSkippedEssentials((current) => ({
          ...current,
          ...Object.fromEntries(categoriesToSkip.map((category) => [category, true])),
        }));
        setEssentialProgressBusy("all");
        await Promise.allSettled(ESSENTIAL_STEP_KEYS.map((category) => {
          const choice = selectedEssentialChoices[category];
          return recordEssentialProgress({
            category,
            action: choice ? "saved_selection" : "reviewed_no_selection",
            choice,
          });
        }));
        setEssentialProgressBusy("");
        setGuidedStep("review", "Review this setup before adding it to cart.");
      };

      return (
        <div className="flex h-full min-h-0 flex-col" data-sleep-essentials-step="combined">
          <div className="mb-2 flex shrink-0 items-center justify-end" data-sleep-essentials-catalog-action="true">
            <button type="button" onClick={() => openSleepEssentials("all")} className="inline-flex min-h-[44px] items-center gap-1 rounded-[12px] border border-[#dfe7fb] bg-white px-3 text-[0.75rem] font-black text-[#315cf6]">
              View All Sleep Essentials <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          {essentialProducts.status === "loading" ? (
            <div className="flex min-h-[120px] flex-1 items-center justify-center rounded-[18px] border border-[#dfe7fb] bg-[#f8faff] text-sm font-semibold text-slate-600">Preparing approved options…</div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-3" data-sleep-essentials-card-row="three">
              {visibleCategories.map(({ category, choice }) => {
                const active = Boolean(choice && selectedEssentialChoices[category]?.variantId === choice.variantId);
                if (!choice) {
                  return (
                    <div key={category} className="flex min-h-[286px] min-w-0 flex-col items-center justify-center rounded-[20px] border border-dashed border-[#cbd7f7] bg-[#f8faff] p-5 text-center" data-sleep-essentials-card={category} data-sleep-essentials-unavailable="true">
                      <PackageCheck className="h-9 w-9 text-[#8ba6ef]" />
                      <span className="mt-3 text-[0.72rem] font-black uppercase tracking-[0.14em] text-[#315cf6]">{ESSENTIAL_CATEGORY_CONFIG[category].recommendationLabel}</span>
                      <span className="mt-2 text-base font-black text-slate-900">No approved match available</span>
                      <button type="button" onClick={() => openSleepEssentials(CANONICAL_ESSENTIAL_CATEGORY_IDS[category])} className="mt-3 min-h-[44px] rounded-full bg-white px-3 text-[0.75rem] font-black text-[#315cf6]">View All</button>
                    </div>
                  );
                }
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => selectChoice(category, choice)}
                    className={`group flex min-h-[286px] min-w-0 flex-col rounded-[20px] border p-4 text-left shadow-sm transition ${active ? "border-[#315cf6] bg-[#eef3ff] ring-2 ring-[#315cf6]/15" : "border-[#dfe7fb] bg-white hover:-translate-y-0.5 hover:shadow-md"}`}
                    data-sleep-essentials-card={category}
                    aria-pressed={active}
                  >
                    <BuilderMediaPreview
                      src={choice.image}
                      alt={choice.title}
                      icon={PackageCheck}
                      className="min-h-[150px] w-full flex-1 overflow-hidden rounded-[14px] bg-[#f6f8ff]"
                      imgClassName="h-full w-full object-contain p-2"
                      data-sleep-essentials-card-image="true"
                    />
                    <span className="mt-3 text-[0.76rem] font-black uppercase tracking-[0.14em] text-[#315cf6]" data-sleep-essentials-card-category="true">
                      {ESSENTIAL_CATEGORY_CONFIG[category].recommendationLabel}
                    </span>
                    <span className="mt-1.5 line-clamp-2 text-[clamp(1.02rem,1.3vw,1.18rem)] font-black leading-[1.08] text-slate-950" data-sleep-essentials-card-name="true">
                      {choice.title}
                    </span>
                    <span className="mt-3 flex w-full items-center justify-between gap-3" data-sleep-essentials-card-action="true">
                      <span className="text-[1.1rem] font-black text-slate-950">{money(choice.price)}</span>
                      <span className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-[0.78rem] font-black ${active ? "bg-[#315cf6] text-white" : "bg-[#edf2ff] text-[#315cf6]"}`}>
                        <CheckCircle2 className="h-4 w-4" /> {active ? "Added" : "+ Add"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {renderStageControls({
            primaryLabel: "Continue to Review",
            onPrimary: continueEssentials,
            primaryDisabled: essentialProducts.status === "loading" || Boolean(essentialProgressBusy),
          })}
        </div>
      );
    }

    if (ESSENTIAL_STEP_KEYS.includes(stepKey)) {
      const config = ESSENTIAL_CATEGORY_CONFIG[stepKey];
      const choices = essentialChoicesByCategory[stepKey] || [];
      const selected = selectedEssentialChoices[stepKey];
      const categoryIndex = ESSENTIAL_STEP_KEYS.indexOf(stepKey);
      const nextKey = ESSENTIAL_STEP_KEYS[categoryIndex + 1] || "review";
      const nextLabel =
        nextKey === "review" ? "Review" : ESSENTIAL_CATEGORY_CONFIG[nextKey]?.label || "Continue";

      const selectChoice = (choice) => {
        setSelectedEssentials((current) => ({
          ...current,
          [stepKey]: {
            handle: choice.handle,
            variantId: choice.variantId,
            quantity: stepKey === "pillows" ? current[stepKey]?.quantity || 1 : 1,
          },
        }));
        setSkippedEssentials((current) => ({ ...current, [stepKey]: false }));
        setCartError("");
      };

      const skipCategory = async () => {
        if (essentialProgressBusy === stepKey) return;
        setSelectedEssentials((current) => ({ ...current, [stepKey]: null }));
        setSkippedEssentials((current) => ({ ...current, [stepKey]: true }));
        const recorded = await recordEssentialProgress({
          category: stepKey,
          action: "reviewed_no_selection",
        });
        if (!recorded) return;
        setGuidedStep(nextKey, `${config.label} skipped. ${nextKey === "review" ? "Review your setup." : `Choose ${ESSENTIAL_CATEGORY_CONFIG[nextKey].label.toLowerCase()} next.`}`);
      };

      const continueCategory = async () => {
        if (essentialProgressBusy === stepKey) return;
        const recorded = await recordEssentialProgress({
          category: stepKey,
          action: selected ? "saved_selection" : "reviewed_no_selection",
          choice: selected ? choices.find((choice) => choice.variantId === selected.variantId) || selected : null,
        });
        if (!recorded) return;
        setGuidedStep(
          nextKey,
          nextKey === "review"
            ? "Review this setup before adding it to cart."
            : `Choose ${ESSENTIAL_CATEGORY_CONFIG[nextKey].label.toLowerCase()} next.`
        );
      };

      return (
        <div className="flex h-full min-h-0 flex-col" data-sleep-essentials-step={stepKey}>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <p className="text-[0.78rem] font-semibold text-slate-600">
              {essentialProducts.status === "loading"
                ? "Loading approved Shopify options..."
                : `${choices.length} compatible option${choices.length === 1 ? "" : "s"} available for this setup.`}
            </p>
            {selected ? (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-[0.7rem] font-black uppercase tracking-[0.12em] text-emerald-700">
                Selected
              </span>
            ) : skippedEssentials[stepKey] ? (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[0.7rem] font-black uppercase tracking-[0.12em] text-slate-600">
                Skipped
              </span>
            ) : null}
          </div>

          <div className="mb-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Sleep Essentials showroom links">
            {[
              ["Browse Pillows", "pillows"],
              ["Shop Sheets and Bedding", "sheets_bedding"],
              ["Explore Mattress Protectors", "protectors"],
              ["View All Sleep Essentials", CANONICAL_ESSENTIAL_CATEGORY_IDS[stepKey]],
            ].map(([label, category]) => (
              <button
                key={label}
                type="button"
                onClick={() => openSleepEssentials(category)}
                className="inline-flex min-h-[44px] items-center justify-between rounded-[12px] border border-[#dfe7fb] bg-white px-3 text-left text-[0.72rem] font-black text-[#315cf6] transition hover:border-[#9bb1ff]"
              >
                <span>{label}</span>
                <ArrowRight className="h-4 w-4 shrink-0" />
              </button>
            ))}
          </div>

          {essentialProducts.status === "error" || (essentialProducts.status === "ready" && !choices.length) ? (
            <div className="flex min-h-[88px] flex-1 items-center justify-center rounded-[18px] border border-[#dfe7fb] bg-[#f8faff] px-5 text-center">
              <div>
                <PackageCheck className="mx-auto h-8 w-8 text-[#315cf6]" />
                <p className="mt-2 text-[0.95rem] font-black text-slate-900">
                  No approved {config.label.toLowerCase()} are available for this setup right now.
                </p>
                <p className="mt-1 text-[0.78rem] font-semibold text-slate-600">
                  Skip this category to keep building your core setup.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
              {choices.map((choice) => {
                const active = selected?.variantId === choice.variantId;
                return (
                  <button
                    key={choice.variantId}
                    type="button"
                    onClick={() => selectChoice(choice)}
                    className={[
                      "flex min-h-[104px] min-w-0 flex-col rounded-[18px] border bg-white p-3 text-left shadow-sm transition",
                      active
                        ? "border-[#315cf6] ring-2 ring-[#315cf6]/10"
                        : "border-[#dfe7fb] hover:border-[#9bb1ff]",
                    ].join(" ")}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <BuilderMediaPreview
                        src={choice.image}
                        alt={choice.title}
                        icon={PackageCheck}
                        className="h-[64px] w-[72px] shrink-0 overflow-hidden rounded-[12px] bg-[#f6f8ff]"
                        imgClassName="h-full w-full object-contain p-1.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-[0.9rem] font-black leading-tight text-slate-950">
                          {choice.title}
                        </div>
                        {choice.variantTitle && lower(choice.variantTitle) !== "default title" ? (
                          <div className="mt-1 truncate text-[0.7rem] font-bold text-slate-500">
                            {choice.variantTitle}
                          </div>
                        ) : null}
                        <div className="mt-1 text-[0.88rem] font-black text-[#315cf6]">{money(choice.price)}</div>
                      </div>
                      <CheckCircle2 className={active ? "h-5 w-5 shrink-0 text-[#315cf6]" : "h-5 w-5 shrink-0 text-slate-200"} />
                    </div>
                    {choice.description ? (
                      <p className="mt-2 line-clamp-2 text-[0.7rem] font-semibold leading-snug text-slate-600">
                        {choice.description}
                      </p>
                    ) : null}
                    {stepKey === "pillows" && active ? (
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <span className="text-[0.7rem] font-black uppercase tracking-[0.12em] text-slate-500">
                          Quantity
                        </span>
                        <span className="flex items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label="Decrease pillow quantity"
                            onClick={() =>
                              setSelectedEssentials((current) => ({
                                ...current,
                                pillows: {
                                  ...current.pillows,
                                  quantity: Math.max(1, (current.pillows?.quantity || 1) - 1),
                                },
                              }))
                            }
                            className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[#dfe7fb] bg-white"
                          >
                            <Minus className="h-4 w-4" />
                          </span>
                          <strong className="w-5 text-center text-sm">{selected.quantity}</strong>
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label="Increase pillow quantity"
                            onClick={() =>
                              setSelectedEssentials((current) => ({
                                ...current,
                                pillows: {
                                  ...current.pillows,
                                  quantity: Math.min(4, (current.pillows?.quantity || 1) + 1),
                                },
                              }))
                            }
                            className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[#dfe7fb] bg-white"
                          >
                            <Plus className="h-4 w-4" />
                          </span>
                        </span>
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}

          {renderStageControls({
            primaryLabel: `Continue to ${nextLabel}`,
            onPrimary: continueCategory,
            primaryDisabled:
              (!selected && !skippedEssentials[stepKey]) ||
              essentialProgressBusy === stepKey,
            secondaryLabel: "Skip",
            onSecondary: skipCategory,
          })}
        </div>
      );
    }

    if (stepKey === "success") {
      return (
        <div
          className="grid h-full min-h-0 gap-3 lg:grid-cols-[1.35fr_0.65fr]"
          data-pod-builder-success-layout="compact"
        >
          <div className="flex min-h-0 flex-col gap-2">
            <div
              className="flex min-h-[64px] shrink-0 items-center gap-3 rounded-[18px] border border-emerald-200 bg-emerald-50/80 px-4 py-2.5"
              data-pod-builder-success-banner="true"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="text-[clamp(1.08rem,1.55vw,1.35rem)] font-black tracking-tight text-slate-950">
                  Your setup is in the cart.
                </div>
                <p className="text-[0.78rem] font-semibold leading-snug text-slate-600">
                  Open the cart or customize another setup.
                </p>
              </div>
            </div>
            <div
              className="grid min-h-0 flex-1 content-start gap-1.5 sm:grid-cols-2"
              data-pod-builder-success-summary="true"
            >
              {successSummaryRows.map((item) => (
                <div
                  key={item.label}
                  className="flex min-h-[40px] min-w-0 items-center gap-2 rounded-[12px] border border-[#dfe7fb] bg-white px-3"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#315cf6]" />
                  <div className="min-w-0 leading-tight">
                    <div className="text-[0.56rem] font-black uppercase tracking-[0.1em] text-slate-500">
                      {item.label}
                    </div>
                    <div className="text-[0.7rem] font-bold text-slate-900">{item.value}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div
            className="flex min-h-0 flex-col justify-center gap-3 rounded-[18px] border border-[#dfe7fb] bg-[#f8faff] p-3"
            data-pod-builder-success-actions="true"
          >
            <Button
              type="button"
              onClick={viewCart}
              data-pod-layout-primary-action="build-open-cart"
              className="min-h-[48px] w-full rounded-[14px] px-5 text-[0.9rem] font-black"
            >
              Open Cart
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <button
              type="button"
              onClick={resetBuild}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-[14px] border border-[#dfe7fb] bg-white px-4 text-[0.88rem] font-black text-slate-800"
            >
              Build Another
            </button>
          </div>
        </div>
      );
    }

    const selectedReviewEssentials = essentialReviewRows.filter((item) => item.value !== "Skipped");

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

          {selectedReviewEssentials.length ? (
            <div className="mt-2 min-h-0" data-pod-builder-summary-group="essentials" data-sleep-essentials-status="reviewed">
              <div className="mb-1.5 text-[0.68rem] font-black uppercase tracking-[0.14em] text-[#315cf6]">Sleep Essentials</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {selectedReviewEssentials.map((item) => (
                  <div key={item.category} className="flex min-w-0 items-center gap-2 rounded-[14px] border border-[#e2e8f7] bg-white p-2" data-pod-builder-summary-row="essential">
                    <BuilderMediaPreview src={item.image} alt={item.value} icon={PackageCheck} className="h-[clamp(44px,7vh,64px)] w-[clamp(44px,7vh,64px)] shrink-0 overflow-hidden rounded-[10px] bg-[#f6f8ff]" imgClassName="h-full w-full object-contain p-1" data-pod-builder-summary-image="essential" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[0.6rem] font-black uppercase tracking-[0.1em] text-slate-500">{item.label}</div>
                      <div className="line-clamp-2 text-[0.78rem] font-black leading-tight text-slate-950">{item.value}</div>
                      <div className="mt-0.5 text-[0.78rem] font-black text-[#315cf6]">{money(item.price)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
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
          <button type="button" onClick={goBack} className="mt-2 min-h-[44px] w-full rounded-[12px] text-[0.82rem] font-black text-slate-600">Back to essentials</button>
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
