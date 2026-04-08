import React from "react";
import {
  Bed,
  ArrowsUp,
  Columns,
  SplitHorizontal,
} from "phosphor-react";

/**
 * MotionIcon
 *
 * type:
 *  - "standard"
 *  - "half"
 *  - "full"
 *
 * size: number (default 28)
 * color: base color (default neutral)
 * accentColor: motion indicator color
 */

export default function MotionIcon({
  type = "standard",
  size = 28,
  color = "#1f2937",
  accentColor = "#2563eb",
}) {
  const baseStyle = { color };
  const accentStyle = { color: accentColor };

  if (type === "standard") {
    return (
      <div style={containerStyle}>
        <Bed size={size} weight="regular" style={baseStyle} />
        <div style={overlayStyle}>
          <ArrowsUp size={size * 0.6} weight="bold" style={accentStyle} />
        </div>
      </div>
    );
  }

  if (type === "half") {
    return (
      <div style={containerStyle}>
        <Bed size={size} weight="regular" style={baseStyle} />
        <div style={overlayStyle}>
          <SplitHorizontal
            size={size * 0.6}
            weight="regular"
            style={accentStyle}
          />
        </div>
      </div>
    );
  }

  if (type === "full") {
    return (
      <div style={containerStyle}>
        <Columns size={size} weight="regular" style={baseStyle} />
        <div style={overlayStyle}>
          <ArrowsUp size={size * 0.6} weight="bold" style={accentStyle} />
        </div>
      </div>
    );
  }

  return null;
}

const containerStyle = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const overlayStyle = {
  position: "absolute",
  top: 2,
  right: 2,
};
