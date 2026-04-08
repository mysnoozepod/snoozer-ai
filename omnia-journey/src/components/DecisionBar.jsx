// src/components/DecisionBar.jsx
import { useMemo, useState } from "react";
import { CheckCircle2, Pencil } from "lucide-react";

const MOTION_OPTIONS = ["No Motion", "Standard Motion", "Half Split Motion", "Full Split Motion"];
const FALLBACK_SIZES = ["King", "Queen", "Full", "Twin XL", "Twin"];

function cleanText(v) {
  return String(v || "").trim();
}

function uniqNonEmpty(arr) {
  return Array.from(new Set((arr || []).map(cleanText).filter(Boolean)));
}

function pickSafeValue(value, options) {
  const v = cleanText(value);
  if (v && options.includes(v)) return v;
  return options[0] || "";
}

export default function DecisionBar({
  size,
  motion,
  mattress,

  onChangeSize,
  onChangeMotion,
  onChangeMattress,

  sizeOptions,
  motionOptions,
}) {
  const [editSize, setEditSize] = useState(false);
  const [editMotion, setEditMotion] = useState(false);

  const sizes = useMemo(() => {
    const arr = Array.isArray(sizeOptions) && sizeOptions.length ? sizeOptions : FALLBACK_SIZES;
    return uniqNonEmpty(arr);
  }, [sizeOptions]);

  const motions = useMemo(() => {
    const arr = Array.isArray(motionOptions) && motionOptions.length ? motionOptions : MOTION_OPTIONS;
    return uniqNonEmpty(arr);
  }, [motionOptions]);

  const currentSize = useMemo(() => pickSafeValue(size, sizes), [size, sizes]);
  const currentMotion = useMemo(() => pickSafeValue(motion, motions), [motion, motions]);

  const canEditSize = sizes.length > 1 && typeof onChangeSize === "function";
  const canEditMotion = motions.length > 1 && typeof onChangeMotion === "function";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {/* SIZE */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-gray-500">Size</div>
          <button
            type="button"
            onClick={() => {
              if (!canEditSize) return;
              setEditSize((v) => !v);
            }}
            disabled={!canEditSize}
            className={[
              "inline-flex items-center gap-1 text-xs font-semibold",
              canEditSize
                ? "text-indigo-700 hover:text-indigo-800"
                : "text-gray-400 cursor-not-allowed",
            ].join(" ")}
            aria-disabled={!canEditSize}
            title={canEditSize ? "Edit size" : "Size locked by selection"}
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        </div>

        <div className="mt-2 flex items-start gap-2">
          <CheckCircle2 className="w-5 h-5 text-indigo-600 mt-0.5" />
          <div className="text-sm font-semibold text-gray-900">{currentSize || "—"}</div>
        </div>

        {editSize && canEditSize && (
          <div className="mt-3">
            <select
              className="w-full h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm"
              value={currentSize}
              onChange={(e) => {
                const v = e.target.value;
                setEditSize(false);
                onChangeSize?.(v);
              }}
            >
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* MOTION */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-gray-500">Motion</div>
          <button
            type="button"
            onClick={() => {
              if (!canEditMotion) return;
              setEditMotion((v) => !v);
            }}
            disabled={!canEditMotion}
            className={[
              "inline-flex items-center gap-1 text-xs font-semibold",
              canEditMotion
                ? "text-indigo-700 hover:text-indigo-800"
                : "text-gray-400 cursor-not-allowed",
            ].join(" ")}
            aria-disabled={!canEditMotion}
            title={canEditMotion ? "Edit motion" : "Motion locked by selection"}
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        </div>

        <div className="mt-2 flex items-start gap-2">
          <CheckCircle2 className="w-5 h-5 text-indigo-600 mt-0.5" />
          <div className="text-sm font-semibold text-gray-900">{currentMotion || "—"}</div>
        </div>

        {editMotion && canEditMotion && (
          <div className="mt-3">
            <select
              className="w-full h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm"
              value={currentMotion}
              onChange={(e) => {
                const v = e.target.value;
                setEditMotion(false);
                onChangeMotion?.(v);
              }}
            >
              {motions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* MATTRESS */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-gray-500">Mattress</div>
          <button
            type="button"
            onClick={() => onChangeMattress?.()}
            className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-800"
            title="Pick another Snoozepod below"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        </div>

        <div className="mt-2 flex items-start gap-2">
          <CheckCircle2 className="w-5 h-5 text-indigo-600 mt-0.5" />
          <div className="text-sm font-semibold text-gray-900 line-clamp-2">
            {cleanText(mattress) || "—"}
          </div>
        </div>

        <div className="mt-3 text-xs text-gray-500">
          Tap another Snoozepod below to switch what you’re testing.
        </div>
      </div>
    </div>
  );
}