// src/pages/Explore.jsx
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import useSnoozerSession from "@/lib/useSnoozerSession";
import { api } from "@/lib/api";
import { useStore } from "@/lib/useStore";

import DecisionBar from "@/components/DecisionBar";
import SnoozerCue from "@/components/SnoozerCue";
import SnoozerHUD from "@/components/SnoozerHUD";
import { generateShowroomRecommendations } from "@/lib/utils/recommendations";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function safeGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, val) {
  try {
    sessionStorage.setItem(key, val);
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

function toNumericId(id) {
  if (!id) return "";
  const s = String(id);
  return s.startsWith("gid://") ? s.split("/").pop() : s;
}

function lower(v) {
  return String(v || "").toLowerCase().trim();
}

function formatPrice(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(n);
  } catch {
    return `$${Number(n).toFixed(2)}`;
  }
}

// GraphQL-safe normalizers
function normalizeImages(imagesLike) {
  if (!imagesLike) return [];
  if (Array.isArray(imagesLike)) return imagesLike.filter(Boolean);

  const edges = imagesLike?.edges;
  if (Array.isArray(edges)) return edges.map((e) => e?.node).filter(Boolean);

  const nodes = imagesLike?.nodes;
  if (Array.isArray(nodes)) return nodes.filter(Boolean);

  return [];
}

function pickImage(imagesLike) {
  const images = normalizeImages(imagesLike);
  if (!images.length) return "/no-image.svg";

  const candidates = [
    images.find((i) => i?.url)?.url,
    images.find((i) => i?.src)?.src,
    images.find((i) => i?.originalSrc)?.originalSrc,
  ].filter(Boolean);

  return candidates[0] || "/no-image.svg";
}

function normalizeVariants(variantsLike) {
  if (!variantsLike) return [];
  if (Array.isArray(variantsLike)) return variantsLike.filter(Boolean);

  const edges = variantsLike?.edges;
  if (Array.isArray(edges)) return edges.map((e) => e?.node).filter(Boolean);

  const nodes = variantsLike?.nodes;
  if (Array.isArray(nodes)) return nodes.filter(Boolean);

  return [];
}

function pickFirstVariantId(fullProduct) {
  const variants = normalizeVariants(fullProduct?.variants);
  const v0 = variants[0] || null;
  return v0?.id || null;
}

function normalizeProduct(p = {}) {
  const minPrice =
    typeof p.price === "number"
      ? p.price
      : typeof p?.priceRange?.min === "number"
      ? p.priceRange.min
      : typeof p?.priceRange?.minVariantPrice?.amount === "string"
      ? Number(p.priceRange.minVariantPrice.amount)
      : typeof p?.priceRange?.minVariantPrice?.amount === "number"
      ? p.priceRange.minVariantPrice.amount
      : null;

  const imageUrl =
    p?.imageUrl ||
    p?.image ||
    p?.image?.url ||
    pickImage(p.images || p?.featuredImage || p?.media);

  const variantId =
    p?.variantId ||
    p?.firstAvailableVariantId ||
    pickFirstVariantId(p) ||
    null;

  return {
    id: p.id ? toNumericId(p.id) : p.handle,
    handle: p.handle,
    title: p.title || "Untitled",
    imageUrl: imageUrl || "/no-image.svg",
    priceNumber: typeof minPrice === "number" && Number.isFinite(minPrice) ? minPrice : null,
    priceDisplay:
      typeof minPrice === "number" && Number.isFinite(minPrice) ? formatPrice(minPrice) : "—",
    tags: Array.isArray(p.tags) ? p.tags : [],
    reason: p.reason || "",
    productType: p.productType || "",
    variantId,
  };
}

function computeAvailableSizes({ motionMode } = {}) {
  const m = lower(motionMode);

  if (m.includes("full split")) return ["King"];
  if (m.includes("half split")) return ["Queen", "King"];

  return ["King", "Queen", "Full", "Twin XL", "Twin"];
}

function computeDisplayedBaseLabel(baseHandle) {
  const h = lower(baseHandle);
  if (h.includes("adjustable")) return "Adjustable Base";
  if (h.includes("storage")) return "Storage Base";
  if (h.includes("platform")) return "Platform Base";
  return "Base";
}

function pickCleanMotionLabel(v) {
  const s = String(v || "").trim();
  return s || "";
}

function computeDisplayedMotionLabel(inStoreMotionMode, selectedMotion) {
  return (
    pickCleanMotionLabel(inStoreMotionMode) ||
    pickCleanMotionLabel(selectedMotion) ||
    "—"
  );
}

function pickDisplayedSize(inStoreSize, selectedSize) {
  const s = String(inStoreSize || "").trim();
  if (s) return s;
  const fallback = String(selectedSize || "").trim();
  return fallback || "—";
}

function buildWhyCopy(heroProduct, activePod, assessment) {
  if (heroProduct?.reason) return heroProduct.reason;

  const pos = lower(assessment?.sleepPosition);
  const firm = String(assessment?.firmness || "").trim();
  const temp = String(assessment?.temperature || "").trim();

  const parts = [];
  if (pos) parts.push(`Matches your sleep position (${pos}).`);
  if (firm) parts.push(`Aligned to your feel (${firm}).`);
  if (temp) parts.push(`Accounts for temperature preference (${temp}).`);

  if (activePod?.subtitle) parts.push(activePod.subtitle);

  return parts.length
    ? parts.join(" ")
    : "Test it in your normal sleep position first, then switch positions and notice pressure + alignment.";
}

// ─────────────────────────────────────────────
// Explore – Showroom Mode
// ─────────────────────────────────────────────
export default function Explore() {
  const { shopperId } = useSnoozerSession("explore");
  const addToCart = useStore((s) => s.addToCart);

  const [loading, setLoading] = useState(true);
  const [recs, setRecs] = useState(null);

  const [activePodId, setActivePodId] = useState(null);
  const [heroProduct, setHeroProduct] = useState(null);
  const [podProducts, setPodProducts] = useState({});

  const [selectedSize, setSelectedSize] = useState("");
  const [selectedMotion, setSelectedMotion] = useState("");

  const [cue, setCue] = useState(
    "Spend about 90 seconds on your side. Notice shoulder pressure."
  );
  const [cueType, setCueType] = useState("tip");


  // Disable global chat widget on this route
  useEffect(() => {
    const prev = window.__SNOOZE_DISABLE_WIDGET;
    window.__SNOOZE_DISABLE_WIDGET = true;
    document.body.classList.add("no-global-chat");
    return () => {
      window.__SNOOZE_DISABLE_WIDGET = prev;
      document.body.classList.remove("no-global-chat");
    };
  }, []);

  const assessment = useMemo(() => {
    const raw = safeGet("snooze.assessment");
    const parsed = raw ? safeParseJson(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  }, []);

  // Load existing recs from storage; fallback to regenerate if missing
  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);

      const stored = safeGet("snooze.recommendations");
      const parsed = stored ? safeParseJson(stored) : null;

      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray(parsed.pods) &&
        parsed.pods.length
      ) {
        if (!alive) return;
        setRecs(parsed);
        setLoading(false);
        return;
      }

      try {
        const generated = await generateShowroomRecommendations(assessment);
        if (!alive) return;

        setRecs(generated);
        safeSet("snooze.recommendations", JSON.stringify(generated || {}));
      } catch {
        // ignore
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [assessment]);

  // Set initial pod + decisions once recs exist
  useEffect(() => {
    if (!recs || !Array.isArray(recs.pods) || !recs.pods.length) return;

    const first = recs.pods[0];
    const firstPodId = String(first.podId ?? first.id ?? "");
    if (!activePodId) setActivePodId(firstPodId || "1");

    const initSize = assessment?.size || recs?.meta?.size || "King";
    const initMotion =
      assessment?.motionMode || recs?.meta?.motionMode || "Standard Motion";

    setSelectedSize(initSize);
    setSelectedMotion(initMotion);
  }, [recs, assessment, activePodId]);

  const allPods = useMemo(
    () => (Array.isArray(recs?.pods) ? recs.pods : []),
    [recs]
  );

  const activePod = useMemo(() => {
    const id = String(activePodId || "");
    return (
      allPods.find((p) => String(p.podId ?? p.id ?? "") === id) ||
      allPods[0] ||
      null
    );
  }, [allPods, activePodId]);

  // Preload products for ALL pods (dedupe handles)
  useEffect(() => {
    let alive = true;

    (async () => {
      if (!allPods.length) return;

      const uniqueHandles = Array.from(
        new Set(allPods.map((p) => p?.mattressHandle).filter(Boolean))
      );

      try {
        const handlePairs = await Promise.all(
          uniqueHandles.map(async (handle) => {
            try {
              const full = await api.getProductById(handle);
              return [handle, normalizeProduct(full)];
            } catch {
              return [handle, null];
            }
          })
        );

        if (!alive) return;

        const byHandle = {};
        handlePairs.forEach(([h, prod]) => {
          if (h && prod) byHandle[h] = prod;
        });

        const byPodId = {};
        allPods.forEach((pod) => {
          const podId = String(pod.podId ?? pod.id ?? "");
          const handle = pod?.mattressHandle;
          if (podId && handle && byHandle[handle]) {
            byPodId[podId] = byHandle[handle];
          }
        });

        setPodProducts(byPodId);
      } catch {
        // ignore
      }
    })();

    return () => {
      alive = false;
    };
  }, [allPods]);

  const displayedIn = useMemo(() => {
    if (!activePod) return { size: "—", baseLabel: "—", motionLabel: "—" };

    const inStore = activePod.inStore || activePod.displayedIn || {};
    const size = pickDisplayedSize(inStore.size, selectedSize);

    const baseLabel =
      String(inStore.baseLabel || "").trim() ||
      computeDisplayedBaseLabel(activePod.baseHandle || activePod.fixtureBaseHandle);

    const motionLabel = computeDisplayedMotionLabel(
      inStore.motionMode || inStore.motion,
      selectedMotion
    );

    return { size, baseLabel, motionLabel };
  }, [activePod, selectedSize, selectedMotion]);

  const availableSizes = useMemo(
    () => computeAvailableSizes({ motionMode: selectedMotion }),
    [selectedMotion]
  );

  const motionOptions = useMemo(
    () => ["No Motion", "Standard Motion", "Half Split Motion", "Full Split Motion"],
    []
  );

  // Compact "explore context" for Snoozer
  const snoozerExploreContext = useMemo(() => {
    const items = [];

    if (heroProduct?.handle) {
      items.push({
        handle: heroProduct.handle,
        title: heroProduct.title,
        firstAvailableVariantId: heroProduct.variantId || null,
      });
    }

    const seen = new Set(items.map((x) => x.handle));
    for (const p of Object.values(podProducts || {})) {
      if (!p?.handle) continue;
      if (seen.has(p.handle)) continue;
      seen.add(p.handle);
      items.push({
        handle: p.handle,
        title: p.title,
        firstAvailableVariantId: p.variantId || null,
      });
    }

    return items.slice(0, 12);
  }, [heroProduct, podProducts]);

  // Load hero mattress product for active pod
  useEffect(() => {
    let alive = true;

    (async () => {
      if (!activePod?.mattressHandle) return;

      try {
        const podId = String(activePod?.podId ?? activePod?.id ?? "");
        const cached = podId ? podProducts[podId] : null;

        if (cached) {
          if (!alive) return;
          setHeroProduct({ ...cached, reason: cached.reason || "" });
        } else {
          const full = await api.getProductById(activePod.mattressHandle);
          if (!alive) return;

          const normalized = normalizeProduct(full);
          setHeroProduct({ ...normalized, reason: normalized.reason || "" });
        }

        setCueType("tip");
        setCue(
          "Try your normal sleep position first. Then switch positions and notice pressure + alignment."
        );

      } catch {
        // ignore
      }
    })();

    return () => {
      alive = false;
    };
  }, [activePod?.mattressHandle, activePod?.podId, podProducts]);

  async function regenerateWith(nextSize, nextMotion) {
    try {
      const draft = {
        ...(assessment || {}),
        size: nextSize,
        motionMode: nextMotion,
      };

      const generated = await generateShowroomRecommendations(draft);
      setRecs(generated);
      safeSet("snooze.recommendations", JSON.stringify(generated || {}));

      const nextPod = generated?.pods?.[0] || null;
      if (nextPod) setActivePodId(String(nextPod.podId ?? nextPod.id ?? "1"));

      const warnings = Array.isArray(generated?.meta?.warnings)
        ? generated.meta.warnings
        : [];
      if (warnings.length) {
        setCueType("warning");
        setCue(warnings[0]);
      } else {
        setCueType("tip");
        setCue("Decision updated. Now test the updated best-fit SnoozePod.");
      }
    } catch {
      setCueType("warning");
      setCue("Couldn’t refresh recommendations right now. Try again in a moment.");
    }
  }

  function handleChangeSize(next) {
    const v = String(next || "").trim();
    if (!v) return;
    setSelectedSize(v);
    regenerateWith(v, selectedMotion);
  }

  function handleChangeMotion(next) {
    const v = String(next || "").trim();
    if (!v) return;

    setSelectedMotion(v);

    const m = lower(v);
    if (m.includes("half split") || m.includes("full split")) {
      setCueType("tip");
      setCue(
        "Split motion means Dual Comfort is required. We’ll keep the mattress aligned automatically."
      );
    } else {
      setCueType("tip");
      setCue("Motion preference updated. Your mattress match will auto-update.");
    }

    regenerateWith(selectedSize, v);
  }

  function handleChangeMattress() {
    setCueType("tip");
    setCue("Tap a SnoozePod tile to switch what you’re testing.");
  }

  async function handleAddToCart(product) {
    try {
      // If we already have the first variantId, skip the extra fetch.
      const cachedVariantId = product?.variantId || null;

      let variantId = cachedVariantId;
      if (!variantId) {
        const full = await api.getProductById(product.handle);
        variantId = pickFirstVariantId(full);
      }

      if (!variantId) {
        setCueType("warning");
        setCue("That item can’t be added to cart right now.");
        return;
      }

      addToCart({
        merchandiseId: variantId,
        handle: product.handle || null,
        title: product.title,
        imageUrl: product.imageUrl,
        unitPrice: product.priceNumber ?? 0,
        quantity: 1,
      });

      setCueType("success");
      setCue("Added to cart. Keep testing or head to checkout when you’re ready.");
    } catch {
      setCueType("warning");
      setCue("We couldn’t add that to cart. Try again in a moment.");
    }
  }

  const whyCopy = useMemo(
    () => buildWhyCopy(heroProduct, activePod, assessment),
    [heroProduct, activePod, assessment]
  );

  function handleSnoozerCheckoutCreated({ cartId, checkoutUrl, contextPatch }) {
    if (cartId) safeSet("snooze.cartId", String(cartId));
    if (checkoutUrl) {
      safeSet("snooze.checkoutUrl", String(checkoutUrl));
      safeSet("snooze.shopify.checkoutUrl", String(checkoutUrl));
    }
    if (contextPatch && typeof contextPatch === "object") {
      safeSet("snooze.contextPatch", JSON.stringify(contextPatch));
    }

    setCueType("success");
    setCue("Snoozer added it to your cart. You can keep browsing or open the cart.");
  }

  return (
    <section className="min-h-screen bg-gradient-to-b from-[#E8ECF5] to-white py-8">
      <div className="max-w-6xl mx-auto px-4">
        {/* HEADER */}
        <div className="text-center mb-5">
          <h1 className="text-2xl font-semibold">
            {activePod?.title || "SnoozePods"}
          </h1>
          <p className="text-sm text-gray-600">
            Recommended based on your Snooze Profile
          </p>
        </div>

        {/* Main layout: HUD left, content right */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
          {/* Snoozer HUD */}
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-6">
              <SnoozerHUD
                chrome="none"
                size="xl"
                shopperId={shopperId}
                mode="explore"
                assessment={assessment}
                exploreContext={snoozerExploreContext}
                onCheckoutCreated={handleSnoozerCheckoutCreated}
                title="Snoozer"
                subtitle="Compare pods. Explain. Add to cart."
              />
            </div>
          </div>

          {/* Content */}
          <div className="lg:col-span-7 space-y-6">
            {/* DECISION BAR */}
            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <DecisionBar
                size={selectedSize}
                motion={selectedMotion}
                mattress={heroProduct?.title || "—"}
                sizeOptions={availableSizes}
                motionOptions={motionOptions}
                onChangeSize={handleChangeSize}
                onChangeMotion={handleChangeMotion}
                onChangeMattress={handleChangeMattress}
              />
            </div>

            {/* ALL PODS */}
            {allPods.length > 0 ? (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-gray-700">
                    All SnoozePods
                  </div>
                  <div className="text-xs text-gray-500">Top picks are tagged</div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {allPods.map((pod) => {
                    const id = String(pod.podId ?? pod.id ?? "");
                    const isActive = id && String(activePodId || "") === id;
                    const product = id ? podProducts[id] : null;

                    return (
                      <PodTile
                        key={id || pod.title}
                        pod={pod}
                        product={product}
                        active={isActive}
                        onTest={() => {
                          setActivePodId(id);
                          setCueType("tip");
                          setCue(
                            "Now testing a different SnoozePod. Try your normal position first."
                          );
                        }}
                        onAdd={() => {
                          if (product?.handle) handleAddToCart(product);
                          else {
                            setCueType("warning");
                            setCue(
                              "That pod’s product details aren’t loaded yet. Try again in a second."
                            );
                          }
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* HERO */}
            <div>
              {loading || !activePod || !heroProduct ? (
                <div className="text-center text-gray-500">Loading SnoozePod…</div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-2xl shadow-lg p-6"
                >
                  <div className="grid md:grid-cols-2 gap-6 items-center">
                    <img
                      src={heroProduct.imageUrl}
                      alt={heroProduct.title}
                      className="rounded-xl w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.src = "/no-image.svg";
                      }}
                    />

                    <div>
                      <h2 className="text-xl font-semibold">{heroProduct.title}</h2>

                      <p className="text-gray-600 mt-2 line-clamp-2">{whyCopy}</p>

                      <div className="text-2xl font-semibold mt-3">
                        {heroProduct.priceDisplay}
                      </div>

                      <div className="mt-4 rounded-2xl border bg-gray-50 px-4 py-3 text-sm">
                        <div>
                          <span className="font-medium">Displayed in:</span>{" "}
                          {displayedIn.size} with {displayedIn.baseLabel}
                          {displayedIn.motionLabel !== "—" ? (
                            <> • {displayedIn.motionLabel}</>
                          ) : null}
                        </div>

                        <div className="mt-1">
                          <span className="font-medium">Available as:</span>{" "}
                          {availableSizes.join(" · ")}
                        </div>

                        <div className="mt-2 text-xs text-gray-600">
                          The showroom setup is just a display. You can order a standard one-piece
                          mattress in your chosen size.
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-2 gap-3">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setCueType("tip");
                            setCue(heroProduct.reason || whyCopy);
                          }}
                        >
                          Why this bed
                        </Button>
                        <Button onClick={() => handleAddToCart(heroProduct)}>
                          Add to Cart
                        </Button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            {/* SNOOZER CUE */}
            <div className="mx-auto max-w-2xl">
              <SnoozerCue text={cue} type={cueType} />
            </div>

            {/* ACCESSORIES */}
            {(Array.isArray(recs?.pillows) && recs.pillows.length > 0) ||
            (Array.isArray(recs?.bedding) && recs.bedding.length > 0) ? (
              <div className="mt-8">
                <h3 className="text-sm font-semibold text-gray-600 mb-3 text-center">
                  Accessories (optional, but helpful)
                </h3>

                <div className="grid md:grid-cols-2 gap-6">
                  <div className="bg-white rounded-2xl border shadow-sm p-4">
                    <div className="text-sm font-semibold">Pillows</div>
                    <div className="mt-3 space-y-2">
                      {(recs?.pillows || []).slice(0, 3).map((x, idx) => (
                        <div
                          key={`${x.handle || idx}`}
                          className="rounded-xl border bg-gray-50 px-3 py-2"
                        >
                          <div className="text-sm font-semibold">{x.title}</div>
                          {x.subtitle ? (
                            <div className="text-xs text-gray-600 mt-0.5">
                              {x.subtitle}
                            </div>
                          ) : null}
                        </div>
                      ))}
                      {(recs?.pillows || []).length === 0 ? (
                        <div className="text-xs text-gray-500">
                          No pillow picks found yet.
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border shadow-sm p-4">
                    <div className="text-sm font-semibold">Sheets + Bedding</div>
                    <div className="mt-3 space-y-2">
                      {(recs?.bedding || []).slice(0, 3).map((x, idx) => (
                        <div
                          key={`${x.handle || idx}`}
                          className="rounded-xl border bg-gray-50 px-3 py-2"
                        >
                          <div className="text-sm font-semibold">{x.title}</div>
                          {x.subtitle ? (
                            <div className="text-xs text-gray-600 mt-0.5">
                              {x.subtitle}
                            </div>
                          ) : null}
                        </div>
                      ))}
                      {(recs?.bedding || []).length === 0 ? (
                        <div className="text-xs text-gray-500">
                          No bedding picks found yet.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * PodTile
 * Compact selector tile.
 */
function PodTile({ pod, product, active, onTest, onAdd }) {
  const rank = Number(pod?.rank || 0);
  const recommended = !!pod?.recommended;

  return (
    <button
      type="button"
      onClick={onTest}
      className={[
        "text-left w-full rounded-2xl border bg-white shadow-sm p-3 transition",
        active
          ? "ring-2 ring-indigo-600 border-indigo-200"
          : "border-gray-200 hover:border-indigo-200",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-extrabold text-gray-900 tracking-wide">
          {pod?.title || "SnoozePod"}
        </div>

        {recommended ? (
          <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200">
            Recommended #{rank || "—"}
          </span>
        ) : (
          <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
            Option
          </span>
        )}
      </div>

      <div className="mt-2 rounded-xl overflow-hidden border bg-gray-50">
        <img
          src={product?.imageUrl || "/no-image.svg"}
          alt={product?.title || pod?.title || "SnoozePod"}
          className="w-full h-[88px] object-cover"
          loading="lazy"
          decoding="async"
          onError={(e) => {
            e.currentTarget.src = "/no-image.svg";
          }}
        />
      </div>

      <div className="mt-2">
        <div className="text-xs font-semibold text-gray-800 line-clamp-1">
          {product?.title || "Loading…"}
        </div>
        <div className="text-sm font-extrabold text-indigo-700">
          {product?.priceDisplay || "—"}
        </div>
        {pod?.subtitle ? (
          <div className="text-[10px] text-gray-500 line-clamp-1">{pod.subtitle}</div>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2" onClick={(e) => e.stopPropagation()}>
        <Button variant="outline" className="h-9" onClick={onTest}>
          Test
        </Button>
        <Button className="h-9" onClick={onAdd} disabled={!product?.handle}>
          Add
        </Button>
      </div>
    </button>
  );
}
