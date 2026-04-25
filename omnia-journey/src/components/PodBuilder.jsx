import { useCallback, useEffect, useMemo, useState } from "react";
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

function money(value) {
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

function monthlyEstimate(total) {
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

function pickFeaturedImage(product) {
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

  return "/no-image.svg";
}

function normalizeVariants(product) {
  const variants = product?.variants;
  if (Array.isArray(variants)) return variants;
  if (Array.isArray(variants?.edges)) return variants.edges.map((edge) => edge?.node).filter(Boolean);
  if (Array.isArray(variants?.nodes)) return variants.nodes.filter(Boolean);
  return [];
}

function parseVariantPrice(variant) {
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

function pickVariantForSize(product, size) {
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

function inferBaseTypeFromPod(pod) {
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

function inferMotionTypeFromPod(pod) {
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

function buildDefaultSelections({ assessment, pod, supportsSplitMotion, isDualComfort }) {
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
        "w-full rounded-3xl border p-5 text-left shadow-sm transition md:p-6",
        disabled ? "cursor-not-allowed opacity-50" : "hover:-translate-y-0.5 hover:shadow-md",
        active ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-extrabold text-gray-900">{title}</div>
          {subtitle ? <div className="mt-2 text-sm text-gray-600">{subtitle}</div> : null}
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

function subtitleForSize(option) {
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

function subtitleForBase(option) {
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

export default function PodBuilder({
  pod,
  assessment,
  mattressProduct,
  baseProduct,
  onCue,
  onSelectionHandlesChange,
  onBuildStepChange,
  primaryCtaLabel = "Add to Cart",
  onViewSnoozePod,
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
  const steps = useMemo(() => {
    const list = [
      { key: "size", label: "Size" },
      { key: "base", label: "Base" },
    ];
    if (showMotion) list.push({ key: "motion", label: "Motion" });
    if (isDualComfort) list.push({ key: "dual", label: "Comfort" });
    list.push({ key: "review", label: "Review" });
    return list;
  }, [showMotion, isDualComfort]);

  const [stepKey, setStepKey] = useState(() => {
    const candidate = String(compatibleSavedBuild?.stepKey || "size").trim();
    return steps.some((step) => step.key === candidate) ? candidate : "size";
  });

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
    setStepKey(isDualComfort ? "dual" : "review");
  }, [steps, stepKey, isDualComfort]);

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
  const currentStepIndex = Math.max(0, steps.findIndex((step) => step.key === stepKey));
  const nextStep = steps[currentStepIndex + 1] || null;
  const canGoBack = currentStepIndex > 0;
  const currentStepMeta = useMemo(() => {
    if (stepKey === "size") {
      return {
        eyebrow: "Choose your size",
        title: "Pick the size that feels right for your room and sleep setup.",
      };
    }
    if (stepKey === "base") {
      return {
        eyebrow: "Choose your base",
        title: "Decide how you want this SnoozePod set up underneath.",
      };
    }
    if (stepKey === "motion") {
      return {
        eyebrow: "Choose your motion",
        title: "Pick the motion setup that fits the way you want to rest.",
      };
    }
    if (stepKey === "dual") {
      return {
        eyebrow: "Choose your comfort setup",
        title: "Set the feel on each side so the bed matches the way you want it to sleep.",
      };
    }
    return {
      eyebrow: "Your SnoozePod",
      title: "Review your setup before adding it to your cart.",
    };
  }, [stepKey]);
  const canProceed =
    stepKey === "size"
      ? Boolean(size)
      : stepKey === "base"
        ? Boolean(baseType)
        : stepKey === "motion"
          ? Boolean(motionType)
          : stepKey === "dual"
            ? Boolean(dcLeft && dcRight)
            : Boolean(mattressMerchId) && (!wantsBase || Boolean(baseMerchId));

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

    const podLabel = String(pod?.podId ?? pod?.id ?? "").trim();

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
        ...(podLabel ? [{ key: "SnoozePod", value: `SnoozePod ${podLabel}` }] : []),
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
          ...(podLabel ? [{ key: "SnoozePod", value: `SnoozePod ${podLabel}` }] : []),
        ],
      });
    }

    onCue?.(`Added to cart: ${size} ${mattressLabel}${wantsBase ? ` with ${selectedBaseLabel}` : ""}.`, "success");
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
    onCue?.(`Cart: ${money(getSnoozePodSubtotal?.() ?? 0)}.`, "tip");
    onViewSnoozePod?.();
  }, [getSnoozePodSubtotal, onCue, onViewSnoozePod]);

  return (
    <div className="space-y-5 p-5 md:p-6">
      <div className="rounded-[32px] border bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-6 shadow-sm">
        <div className="rounded-3xl bg-white/90 px-6 py-7 text-center shadow-sm md:px-8">
          <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
            Finish Your SnoozePod
          </div>
          <div className="mt-2 text-3xl font-extrabold tracking-tight text-gray-900 md:text-5xl">
            Choose your size, base, and comfort setup.
          </div>
          <div className="mx-auto mt-3 max-w-3xl text-base leading-7 text-gray-700 md:text-lg">
            Then review everything before adding it to your cart.
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 rounded-3xl border border-white/70 bg-white/85 p-3 shadow-sm">
          {steps.map((step, index) => {
            const clickable = index <= currentStepIndex;
            return (
              <button
                key={step.key}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && setStepKey(step.key)}
                className={[
                  "rounded-full border px-4 py-2 text-xs font-extrabold uppercase tracking-[0.16em] transition",
                  step.key === stepKey
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : clickable
                      ? "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                      : "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400",
                ].join(" ")}
              >
                {step.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          <div className="rounded-2xl border bg-white px-4 py-3 text-right shadow-sm">
            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
              Estimated Monthly
            </div>
            <div className="mt-1 text-xl font-extrabold text-indigo-950">{money(monthly)}</div>
          </div>

          <div className="rounded-2xl border bg-white px-4 py-3 text-right shadow-sm">
            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
              Estimated Total
            </div>
            <div className="mt-1 text-xl font-extrabold text-gray-900">{money(previewTotal)}</div>
          </div>
        </div>
      </div>

      {stepKey !== "review" ? (
        <div className="rounded-3xl border bg-white p-5 shadow-sm md:p-6">
          <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
            Step {currentStepIndex + 1} of {steps.length}
          </div>
          <div className="mt-2 text-2xl font-extrabold tracking-tight text-gray-900 md:text-3xl">
            {currentStepMeta.title}
          </div>
          <div className="mt-2 text-sm font-semibold uppercase tracking-[0.14em] text-gray-400">
            {currentStepMeta.eyebrow}
          </div>

          {stepKey === "size" ? (
            <div className="mt-5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
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
          ) : null}

          {stepKey === "base" ? (
            <div className="mt-5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
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
          ) : null}

          {stepKey === "motion" && showMotion ? (
            <div className="mt-5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
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
          ) : null}

          {stepKey === "dual" && isDualComfort ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border bg-slate-50 p-5">
                <div className="text-sm font-extrabold uppercase tracking-[0.16em] text-gray-500">Left Side</div>
                <div className="mt-2 text-base text-gray-600">Choose the feel you want on this side.</div>
                <div className="mt-4 grid gap-3">
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

              <div className="rounded-3xl border bg-slate-50 p-5">
                <div className="text-sm font-extrabold uppercase tracking-[0.16em] text-gray-500">Right Side</div>
                <div className="mt-2 text-base text-gray-600">Set the feel you want on the other side.</div>
                <div className="mt-4 grid gap-3">
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
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={goBack}
              disabled={!canGoBack}
              className="rounded-2xl px-5 py-6 text-base font-extrabold"
            >
              Back
            </Button>
            <Button
              onClick={goNext}
              disabled={!canProceed}
              className="rounded-2xl px-6 py-6 text-base font-extrabold"
            >
              {nextStep?.key === "review" ? "Review Your Setup" : "Next"}
            </Button>
          </div>
        </div>
      ) : null}

      {stepKey === "review" ? (
        <div className="space-y-4">
          <div className="rounded-[32px] border bg-white p-5 shadow-sm md:p-6">
            <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.78fr)_minmax(0,1.22fr)] xl:items-start">
              <div className="rounded-3xl border bg-slate-50 p-5">
                <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
                  Mattress
                </div>
                <div className="mt-4 flex gap-4">
                  <img
                    src={pickFeaturedImage(mattressProduct)}
                    alt={mattressLabel}
                    className="h-28 w-28 rounded-3xl border bg-white object-cover"
                    onError={(event) => {
                      event.currentTarget.src = "/no-image.svg";
                    }}
                  />
                  <div className="min-w-0">
                    <div className="text-xl font-extrabold text-gray-900">{mattressLabel}</div>
                    <div className="mt-2 text-sm leading-6 text-gray-600">
                      Your size, base, motion, and comfort choices finish the setup around this
                      mattress.
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border bg-slate-50 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-2xl font-extrabold tracking-tight text-gray-900 md:text-3xl">
                      Review Your Setup
                    </div>
                    <div className="mt-2 max-w-2xl text-sm leading-6 text-gray-600 md:text-base">
                      Take one last look before adding this SnoozePod to your cart.
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-end gap-3">
                    <div className="rounded-2xl bg-white px-4 py-3 text-right shadow-sm">
                      <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
                        Estimated Monthly
                      </div>
                      <div className="mt-1 text-xl font-extrabold text-indigo-950">{money(monthly)}</div>
                    </div>

                    <div className="rounded-2xl bg-white px-4 py-3 text-right shadow-sm">
                      <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
                        Estimated Total
                      </div>
                      <div className="mt-1 text-xl font-extrabold text-gray-900">{money(previewTotal)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-3xl border bg-slate-50 p-5">
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
                <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                  <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
                    Mattress
                  </div>
                  <div className="mt-1 text-lg font-extrabold text-gray-900">{mattressLabel}</div>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                  <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
                    Size
                  </div>
                  <div className="mt-1 text-lg font-extrabold text-gray-900">{size}</div>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                  <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
                    Base
                  </div>
                  <div className="mt-1 text-lg font-extrabold text-gray-900">{selectedBaseLabel}</div>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                  <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
                    Motion
                  </div>
                  <div className="mt-1 text-lg font-extrabold text-gray-900">
                    {showMotion ? selectedMotionLabel : "No Motion"}
                  </div>
                </div>
                {isDualComfort ? (
                  <div className="rounded-2xl bg-white px-4 py-3 shadow-sm sm:[grid-column:span_2/span_2] xl:[grid-column:auto]">
                    <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
                      Comfort Setup
                    </div>
                    <div className="mt-1 text-lg font-extrabold text-gray-900">{dcLeft} / {dcRight}</div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-4 border-t border-slate-200 pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  onClick={goBack}
                  disabled={!canGoBack}
                  className="rounded-2xl px-5 py-6 text-base font-extrabold"
                >
                  Back
                </Button>
                <Button
                  onClick={addToPlan}
                  disabled={!canProceed}
                  className="rounded-2xl px-6 py-6 text-base font-extrabold"
                >
                  {primaryCtaLabel}
                </Button>
                <Button
                  variant="outline"
                  onClick={viewCart}
                  className="rounded-2xl px-5 py-6 text-base font-extrabold"
                >
                  View Cart
                </Button>
              </div>

              <button
                type="button"
                onClick={resetBuild}
                className="mt-4 text-sm font-extrabold text-gray-500 underline-offset-4 hover:text-gray-800 hover:underline"
              >
                Start Over
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
