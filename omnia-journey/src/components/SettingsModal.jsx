import React from "react";

export default function SettingsModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 360,
          background: "#fff",
          borderRadius: 16,
          padding: "24px 28px",
          boxShadow: "0 6px 24px rgba(0,0,0,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginBottom: 16, fontSize: 20 }}>Settings</h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <label>
            <input type="checkbox" /> Mute Snoozer Voice
          </label>
          <label>
            <input type="checkbox" /> Dim Display Lighting
          </label>
          <label>
            <input type="checkbox" /> Enable Ambient Sound
          </label>
          <label>
            <input type="checkbox" /> Accessibility Mode
          </label>
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: 24,
            width: "100%",
            padding: "10px 0",
            background: "#1A66D2",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
