import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BedDouble,
  CheckCircle2,
  ImageOff,
  Ruler,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/useStore";
import { getShopperId } from "@/state/sessionStore";
import {
  SIZE_OPTIONS,
  BASE_OPTIONS_UI,
  MOTION_TYPES_UI,
  DUAL_COMFORT_OPTIONS,
  getBaseHandleForType,
  getMattressHandleForType,
} from "@/lib/utils/recommendations";

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

function variantMatchesSize(variant, size) {
  const target = lower(size);
  if (!target) return false;

  const selectedOptions = Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : [];
  return selectedOptions.some((option) => lower(option?.value) === target);
}

export function pickVariantForSize(product, size) {
  const variants = normalizeVariants(product);
  if (!variants.length) return null;
  return variants.find((variant) => variantMatchesSize(variant, size)) || variants[0] || null;
}

function safeVariantId(variant) {
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
        "w-full rounded-[18px] border px-2.5 py-1.75 text-left shadow-sm transition",
        compact ? "min-h-[42px]" : "min-h-[76px]",
        disabled ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 opacity-60" : "hover:-translate-y-0.5 hover:shadow-md",
        active ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className={[
              "font-extrabold leading-tight text-gray-900",
              compact ? "text-[0.8rem]" : "text-[0.94rem]",
            ].join(" ")}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              className={[
                "text-gray-600",
                compact ? "mt-0.5 text-[0.62rem] leading-[0.85rem]" : "mt-1 text-[0.76rem] leading-[1.1rem]",
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

export function subtitleForSize(option) {
  switch (option) {
    case "Twin":
      return "A clean fit for compact spaces.";
    case "Twin XL":
      return "Extra length without taking up extra width.";
    case "Full":
      return "A little more room to stretch out.";
    case "Queen":
      return "The most popular balance of comfort and space.";
    case "King":
      return "Maximum room to spread out.";
    default:
      return "";
  }
}

export function subtitleForBase(option) {
  switch (option) {
    case "none":
      return "Keep the focus on the mattress feel.";
    case "adjustable":
      return "Lift, recline, and unlock motion features.";
    case "platform":
      return "A simple, supportive foundation.";
    case "storage":
      return "Support plus built-in storage underneath.";
    default:
      return "";
  }
}

function subtitleForMotion(option) {
  switch (option) {
    case "standard":
      return "One-piece movement across the whole bed.";
    case "half_split":
      return "Separate head adjustment with a shared foot.";
    case "full_split":
      return "Independent movement on both sides.";
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
    return 'Available only with 12" Dual Comfort in Queen or King.';
  }
  if (option === "full_split") {
    return "Available with King size only.";
  }
  if (!isDualComfort && option === "standard") {
    return "Available when Adjustable Base is selected.";
  }
  return `Unavailable with ${size || "this size"}.`;
}

function normalizeBuildStepCandidate(value) {
  const normalized = lower(value);
  if (!normalized) return "";
  if (normalized === "motion") return "base";
  if (normalized === "dual" || normalized === "comfort") return "review";
  if (normalized === "mattress") return "size";
  if (normalized === "base" || normalized === "size" || normalized === "review") {
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
}) {
  const safeSrc = sanitizeImageUrl(src);

  return (
    <div className={className}>
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
}) {
  const addToSnoozePod = useStore((state) => state.addToSnoozePod);
  const getSnoozePodSubtotal = useStore((state) => state.getSnoozePodSubtotal);

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

  const [size, setSize] = useState(initialSelections.size);
  const [baseType, setBaseType] = useState(initialSelections.baseType);
  const [motionType, setMotionType] = useState(initialSelections.motionType);
  const [dcLeft, setDcLeft] = useState(initialSelections.dcLeft);
  const [dcRight, setDcRight] = useState(initialSelections.dcRight);

  const showMotion = baseType === "adjustable";
  const wantsBase = baseType !== "none";
  const steps = useMemo(
    () => [
      { key: "size", label: "Size", icon: Ruler },
      { key: "base", label: "Base", icon: SlidersHorizontal },
      { key: "review", label: "Review", icon: CheckCircle2 },
    ],
    []
  );

  const requestedNormalizedStepKey = useMemo(
    () => normalizeBuildStepCandidate(requestedStepKey),
    [requestedStepKey]
  );

  const [stepKey, setStepKey] = useState(() => {
    if (steps.some((step) => step.key === requestedNormalizedStepKey)) {
      return requestedNormalizedStepKey;
    }

    const candidate = normalizeBuildStepCandidate(compatibleSavedBuild?.stepKey);
    return steps.some((step) => step.key === candidate) ? candidate : "size";
  });
  const appliedRequestedStepRef = useRef(requestedNormalizedStepKey || "size");

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

  useEffect(() => {
    if (steps.some((step) => step.key === stepKey)) return;
    setStepKey("review");
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
      shopperKey,
      assessmentSignature,
    });
  }, [pod, size, baseType, motionType, dcLeft, dcRight, stepKey, shopperKey, assessmentSignature]);

  const mattressVariant = useMemo(() => pickVariantForSize(mattressProduct, size), [mattressProduct, size]);
  const baseVariant = useMemo(
    () => (wantsBase ? pickVariantForSize(baseProduct, size) : null),
    [baseProduct, wantsBase, size]
  );
  const mattressMerchId = useMemo(() => safeVariantId(mattressVariant), [mattressVariant]);
  const baseMerchId = useMemo(() => safeVariantId(baseVariant), [baseVariant]);
  const mattressPrice = useMemo(() => parseVariantPrice(mattressVariant), [mattressVariant]);
  const basePrice = useMemo(() => parseVariantPrice(baseVariant), [baseVariant]);
  const previewTotal = useMemo(() => mattressPrice + (wantsBase ? basePrice : 0), [mattressPrice, basePrice, wantsBase]);
  const monthly = useMemo(() => monthlyEstimate(previewTotal), [previewTotal]);

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
  const canAdd = Boolean(mattressMerchId) && (!wantsBase || Boolean(baseMerchId)) && (!isDualComfort || Boolean(dcLeft && dcRight));
  const reviewSummaryGridClassName = showMotion
    ? "grid gap-1.25 sm:grid-cols-2 xl:grid-cols-5"
    : "grid gap-1.25 sm:grid-cols-2 xl:grid-cols-4";
  const selectionSummary = useMemo(
    () => [
      `Mattress: ${mattressLabel}`,
      `Base: ${selectedBaseLabel}`,
      `Size: ${size || "Not selected"}`,
      showMotion ? `Motion: ${selectedMotionLabel}` : "",
      isDualComfort ? `Comfort: ${dcLeft || "Not selected"} / ${dcRight || "Not selected"}` : "",
    ].filter(Boolean),
    [mattressLabel, selectedBaseLabel, size, showMotion, selectedMotionLabel, isDualComfort, dcLeft, dcRight]
  );
  const sizeReady = Boolean(size);
  const baseReady = Boolean(baseType) && (!showMotion || Boolean(motionType));
  const currentStepMeta = useMemo(() => {
    if (stepKey === "size") {
      return {
        eyebrow: "Step 1",
        title: "Choose your size.",
        description: "Choose the size you want to price and add.",
      };
    }
    if (stepKey === "base") {
      return {
        eyebrow: "Step 2",
        title: "Choose your base.",
        description: showMotion
          ? "Adjustable is selected, so motion stays right here as a sub-choice."
          : "Choose the base you want under this mattress.",
      };
    }
    return {
      eyebrow: "Step 3",
      title: "Review & add.",
      description: "Check the setup, then add it when you're ready.",
    };
  }, [stepKey, isDualComfort, showMotion]);
  const canProceed =
    stepKey === "size"
      ? Boolean(size)
      : stepKey === "base"
        ? Boolean(baseType) && (!showMotion || Boolean(motionType))
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

      return {
        title: `Review ${podLabel}`,
        caption: "Ready to review this setup before you add it to cart.",
        items: [
          ...selectionSummary,
          `Estimated monthly: ${money(monthly)}/mo`,
          `Estimated total: ${money(previewTotal)}`,
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
    monthly,
    previewTotal,
  ]);

  const goNext = useCallback(() => {
    if (!nextStep || !canProceed) return;
    setStepKey(nextStep.key);
    if (nextStep.key === "review") onCue?.("Take one last look before you add it to cart.", "tip");
  }, [nextStep, canProceed, onCue]);

  const goBack = useCallback(() => {
    if (!canGoBack) return;
    setStepKey(steps[currentStepIndex - 1].key);
  }, [canGoBack, currentStepIndex, steps]);

  const resetBuild = useCallback(() => {
    setSize(defaults.size);
    setBaseType(defaults.baseType);
    setMotionType(defaults.motionType);
    setDcLeft(defaults.dcLeft);
    setDcRight(defaults.dcRight);
    setStepKey("size");
    onCue?.("Your setup has been reset.", "tip");
  }, [defaults, onCue]);

  const addToPlan = useCallback(() => {
    if (!mattressMerchId) {
      onCue?.("This mattress is unavailable in the selected size.", "warning");
      return;
    }

    const podIdValue = String(pod?.podId ?? pod?.id ?? "").trim();

    addToSnoozePod({
      merchandiseId: mattressMerchId,
      handle: fixedMattressHandle,
      title: mattressProduct?.title || "Mattress",
      imageUrl: pickFeaturedImage(mattressProduct),
      unitPrice: mattressPrice,
      quantity: 1,
      attributes: [
        { key: "Size", value: size },
        { key: "Mattress", value: mattressLabel },
        ...(showMotion ? [{ key: "Motion", value: selectedMotionLabel }] : []),
        ...(isDualComfort
          ? [
              { key: "Left Feel", value: dcLeft },
              { key: "Right Feel", value: dcRight },
            ]
          : []),
        ...(podIdValue ? [{ key: "SnoozePod", value: `SnoozePod ${podIdValue}` }] : []),
      ],
    });

    if (wantsBase && baseMerchId) {
      addToSnoozePod({
        merchandiseId: baseMerchId,
        handle: selectedBaseHandle,
        title: baseProduct?.title || selectedBaseLabel,
        imageUrl: pickFeaturedImage(baseProduct),
        unitPrice: basePrice,
        quantity: 1,
        attributes: [
          { key: "Size", value: size },
          { key: "Base", value: selectedBaseLabel },
          ...(showMotion ? [{ key: "Motion", value: selectedMotionLabel }] : []),
          ...(podIdValue ? [{ key: "SnoozePod", value: `SnoozePod ${podIdValue}` }] : []),
        ],
      });
    }

    onCue?.("Added to cart.", "success");
  }, [
    addToSnoozePod,
    baseMerchId,
    basePrice,
    baseProduct,
    dcLeft,
    dcRight,
    fixedMattressHandle,
    isDualComfort,
    mattressLabel,
    mattressMerchId,
    mattressPrice,
    mattressProduct,
    onCue,
    pod?.id,
    pod?.podId,
    selectedBaseHandle,
    selectedBaseLabel,
    selectedMotionLabel,
    showMotion,
    size,
    wantsBase,
  ]);

  const viewCart = useCallback(() => {
    onCue?.(`SnoozePod total: ${money(getSnoozePodSubtotal?.() ?? 0)}.`, "tip");
    onViewSnoozePod?.();
  }, [getSnoozePodSubtotal, onCue, onViewSnoozePod]);

  const renderCurrentStep = () => {
    if (stepKey === "mattress") {
      return (
        <div className="space-y-4">
          <div className="rounded-[24px] border border-[#e2e9fb] bg-white px-4 py-4 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-[88px] w-[88px] shrink-0 overflow-hidden rounded-[22px] border border-[#e3eafc] bg-[#fbfcff]">
                <BuilderMediaPreview
                  src={mattressImage}
                  alt={mattressLabel}
                  icon={BedDouble}
                  className="h-full w-full"
                  imgClassName="h-full w-full object-cover"
                />
              </div>

              <div className="min-w-0">
                <div className="text-[1.08rem] font-extrabold leading-tight text-slate-900">{mattressLabel}</div>
                <div className="mt-1.5 text-sm leading-6 text-slate-600">
                  This mattress is fixed to {podLabel}. Use another pod if you want to compare a
                  different mattress family.
                </div>

                {onViewResults ? (
                  <button
                    type="button"
                    onClick={onViewResults}
                    className="mt-3 inline-flex items-center gap-2 text-sm font-extrabold text-[#2f57e8]"
                  >
                    Compare other pods
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {isDualComfort ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[24px] border border-[#e2e9fb] bg-white px-4 py-4 shadow-sm">
                <div className="text-[0.78rem] font-black uppercase tracking-[0.16em] text-slate-500">
                  Left Side
                </div>
                <div className="mt-2 text-sm text-slate-600">Choose the feel you want on one side.</div>
                <div className="mt-3 grid gap-3">
                  {DUAL_COMFORT_OPTIONS.map((option) => (
                    <ChoiceCard
                      key={`left-${option}`}
                      title={option}
                      active={dcLeft === option}
                      onClick={() => setDcLeft(option)}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] border border-[#e2e9fb] bg-white px-4 py-4 shadow-sm">
                <div className="text-[0.78rem] font-black uppercase tracking-[0.16em] text-slate-500">
                  Right Side
                </div>
                <div className="mt-2 text-sm text-slate-600">Choose the feel you want on the other side.</div>
                <div className="mt-3 grid gap-3">
                  {DUAL_COMFORT_OPTIONS.map((option) => (
                    <ChoiceCard
                      key={`right-${option}`}
                      title={option}
                      active={dcRight === option}
                      onClick={() => setDcRight(option)}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[22px] border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-sm font-semibold text-indigo-900">
              Motion becomes available only when you choose an adjustable base.
            </div>
          )}
        </div>
      );
    }

    if (stepKey === "base") {
      return (
        <div className="space-y-4">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
            {BASE_OPTIONS_UI.map((option) => (
              <ChoiceCard
                key={option.value}
                title={option.value === "none" ? "Mattress Only" : option.label}
                subtitle={subtitleForBase(option.value)}
                active={baseType === option.value}
                onClick={() => setBaseType(option.value)}
              />
            ))}
          </div>

          {showMotion ? (
            <div className="rounded-[24px] border border-[#e2e9fb] bg-white px-4 py-4 shadow-sm">
              <div className="flex items-center gap-2 text-[0.78rem] font-black uppercase tracking-[0.16em] text-slate-500">
                <SlidersHorizontal className="h-4 w-4 text-[#2f57e8]" />
                Motion
              </div>
              <div className="mt-2 text-sm text-slate-600">
                Choose the motion style that works with this adjustable base and size.
              </div>

              <div className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
                {MOTION_TYPES_UI.map((option) => {
                  const allowed = Boolean(motionAvailability[option.value]);
                  return (
                    <ChoiceCard
                      key={option.value}
                      title={titleForMotion(option.value)}
                      subtitle={
                        allowed
                          ? subtitleForMotion(option.value)
                          : disabledReasonForMotion(option.value, size, isDualComfort)
                      }
                      active={motionType === option.value}
                      disabled={!allowed}
                      onClick={() => allowed && setMotionType(option.value)}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
              Choose Adjustable Base to unlock motion choices.
            </div>
          )}
        </div>
      );
    }

    if (stepKey === "size") {
      return (
        <div className="space-y-4">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(148px,1fr))]">
            {SIZE_OPTIONS.map((option) => (
              <ChoiceCard
                key={option}
                title={option}
                subtitle={subtitleForSize(option)}
                active={size === option}
                onClick={() => setSize(option)}
              />
            ))}
          </div>

          {showMotion ? (
            <div className="rounded-[22px] border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-sm font-semibold text-indigo-900">
              Motion available with {size}: {availableMotionLabel}.
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="rounded-[24px] border border-[#e2e9fb] bg-white px-4 py-4 shadow-sm">
          <div className="text-[0.78rem] font-black uppercase tracking-[0.16em] text-slate-500">
            Review your setup
          </div>
          <div className="mt-3 space-y-2.5">
            {selectionSummary.map((item) => (
              <div key={item} className="flex gap-2 text-sm leading-6 text-slate-700">
                <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#2f57e8]" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[22px] border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-sm font-semibold text-indigo-900">
          Add this setup now, or open the cart and compare it against your next pod.
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="min-h-0 flex-1">
          <div className="grid min-h-0 gap-2.25 xl:h-full xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.02fr)_minmax(0,0.96fr)] xl:items-stretch">
            <div
              className={[
                "flex h-full min-h-0 flex-col rounded-[22px] border bg-white/96 p-2.25 shadow-[0_16px_40px_rgba(45,71,136,0.08)]",
                stepKey === "size" ? "border-indigo-200" : "border-white/80",
              ].join(" ")}
            >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#eef3ff] text-[0.76rem] font-black text-[#2f57e8]">
                  1
                </div>
                <div>
                  <div className="text-[0.7rem] font-black uppercase tracking-[0.16em] text-slate-500">
                    Choose Size
                  </div>
                  <div className="mt-0.5 text-[0.94rem] font-extrabold text-slate-900">
                    {size || "Choose your size"}
                  </div>
                </div>
              </div>
              {sizeReady ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : null}
            </div>

            <div className="mt-1.75 grid gap-1.25 [grid-template-columns:repeat(auto-fit,minmax(98px,1fr))]">
              {SIZE_OPTIONS.map((option) => (
                <BuilderOptionButton
                  key={option}
                  title={option}
                  subtitle=""
                  active={size === option}
                  compact
                  onClick={() => {
                    setStepKey("size");
                    setSize(option);
                  }}
                />
              ))}
            </div>
          </div>

            <div
              className={[
                "flex h-full min-h-0 flex-col rounded-[22px] border bg-white/96 p-2.25 shadow-[0_16px_40px_rgba(45,71,136,0.08)]",
                stepKey === "base" ? "border-indigo-200" : "border-white/80",
              ].join(" ")}
            >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#eef3ff] text-[0.76rem] font-black text-[#2f57e8]">
                  2
                </div>
                <div>
                  <div className="text-[0.7rem] font-black uppercase tracking-[0.16em] text-slate-500">
                    Choose Base
                  </div>
                  <div className="mt-0.5 text-[0.94rem] font-extrabold text-slate-900">
                    {selectedBaseLabel}
                  </div>
                </div>
              </div>
              {baseReady ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : null}
            </div>

            <div className="mt-1.75 grid gap-1.25 [grid-template-columns:repeat(auto-fit,minmax(128px,1fr))]">
              {BASE_OPTIONS_UI.map((option) => (
                <BuilderOptionButton
                  key={option.value}
                  title={option.value === "none" ? "Mattress Only" : option.label}
                  subtitle=""
                  active={baseType === option.value}
                  compact
                  onClick={() => {
                    setStepKey("base");
                    setBaseType(option.value);
                  }}
                />
              ))}
            </div>

            {showMotion ? (
              <div className="mt-1.75 rounded-[18px] border border-[#e2e9fb] bg-[#f8faff] px-2.5 py-2.25 shadow-sm">
                <div className="text-[0.7rem] font-black uppercase tracking-[0.16em] text-slate-500">
                  Motion Options
                </div>
                <div className="mt-1 text-[0.7rem] font-medium leading-[1rem] text-slate-600">
                  Choose the motion setup that fits this mattress, size, and adjustable base.
                </div>
                <div className="mt-1.5 grid gap-1.25 sm:grid-cols-2 xl:grid-cols-3">
                  {MOTION_TYPES_UI.map((option) => {
                    const allowed = Boolean(motionAvailability[option.value]);
                    return (
                      <BuilderOptionButton
                        key={option.value}
                        title={titleForMotion(option.value)}
                        subtitle={
                          allowed
                            ? subtitleForMotion(option.value)
                            : disabledReasonForMotion(option.value, size, isDualComfort)
                        }
                        active={motionType === option.value}
                        disabled={!allowed}
                        onClick={() => {
                          if (!allowed) return;
                          setStepKey("base");
                          setMotionType(option.value);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="mt-2 rounded-[16px] border border-slate-200 bg-slate-50 px-2.25 py-1.75 text-[0.74rem] font-semibold text-slate-700">
                Choose Adjustable Base to unlock motion choices.
              </div>
            )}
          </div>

          <div
            className={[
              "flex h-full min-h-0 flex-col rounded-[22px] border bg-white/96 p-2.25 shadow-[0_16px_40px_rgba(45,71,136,0.08)]",
              stepKey === "review" ? "border-indigo-200" : "border-white/80",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#eef3ff] text-[0.76rem] font-black text-[#2f57e8]">
                  3
                </div>
                <div>
                  <div className="text-[0.7rem] font-black uppercase tracking-[0.16em] text-slate-500">
                    Review & Add
                  </div>
                  <div className="mt-0.5 text-[0.94rem] font-extrabold text-slate-900">
                    {podLabel}
                  </div>
                </div>
              </div>
              {canAdd ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : null}
            </div>

            <div className="mt-1.75 rounded-[18px] border border-[#e2e9fb] bg-white px-2.5 py-2.25 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-[44px] w-[44px] shrink-0 overflow-hidden rounded-[14px] border border-[#e3eafc] bg-[#fbfcff]">
                  <BuilderMediaPreview
                    src={mattressImage}
                    alt={mattressLabel}
                    icon={BedDouble}
                    className="h-full w-full"
                    imgClassName="h-full w-full object-cover"
                  />
                </div>

                <div className="min-w-0">
                  <div className="text-[0.7rem] font-black uppercase tracking-[0.16em] text-slate-500">
                    Fixed Mattress
                  </div>
                  <div className="mt-0.5 text-[0.82rem] font-extrabold leading-tight text-slate-900">
                    {mattressLabel}
                  </div>
                  <div className="mt-0.5 text-[0.68rem] leading-[1rem] text-slate-600">
                    Locked to {podLabel}. Compare another pod if you want a different mattress family.
                  </div>
                  {onViewResults ? (
                    <button
                      type="button"
                      onClick={onViewResults}
                      className="mt-1 inline-flex items-center gap-2 text-[0.64rem] font-extrabold uppercase tracking-[0.14em] text-[#2f57e8]"
                    >
                      Compare other pods
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {isDualComfort ? (
              <div className="mt-1.75 rounded-[18px] border border-[#e2e9fb] bg-[#f8faff] px-2.5 py-2.25 shadow-sm">
                <div className="text-[0.7rem] font-black uppercase tracking-[0.16em] text-slate-500">
                  Comfort Sides
                </div>
                <div className="mt-1.5 grid gap-1.25 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-[0.72rem] font-extrabold text-slate-700">Left Side</div>
                    {DUAL_COMFORT_OPTIONS.map((option) => (
                      <BuilderOptionButton
                        key={`left-${option}`}
                        title={option}
                        active={dcLeft === option}
                        compact
                        onClick={() => {
                          setStepKey("review");
                          setDcLeft(option);
                        }}
                      />
                    ))}
                  </div>
                  <div className="space-y-2">
                    <div className="text-[0.72rem] font-extrabold text-slate-700">Right Side</div>
                    {DUAL_COMFORT_OPTIONS.map((option) => (
                      <BuilderOptionButton
                        key={`right-${option}`}
                        title={option}
                        active={dcRight === option}
                        compact
                        onClick={() => {
                          setStepKey("review");
                          setDcRight(option);
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-1.75 rounded-[16px] border border-[#dbe5ff] bg-white/96 px-2.5 py-2 shadow-sm">
              <div className={reviewSummaryGridClassName}>
                <div>
                  <div className="text-[0.62rem] font-black uppercase tracking-[0.14em] text-slate-500">
                    Size
                  </div>
                  <div className="mt-0.5 text-[0.8rem] font-extrabold text-slate-900">
                    {size || "Choose"}
                  </div>
                </div>

                <div>
                  <div className="text-[0.62rem] font-black uppercase tracking-[0.14em] text-slate-500">
                    Base
                  </div>
                  <div className="mt-0.5 text-[0.8rem] font-extrabold text-slate-900">
                    {selectedBaseLabel}
                  </div>
                </div>

                {showMotion ? (
                  <div>
                    <div className="text-[0.62rem] font-black uppercase tracking-[0.14em] text-slate-500">
                      Motion
                    </div>
                    <div className="mt-0.5 text-[0.8rem] font-extrabold text-slate-900">
                      {selectedMotionLabel}
                    </div>
                  </div>
                ) : null}

                <div>
                  <div className="text-[0.62rem] font-black uppercase tracking-[0.14em] text-slate-500">
                    Monthly
                  </div>
                  <div className="mt-0.5 text-[0.8rem] font-extrabold text-slate-900">
                    {money(monthly)}/mo
                  </div>
                </div>

                <div>
                  <div className="text-[0.62rem] font-black uppercase tracking-[0.14em] text-slate-500">
                    Total
                  </div>
                  <div className="mt-0.5 text-[0.8rem] font-extrabold text-slate-900">
                    {money(previewTotal)}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-auto space-y-1.25 pt-2">
              <Button
                onClick={() => {
                  setStepKey("review");
                  addToPlan();
                }}
                disabled={!canAdd}
                className="min-h-[36px] w-full rounded-[16px] px-5 text-[0.8rem] font-extrabold"
              >
                <span>{primaryCtaLabel}</span>
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={viewCart}
                  className="text-[0.68rem] font-extrabold uppercase tracking-[0.14em] text-[#2f57e8]"
                >
                  Open Cart
                </button>

                <button
                  type="button"
                  onClick={resetBuild}
                  className="text-[0.68rem] font-extrabold uppercase tracking-[0.14em] text-slate-500"
                >
                  Start Over
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
