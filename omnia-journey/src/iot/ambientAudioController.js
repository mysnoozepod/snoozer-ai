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

export function createAmbientAudioController({ track = "" } = {}) {
  let activeTrack = "";
  let audio = null;
  let status = "idle";

  function stop({ fadeMs = 0 } = {}) {
    const current = audio;
    audio = null;
    activeTrack = "";

    if (!current) {
      status = "idle";
      return { ok: true, stopped: false, status };
    }

    const finish = () => {
      safeCall(() => current.pause());
      current.currentTime = 0;
      status = "idle";
    };

    if (fadeMs > 0 && Number.isFinite(Number(current.volume))) {
      const startVolume = Number(current.volume || 1);
      current.volume = Math.max(0, startVolume * 0.35);
      window.setTimeout(finish, Math.min(Number(fadeMs), 1500));
    } else {
      finish();
    }

    return { ok: true, stopped: true, status: "stopping" };
  }

  function start(nextTrack = track) {
    const selectedTrack = String(nextTrack || "").trim();

    if (!selectedTrack) {
      status = "placeholder";
      return {
        ok: true,
        started: false,
        skipped: true,
        reason: "NO_AUDIO_TRACK_CONFIGURED",
        status,
      };
    }

    if (activeTrack === selectedTrack && status === "playing") {
      return { ok: true, started: false, reused: true, track: activeTrack, status };
    }

    stop();
    activeTrack = selectedTrack;

    if (!canUseAudio()) {
      status = "placeholder";
      return {
        ok: true,
        started: false,
        skipped: true,
        reason: "AUDIO_API_UNAVAILABLE",
        track: activeTrack,
        status,
      };
    }

    audio = new Audio(selectedTrack);
    audio.loop = true;
    audio.volume = 0.55;
    const playResult = safeCall(() => audio.play());
    status = "playing";

    if (playResult && typeof playResult.catch === "function") {
      playResult.catch(() => {
        status = "blocked";
      });
    }

    return { ok: true, started: true, track: activeTrack, status };
  }

  return {
    start,
    stop,
    reset: stop,
    getSnapshot: () => ({
      status,
      track: activeTrack,
      hasAudio: Boolean(audio),
    }),
  };
}
