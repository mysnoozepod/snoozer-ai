import { useSyncExternalStore } from "react";
import {
  getRewardGift,
  getRewardHistory,
  getRewardOffers,
  getRewardSummary,
} from "@/lib/api";
import {
  getSessionState,
  subscribeSessionState,
} from "@/state/sessionStore";

const EMPTY_STATE = Object.freeze({
  identityKey: "",
  status: "idle",
  stale: false,
  summary: null,
  offers: [],
  gift: null,
  history: [],
  error: null,
  updatedAt: null,
});

const PARTIAL_REWARDS_ERROR = "Some reward details are temporarily unavailable.";

let state = { ...EMPTY_STATE };
let inflight = null;
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener());
}

function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

function identityKey() {
  const session = getSessionState();
  return [session?.shopperId, session?.sessionId].filter(Boolean).join(":");
}

function hasVerifiedIdentity() {
  const session = getSessionState();
  return Boolean(session?.shopperId && session?.sessionId);
}

export function getRewardsState() {
  return state;
}

export function subscribeRewardsState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshRewardsState({ force = false } = {}) {
  const nextIdentityKey = identityKey();
  const previousSnapshot =
    state.identityKey === nextIdentityKey ? state : EMPTY_STATE;
  if (!hasVerifiedIdentity()) {
    setState({ ...EMPTY_STATE, identityKey: nextIdentityKey });
    return state;
  }
  if (!force && state.status === "ready" && state.identityKey === nextIdentityKey) {
    return state;
  }
  if (inflight && state.identityKey === nextIdentityKey) return inflight;

  setState({
    identityKey: nextIdentityKey,
    status: "loading",
    stale: Boolean(previousSnapshot.summary),
    error: null,
  });

  inflight = Promise.allSettled([
    getRewardSummary(),
    getRewardOffers(),
    getRewardGift(),
    getRewardHistory(),
  ])
    .then(([summaryResult, offersResult, giftResult, historyResult]) => {
      if (summaryResult.status !== "fulfilled") {
        throw summaryResult.reason || new Error("Rewards are temporarily unavailable.");
      }

      const optionalFailure =
        offersResult.status !== "fulfilled" ||
        giftResult.status !== "fulfilled" ||
        historyResult.status !== "fulfilled";

      setState({
        identityKey: nextIdentityKey,
        status: "ready",
        stale: false,
        summary: summaryResult.value || null,
        offers:
          offersResult.status === "fulfilled"
            ? Array.isArray(offersResult.value)
              ? offersResult.value
              : []
            : Array.isArray(previousSnapshot.offers)
              ? previousSnapshot.offers
              : [],
        gift:
          giftResult.status === "fulfilled"
            ? giftResult.value || null
            : previousSnapshot.gift || null,
        history:
          historyResult.status === "fulfilled"
            ? Array.isArray(historyResult.value)
              ? historyResult.value
              : []
            : Array.isArray(previousSnapshot.history)
              ? previousSnapshot.history
              : [],
        error: optionalFailure ? PARTIAL_REWARDS_ERROR : null,
        updatedAt: new Date().toISOString(),
      });
      return state;
    })
    .catch((error) => {
      setState({
        identityKey: nextIdentityKey,
        status: "error",
        stale: Boolean(state.summary),
        error: error?.message || "Rewards are temporarily unavailable.",
      });
      return state;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function useRewardsState(selector = (snapshot) => snapshot) {
  return useSyncExternalStore(
    subscribeRewardsState,
    () => selector(getRewardsState()),
    () => selector(getRewardsState())
  );
}

subscribeSessionState(() => {
  const nextIdentityKey = identityKey();
  if (nextIdentityKey === state.identityKey) return;
  state = { ...EMPTY_STATE, identityKey: nextIdentityKey };
  emit();
  if (hasVerifiedIdentity()) void refreshRewardsState({ force: true });
});
