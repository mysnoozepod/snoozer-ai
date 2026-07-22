function canUseAudio() {
  return typeof Audio !== "undefined";
}

function safeCall(fn) {
  try {
    return fn?.();
  } catch {
    return null;
  }
}

function clampVolume(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function createAmbientAudioController({ track = "", volume = 0.38, duckMultiplier = 0.24 } = {}) {
  let selectedTrack = String(track || "").trim();
  let activeTrack = "";
  let audio = null;
  let status = "idle";
  let targetVolume = clampVolume(volume);
  let ducked = false;
  const retiring = new Set();
  const fadeTimers = new Map();

  function appliedVolume() {
    return clampVolume(targetVolume * (ducked ? duckMultiplier : 1));
  }

  function clearFade(element) {
    const timer = fadeTimers.get(element);
    if (timer && typeof window !== "undefined") window.clearInterval(timer);
    fadeTimers.delete(element);
  }

  function fadeElement(element, nextVolume, durationMs = 350, onDone) {
    if (!element || typeof window === "undefined" || durationMs <= 0) {
      if (element) element.volume = clampVolume(nextVolume);
      onDone?.();
      return;
    }
    clearFade(element);
    const start = Number(element.volume || 0);
    const target = clampVolume(nextVolume);
    const steps = Math.max(1, Math.round(durationMs / 40));
    let step = 0;
    const timer = window.setInterval(() => {
      step += 1;
      element.volume = clampVolume(start + (target - start) * (step / steps));
      if (step >= steps) {
        clearFade(element);
        onDone?.();
      }
    }, 40);
    fadeTimers.set(element, timer);
  }

  function retire(element, fadeMs = 0, { reset = true } = {}) {
    if (!element) return;
    retiring.add(element);
    const finish = () => {
      clearFade(element);
      safeCall(() => element.pause());
      if (reset) safeCall(() => { element.currentTime = 0; });
      retiring.delete(element);
    };
    fadeMs > 0 ? fadeElement(element, 0, fadeMs, finish) : finish();
  }

  function stop({ fadeMs = 0 } = {}) {
    const current = audio;
    audio = null;
    activeTrack = "";
    if (current) retire(current, Math.min(Number(fadeMs) || 0, 1500));
    [...retiring].forEach((element) => {
      if (element !== current) retire(element, 0);
    });
    status = fadeMs > 0 && current ? "stopping" : "idle";
    return { ok: true, stopped: Boolean(current), status };
  }

  function start(nextTrack = selectedTrack, { fadeMs = 600 } = {}) {
    const requestedTrack = String(nextTrack || "").trim();
    selectedTrack = requestedTrack || selectedTrack;
    if (!selectedTrack) {
      status = "placeholder";
      return { ok: true, started: false, skipped: true, reason: "NO_AUDIO_TRACK_CONFIGURED", status };
    }

    if (activeTrack === selectedTrack && audio) {
      const playPromise = safeCall(() => audio.play());
      status = "playing";
      fadeElement(audio, appliedVolume(), fadeMs);
      playPromise?.catch?.(() => { status = "blocked"; });
      return { ok: true, started: false, reused: true, track: activeTrack, status, playPromise };
    }

    if (!canUseAudio()) {
      activeTrack = selectedTrack;
      status = "placeholder";
      return { ok: true, started: false, skipped: true, reason: "AUDIO_API_UNAVAILABLE", track: activeTrack, status };
    }

    const previous = audio;
    const next = new Audio(selectedTrack);
    next.loop = true;
    next.preload = "auto";
    next.volume = previous && fadeMs > 0 ? 0 : appliedVolume();
    audio = next;
    activeTrack = selectedTrack;
    const playPromise = safeCall(() => next.play());
    status = "playing";

    if (previous) retire(previous, Math.max(0, Number(fadeMs) || 0));
    if (fadeMs > 0) fadeElement(next, appliedVolume(), fadeMs);
    playPromise?.catch?.(() => {
      if (audio === next) status = "blocked";
      retire(next, 0);
    });

    return { ok: true, started: true, track: activeTrack, status, playPromise };
  }

  function pause({ fadeMs = 250 } = {}) {
    if (!audio) return { ok: true, paused: false, status };
    const current = audio;
    const finish = () => {
      safeCall(() => current.pause());
      if (audio === current) status = "paused";
    };
    fadeMs > 0 ? fadeElement(current, 0, fadeMs, finish) : finish();
    return { ok: true, paused: true, status: "pausing" };
  }

  function resume() {
    return start(activeTrack || selectedTrack, { fadeMs: 450 });
  }

  function syncVolume() {
    if (audio) fadeElement(audio, appliedVolume(), 180);
  }

  function snapshot() {
    return {
      status,
      track: activeTrack || selectedTrack,
      trackId: (activeTrack || selectedTrack).includes("crashing-waves") ? "waves" : "sleepTones",
      hasAudio: Boolean(audio),
      muted: false,
      volume: targetVolume,
      currentTime: Number(audio?.currentTime || 0),
      paused: audio ? Boolean(audio.paused) : true,
      ducked,
      activeInstanceCount: [audio, ...retiring].filter((element) => element && !element.paused).length,
    };
  }

  return {
    start,
    stop,
    pause,
    resume,
    reset: stop,
    setTrack: (nextTrack) => {
      selectedTrack = String(nextTrack || "").trim();
      return selectedTrack;
    },
    setVolume: (nextVolume) => {
      targetVolume = clampVolume(nextVolume);
      syncVolume();
      return targetVolume;
    },
    duck: () => {
      ducked = true;
      if (audio) fadeElement(audio, appliedVolume(), 180);
    },
    restore: () => {
      ducked = false;
      if (audio) fadeElement(audio, appliedVolume(), 320);
    },
    getSnapshot: snapshot,
  };
}
