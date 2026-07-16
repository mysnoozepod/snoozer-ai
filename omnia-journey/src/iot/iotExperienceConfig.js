const DEFAULT_REST_TEST_DURATION_MS = 420000;
const DEFAULT_REST_TEST_VACANCY_GRACE_MS = 30000;

function pickEnv(env, key) {
  if (!env || typeof env !== "object") return "";
  return env[`VITE_${key}`] ?? env[key] ?? "";
}

function numberFromEnv(env, key, fallback) {
  const parsed = Number(pickEnv(env, key));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanFromEnv(env, key, fallback = true) {
  const raw = String(pickEnv(env, key) || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["0", "false", "no", "off", "disabled"].includes(raw)) return false;
  if (["1", "true", "yes", "on", "enabled"].includes(raw)) return true;
  return fallback;
}

export const REST_TEST_OPENING_HUD_PAYLOAD = Object.freeze({
  speech:
    "Your seven-minute Rest Test is beginning. Relax and take your time. I\u2019ll be here if you need me.",
  captions:
    "Your seven-minute Rest Test is beginning. Relax and take your time. I\u2019ll be here if you need me.",
  state: "speaking",
  priority: "normal",
  ttlMs: 7000,
  actions: [],
});

export function getIotExperienceConfig(env = {}) {
  return {
    enableIotExperiences: booleanFromEnv(env, "ENABLE_IOT_EXPERIENCES", true),
    restTestDurationMs: numberFromEnv(
      env,
      "REST_TEST_DURATION_MS",
      DEFAULT_REST_TEST_DURATION_MS
    ),
    restTestVacancyGraceMs: numberFromEnv(
      env,
      "REST_TEST_VACANCY_GRACE_MS",
      DEFAULT_REST_TEST_VACANCY_GRACE_MS
    ),
    defaultRestTestAudioTrack: String(
      pickEnv(env, "DEFAULT_REST_TEST_AUDIO_TRACK") || ""
    ).trim(),
  };
}

export const IOT_EXPERIENCE_DEFAULTS = Object.freeze({
  REST_TEST_DURATION_MS: DEFAULT_REST_TEST_DURATION_MS,
  REST_TEST_VACANCY_GRACE_MS: DEFAULT_REST_TEST_VACANCY_GRACE_MS,
});
