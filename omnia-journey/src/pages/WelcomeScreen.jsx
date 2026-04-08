import React from "react";
import { useNavigate } from "react-router-dom";

export default function WelcomeScreen() {
  const navigate = useNavigate();

  return (
    <div>
      <h1>Welcome to Omnia</h1>
      <button onClick={() => navigate("/explore")}>Explore Products</button>
    </div>
  );
}
