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

export function createAmbientAudioController({ track = "", volume = 0.45 } = {}) {
  let selectedTrack = String(track || "").trim();
  let activeTrack = "";
  let audio = null;
  let previewAudio = null;
  let status = "idle";
  let muted = false;
  let targetVolume = clampVolume(volume);
  let ducked = false;
  let fadeTimer = null;

  function clearFade() {
    if (fadeTimer && typeof window !== "undefined") {
      window.clearInterval(fadeTimer);
    }
    fadeTimer = null;
  }

  function appliedVolume() {
    if (muted) return 0;
    return clampVolume(targetVolume * (ducked ? 0.24 : 1));
  }

  function syncVolume() {
    if (audio) audio.volume = appliedVolume();
    if (previewAudio) previewAudio.volume = muted ? 0 : Math.min(targetVolume, 0.5);
  }

  function fadeTo(nextVolume, durationMs = 350, onDone) {
    if (!audio || typeof window === "undefined") {
      onDone?.();
      return;
    }
    clearFade();
    const start = Number(audio.volume || 0);
    const target = clampVolume(nextVolume);
    const steps = Math.max(1, Math.round(Math.max(0, durationMs) / 40));
    let step = 0;
    fadeTimer = window.setInterval(() => {
      step += 1;
      if (audio) audio.volume = clampVolume(start + (target - start) * (step / steps));
      if (step >= steps) {
        clearFade();
        onDone?.();
      }
    }, 40);
  }

  function stopPreview() {
    if (!previewAudio) return;
    safeCall(() => previewAudio.pause());
    previewAudio.currentTime = 0;
    previewAudio = null;
  }

  function stop({ fadeMs = 0 } = {}) {
    stopPreview();
    const current = audio;
    activeTrack = "";

    if (!current) {
      status = "idle";
      return { ok: true, stopped: false, status };
    }

    const finish = () => {
      if (audio === current) audio = null;
      safeCall(() => current.pause());
      current.currentTime = 0;
      status = "idle";
    };

    if (fadeMs > 0) {
      fadeTo(0, Math.min(Number(fadeMs), 1500), finish);
    } else {
      clearFade();
      finish();
    }

    return { ok: true, stopped: true, status: fadeMs > 0 ? "stopping" : status };
  }

  function start(nextTrack = selectedTrack, { fadeMs = 600 } = {}) {
    const requestedTrack = String(nextTrack || "").trim();
    selectedTrack = requestedTrack || selectedTrack;
    stopPreview();

    if (!selectedTrack) {
      status = "placeholder";
      return { ok: true, started: false, skipped: true, reason: "NO_AUDIO_TRACK_CONFIGURED", status };
    }

    if (activeTrack === selectedTrack && audio) {
      const playResult = safeCall(() => audio.play());
      status = "playing";
      fadeTo(appliedVolume(), fadeMs);
      playResult?.catch?.(() => {
        status = "blocked";
      });
      return { ok: true, started: false, reused: true, track: activeTrack, status };
    }

    stop();
    activeTrack = selectedTrack;

    if (!canUseAudio()) {
      status = "placeholder";
      return { ok: true, started: false, skipped: true, reason: "AUDIO_API_UNAVAILABLE", track: activeTrack, status };
    }

    audio = new Audio(activeTrack);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = fadeMs > 0 ? 0 : appliedVolume();
    const playResult = safeCall(() => audio.play());
    status = "playing";
    if (fadeMs > 0) fadeTo(appliedVolume(), fadeMs);
    playResult?.catch?.(() => {
      status = "blocked";
    });
    return { ok: true, started: true, track: activeTrack, status };
  }

  function pause({ fadeMs = 250 } = {}) {
    if (!audio) return { ok: true, paused: false, status };
    const current = audio;
    const finish = () => {
      safeCall(() => current.pause());
      status = "paused";
    };
    fadeMs > 0 ? fadeTo(0, fadeMs, finish) : finish();
    return { ok: true, paused: true, status: "pausing" };
  }

  function resume() {
    return start(activeTrack || selectedTrack, { fadeMs: 450 });
  }

  function preview(nextTrack = selectedTrack, { seconds = 8 } = {}) {
    stopPreview();
    const requestedTrack = String(nextTrack || "").trim();
    if (!requestedTrack || !canUseAudio()) {
      return { ok: false, skipped: true, reason: !requestedTrack ? "NO_AUDIO_TRACK_CONFIGURED" : "AUDIO_API_UNAVAILABLE" };
    }
    previewAudio = new Audio(requestedTrack);
    previewAudio.loop = false;
    previewAudio.volume = muted ? 0 : Math.min(targetVolume, 0.5);
    const current = previewAudio;
    const playResult = safeCall(() => current.play());
    playResult?.catch?.(() => {
      if (previewAudio === current) previewAudio = null;
    });
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        if (previewAudio === current) stopPreview();
      }, Math.max(2, Math.min(12, Number(seconds) || 8)) * 1000);
    }
    return { ok: true, previewing: true, track: requestedTrack };
  }

  return {
    start,
    stop,
    pause,
    resume,
    preview,
    stopPreview,
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
    setMuted: (nextMuted) => {
      muted = Boolean(nextMuted);
      syncVolume();
      return muted;
    },
    duck: () => {
      ducked = true;
      fadeTo(appliedVolume(), 180);
    },
    restore: () => {
      ducked = false;
      fadeTo(appliedVolume(), 320);
    },
    getSnapshot: () => ({
      status,
      track: activeTrack || selectedTrack,
      hasAudio: Boolean(audio),
      muted,
      volume: targetVolume,
      ducked,
      previewing: Boolean(previewAudio),
    }),
  };
}
