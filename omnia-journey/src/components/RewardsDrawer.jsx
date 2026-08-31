import React, { useEffect, useMemo, useState } from "react";
import {
  claimRewardGift,
  createRewardRedemption,
  previewRewardRedemption,
} from "@/lib/api";
import { getCartSession } from "@/state/sessionStore";
import {
  refreshRewardsState,
  useRewardsState,
} from "@/state/rewardsStore";

function formatDate(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString();
}

function cleanMilestoneLabel(value) {
  return String(value || "Milestone")
    .replace(/^completed:\s*/i, "")
    .replace(/\s+completed$/i, "")
    .trim();
}

export default function RewardsDrawer({ shopperId, open, onClose, onHud }) {
  const rewards = useRewardsState();
  const [actionError, setActionError] = useState("");
  const [workingOfferId, setWorkingOfferId] = useState("");

  useEffect(() => {
    if (open && shopperId) void refreshRewardsState();
  }, [open, shopperId]);

  const completedMilestones = useMemo(
    () => (rewards.summary?.milestones || []).filter((item) => item.completed),
    [rewards.summary]
  );
  const unlockedOffers = useMemo(
    () => (rewards.offers || []).filter((offer) => offer.unlocked && offer.status !== "expired"),
    [rewards.offers]
  );

  async function applyOffer(offer) {
    const cartId = getCartSession()?.cartId;
    if (!cartId) {
      setActionError("Add your setup to the showroom cart before applying an offer.");
      return;
    }

    setWorkingOfferId(offer.id);
    setActionError("");
    try {
      const preview = await previewRewardRedemption({ offerId: offer.id, cartId });
      if (!preview?.eligible) {
        setActionError(preview?.reason || "This cart is not eligible for that offer yet.");
        return;
      }
      const idempotencyKey = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${offer.id}`;
      const result = await createRewardRedemption(
        {
          offerId: offer.id,
          cartId,
          cartFingerprint: preview.cartFingerprint,
          idempotencyKey,
        },
        idempotencyKey
      );
      if (result?.hud && typeof onHud === "function") onHud(result.hud);
      await refreshRewardsState({ force: true });
    } catch (error) {
      setActionError(
        error?.message || "The reward could not be applied. Normal checkout is still available."
      );
    } finally {
      setWorkingOfferId("");
    }
  }

  async function claimGift() {
    setActionError("");
    try {
      await claimRewardGift();
      await refreshRewardsState({ force: true });
    } catch (error) {
      setActionError(error?.message || "The sleep mask could not be claimed right now.");
    }
  }

  if (!open) return null;

  const summary = rewards.summary;
  const points = Number(summary?.availableSleepPoints || 0);
  const badge = summary?.currentBadge?.label || "Explorer";
  const progress = summary?.badgeProgress;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(8,25,59,.38)" }}
      aria-label="Rewards overlay"
    >
      <aside
        onClick={(event) => event.stopPropagation()}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          height: "100%",
          width: 430,
          maxWidth: "94vw",
          background: "#f8fbff",
          padding: 20,
          boxShadow: "-12px 0 40px rgba(8,25,59,.18)",
          overflowY: "auto",
        }}
        aria-label="My rewards"
      >
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ color: "#315efb", fontWeight: 800, letterSpacing: ".12em" }}>
              MY REWARDS
            </div>
            <h2 style={{ margin: "4px 0 0", fontSize: 28 }}>Reward summary</h2>
          </div>
          <button type="button" onClick={onClose} style={{ minHeight: 44, padding: "0 14px" }}>
            Close
          </button>
        </header>

        {rewards.status === "loading" && !summary && <p>Loading your rewards...</p>}
        {rewards.error && (
          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 12,
              background: summary ? "#eef5ff" : "#fff6df",
            }}
          >
            {rewards.error}
            <button
              type="button"
              onClick={() => refreshRewardsState({ force: true })}
              style={{ display: "block", marginTop: 10, minHeight: 44 }}
            >
              Try again
            </button>
          </div>
        )}

        {summary && (
          <>
            <section style={{ marginTop: 18, padding: 18, borderRadius: 16, background: "#fff" }}>
              <div style={{ fontSize: 34, fontWeight: 900, color: "#315efb" }}>
                {points} Sleep Points
              </div>
              <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800 }}>{badge}</div>
              {!progress?.complete && progress?.nextBadgeLabel ? (
                <p style={{ marginBottom: 0, color: "#526179" }}>
                  {progress?.pointsRemaining || 0} points to {progress.nextBadgeLabel}.
                </p>
              ) : null}
            </section>

            <section style={{ marginTop: 16 }}>
              <h3>Completed milestones</h3>
              <div style={{ display: "grid", gap: 8 }}>
                {completedMilestones.map((milestone) => (
                  <div
                    key={milestone.id}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, background: "#fff" }}
                  >
                    <span aria-hidden="true" style={{ color: "#12805c", fontWeight: 900 }}>✓</span>
                    <strong>{cleanMilestoneLabel(milestone.label)}</strong>
                  </div>
                ))}
                {!completedMilestones.length ? (
                  <p style={{ margin: 0, color: "#657087" }}>No completed milestones yet.</p>
                ) : null}
              </div>
            </section>

            {unlockedOffers.length ? (
            <section style={{ marginTop: 16 }}>
              <h3>Unlocked offers</h3>
              <div style={{ display: "grid", gap: 10 }}>
                {unlockedOffers.map((offer) => (
                  <div key={offer.id} style={{ padding: 14, borderRadius: 12, background: "#fff" }}>
                    <strong>{offer.label}</strong>
                    <p style={{ margin: "6px 0", color: "#526179" }}>{offer.description}</p>
                    <small>
                      {offer.status === "expired"
                        ? "Expired"
                        : offer.expiresAt
                          ? `Available through ${formatDate(offer.expiresAt)}`
                          : offer.eligibility}
                    </small>
                    <button
                      type="button"
                      disabled={workingOfferId === offer.id}
                      onClick={() => applyOffer(offer)}
                      style={{ width: "100%", minHeight: 46, marginTop: 10 }}
                    >
                      {workingOfferId === offer.id ? "Checking cart..." : "Check offer for this cart"}
                    </button>
                  </div>
                ))}
              </div>
            </section>
            ) : null}

            {rewards.gift?.status && rewards.gift.status !== "locked" && (
              <section style={{ marginTop: 16, padding: 16, borderRadius: 14, background: "#eafbf3" }}>
                <h3 style={{ marginTop: 0 }}>Complimentary sleep mask</h3>
                <p>Status: {rewards.gift.status}</p>
                {rewards.gift.status === "unlocked" && (
                  <button type="button" onClick={claimGift} style={{ minHeight: 44 }}>
                    Claim sleep mask
                  </button>
                )}
              </section>
            )}

            {actionError && (
              <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "#fff2e8" }}>
                {actionError}
              </div>
            )}

          </>
        )}
      </aside>
    </div>
  );
}
