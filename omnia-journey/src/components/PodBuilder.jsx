import { useEffect, useMemo, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/useStore";

import {
  SIZE_OPTIONS,
  BASE_OPTIONS_UI,
  MATTRESS_OPTIONS_UI,
  MOTION_TYPES_UI,
  DUAL_COMFORT_OPTIONS,
  getBaseHandleForType,
  getMattressHandleForType,
} from "@/lib/utils/recommendations";

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */

function lower(v) {
  return String(v || "").toLowerCase().trim();
}

function money(n) {
  const x = typeof n === "number" && Number.isFinite(n) ? n : Number(n);
  const v = Number.isFinite(x) ? x : 0;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

function monthlyEstimate(total) {
  const t = typeof total === "number" && Number.isFinite(total) ? total : Number(total);
  const safe = Number.isFinite(t) ? t : 0;
  return safe / 12;
}

function isLikelyRenderableImageUrl(value) {
  const s = String(value || "").trim();
  if (!s) return false;

  if (/^data:image\//i.test(s)) return true;
  if (/^blob:/i.test(s)) return true;
  if (/^https?:\/\//i.test(s)) return true;

  if (/^\/pods\//i.test(s)) return false;
  if (/^pods\//i.test(s)) return false;

  if (/^\//.test(s) && /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(s)) return true;

  return false;
}

function sanitizeImageUrl(value) {
  const s = String(value || "").trim();
  return isLikelyRenderableImageUrl(s) ? s : "";
}

function pickFeaturedImage(p) {
  const candidates = [
    p?.imageUrl,
    p?.image,
    p?.featuredImage?.url,
    p?.featuredImage?.src,
    p?.images?.[0]?.url,
    p?.images?.[0]?.src,
    p?.images?.edges?.[0]?.node?.url,
    p?.media?.[0]?.image?.url,
    p?.media?.[0]?.preview?.image?.url,
  ];

  for (const candidate of candidates) {
    const url = sanitizeImageUrl(candidate);
    if (url) return url;
  }

  return "/no-image.svg";
}

function normalizeVariants(product) {
  const v = product?.variants;
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.edges)) return v.edges.map((e) => e?.node).filter(Boolean);
  if (Array.isArray(v?.nodes)) return v.nodes.filter(Boolean);
  return [];
}

function parseVariantPrice(variant) {
  const amt =
    variant?.price?.amount ??
    variant?.priceV2?.amount ??
    variant?.priceAmount ??
    variant?.price ??
    null;

  const n = Number(String(amt ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function variantMatchesSize(variant, size) {
  const target = lower(size);
  if (!target) return false;

  const opts = Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : [];
  return opts.some((o) => lower(o?.value) === target);
}

function pickVariantForSize(product, size) {
  const variants = normalizeVariants(product);
  if (!variants.length) return null;
  const found = variants.find((v) => variantMatchesSize(v, size));
  return found || variants[0] || null;
}

function safeVariantId(v) {
  const id = v?.id ? String(v.id).trim() : "";
  if (!id) return null;
  if (!id.startsWith("gid://shopify/ProductVariant/")) return null;
  return id;
}

function allowedMotionTypesForSize(size) {
  const s = String(size || "");
  if (s === "King") return ["standard", "half_split", "full_split"];
  if (s === "Queen") return ["standard", "half_split"];
  return ["standard"];
}

function labelFor(list, value, fallback = "—") {
  const found = Array.isArray(list) ? list.find((x) => x?.value === value) : null;
  return found?.label || fallback;
}

function isSplitMotion(motionType) {
  return motionType === "half_split" || motionType === "full_split";
}

function inferBaseTypeFromPod(pod) {
  const h = lower(pod?.baseHandle);
  const label = lower(pod?.displayedIn?.baseLabel);
  const motion = lower(pod?.displayedIn?.motion);

  if (h.includes("adjust") || h.includes("motion") || label.includes("adjustable") || motion.includes("motion")) {
    return "adjustable";
  }
  if (h.includes("storage") || label.includes("storage")) return "storage";
  if (h.includes("platform") || label.includes("platform")) return "platform";
  if (!h) return "none";
  return "none";
}

function inferMotionTypeFromPod(pod) {
  const m = lower(pod?.displayedIn?.motion);
  if (m.includes("full split")) return "full_split";
  if (m.includes("half split")) return "half_split";
  return "standard";
}

function inferMattressTypeFromPod(pod) {
  const h = lower(pod?.mattressHandle);
  if (h.includes("dual") && h.includes("comfort")) return "dual12";
  if (h.includes("hybrid") && h.includes("14")) return "hybrid14";
  if (h.includes("14") && h.includes("hybrid")) return "hybrid14";
  if (h.includes("foam") && h.includes("10")) return "foam10";
  if (h.includes("foam") && h.includes("12")) return "foam12";
  if (h.includes("hybrid")) return "hybrid14";
  if (h.includes("foam")) return "foam12";
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

function optionSubtitleForBase(value) {
  if (value === "adjustable") return "Motion ready";
  if (value === "storage") return "Storage base";
  if (value === "platform") return "Platform base";
  return "Mattress only";
}

function optionSubtitleForMotion(value) {
  if (value === "full_split") return "King only";
  if (value === "half_split") return "Queen or King";
  return "Standard motion";
}

function optionSubtitleForMattress(value) {
  if (value === "dual12") return "Dual comfort";
  if (value === "hybrid14") return "Hybrid feel";
  if (value === "foam10") return "10 inch foam";
  return "12 inch foam";
}

function getStepMeta(stepKey) {
  switch (stepKey) {
    case "size":
      return {
        eyebrow: "Step 1",
        title: "Choose Your Size",
        description: "Pick the size first. The rest of the build follows from this.",
      };
    case "base":
      return {
        eyebrow: "Step 2",
        title: "Choose Your Base",
        description: "Decide whether you want mattress only, a platform base, or adjustable base.",
      };
    case "motion":
      return {
        eyebrow: "Step 3",
        title: "Choose Your Motion",
        description: "Motion options only apply when adjustable base is selected.",
      };
    case "mattress":
      return {
        eyebrow: "Next Step",
        title: "Choose Your Mattress",
        description: "Now choose the mattress that fits this setup.",
      };
    case "dual":
      return {
        eyebrow: "Final Step",
        title: "Choose Dual Comfort",
        description: "Set the left and right feel separately for this mattress.",
      };
    default:
      return {
        eyebrow: "Build Your Pod",
        title: "Build Your Pod",
        description: "Choose your setup one step at a time.",
      };
  }
}

/* ─────────────────────────────────────────────
   UI bits
───────────────────────────────────────────── */

function StepPill({ active, done, children, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "inline-flex items-center justify-center rounded-full border px-4 py-2 text-xs font-extrabold uppercase tracking-[0.16em] transition",
        disabled
          ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
          : active
          ? "border-indigo-600 bg-indigo-600 text-white"
          : done
          ? "border-gray-200 bg-white text-gray-900"
          : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function ChoiceCard({
  title,
  subtitle,
  selected,
  onClick,
  disabled = false,
  featured = false,
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "w-full rounded-3xl border p-5 text-left shadow-sm transition md:p-6",
        disabled ? "cursor-not-allowed opacity-50" : "hover:shadow-md",
        selected
          ? "border-indigo-500 bg-indigo-50"
          : featured
          ? "border-gray-300 bg-gray-50"
          : "border-gray-200 bg-white",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-extrabold text-gray-900">{title}</div>
          {subtitle ? <div className="mt-2 text-sm text-gray-600">{subtitle}</div> : null}
        </div>

        <div
          className={[
            "mt-1 h-6 w-6 shrink-0 rounded-full border",
            selected ? "border-indigo-600 bg-indigo-600" : "border-gray-300 bg-white",
          ].join(" ")}
          aria-hidden
        >
          {selected ? <div className="mx-auto mt-1 h-2.5 w-2.5 rounded-full bg-white" /> : null}
        </div>
      </div>
    </button>
  );
}

function StepHeader({ eyebrow, title, description, currentStepIndex, totalSteps }) {
  return (
    <div className="rounded-3xl border bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm md:p-7">
      <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">{eyebrow}</div>
      <div className="mt-2 text-3xl font-extrabold text-gray-900 md:text-4xl">{title}</div>
      <div className="mt-2 max-w-2xl text-base text-gray-700">{description}</div>
      <div className="mt-4 text-xs font-semibold text-gray-500">
        Step {currentStepIndex + 1} of {totalSteps}
      </div>
    </div>
  );
}

function EstimateStrip({ monthly, previewTotal }) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
            Estimated Monthly
          </div>
          <div className="mt-2 text-3xl font-extrabold text-indigo-950">{money(monthly)}</div>
        </div>

        <div className="text-right">
          <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
            Estimated Total
          </div>
          <div className="mt-2 text-xl font-extrabold text-gray-900">{money(previewTotal)}</div>
        </div>
      </div>
    </div>
  );
}

function PreviewPanel({
  wantsBase,
  selectedMattressLabel,
  selectedBaseLabel,
  selectedMotionLabel,
  isDualComfort,
  dcLeft,
  dcRight,
  mattressProduct,
  baseProduct,
  mattressImage,
  baseImage,
  canAddMattress,
  baseMerchId,
  baseMismatch,
}) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="mb-4">
        <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">Your Build</div>
        <div className="mt-2 text-2xl font-extrabold text-gray-900">Review Before You Add to Cart</div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-3xl border bg-gray-50 p-4">
          <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
            Mattress
          </div>

          <div className="mt-3 flex gap-4">
            <img
              src={mattressImage}
              alt={mattressProduct?.title || "Mattress"}
              className="h-24 w-24 rounded-2xl border bg-white object-cover"
              onError={(e) => {
                e.currentTarget.src = "/no-image.svg";
              }}
            />

            <div className="min-w-0">
              <div className="text-lg font-extrabold text-gray-900">{selectedMattressLabel}</div>
              <div className="mt-1 text-sm text-gray-600">{mattressProduct?.title || "Mattress"}</div>

              {!canAddMattress ? (
                <div className="mt-2 text-sm font-semibold text-amber-700">Unavailable in this size</div>
              ) : null}

              {isDualComfort ? (
                <div className="mt-2 text-sm text-gray-700">
                  {dcLeft} / {dcRight}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border bg-gray-50 p-4">
          <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-500">
            Base
          </div>

          {!wantsBase ? (
            <div className="mt-3 text-base text-gray-700">Mattress Only</div>
          ) : baseMismatch ? (
            <div className="mt-3">
              <div className="text-lg font-extrabold text-gray-900">{selectedBaseLabel}</div>
              <div className="mt-1 text-sm text-amber-700">Base match pending</div>
            </div>
          ) : !baseProduct ? (
            <div className="mt-3 text-base text-gray-700">Loading base</div>
          ) : (
            <div className="mt-3 flex gap-4">
              <img
                src={baseImage}
                alt={baseProduct?.title || "Base"}
                className="h-24 w-24 rounded-2xl border bg-white object-cover"
                onError={(e) => {
                  e.currentTarget.src = "/no-image.svg";
                }}
              />

              <div className="min-w-0">
                <div className="text-lg font-extrabold text-gray-900">
                  {baseProduct?.title || selectedBaseLabel || "Base"}
                </div>
                <div className="mt-1 text-sm text-gray-600">{selectedMotionLabel}</div>

                {!baseMerchId ? (
                  <div className="mt-2 text-sm font-semibold text-amber-700">Unavailable in this size</div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FooterActions({
  primaryCtaLabel,
  secondaryCtaLabel,
  onAdd,
  onSave,
  onReset,
  onViewCart,
  onBack,
  canGoBack,
  isReadyToAdd,
}) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      {!isReadyToAdd ? (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Complete the steps above, then review your build before adding it to cart.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={!canGoBack}
          className="rounded-2xl py-6 text-base font-extrabold"
        >
          Back
        </Button>

        <Button
          onClick={onAdd}
          disabled={!isReadyToAdd}
          className="rounded-2xl py-6 text-base font-extrabold"
        >
          {primaryCtaLabel}
        </Button>

        <Button variant="outline" onClick={onSave} className="rounded-2xl py-6 text-base font-extrabold">
          {secondaryCtaLabel}
        </Button>

        <Button variant="outline" onClick={onReset} className="rounded-2xl py-6 text-base font-extrabold">
          Reset
        </Button>

        <Button variant="outline" onClick={onViewCart} className="rounded-2xl py-6 text-base font-extrabold">
          View Cart
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Component
───────────────────────────────────────────── */

export default function PodBuilder({
  pod,
  assessment,
  mattressProduct,
  baseProduct,
  onCue,
  onSelectionHandlesChange,
  onBuildStepChange,
  primaryCtaLabel = "Add to Cart",
  secondaryCtaLabel = "Save Build",
  onViewSnoozePod = undefined,
}) {
  const addToSnoozePod = useStore((s) => s.addToSnoozePod);
  const getSnoozePodSubtotal = useStore((s) => s.getSnoozePodSubtotal);

  const initialSize = assessment?.size || pod?.displayedIn?.size || pod?.meta?.size || "Queen";
  const initialBaseType = useMemo(() => inferBaseTypeFromPod(pod), [pod]);
  const initialMotionType = useMemo(() => inferMotionTypeFromPod(pod), [pod]);
  const initialMattressType = useMemo(() => inferMattressTypeFromPod(pod), [pod]);

  const savedBuild = useMemo(() => readSavedBuild(pod), [pod]);

  const [size, setSize] = useState(String(savedBuild?.size || initialSize || "Queen"));
  const [baseType, setBaseType] = useState(savedBuild?.baseType || initialBaseType);
  const [motionType, setMotionType] = useState(savedBuild?.motionType || initialMotionType);
  const [mattressType, setMattressType] = useState(savedBuild?.mattressType || initialMattressType);
  const [dcLeft, setDcLeft] = useState(savedBuild?.dcLeft || pod?.displayedIn?.dualComfort?.left || "Medium Firm");
  const [dcRight, setDcRight] = useState(savedBuild?.dcRight || pod?.displayedIn?.dualComfort?.right || "Medium Soft");

  const showMotion = baseType === "adjustable";
  const isDualComfort = mattressType === "dual12";
  const wantsBase = baseType !== "none";

  const steps = useMemo(() => {
    const list = [
      { key: "size", label: "Size" },
      { key: "base", label: "Base" },
    ];
    if (showMotion) list.push({ key: "motion", label: "Motion" });
    list.push({ key: "mattress", label: "Mattress" });
    if (isDualComfort) list.push({ key: "dual", label: "Comfort" });
    return list;
  }, [showMotion, isDualComfort]);

  const initialStepKey = useMemo(() => {
    const candidate = String(savedBuild?.stepKey || "size");
    return steps.some((s) => s.key === candidate) ? candidate : "size";
  }, [savedBuild?.stepKey, steps]);

  const [stepKey, setStepKey] = useState(initialStepKey);

  const allowedMotion = useMemo(() => allowedMotionTypesForSize(size), [size]);

  useEffect(() => {
    const exists = steps.some((s) => s.key === stepKey);
    if (!exists) {
      if (showMotion) {
        setStepKey("motion");
      } else if (stepKey === "motion") {
        setStepKey("mattress");
      } else if (isDualComfort) {
        setStepKey("dual");
      } else {
        setStepKey("mattress");
      }
    }
  }, [steps, stepKey, showMotion, isDualComfort]);

  useEffect(() => {
    if (typeof onBuildStepChange === "function") {
      onBuildStepChange(stepKey);
    }
  }, [stepKey, onBuildStepChange]);

  useEffect(() => {
    if (!showMotion && motionType !== "standard") {
      setMotionType("standard");
    }
  }, [showMotion, motionType]);

  useEffect(() => {
    if (!showMotion) return;

    if (!allowedMotion.includes(motionType)) {
      const next = allowedMotion[0] || "standard";
      setMotionType(next);
      onCue?.(`Motion updated to ${labelFor(MOTION_TYPES_UI, next, "Standard")}.`, "warning");
    }
  }, [allowedMotion, motionType, onCue, showMotion]);

  useEffect(() => {
    if (!showMotion) return;

    if (isSplitMotion(motionType) && mattressType !== "dual12") {
      setMattressType("dual12");
      onCue?.("Split motion requires Dual Comfort. Mattress updated.", "warning");
    }
  }, [showMotion, motionType, mattressType, onCue]);

  const expectedBaseHandle = useMemo(() => getBaseHandleForType(baseType), [baseType]);
  const expectedMattressHandle = useMemo(() => getMattressHandleForType(mattressType), [mattressType]);

  useEffect(() => {
    if (typeof onSelectionHandlesChange !== "function") return;

    onSelectionHandlesChange({
      mattressHandle: expectedMattressHandle || pod?.mattressHandle || null,
      baseHandle: baseType === "none" ? null : expectedBaseHandle || null,
    });
  }, [onSelectionHandlesChange, expectedMattressHandle, expectedBaseHandle, baseType, pod?.mattressHandle]);

  useEffect(() => {
    writeSavedBuild(pod, {
      size,
      baseType,
      motionType,
      mattressType,
      dcLeft,
      dcRight,
      stepKey,
    });
  }, [pod, size, baseType, motionType, mattressType, dcLeft, dcRight, stepKey]);

  const providedBaseHandle = useMemo(() => {
    return baseProduct?.handle ? String(baseProduct.handle).trim() : "";
  }, [baseProduct]);

  const baseMismatch = useMemo(() => {
    if (!wantsBase) return false;
    if (!expectedBaseHandle) return true;
    if (!providedBaseHandle) return true;
    return lower(providedBaseHandle) !== lower(expectedBaseHandle);
  }, [wantsBase, expectedBaseHandle, providedBaseHandle]);

  useEffect(() => {
    if (!baseMismatch || !wantsBase) return;

    const selected = labelFor(BASE_OPTIONS_UI, baseType, baseType);
    const expected = expectedBaseHandle || "—";
    const got = providedBaseHandle || "—";

    onCue?.(`Base mismatch blocked: selected "${selected}", expected "${expected}", got "${got}".`, "warning");
  }, [baseMismatch, wantsBase, baseType, expectedBaseHandle, providedBaseHandle, onCue]);

  const mattressVariant = useMemo(() => pickVariantForSize(mattressProduct, size), [mattressProduct, size]);

  const safeBaseProduct = baseMismatch ? null : baseProduct;
  const baseVariant = useMemo(() => pickVariantForSize(safeBaseProduct, size), [safeBaseProduct, size]);

  const mattressMerchId = useMemo(() => safeVariantId(mattressVariant), [mattressVariant]);
  const baseMerchId = useMemo(() => safeVariantId(baseVariant), [baseVariant]);

  const mattressPrice = useMemo(() => parseVariantPrice(mattressVariant), [mattressVariant]);
  const basePrice = useMemo(() => parseVariantPrice(baseVariant), [baseVariant]);

  const mattressImage = useMemo(() => pickFeaturedImage(mattressProduct), [mattressProduct]);
  const baseImage = useMemo(() => pickFeaturedImage(safeBaseProduct), [safeBaseProduct]);

  const previewTotal = useMemo(() => {
    const m = mattressPrice || 0;
    const b = wantsBase && !baseMismatch ? basePrice || 0 : 0;
    return m + b;
  }, [mattressPrice, basePrice, wantsBase, baseMismatch]);

  const monthly = useMemo(() => monthlyEstimate(previewTotal), [previewTotal]);

  const canAddMattress = Boolean(mattressMerchId);

  const selectedMattressLabel = useMemo(
    () => labelFor(MATTRESS_OPTIONS_UI, mattressType, mattressType),
    [mattressType]
  );
  const selectedBaseLabel = useMemo(
    () => labelFor(BASE_OPTIONS_UI, baseType, baseType),
    [baseType]
  );
  const selectedMotionLabel = useMemo(
    () => labelFor(MOTION_TYPES_UI, motionType, motionType),
    [motionType]
  );

  const done = useMemo(() => {
    const d = new Set();
    if (size) d.add("size");
    if (baseType) d.add("base");
    if (!showMotion || motionType) d.add("motion");
    if (mattressType) d.add("mattress");
    if (!isDualComfort || (dcLeft && dcRight)) d.add("dual");
    return d;
  }, [size, baseType, showMotion, motionType, mattressType, isDualComfort, dcLeft, dcRight]);

  const currentStepIndex = Math.max(0, steps.findIndex((s) => s.key === stepKey));
  const currentStepMeta = getStepMeta(stepKey);

  const canGoBack = currentStepIndex > 0;

  const isReadyToAdd = useMemo(() => {
    if (!canAddMattress) return false;
    if (wantsBase && baseMismatch) return false;
    if (wantsBase && !baseMerchId) return false;
    if (isDualComfort && (!dcLeft || !dcRight)) return false;
    return Boolean(size && baseType && mattressType);
  }, [canAddMattress, wantsBase, baseMismatch, baseMerchId, isDualComfort, dcLeft, dcRight, size, baseType, mattressType]);

  const goBack = useCallback(() => {
    if (!canGoBack) return;
    const prev = steps[currentStepIndex - 1];
    if (prev?.key) setStepKey(prev.key);
  }, [canGoBack, currentStepIndex, steps]);

  const clearConfiguration = useCallback(() => {
    setSize(String(initialSize || "Queen"));
    setBaseType(initialBaseType);
    setMotionType(initialMotionType);
    setMattressType(initialMattressType);
    setDcLeft(pod?.displayedIn?.dualComfort?.left || "Medium Firm");
    setDcRight(pod?.displayedIn?.dualComfort?.right || "Medium Soft");
    setStepKey("size");
    onCue?.("Build reset.", "tip");
  }, [
    initialSize,
    initialBaseType,
    initialMotionType,
    initialMattressType,
    onCue,
    pod?.displayedIn?.dualComfort?.left,
    pod?.displayedIn?.dualComfort?.right,
  ]);

  const addToPlan = useCallback(() => {
    if (!canAddMattress) {
      onCue?.("Mattress unavailable in this size.", "warning");
      return;
    }

    const podIdLabel = String(pod?.podId ?? pod?.id ?? "").trim();

    addToSnoozePod({
      merchandiseId: mattressMerchId,
      handle: mattressProduct?.handle || expectedMattressHandle || pod?.mattressHandle || null,
      title: mattressProduct?.title || "Mattress",
      imageUrl: mattressImage,
      unitPrice: mattressPrice,
      quantity: 1,
      attributes: [
        { key: "Size", value: size },
        { key: "Mattress", value: selectedMattressLabel },
        ...(isDualComfort ? [{ key: "Dual Comfort", value: "Yes" }] : []),
        ...(isDualComfort
          ? [
              { key: "Left Feel", value: dcLeft },
              { key: "Right Feel", value: dcRight },
            ]
          : []),
        ...(showMotion ? [{ key: "Motion", value: selectedMotionLabel }] : []),
        ...(podIdLabel ? [{ key: "SnoozePod", value: `SnoozePod ${podIdLabel}` }] : []),
      ],
    });

    if (wantsBase) {
      if (baseMismatch) {
        onCue?.("Mattress added. Base blocked.", "warning");
      } else if (!safeBaseProduct || !baseMerchId) {
        onCue?.("Mattress added. Base unavailable.", "warning");
      } else {
        addToSnoozePod({
          merchandiseId: baseMerchId,
          handle: safeBaseProduct?.handle || expectedBaseHandle || pod?.baseHandle || null,
          title: safeBaseProduct?.title || selectedBaseLabel || "Base",
          imageUrl: baseImage,
          unitPrice: basePrice,
          quantity: 1,
          attributes: [
            { key: "Size", value: size },
            { key: "Base", value: selectedBaseLabel },
            ...(showMotion ? [{ key: "Motion", value: selectedMotionLabel }] : []),
            ...(podIdLabel ? [{ key: "SnoozePod", value: `SnoozePod ${podIdLabel}` }] : []),
          ],
        });
      }
    }

    const baseSummary = wantsBase ? ` • ${selectedBaseLabel}` : " • Mattress Only";
    onCue?.(`Added to cart: ${String(size).toUpperCase()} • ${selectedMattressLabel}${baseSummary}.`, "success");
  }, [
    addToSnoozePod,
    baseImage,
    baseMerchId,
    baseMismatch,
    basePrice,
    canAddMattress,
    dcLeft,
    dcRight,
    expectedBaseHandle,
    expectedMattressHandle,
    isDualComfort,
    mattressImage,
    mattressMerchId,
    mattressPrice,
    mattressProduct?.handle,
    mattressProduct?.title,
    onCue,
    pod?.baseHandle,
    pod?.id,
    pod?.mattressHandle,
    pod?.podId,
    safeBaseProduct,
    selectedBaseLabel,
    selectedMattressLabel,
    selectedMotionLabel,
    showMotion,
    size,
    wantsBase,
  ]);

  const saveBuild = useCallback(() => {
    writeSavedBuild(pod, {
      size,
      baseType,
      motionType,
      mattressType,
      dcLeft,
      dcRight,
      stepKey,
    });

    const label = `${String(size).toUpperCase()} • ${selectedMattressLabel}${wantsBase ? ` • ${selectedBaseLabel}` : " • Mattress Only"}`;
    onCue?.(`Saved: ${label}.`, "success");
  }, [
    pod,
    size,
    baseType,
    motionType,
    mattressType,
    dcLeft,
    dcRight,
    stepKey,
    onCue,
    selectedMattressLabel,
    wantsBase,
    selectedBaseLabel,
  ]);

  const viewCart = useCallback(() => {
    const subtotal = getSnoozePodSubtotal?.() ?? 0;
    onCue?.(`Cart: ${money(subtotal)}.`, "tip");
    if (typeof onViewSnoozePod === "function") onViewSnoozePod();
  }, [getSnoozePodSubtotal, onCue, onViewSnoozePod]);

  return (
    <div className="space-y-6">
      <StepHeader
        eyebrow={currentStepMeta.eyebrow}
        title={currentStepMeta.title}
        description={currentStepMeta.description}
        currentStepIndex={currentStepIndex}
        totalSteps={steps.length}
      />

      <div className="flex flex-wrap gap-2">
        {steps.map((s, index) => {
          const locked = index > currentStepIndex && !done.has(s.key);

          return (
            <StepPill
              key={s.key}
              active={s.key === stepKey}
              done={done.has(s.key)}
              disabled={locked}
              onClick={() => {
                if (locked) return;
                setStepKey(s.key);
              }}
            >
              {s.label}
            </StepPill>
          );
        })}
      </div>

      <EstimateStrip monthly={monthly} previewTotal={previewTotal} />

      {stepKey === "size" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {SIZE_OPTIONS.map((option) => (
              <ChoiceCard
                key={option}
                title={option}
                subtitle={size === option ? "Selected" : "Choose size"}
                selected={size === option}
                featured={size === option}
                onClick={() => {
                  setSize(option);

                  if (baseType === "adjustable") {
                    const allowed = allowedMotionTypesForSize(option);
                    const safeMotion = allowed.includes(motionType) ? motionType : allowed[0] || "standard";
                    setMotionType(safeMotion);

                    if (isSplitMotion(safeMotion)) {
                      setMattressType("dual12");
                    }
                  }

                  setStepKey("base");
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {stepKey === "base" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {BASE_OPTIONS_UI.map((option) => (
              <ChoiceCard
                key={option.value}
                title={option.label}
                subtitle={optionSubtitleForBase(option.value)}
                selected={baseType === option.value}
                featured={baseType === option.value}
                onClick={() => {
                  setBaseType(option.value);

                  if (option.value !== "adjustable") {
                    setMotionType("standard");
                    setStepKey("mattress");
                    onCue?.(`${option.label} selected.`, "success");
                  } else {
                    setStepKey("motion");
                    onCue?.("Adjustable base selected.", "success");
                  }
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {stepKey === "motion" && showMotion ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {MOTION_TYPES_UI.map((option) => {
              const allowed = allowedMotion.includes(option.value);

              return (
                <ChoiceCard
                  key={option.value}
                  title={option.label}
                  subtitle={optionSubtitleForMotion(option.value)}
                  selected={motionType === option.value}
                  disabled={!allowed}
                  featured={motionType === option.value}
                  onClick={() => {
                    if (!allowed) return;

                    setMotionType(option.value);

                    if (isSplitMotion(option.value)) {
                      setMattressType("dual12");
                    }

                    setStepKey("mattress");
                  }}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {stepKey === "mattress" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {MATTRESS_OPTIONS_UI.map((option) => {
              const disabled = isSplitMotion(motionType) && option.value !== "dual12";

              return (
                <ChoiceCard
                  key={option.value}
                  title={option.label}
                  subtitle={optionSubtitleForMattress(option.value)}
                  selected={mattressType === option.value}
                  disabled={disabled}
                  featured={mattressType === option.value}
                  onClick={() => {
                    if (disabled) return;

                    setMattressType(option.value);

                    if (option.value === "dual12") {
                      setStepKey("dual");
                    } else {
                      onCue?.(`${option.label} selected. Review your build below.`, "success");
                    }
                  }}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {stepKey === "dual" && isDualComfort ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <div className="text-sm font-extrabold uppercase tracking-[0.16em] text-gray-500">
                Left
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {DUAL_COMFORT_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={`left-${option}`}
                    title={option}
                    selected={dcLeft === option}
                    featured={dcLeft === option}
                    onClick={() => setDcLeft(option)}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <div className="text-sm font-extrabold uppercase tracking-[0.16em] text-gray-500">
                Right
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {DUAL_COMFORT_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={`right-${option}`}
                    title={option}
                    selected={dcRight === option}
                    featured={dcRight === option}
                    onClick={() => setDcRight(option)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <PreviewPanel
        wantsBase={wantsBase}
        selectedMattressLabel={selectedMattressLabel}
        selectedBaseLabel={selectedBaseLabel}
        selectedMotionLabel={selectedMotionLabel}
        isDualComfort={isDualComfort}
        dcLeft={dcLeft}
        dcRight={dcRight}
        mattressProduct={mattressProduct}
        baseProduct={safeBaseProduct}
        mattressImage={mattressImage}
        baseImage={baseImage}
        canAddMattress={Boolean(mattressProduct && pickVariantForSize(mattressProduct, size))}
        baseMerchId={baseMerchId}
        baseMismatch={baseMismatch}
      />

      <FooterActions
        primaryCtaLabel={primaryCtaLabel}
        secondaryCtaLabel={secondaryCtaLabel}
        onAdd={addToPlan}
        onSave={saveBuild}
        onReset={clearConfiguration}
        onViewCart={viewCart}
        onBack={goBack}
        canGoBack={canGoBack}
        isReadyToAdd={isReadyToAdd}
      />
    </div>
  );
}