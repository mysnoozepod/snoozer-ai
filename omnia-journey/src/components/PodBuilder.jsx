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

function allowedMotionTypesForSelection(size, supportsSplitMotion) {
  if (!supportsSplitMotion) return ["standard"];
  if (size === "King") return ["standard", "half_split", "full_split"];
  if (size === "Queen") return ["standard", "half_split"];
  return ["standard"];
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
  try {
    return (
      sessionStorage.getItem("snooze.shopperId") ||
      sessionStorage.getItem("snooze.accessCode") ||
      "guest"
    );
  } catch {
    return "guest";
  }
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
  if (normalized === "full_split" && allowed.includes("half_split")) return "half_split";
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
  const allowedMotion = allowedMotionTypesForSelection(size, supportsSplitMotion);
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
  const allowedMotion = allowedMotionTypesForSelection(size, supportsSplitMotion);
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

function normalizeBuildStepCandidate(value) {
  const normalized = lower(value);
  if (!normalized) return "";
  if (normalized === "motion") return "base";
  if (normalized === "dual" || normalized === "comfort") return "mattress";
  if (normalized === "mattress" || normalized === "base" || normalized === "size" || normalized === "review") {
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
      { key: "mattress", label: "Mattress", icon: BedDouble },
      { key: "base", label: "Base", icon: SlidersHorizontal },
      { key: "size", label: "Size", icon: Ruler },
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
    return steps.some((step) => step.key === candidate) ? candidate : "mattress";
  });
  const appliedRequestedStepRef = useRef(requestedNormalizedStepKey || "mattress");

  const allowedMotion = useMemo(
    () => allowedMotionTypesForSelection(size, supportsSplitMotion),
    [size, supportsSplitMotion]
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
  const selectedMotionLabel = labelFor(MOTION_TYPES_UI, motionType, "Standard");
  const mattressLabel = mattressProduct?.title || pod?.displayMattress || pod?.subtitle || "Mattress";
  const podLabel = useMemo(() => podLabelFor(pod), [pod]);
  const availableMotionLabel = useMemo(
    () => allowedMotion.map((value) => labelFor(MOTION_TYPES_UI, value, value)).join(", "),
    [allowedMotion]
  );
  const currentStepIndex = Math.max(0, steps.findIndex((step) => step.key === stepKey));
  const nextStep = steps[currentStepIndex + 1] || null;
  const canGoBack = currentStepIndex > 0;
  const mattressImage = pickFeaturedImage(mattressProduct);
  const selectedBaseImage = pickFeaturedImage(baseProduct);
  const canAdd = Boolean(mattressMerchId) && (!wantsBase || Boolean(baseMerchId)) && (!isDualComfort || Boolean(dcLeft && dcRight));
  const selectionSummary = useMemo(
    () => [
      `Mattress: ${mattressLabel}`,
      `Base: ${selectedBaseLabel}`,
      `Size: ${size || "Not selected"}`,
      showMotion ? `Motion: ${selectedMotionLabel}` : "Motion: No Motion",
      isDualComfort ? `Comfort: ${dcLeft || "Not selected"} / ${dcRight || "Not selected"}` : "",
    ].filter(Boolean),
    [mattressLabel, selectedBaseLabel, size, showMotion, selectedMotionLabel, isDualComfort, dcLeft, dcRight]
  );
  const currentStepMeta = useMemo(() => {
    if (stepKey === "mattress") {
      return {
        eyebrow: "Step 1",
        title: "Mattress",
        description: isDualComfort
          ? "This pod's mattress is fixed. If you want different left and right comfort, set it here."
          : "This pod's mattress is fixed. Use the results screen if you want to compare a different mattress.",
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
    if (stepKey === "size") {
      return {
        eyebrow: "Step 3",
        title: "Choose your size.",
        description: "Choose the size you want to price and add.",
      };
    }
    return {
      eyebrow: "Step 4",
      title: "Review your setup.",
      description: "Check the setup, then add it when you're ready.",
    };
  }, [stepKey, isDualComfort, showMotion]);
  const canProceed =
    stepKey === "mattress"
      ? !isDualComfort || Boolean(dcLeft && dcRight)
      : stepKey === "base"
        ? Boolean(baseType) && (!showMotion || Boolean(motionType))
        : stepKey === "size"
      ? Boolean(size)
        : canAdd;

  useEffect(() => {
    if (!onPreviewChange) return;

    const preview = (() => {
      if (stepKey === "mattress") {
        return {
          title: mattressLabel,
          caption: isDualComfort
            ? "This pod's mattress is fixed, but you can set left and right comfort before you add it."
            : "This pod's mattress is fixed. Compare another pod if you want a different mattress.",
          items: [
            `Mattress: ${mattressLabel}`,
            isDualComfort ? `Comfort: ${dcLeft || "Not selected"} / ${dcRight || "Not selected"}` : "",
            `Location: ${podLabel}`,
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
            showMotion ? `Motion: ${selectedMotionLabel}` : "Motion: No Motion",
            size ? `Size: ${size}` : "",
            size && supportsSplitMotion ? `Available motion for ${size}: ${availableMotionLabel}.` : "",
          ].filter(Boolean),
          nextAction: "Next: Choose your size",
        };
      }

      if (stepKey === "size") {
        return {
          title: size ? `${size} setup` : "Choose your size",
          caption: size ? `Selected size: ${size}.` : "Choose a size to begin.",
          items: [
            size ? `Size: ${size}` : "Choose a size to begin.",
            size ? subtitleForSize(size) : "",
            supportsSplitMotion && size
              ? `Available motion with ${size}: ${availableMotionLabel}.`
              : "",
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
    supportsSplitMotion,
    availableMotionLabel,
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
    setStepKey("mattress");
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
                  const allowed = allowedMotion.includes(option.value);
                  return (
                    <ChoiceCard
                      key={option.value}
                      title={option.label}
                      subtitle={allowed ? subtitleForMotion(option.value) : "Not available with this size."}
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
              Choose Adjustable Base if you want motion options.
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
    <div className="w-full">
      <div className="grid gap-2.5 lg:grid-cols-[minmax(226px,0.9fr)_minmax(250px,1.04fr)_252px] lg:items-start">
        <div className="flex flex-col rounded-[24px] border border-white/80 bg-white/96 p-3 shadow-[0_16px_40px_rgba(45,71,136,0.08)]">
          <div className="shrink-0">
            <div className="text-[0.74rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">
              Build This Setup
            </div>
            <div className="mt-1 text-[1.28rem] font-extrabold tracking-tight text-slate-900">
              {currentStepMeta.title}
            </div>
            <div className="mt-1 text-[0.85rem] leading-5 text-slate-600">{currentStepMeta.description}</div>
          </div>

          <div className="mt-3 grid shrink-0 grid-cols-2 gap-2">
            {steps.map((step, index) => (
              <BuilderStepButton
                key={step.key}
                step={step}
                index={index}
                active={step.key === stepKey}
                unlocked
                onClick={() => setStepKey(step.key)}
              />
            ))}
          </div>

          <div className="mt-3 flex-1 pr-1">{renderCurrentStep()}</div>

          <div className="mt-3 flex shrink-0 flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={goBack}
              disabled={!canGoBack}
              className="rounded-[16px] px-4 py-3 text-sm font-extrabold"
            >
              Back
            </Button>
            <Button
              onClick={goNext}
              disabled={!nextStep || !canProceed}
              className="rounded-[16px] px-4 py-3 text-sm font-extrabold"
            >
              {nextStep ? `Next: ${nextStep.label}` : "Review your setup"}
            </Button>
          </div>
        </div>

        <div className="grid auto-rows-fr gap-2.5">
          <BuilderSelectionCard
            step={1}
            label="Mattress"
            value={mattressLabel}
            subtitle={
              isDualComfort
                ? `Comfort: ${dcLeft || "Not selected"} / ${dcRight || "Not selected"}`
                : "Fixed to this pod"
            }
            image={mattressImage}
            icon={BedDouble}
            imageFit="cover"
            onChange={onViewResults}
          />
          <BuilderSelectionCard
            step={2}
            label="Base"
            value={selectedBaseLabel}
            subtitle={showMotion ? `${selectedMotionLabel} motion` : subtitleForBase(baseType)}
            image={selectedBaseImage}
            icon={SlidersHorizontal}
            onChange={() => setStepKey("base")}
          />
          <BuilderSelectionCard
            step={3}
            label="Size"
            value={size || "Choose your size"}
            subtitle={subtitleForSize(size)}
            image=""
            icon={Ruler}
            onChange={() => setStepKey("size")}
          />
        </div>

        <div className="flex flex-col rounded-[24px] border border-white/80 bg-white/96 p-3 shadow-[0_16px_40px_rgba(45,71,136,0.08)]">
          <div className="text-[0.74rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">
            Pricing
          </div>

          <div className="mt-2.5 grid gap-2.5">
            <BuilderMetricCard label="Estimated monthly" value={`${money(monthly)}/mo`} />
            <BuilderMetricCard label="Estimated total" value={money(previewTotal)} />
          </div>

          <div className="mt-2.5 rounded-[20px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-[0.84rem] text-slate-700">
            <div className="font-extrabold text-slate-900">{podLabel}</div>
            <div className="mt-1">
              {showMotion ? selectedMotionLabel : "No Motion"} / {wantsBase ? selectedBaseLabel : "Mattress Only"}
            </div>
          </div>

          <div className="mt-auto space-y-2.5 pt-3">
            <Button
              onClick={addToPlan}
              disabled={!canAdd}
              className="min-h-[56px] w-full rounded-[18px] px-5 text-[0.96rem] font-extrabold"
            >
              <span>{primaryCtaLabel}</span>
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              onClick={viewCart}
              className="min-h-[46px] w-full rounded-[16px] px-5 text-sm font-extrabold"
            >
              Open Cart
            </Button>

            <button
              type="button"
              onClick={resetBuild}
              className="w-full text-center text-sm font-extrabold text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline"
            >
              Start Over
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
