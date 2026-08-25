import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Home,
  Pause,
  Play,
  RotateCcw,
  Square,
  Star,
} from "lucide-react";

import { ShowroomPanel } from "@/components/showroom/ShowroomPrimitives";
import {
  REST_TEST_DURATIONS,
  REST_TEST_PHASES,
  REST_TEST_STAGES,
} from "@/lib/restTestProgram.mjs";

function formatTime(totalSeconds) {
  const total = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function PodRestStartSection({ podLabel, flowOptions = [], onChooseMode }) {
  const ids = flowOptions.length ? flowOptions.map((flow) => flow.id).slice(0, 2) : ["quick", "deep"];
  const cards = ids.map((id) => {
    const duration = REST_TEST_DURATIONS[id] || REST_TEST_DURATIONS.quick;
    return {
      ...duration,
      subtitle: id === "deep" ? "More time to settle in" : "Quick feel check",
      accent: id === "deep" ? "blue" : "orange",
    };
  });

  return (
    <ShowroomPanel data-pod-text-card="pod-home" className="h-full overflow-hidden p-[12px]" tone="frost">
      <div>
        <h2 className="text-[clamp(1.55rem,2.4vw,2rem)] font-black leading-none tracking-tight text-slate-950">Start Your Rest Test</h2>
        <p className="mt-1 text-[clamp(0.82rem,1.2vw,1rem)] leading-snug text-slate-600">
          Try {podLabel} your way. Choose 7 or 15 minutes to begin.
        </p>
      </div>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        {cards.map((card) => (
          <button
            type="button"
            key={card.id}
            onClick={() => onChooseMode?.(card.id)}
            className={[
              "flex min-h-[88px] items-center justify-between gap-4 rounded-[16px] border bg-white px-4 py-3 text-left shadow-[0_12px_26px_rgba(35,58,117,0.08)]",
              card.accent === "orange" ? "border-orange-200" : "border-blue-200",
            ].join(" ")}
          >
            <span>
              <span className="block text-[clamp(1rem,1.45vw,1.2rem)] font-black text-slate-950">{card.label}</span>
              <span className="mt-0.5 block text-[0.78rem] font-semibold text-slate-600">{card.subtitle}</span>
            </span>
            <span className={card.accent === "orange" ? "text-[#ff8f1f]" : "text-[#355ff1]"}><ArrowRight className="h-5 w-5" /></span>
          </button>
        ))}
      </div>
    </ShowroomPanel>
  );
}

function ConfirmBar({ action, onCancel, onConfirm }) {
  if (!action) return null;
  const isRestart = action === "restart";
  return (
    <div className="absolute inset-x-2 bottom-2 z-20 flex min-h-[52px] items-center justify-between gap-3 rounded-[14px] border border-amber-200 bg-white px-3 py-2 shadow-[0_14px_34px_rgba(15,23,42,0.18)]">
      <p className="min-w-0 text-[0.74rem] font-bold leading-tight text-slate-700">
        {isRestart
          ? "Restart this Rest Test from the beginning?"
          : "End this Rest Test? Your progress on this mattress will be saved as incomplete."}
      </p>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={onCancel} className="min-h-[44px] rounded-[12px] border px-3 text-xs font-black">
          Cancel
        </button>
        <button
          type="button"
          data-testid={`rest-confirm-${action}`}
          onClick={onConfirm}
          className="min-h-[44px] rounded-[12px] bg-slate-900 px-3 text-xs font-black text-white"
        >
          {isRestart ? "Restart" : "End Test"}
        </button>
      </div>
    </div>
  );
}

function RestTestEntry({ controller }) {
  const durations = Object.values(REST_TEST_DURATIONS);

  return (
    <ShowroomPanel
      tone="frost"
      data-testid="rest-test-entry"
      data-rest-test-state="entry"
      className="relative h-full min-h-0 overflow-y-auto p-[12px] lg:overflow-hidden"
    >
      <div className="flex h-full min-h-0 flex-col justify-center rounded-[16px] border border-white/80 bg-white/78 px-5 py-4">
        <h2 className="text-[clamp(1.45rem,2.5vw,2.1rem)] font-black leading-[1.02] tracking-tight text-slate-950">
          Settle in. Snoozer will guide your Rest Test.
        </h2>
        <p className="mt-2 text-[clamp(0.92rem,1.4vw,1.08rem)] leading-snug text-slate-600">
          Choose 7 minutes for a quick feel check or 15 minutes for more time to settle in.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {durations.map((duration) => (
            <button
              type="button"
              key={duration.id}
              onClick={() => controller.start(duration.id)}
              data-testid={`rest-duration-${duration.id}`}
              className={[
                "group flex min-h-[112px] items-center justify-between rounded-[16px] border bg-white px-5 text-left transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4",
                duration.id === "quick"
                  ? "border-orange-200 shadow-[0_14px_30px_rgba(255,143,31,0.12)] focus-visible:ring-orange-100"
                  : "border-blue-200 shadow-[0_14px_30px_rgba(53,95,241,0.12)] focus-visible:ring-blue-100",
              ].join(" ")}
            >
              <span>
                <span className="block text-[clamp(1.1rem,1.7vw,1.4rem)] font-black leading-tight text-slate-950">{duration.label}</span>
                <span className="mt-1.5 block text-sm font-semibold text-slate-600">
                  {duration.id === "quick" ? "Quick feel check" : "More time to settle in"}
                </span>
              </span>
              <ArrowRight className={duration.id === "quick" ? "h-6 w-6 shrink-0 text-[#ff8f1f]" : "h-6 w-6 shrink-0 text-[#355ff1]"} />
            </button>
          ))}
        </div>
      </div>
    </ShowroomPanel>
  );
}

function RestVisual({ stage, paused }) {
  const [failedSrc, setFailedSrc] = useState("");

  useEffect(() => {
    setFailedSrc("");
  }, [stage.visual]);

  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-hidden rounded-[16px] border border-white/80 bg-[radial-gradient(circle_at_50%_35%,#ffffff_0%,#eef4ff_72%,#e4ecfb_100%)]">
      {failedSrc !== stage.visual ? (
        <img
          key={stage.id}
          src={stage.visual}
          alt={`Snoozer demonstrating ${stage.positionLabel}`}
          data-testid="rest-test-pose"
          data-rest-test-pose-stage={stage.id}
          onError={() => setFailedSrc(stage.visual)}
          className={[
            "rest-test-visual-enter h-full max-h-[280px] w-full object-contain p-1",
            paused ? "rest-test-visual-paused" : "rest-test-visual-breathe",
          ].join(" ")}
        />
      ) : (
        <div className="px-4 text-center text-sm font-bold text-slate-600">{stage.positionLabel}</div>
      )}
      <div className="absolute left-2 top-2 rounded-full border border-white/80 bg-white/90 px-2.5 py-1 text-[0.66rem] font-black uppercase tracking-[0.12em] text-[#355ff1] shadow-sm">
        {stage.positionLabel}
      </div>
    </div>
  );
}

function ActiveRestTest({ controller }) {
  const [confirmAction, setConfirmAction] = useState("");
  const { state, stage, duration } = controller;
  const isPaused = state.phase === REST_TEST_PHASES.PAUSED;
  const isPositioning = [REST_TEST_PHASES.POSITIONING, REST_TEST_PHASES.STARTING].includes(state.phase);
  const isBaseFailure = state.phase === REST_TEST_PHASES.BASE_FAILURE;
  const stageNumber = state.stageIndex + 1;
  const progress = Math.min(100, Math.max(0, (state.overallActiveElapsedSeconds / duration.totalSeconds) * 100));
  const statusLabel = isPaused ? "Paused" : isPositioning ? "Moving Into Position" : isBaseFailure ? "Position Unavailable" : "Testing Now";

  return (
    <ShowroomPanel
      tone="frost"
      data-testid="rest-test-active"
      data-rest-test-state={state.phase}
      data-rest-test-stage={stage.id}
      data-rest-test-audio-status={controller.audioSnapshot?.status || "idle"}
      data-rest-test-audio-track={controller.audioSnapshot?.trackId || state.activeTrackId}
      data-rest-test-audio-volume={controller.audioSnapshot?.volume ?? state.volume}
      data-rest-test-audio-time={controller.audioSnapshot?.currentTime || state.audioPlaybackPosition || 0}
      data-rest-test-audio-paused={controller.audioSnapshot?.paused ? "true" : "false"}
      data-rest-test-audio-present={controller.audioSnapshot?.hasAudio ? "true" : "false"}
      className="relative h-full min-h-0 overflow-y-auto p-[8px] lg:overflow-hidden"
    >
      <div className="grid h-full min-h-[190px] gap-3 lg:grid-cols-[minmax(300px,0.92fr)_minmax(0,1.08fr)]">
        <RestVisual stage={stage} paused={isPaused} />

        <div className="flex min-h-0 min-w-0 flex-col rounded-[16px] border border-white/80 bg-white/78 px-3 py-2">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-[#355ff1]">
                Stage {stageNumber} of {REST_TEST_STAGES.length} / {statusLabel}
              </div>
              <h2 className="mt-1 text-[clamp(1.4rem,2.4vw,2rem)] font-black leading-tight tracking-tight text-slate-950">
                {stage.name}
              </h2>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[clamp(2rem,3.8vw,3rem)] font-black leading-none tabular-nums text-slate-950">
                {formatTime(state.stageRemainingSeconds)}
              </div>
              <div className="mt-0.5 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-slate-500">active time</div>
            </div>
          </div>

          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#dfe7f8]" aria-label={`${Math.round(progress)} percent complete`}>
            <div className="h-full rounded-full bg-[linear-gradient(90deg,#355ff1,#6c63ff)] transition-[width]" style={{ width: `${progress}%` }} />
          </div>

          <div className="mt-2 min-h-0 flex-1 rounded-[14px] border border-[#dbe5ff] bg-[#f7f9ff] px-3 py-2">
            {isPaused ? (
              <>
                <div className="text-lg font-black text-slate-950">Rest Test paused</div>
                <p className="mt-1 text-base leading-snug text-slate-600">Your exact stage time is saved. Continue whenever you are ready.</p>
              </>
            ) : isBaseFailure ? (
              <>
                <div className="text-lg font-black text-slate-950">The base position is unavailable right now.</div>
                <p className="mt-1 text-base leading-snug text-slate-600">You can continue evaluating the mattress while it remains flat.</p>
              </>
            ) : isPositioning ? (
              <>
                <div className="text-lg font-black text-slate-950">{stage.manualInstruction}</div>
                <p className="mt-1 text-base leading-snug text-slate-600">
                  {state.openingSpeechActive
                    ? "Snoozer is guiding this change. Active testing starts automatically afterward."
                    : state.transitionRemainingSeconds > 0
                      ? `Active testing starts automatically in ${state.transitionRemainingSeconds} seconds.`
                      : "Active testing is about to begin automatically."}
                </p>
              </>
            ) : (
              <div className="text-lg font-black leading-snug text-slate-950">{stage.quietPrompt}</div>
            )}
          </div>

          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            {isPaused ? (
              <button
                type="button"
                data-testid="rest-resume-active"
                onClick={controller.resume}
                className="inline-flex min-h-[56px] min-w-[130px] flex-1 items-center justify-center gap-2 rounded-[12px] bg-[#355ff1] px-4 text-base font-black text-white"
              >
                <Play className="h-4 w-4" /> Resume Test
              </button>
            ) : isBaseFailure ? (
              <>
                <button type="button" onClick={controller.continueFlat} className="min-h-[44px] flex-1 rounded-[12px] bg-[#355ff1] px-3 text-xs font-black text-white">Continue Flat</button>
                <button type="button" onClick={controller.tryBaseAgain} className="min-h-[44px] flex-1 rounded-[12px] border bg-white px-3 text-xs font-black">Try Again</button>
              </>
            ) : (
              <button
                type="button"
                data-testid="rest-pause-test"
                onClick={controller.pause}
                className="inline-flex min-h-[56px] min-w-[150px] flex-1 items-center justify-center gap-2 rounded-[12px] border border-[#dbe5ff] bg-white px-4 text-base font-black text-[#355ff1]"
              >
                <Pause className="h-4 w-4" /> Pause
              </button>
            )}

            {isPaused ? (
              <button
                type="button"
                data-testid="rest-restart-test"
                onClick={() => setConfirmAction("restart")}
                className="inline-flex min-h-[56px] min-w-[140px] flex-1 items-center justify-center gap-2 rounded-[12px] border border-[#dbe5ff] bg-white px-4 text-base font-black text-slate-700"
              >
                <RotateCcw className="h-4 w-4" /> Restart Test
              </button>
            ) : null}
            <button
              type="button"
              data-testid="rest-end-test"
              onClick={() => setConfirmAction("end")}
              className="inline-flex min-h-[56px] min-w-[130px] flex-1 items-center justify-center gap-2 rounded-[12px] border border-red-200 bg-white px-4 text-base font-black text-red-600"
            >
              <Square className="h-3.5 w-3.5" /> End Test
            </button>
          </div>
        </div>
      </div>

      <ConfirmBar
        action={confirmAction}
        onCancel={() => setConfirmAction("")}
        onConfirm={() => {
          if (confirmAction === "restart") controller.restart();
          else controller.endEarly();
          setConfirmAction("");
        }}
      />
    </ShowroomPanel>
  );
}

function FivePointRating({ label, value, onChange, testId }) {
  return (
    <fieldset className="min-w-0 rounded-[14px] border border-[#dbe5ff] bg-white px-2.5 py-2">
      <legend className="sr-only">{label}</legend>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[0.76rem] font-black text-slate-900">{label}</span>
        <div className="flex gap-1" data-testid={testId}>
          {[1, 2, 3, 4, 5].map((score) => (
            <button
              type="button"
              key={score}
              aria-label={`${label}: ${score} out of 5`}
              aria-pressed={value === score}
              onClick={() => onChange(score)}
              className={[
                "flex h-11 w-11 items-center justify-center rounded-full border text-xs font-black transition",
                value === score ? "border-[#355ff1] bg-[#355ff1] text-white" : "border-[#dbe5ff] bg-[#f8faff] text-slate-600",
              ].join(" ")}
            >
              {score}
            </button>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

function CompactOptionGroup({ label, options, value, onChange, testId }) {
  return (
    <fieldset className="min-w-0 rounded-[14px] border border-[#dbe5ff] bg-white px-2.5 py-2">
      <legend className="sr-only">{label}</legend>
      <div className="flex min-w-0 items-center gap-1.5" data-testid={testId}>
        <span className="mr-auto truncate text-[0.72rem] font-black text-slate-900">{label}</span>
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={[
              "min-h-[36px] rounded-[10px] border px-2 text-[0.66rem] font-black",
              value === option.value ? "border-[#355ff1] bg-[#eef3ff] text-[#234ee8]" : "border-[#dbe5ff] bg-white text-slate-600",
            ].join(" ")}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function RestTestCompletion({ controller, podLabel, onBackHome, onTryAnotherMattress }) {
  const [favoriteSaved, setFavoriteSaved] = useState(false);
  const positionOptions = useMemo(
    () => [
      { value: "flat", label: "Flat" },
      { value: "zero_gravity", label: "Zero Gravity" },
      { value: "snore", label: "Snore preset" },
    ],
    []
  );
  return (
    <ShowroomPanel
      tone="frost"
      data-testid="rest-test-completion"
      data-rest-test-state="completed"
      className="h-full min-h-0 overflow-y-auto p-[9px] lg:overflow-hidden"
    >
      <div className="grid h-full min-h-0 gap-2 lg:grid-cols-[minmax(230px,0.6fr)_minmax(0,1.4fr)]">
        <section className="flex min-h-0 flex-col justify-center rounded-[16px] border border-emerald-100 bg-[linear-gradient(145deg,#f2fff9,#ffffff)] px-3 py-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-5 w-5" strokeWidth={3} /></div>
          <h2 className="mt-1 text-[clamp(1.18rem,2vw,1.65rem)] font-black leading-none text-slate-950">Your Rest Test is complete.</h2>
          <p className="mt-1 text-[0.73rem] leading-snug text-slate-600">Rate how {podLabel} felt while the experience is still fresh.</p>
        </section>

        <section className="grid min-h-0 gap-2 lg:grid-cols-2">
          <div className="grid content-center gap-1.5">
            <FivePointRating label="Overall comfort" value={controller.state.ratings.comfort} onChange={(value) => controller.rate("comfort", value)} testId="rest-rating-comfort" />
            <FivePointRating label="Pressure relief" value={controller.state.ratings.pressureRelief} onChange={(value) => controller.rate("pressureRelief", value)} testId="rest-rating-pressure" />
            <FivePointRating label="Support" value={controller.state.ratings.support} onChange={(value) => controller.rate("support", value)} testId="rest-rating-support" />
          </div>
          <div className="grid content-center gap-1.5">
            <CompactOptionGroup label="Best position" options={positionOptions} value={controller.state.preferredPosition} onChange={controller.setPreferredPosition} testId="rest-best-position" />
            {favoriteSaved ? <p className="rounded-[11px] bg-emerald-50 px-2.5 py-2 text-[0.7rem] font-bold text-emerald-800">Saved. Learn more about this mattress or compare another pod.</p> : null}
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                data-testid="rest-save-favorite"
                onClick={() => { controller.saveFavorite(); setFavoriteSaved(true); }}
                className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-[11px] border border-[#dbe5ff] bg-white px-2 text-[0.66rem] font-black text-[#355ff1]"
              >
                {favoriteSaved ? <Check className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />} {favoriteSaved ? "Saved" : "Favorite"}
              </button>
              <button type="button" onClick={onBackHome} className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-[11px] border border-[#dbe5ff] bg-white px-2 text-[0.66rem] font-black text-slate-800">
                <Home className="h-3.5 w-3.5" /> Pod Home
              </button>
              <button type="button" onClick={onTryAnotherMattress} className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-[11px] bg-[#355ff1] px-2 text-[0.66rem] font-black text-white">
                Try Another <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </section>
      </div>
    </ShowroomPanel>
  );
}

export function GuidedRestTest({ controller, podLabel = "this pod", onBackHome, onTryAnotherMattress }) {
  if (!controller) return null;
  if (controller.state.phase === REST_TEST_PHASES.COMPLETED) {
    return <RestTestCompletion controller={controller} podLabel={podLabel} onBackHome={onBackHome} onTryAnotherMattress={onTryAnotherMattress} />;
  }
  if (controller.state.phase === REST_TEST_PHASES.READY || controller.state.phase === REST_TEST_PHASES.ENDED_EARLY) {
    return <RestTestEntry controller={controller} />;
  }
  return <ActiveRestTest controller={controller} />;
}

export default GuidedRestTest;
