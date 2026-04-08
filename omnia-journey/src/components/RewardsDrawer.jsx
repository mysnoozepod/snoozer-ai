import React, { useEffect, useState } from "react";
import { getRewardBalance, redeemRewardPoints } from "@/lib/api";

export default function RewardsDrawer({ shopperId, open, onClose }) {
  const [balance, setBalance] = useState(0);
  const [history, setHistory] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(false);

  // Catalog via same API base
  async function fetchCatalog() {
    const API_BASE = import.meta.env.VITE_API_BASE?.replace(/\/$/, "");
    if (!API_BASE) return;
    const res = await fetch(`${API_BASE}/rewards/catalog`, { method: "GET" });
    const data = await res.json().catch(() => ({}));
    // backend returns { ok, status, data, error }
    const list = Array.isArray(data?.data?.items)
      ? data.data.items
      : Array.isArray(data?.items)
      ? data.items
      : [];
    setCatalog(list);
  }

  async function refreshBalance() {
    if (!shopperId) return;
    try {
      const data = await getRewardBalance(shopperId);
      // api.js returns raw backend body; normalize common shapes
      const bal =
        typeof data?.balance === "number"
          ? data.balance
          : typeof data?.data?.balance === "number"
          ? data.data.balance
          : 0;
      const hist = Array.isArray(data?.history)
        ? data.history
        : Array.isArray(data?.data?.history)
        ? data.data.history
        : [];
      setBalance(bal);
      setHistory(hist);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("RewardsDrawer refreshBalance failed", e);
    }
  }

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([refreshBalance(), fetchCatalog()])
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shopperId]);

  const handleRedeem = async (rewardId) => {
    try {
      const payload = { shopperId, rewardId };
      const res = await redeemRewardPoints(payload);
      // normalize
      const ok =
        res?.success === true ||
        res?.ok === true ||
        res?.data?.ok === true ||
        res?.data?.success === true;
      if (ok) {
        await refreshBalance();
        const label =
          res?.reward?.label ||
          res?.data?.reward?.label ||
          res?.label ||
          "Reward";
        alert(`🎉 Redeemed: ${label}`);
      } else {
        const msg =
          res?.error?.message ||
          res?.error ||
          res?.data?.error?.message ||
          "Failed to redeem";
        alert(`❌ ${msg}`);
      }
    } catch (e) {
      console.error("RewardsDrawer redeem failed", e);
      alert("Error redeeming reward");
    }
  };

  if (!open) return null;

  return (
    <div
      onClick={() => onClose(false)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
      }}
      aria-label="Rewards overlay"
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          height: "100%",
          width: 360,
          maxWidth: "90vw",
          background: "#fff",
          padding: 16,
          boxShadow: "-2px 0 8px rgba(0,0,0,0.25)",
          overflowY: "auto",
        }}
        aria-label="Rewards drawer"
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Your Rewards</h2>
          <button
            onClick={() => onClose(false)}
            style={{
              border: "1px solid #ddd",
              background: "#fff",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        <div style={{ marginTop: 12, marginBottom: 16 }}>
          <div style={{ color: "#555" }}>Current Balance</div>
          <div style={{ fontSize: 32, fontWeight: 900, color: "#7e22ce" }}>
            {loading ? "…" : `${balance} pts`}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Catalog</div>
          <div style={{ display: "grid", gap: 8 }}>
            {catalog.map((r) => (
              <div
                key={r.id}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 10,
                  padding: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{r.label}</div>
                  <div style={{ color: "#777" }}>{r.points} pts</div>
                </div>
                <button
                  onClick={() => handleRedeem(r.id)}
                  disabled={balance < r.points || loading}
                  style={{
                    border: "1px solid #ddd",
                    background: balance < r.points ? "#f5f5f5" : "#fff",
                    color: balance < r.points ? "#aaa" : "#222",
                    borderRadius: 8,
                    padding: "6px 10px",
                    cursor: balance < r.points ? "not-allowed" : "pointer",
                  }}
                >
                  Redeem
                </button>
              </div>
            ))}
            {catalog.length === 0 && (
              <div style={{ color: "#888", fontSize: 14 }}>
                {loading ? "Loading…" : "No rewards available."}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>History</div>
          <div style={{ display: "grid", gap: 4 }}>
            {history.map((h, i) => (
              <div key={i} style={{ color: "#555", fontSize: 14 }}>
                {h.ts}: {h.points > 0 ? "+" : ""}
                {h.points} ({h.reason})
              </div>
            ))}
            {history.length === 0 && (
              <div style={{ color: "#888", fontSize: 14 }}>
                {loading ? "Loading…" : "No history yet."}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
