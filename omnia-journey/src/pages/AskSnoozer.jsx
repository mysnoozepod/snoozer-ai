// src/pages/AskSnoozer.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import SnoozerHUD from "@/components/SnoozerHUD";

/* ───────────────────────── helpers ───────────────────────── */

function safeGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function readCheckoutUrl() {
  return safeGet("snooze.shopify.checkoutUrl") || safeGet("snooze.checkoutUrl") || "";
}

function buildExploreContext() {
  // Prefer a persisted, curated context if some page wrote it
  const raw = safeGet("snooze.snoozer.layoutExploreContext");
  const parsed = raw ? safeParseJson(raw) : null;
  if (Array.isArray(parsed) && parsed.length) return parsed.slice(0, 12);

  // Fallback to recommended handles (if present)
  const handlesRaw = safeGet("snooze.recommendedProductHandles");
  const handles = handlesRaw ? safeParseJson(handlesRaw) : null;

  if (Array.isArray(handles) && handles.length) {
    const seen = new Set();
    const items = [];
    for (const h of handles) {
      const handle = String(h || "").trim();
      if (!handle) continue;
      if (seen.has(handle)) continue;
      seen.add(handle);
      items.push({
        handle,
        title: handle,
        firstAvailableVariantId: null,
      });
      if (items.length >= 12) break;
    }
    return items;
  }

  return [];
}

function resetKioskState() {
  // Minimal, safe reset. Checkout is sacred, so we clear it too.
  const keys = [
    "snooze.chatTranscript",
    "snooze.contextPatch",
    "snooze.cartId",
    "snooze.checkoutUrl",
    "snooze.shopify.checkoutUrl",
    "snooze.snoozer.lastCaption",
    "snooze.snoozer.dockOpen",
  ];

  for (const k of keys) {
    try {
      sessionStorage.removeItem(k);
    } catch {
      // ignore
    }
  }
}

/* ───────────────────────── page ───────────────────────── */

export default function AskSnoozer() {
  const navigate = useNavigate();

  const shopperId = useMemo(() => {
    try {
      return sessionStorage.getItem("snooze.accessCode") || "guest";
    } catch {
      return "guest";
    }
  }, []);

  const assessment = useMemo(() => {
    const raw = safeGet("snooze.assessment");
    const parsed = raw ? safeParseJson(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  }, []);

  const exploreContext = useMemo(() => buildExploreContext(), []);

  const [openCartUrl, setOpenCartUrl] = useState(() => readCheckoutUrl());

  // Disable global chat widget on this route so we don't get duplicates
  useEffect(() => {
    const prev = window.__SNOOZE_DISABLE_WIDGET;
    window.__SNOOZE_DISABLE_WIDGET = true;
    document.body.classList.add("no-global-chat");
    return () => {
      window.__SNOOZE_DISABLE_WIDGET = prev;
      document.body.classList.remove("no-global-chat");
    };
  }, []);

  function handleSnoozerCheckoutCreated({ cartId, checkoutUrl, contextPatch }) {
    if (cartId) safeSet("snooze.cartId", String(cartId));
    if (checkoutUrl) {
      safeSet("snooze.checkoutUrl", String(checkoutUrl));
      safeSet("snooze.shopify.checkoutUrl", String(checkoutUrl));
      setOpenCartUrl(String(checkoutUrl));
    }
    if (contextPatch && typeof contextPatch === "object") {
      safeSet("snooze.contextPatch", JSON.stringify(contextPatch));
    }
  }

  return (
    <section className="min-h-screen bg-gradient-to-b from-[#E8ECF5] to-white py-10 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border bg-amber-50 text-amber-900 border-amber-200 px-3 py-1 text-xs font-extrabold">
              Legacy / Dev Console
            </div>
            <h1 className="mt-3 text-3xl md:text-4xl font-extrabold text-gray-900">
              Ask Snoozer
            </h1>
            <p className="mt-2 text-gray-700">
              This is a developer-friendly screen. The real showroom experience lives in{" "}
              <span className="font-semibold">Results → Pod</span>.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate("/results")}>
              Go to Results
            </Button>
            <Button variant="outline" onClick={() => navigate("/pod/1")}>
              Go to Pod 1
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                resetKioskState();
                setOpenCartUrl("");
              }}
            >
              Reset (kiosk)
            </Button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-5">
            <SnoozerHUD
              shopperId={shopperId || "guest"}
              mode="ask-snoozer"
              assessment={assessment}
              exploreContext={exploreContext}
              onCheckoutCreated={handleSnoozerCheckoutCreated}
              title="Snoozer"
              subtitle="Ask anything. If you want the product flow, go to Results → Pod."
            />

            {openCartUrl ? (
              <div className="mt-3 flex justify-center">
                <a
                  href={openCartUrl}
                  className="text-xs font-extrabold text-indigo-700 underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Cart
                </a>
              </div>
            ) : null}
          </div>

          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <div className="text-lg font-extrabold text-gray-900">What this page is for</div>
              <ul className="mt-3 space-y-2 text-sm text-gray-700">
                <li>• Quick dev testing for the /ask-snoozer backend route</li>
                <li>• Verifying cart creation and checkout URL handling</li>
                <li>• Sanity-checking that Snoozer responds with the expected contextPatch</li>
              </ul>
            </div>

            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <div className="text-lg font-extrabold text-gray-900">What this page is NOT</div>
              <ul className="mt-3 space-y-2 text-sm text-gray-700">
                <li>• The showroom UI</li>
                <li>• A transcript-first chat experience</li>
                <li>• A replacement for Results → Pod</li>
              </ul>
              <div className="mt-4 text-sm text-gray-600">
                If you want customers to stay focused, keep them in the Pod flow where Snoozer is a HUD, not a hostage taker.
              </div>
            </div>

            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <div className="text-sm font-extrabold text-gray-900">Current context snapshot</div>
              <div className="mt-2 text-xs text-gray-600">
                Shopper: <span className="font-semibold">{shopperId || "guest"}</span>
              </div>
              <div className="mt-2 text-xs text-gray-600">
                Explore items in context: <span className="font-semibold">{exploreContext.length}</span>
              </div>
              <div className="mt-2 text-xs text-gray-600">
                Checkout URL:{" "}
                <span className="font-semibold">{openCartUrl ? "available" : "none"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}