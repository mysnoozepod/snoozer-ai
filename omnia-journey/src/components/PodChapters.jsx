// src/components/PodChapters.jsx
import { useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function StatusPill({ status }) {
  const cfg = useMemo(() => {
    if (status === "complete") {
      return {
        label: "Complete",
        cls: "border-emerald-200 bg-emerald-50 text-emerald-800",
      };
    }

    if (status === "in_progress") {
      return {
        label: "In progress",
        cls: "border-indigo-200 bg-indigo-50 text-indigo-800",
      };
    }

    return {
      label: "Not started",
      cls: "border-gray-200 bg-gray-50 text-gray-700",
    };
  }, [status]);

  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-extrabold",
        cfg.cls
      )}
    >
      {cfg.label}
    </span>
  );
}

function stepLabelForChapter(id, idx) {
  if (id === "rest") return "Step 1";
  if (id === "details") return "Step 2";
  if (id === "build") return "Step 3";
  return `Step ${idx + 1}`;
}

function helperForChapter(activeId) {
  if (!activeId) {
    return "Start with Rest Test. Then confirm the details. Finish by building the exact setup.";
  }

  if (activeId === "rest") {
    return "Run the mattress test first. Get the honest read before you customize anything.";
  }

  if (activeId === "details") {
    return "Confirm why this pod matches, then decide whether it deserves a build or a comparison.";
  }

  if (activeId === "build") {
    return "Tune the setup, review the estimate, and add the exact version you want.";
  }

  return "Open a chapter to continue.";
}

function ChapterCard({
  active,
  icon: Icon,
  title,
  status,
  summary,
  chapterId,
  index,
  total,
  onClick,
}) {
  const stepLabel = stepLabelForChapter(chapterId, index);
  const isComplete = status === "complete";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "w-full rounded-3xl border p-5 text-left shadow-sm transition md:p-6",
        active
          ? "border-indigo-400 bg-gradient-to-br from-indigo-50 to-white shadow"
          : "border-gray-200 bg-white hover:shadow"
      )}
      aria-current={active ? "step" : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-4">
          <div
            className={cx(
              "mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-sm",
              active ? "border-indigo-200 bg-white" : "border-gray-200 bg-white"
            )}
            aria-hidden="true"
          >
            {Icon ? <Icon className="h-5 w-5 text-indigo-700" /> : null}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500">
                {stepLabel} of {total}
              </span>
              {status ? <StatusPill status={status} /> : null}
            </div>

            <div className="mt-2 line-clamp-2 text-base font-extrabold leading-tight text-gray-900 md:text-lg">
              {title}
            </div>

            {summary ? (
              <div className="mt-3 line-clamp-3 text-sm leading-relaxed text-gray-600 md:text-[15px]">
                {summary}
              </div>
            ) : null}

            <div className="mt-4 text-xs font-extrabold uppercase tracking-wide text-indigo-700">
              {active ? "Open now" : "Open chapter"}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border bg-white shadow-sm">
            {isComplete ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            ) : (
              <div
                className={cx("h-2.5 w-2.5 rounded-full", active ? "bg-indigo-600" : "bg-gray-300")}
                aria-hidden="true"
              />
            )}
          </div>

          <div className="text-[11px] font-bold text-gray-400">
            {active ? "Active" : isComplete ? "Done" : ""}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function PodChapters({ chapters = [], openId, onChange }) {
  const safeIndex = useMemo(() => {
    if (!Array.isArray(chapters) || !chapters.length) return -1;

    const found = chapters.findIndex((c) => c.id === openId);
    return found >= 0 ? found : 0;
  }, [chapters, openId]);

  const active = safeIndex >= 0 ? chapters[safeIndex] : null;
  const activeId = active?.id ?? null;

  const canPrev = safeIndex > 0;
  const canNext = safeIndex >= 0 && safeIndex < chapters.length - 1;

  const mobileScrollRef = useRef(null);
  const desktopGridRef = useRef(null);

  const goPrev = () => {
    if (!canPrev) return;
    const prev = chapters[safeIndex - 1];
    if (prev) onChange?.(prev.id);
  };

  const goNext = () => {
    if (!canNext) return;
    const next = chapters[safeIndex + 1];
    if (next) onChange?.(next.id);
  };

  useEffect(() => {
    if (!activeId) return;

    const el = mobileScrollRef.current || desktopGridRef.current;
    if (!el) return;

    const card = el.querySelector(`[data-chapter-id="${activeId}"]`);
    if (!card) return;

    try {
      card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    } catch {
      // ignore
    }
  }, [activeId]);

  useEffect(() => {
    if (!chapters.length) return;
    if (openId && chapters.some((c) => c.id === openId)) return;

    const fallback = chapters[0]?.id;
    if (fallback) onChange?.(fallback);
  }, [chapters, openId, onChange]);

  const helperCopy = useMemo(() => helperForChapter(activeId), [activeId]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-700">Your guided flow</div>
          <div className="mt-1 max-w-3xl text-sm text-gray-500">{helperCopy}</div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            disabled={!canPrev}
            className={cx(
              "inline-flex h-11 w-11 items-center justify-center rounded-2xl border bg-white shadow-sm transition",
              canPrev ? "hover:shadow" : "cursor-not-allowed opacity-40"
            )}
            title="Previous"
          >
            <ChevronLeft className="h-5 w-5 text-gray-700" />
          </button>

          <button
            type="button"
            onClick={goNext}
            disabled={!canNext}
            className={cx(
              "inline-flex h-11 w-11 items-center justify-center rounded-2xl border bg-white shadow-sm transition",
              canNext ? "hover:shadow" : "cursor-not-allowed opacity-40"
            )}
            title="Next"
          >
            <ChevronRight className="h-5 w-5 text-gray-700" />
          </button>
        </div>
      </div>

      <div ref={desktopGridRef} className="hidden grid-cols-1 gap-4 md:grid md:grid-cols-3">
        {chapters.map((c, chapterIndex) => {
          const isActive = c.id === activeId;
          return (
            <div key={c.id} data-chapter-id={c.id}>
              <ChapterCard
                active={isActive}
                icon={c.icon}
                title={c.title}
                status={c.status}
                summary={c.summary}
                chapterId={c.id}
                index={chapterIndex}
                total={chapters.length}
                onClick={() => onChange?.(c.id)}
              />
            </div>
          );
        })}
      </div>

      <div className="md:hidden">
        <div
          ref={mobileScrollRef}
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 scroll-smooth"
        >
          {chapters.map((c, chapterIndex) => {
            const isActive = c.id === activeId;
            return (
              <div key={c.id} className="w-[88%] shrink-0 snap-start" data-chapter-id={c.id}>
                <ChapterCard
                  active={isActive}
                  icon={c.icon}
                  title={c.title}
                  status={c.status}
                  summary={c.summary}
                  chapterId={c.id}
                  index={chapterIndex}
                  total={chapters.length}
                  onClick={() => onChange?.(c.id)}
                />
              </div>
            );
          })}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {active ? (
          <motion.div
            key={activeId}
            className="overflow-hidden rounded-3xl border bg-white shadow-sm"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <div className="border-b bg-gray-50/70 px-6 py-4 md:px-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-gray-500">
                    {stepLabelForChapter(active.id, safeIndex >= 0 ? safeIndex : 0)}
                  </div>

                  <div className="mt-1 text-lg font-extrabold text-gray-900 md:text-xl">
                    {active.title}
                  </div>

                  {active.summary ? (
                    <div className="mt-1 text-sm text-gray-600">{active.summary}</div>
                  ) : null}
                </div>

                {active.status ? <StatusPill status={active.status} /> : null}
              </div>
            </div>

            <div className="p-6 md:p-8">{active.body}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}