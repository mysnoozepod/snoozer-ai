import React, { useState } from "react";
import SettingsModal from "./SettingsModal.jsx";

export default function FooterControlBar({ color, onRewardsClick }) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <footer
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          width: "100%",
          backdropFilter: "blur(8px)",
          background: "rgba(255,255,255,0.9)",
          borderTop: `1px solid ${color.border}`,
          padding: "14px 32px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 48,
          fontWeight: 600,
          fontSize: 16,
          zIndex: 100,
        }}
      >
        <button
          onClick={() => alert("Staff alert triggered.")}
          style={btnStyle(color)}
        >
          🤝 Contact a Human
        </button>

        <button onClick={onRewardsClick} style={btnStyle(color)}>
          🏆 Earn Rewards
        </button>

        <button
          onClick={() => setSettingsOpen(true)}
          style={btnStyle(color)}
        >
          ⚙️ Settings
        </button>
      </footer>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

function btnStyle(color) {
  return {
    background: "transparent",
    border: "none",
    color: color.text,
    fontWeight: 600,
    fontSize: 16,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
    transition: "color 0.2s ease, transform 0.2s ease",
  };
}
