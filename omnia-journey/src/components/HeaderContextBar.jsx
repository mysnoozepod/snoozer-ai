import React from "react";
import { Link } from "react-router-dom";
import useSessionTimer from "../hooks/useSessionTimer.js";

export default function HeaderContextBar({ color }) {
  const { timeLeft } = useSessionTimer(60); // 60-minute session timer

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        backdropFilter: "blur(8px)",
        background: "rgba(255,255,255,0.8)",
        borderBottom: `1px solid ${color.border}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 32px",
        fontWeight: 600,
        fontSize: 16,
        color: color.text,
      }}
    >
      {/* Left side */}
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <Link
          to="/explore"
          style={{
            textDecoration: "none",
            color: color.text,
            fontWeight: 700,
            transition: "opacity 0.2s ease",
          }}
        >
          Explore Products
        </Link>

        <Link
          to="/profile"
          style={{
            textDecoration: "none",
            color: color.text,
            fontWeight: 700,
            transition: "opacity 0.2s ease",
          }}
        >
          Your Snooze Profile
        </Link>
      </div>

      {/* Right side */}
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 500,
            fontSize: 15,
          }}
        >
          <span role="img" aria-label="timer">
            ⏱
          </span>
          <span id="session-timer">{timeLeft}</span>
        </div>

        <Link
          to="/cart"
          aria-label="Cart"
          style={{
            textDecoration: "none",
            color: "#fff",
            fontWeight: 600,
            padding: "8px 14px",
            borderRadius: 12,
            background: color.primary,
            boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
          }}
        >
          Cart
        </Link>
      </div>
    </header>
  );
}
