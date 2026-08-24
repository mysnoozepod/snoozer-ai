const MODEL_TIMEOUT_MS = 3500;
const CIRCUIT_FAILURE_LIMIT = 2;
const CIRCUIT_COOLDOWN_MS = 60_000;

let consecutiveFailures = 0;
let circuitOpenedAt = 0;

function clean(value, max = 140) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildPodReviewFallback(facts = {}) {
  const rating = clean(facts?.restTest?.favorite || facts?.restTest?.bestPosition || "");
  const mattress = clean(facts?.selection?.mattress || "this mattress");
  const size = clean(facts?.selection?.size || "");
  const base = clean(facts?.selection?.base || "");
  const lead = rating
    ? `You liked ${rating} most in your Rest Test, and this setup keeps that result in view.`
    : `Your ${mattress}${size ? ` in ${size}` : ""} is ready to review.`;
  const next = base && !/mattress only/i.test(base)
    ? `You can add the ${base} setup now or compare another pod before deciding.`
    : "You can finish this setup now or compare another pod before deciding.";
  return `${lead} ${next}`;
}

export function buildBoundedPodReviewContext({ assessment, rank, restTest, selection, essentials, cart, progress } = {}) {
  return {
    purpose: "pod_review_coaching",
    assessment: {
      position: clean(assessment?.position || assessment?.sleepPosition || assessment?.answers?.position),
      firmness: clean(assessment?.firmness || assessment?.comfort || assessment?.feel),
      temperature: clean(assessment?.temperature || assessment?.answers?.temperature),
      painPoints: (Array.isArray(assessment?.painPoints) ? assessment.painPoints : []).slice(0, 4).map(clean),
    },
    recommendedRank: Number(rank) > 0 ? Number(rank) : null,
    restTest: {
      ratings: {
        comfort: Number(restTest?.ratings?.comfort) || null,
        pressureRelief: Number(restTest?.ratings?.pressureRelief) || null,
        support: Number(restTest?.ratings?.support) || null,
      },
      favorite: clean(restTest?.favorite),
      bestPosition: clean(restTest?.bestPosition),
    },
    selection: {
      mattress: clean(selection?.mattress),
      size: clean(selection?.size),
      base: clean(selection?.base),
      motion: clean(selection?.motion),
    },
    essentials: {
      selected: (Array.isArray(essentials?.selected) ? essentials.selected : []).slice(0, 3).map(clean),
      skipped: (Array.isArray(essentials?.skipped) ? essentials.skipped : []).slice(0, 3).map(clean),
    },
    cart: (Array.isArray(cart) ? cart : []).slice(0, 12).map((item) => ({
      title: clean(item?.title),
      merchandiseId: clean(item?.merchandiseId, 100),
      quantity: Math.max(1, Number(item?.quantity) || 1),
    })),
    progress: clean(progress),
  };
}

function hudContract(text, fallback) {
  const speech = clean(text, 420) || fallback;
  return { speech, captions: speech, state: "speaking", priority: "normal", ttlMs: 5000, actions: [] };
}

export async function getPodReviewCoaching({ api, facts, timeoutMs = MODEL_TIMEOUT_MS, now = Date.now } = {}) {
  const fallback = buildPodReviewFallback(facts);
  if (!api?.askSnoozer || (circuitOpenedAt && now() - circuitOpenedAt < CIRCUIT_COOLDOWN_MS)) {
    return hudContract(fallback, fallback);
  }

  let timeoutId = null;
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(Object.assign(new Error("Pod review coaching timed out"), { code: "POD_REVIEW_TIMEOUT" })), timeoutMs);
    });
    const result = await Promise.race([
      api.askSnoozer({
        message: "Give one short, friendly review summary using only the supplied facts. Do not invent claims, price, availability, compatibility, cart contents, or medical guidance.",
        mode: "pod",
        context: facts,
      }),
      timeout,
    ]);
    const text = clean(result?.hud?.speech || result?.hud?.captions || result?.reply || result?.text, 420);
    if (!result?.ok || !text) throw Object.assign(new Error("Invalid coaching response"), { code: "POD_REVIEW_INVALID" });
    consecutiveFailures = 0;
    circuitOpenedAt = 0;
    return hudContract(text, fallback);
  } catch {
    consecutiveFailures += 1;
    if (consecutiveFailures >= CIRCUIT_FAILURE_LIMIT) circuitOpenedAt = now();
    return hudContract(fallback, fallback);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function resetPodReviewCoachingCircuit() {
  consecutiveFailures = 0;
  circuitOpenedAt = 0;
}
