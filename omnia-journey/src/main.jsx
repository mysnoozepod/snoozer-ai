// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Layout from "./Layout.jsx";
import Welcome from "./pages/Welcome.jsx";
import Explore from "./pages/Explore.jsx";
import ProductDetail from "./pages/ProductDetail.jsx";
import Checkout from "./pages/Checkout.jsx";
import Cart from "./pages/Cart.jsx";
import WhatToExpect from "./pages/WhatToExpect.jsx";
import Faqs from "./pages/Faqs.jsx";
import Financing from "./pages/Financing.jsx";
import Assessment from "./pages/Assessment.jsx";
import Results from "./pages/Results.jsx";
import AskSnoozer from "./pages/AskSnoozer.jsx";

// âœ… Pod experience route
import Pod from "./pages/Pod.jsx";

// âœ… SnoozePod plan page route
import SnoozePod from "./pages/SnoozePod.jsx";

// âœ… Single source of truth: CartContext lives in src/lib
import { CartProvider } from "./lib/CartContext.jsx";
import { api } from "./lib/api.js";
import { DeviceModeProvider } from "./device/DeviceModeProvider.jsx";
import DeviceRouteGuard from "./device/DeviceRouteGuard.jsx";

import ErrorBoundary from "./ErrorBoundary.jsx";
import "./styles/index.css";

function SessionBoot({ children }) {
  const bootedRef = React.useRef(false);

  React.useEffect(() => {
    // React StrictMode (dev) can double-invoke effects.
    // Avoid spamming backend session creation.
    if (bootedRef.current) return;
    bootedRef.current = true;

    // Best-effort session bootstrap so the backend can correlate requests.
    api.ensureSession?.().catch(() => {});
  }, []);

  return children;
}

function NotFound() {
  return (
    <div style={{ padding: 24, textAlign: "center" }}>
      <h2 style={{ marginBottom: 8 }}>Page not found</h2>
      <p style={{ marginBottom: 16, opacity: 0.8 }}>
        The page may have moved, or the link may be incomplete.
      </p>
      <a href="/welcome">Back to Welcome</a>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <CartProvider>
        <SessionBoot>
          <DeviceModeProvider>
            <BrowserRouter>
              <Routes>
                <Route
                  path="/"
                  element={
                    <DeviceRouteGuard>
                      <Layout />
                    </DeviceRouteGuard>
                  }
                >
                {/* Entry */}
                <Route index element={<Navigate to="/welcome" replace />} />
                <Route path="start" element={<Navigate to="/welcome" replace />} />

                {/* Core pages */}
                <Route path="welcome" element={<Welcome />} />
                <Route path="what-to-expect" element={<WhatToExpect />} />
                <Route path="faqs" element={<Faqs />} />
                <Route path="financing" element={<Financing />} />

                {/* Assessment flow */}
                <Route path="assessment" element={<Assessment />} />
                <Route path="results" element={<Results />} />

                {/* POD EXPERIENCE (canonical showroom mode) */}
                <Route path="pod/:podId" element={<Pod />} />

                {/* SnoozePod plan (build + rewards + commit to cart) */}
                <Route path="snoozepod" element={<SnoozePod />} />

                {/* Legacy Explore route */}
                <Route path="explore" element={<Navigate to="/pod/pod-1" replace />} />
                <Route path="explore-dev" element={<Explore />} />

                {/* Aliases -> Pod experience (so links/buttons never break) */}
                <Route
                  path="shop-with-snoozer"
                  element={<Navigate to="/pod/pod-1" replace />}
                />
                <Route
                  path="ask-snoozer/explore"
                  element={<Navigate to="/pod/pod-1" replace />}
                />
                <Route
                  path="asksnoozer/explore"
                  element={<Navigate to="/pod/pod-1" replace />}
                />

                <Route path="ask-snoozer" element={<AskSnoozer />} />

                {/* Cart + Checkout */}
                <Route
                  path="cart"
                  element={
                    <DeviceRouteGuard requireCart>
                      <Cart />
                    </DeviceRouteGuard>
                  }
                />
                <Route
                  path="checkout/guest"
                  element={
                    <DeviceRouteGuard requireCheckout>
                      <Checkout />
                    </DeviceRouteGuard>
                  }
                />
                <Route
                  path="checkout/:id"
                  element={
                    <DeviceRouteGuard requireCheckout>
                      <Checkout />
                    </DeviceRouteGuard>
                  }
                />

                {/* Product detail â€” accepts either handle or numeric ID */}
                <Route path="products/:slug" element={<ProductDetail />} />

                {/* Catch-all */}
                <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </DeviceModeProvider>
        </SessionBoot>
      </CartProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
