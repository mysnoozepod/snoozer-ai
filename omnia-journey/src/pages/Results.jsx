// src/pages/Results.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import useRewards from "@/lib/useRewards";
import { generateShowroomRecommendations } from "@/lib/utils/recommendations";
import { api } from "@/lib/api";
import { useShowroomHud } from "@/lib/snoozer/hud/useShowroomHud";
import { ImageOff, Volume2, ArrowRight, Star } from "lucide-react";

const BRAND = {
  primary: "#1A66D2",
};

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

function safeSetJson(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
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

function toPodId(v) {
  const s = String(v ?? "").trim();
  return s || "1";
}

function podSortValue(v) {
  const match = String(v ?? "").match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function normalizeText(v) {
  return String(v || "").trim();
}

function isRenderableImageUrl(value) {
  const s = String(value || "").trim();
  if (!s) return false;

  if (/^data:image\//i.test(s)) return true;
  if (/^blob:/i.test(s)) return true;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^\//.test(s)) return true;
  if (/^[^/].*\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(s)) return true;

  return false;
}

function sanitizeImageUrl(value) {
  const s = String(value || "").trim();
  return isRenderableImageUrl(s) ? s : "";
}

function getPodImageFromPod(p) {
  const candidates = [
    p?.mattressImageUrl,
    p?.mattressImage,
    p?.imageUrl,
    p?.image,
    p?.image_url,
    p?.mattress_image,
    p?.featuredImage?.url,
    p?.featuredImage?.src,
    p?.images?.[0]?.url,
    p?.images?.[0]?.src,
    p?.product?.imageUrl,
    p?.product?.image,
    p?.product?.featuredImage?.url,
    p?.product?.featuredImage?.src,
    p?.product?.images?.[0]?.url,
    p?.product?.images?.[0]?.src,
  ];

  for (const c of candidates) {
    const url = sanitizeImageUrl(c);
    if (url) return url;
  }

  return "";
}

function getMattressHandle(p) {
  const candidates = [
    p?.mattressHandle,
    p?.handle,
    p?.productHandle,
    p?.shopifyHandle,
    p?.mattress?.handle,
    p?.product?.handle,
  ];

  for (const c of candidates) {
    const v = String(c || "").trim();
    if (v) return v;
  }

  return "";
}

function simplifyMattressLabel(input) {
  const s = normalizeText(input)
    .replace(/^In-store:\s*/i, "")
    .replace(/^On display:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const inchMatch = s.match(/(\d{1,2}")/);
  const inch = inchMatch ? inchMatch[1] : "";

  const materialOrder = [
    "Dual Comfort Hybrid",
    "Classic Memory Foam",
    "All Foam",
    "Hybrid",
    "Memory Foam",
    "Latex",
  ];

  const foundMaterial = materialOrder.find((m) =>
    s.toLowerCase().includes(m.toLowerCase())
  );

  if (inch && foundMaterial) return `${inch} ${foundMaterial}`;
  if (foundMaterial) return foundMaterial;
  if (inch) return inch;

  return s || "Mattress";
}

function extractDisplayMattress(p) {
  const direct =
    p?.displayMattress ||
    p?.mattressLabel ||
    p?.mattressName ||
    p?.mattressTitle ||
    p?.displayName ||
    "";

  const directText = normalizeText(direct);
  if (directText) return simplifyMattressLabel(directText);

  const subtitle = normalizeText(p?.subtitle);
  if (!subtitle) return "Mattress";

  const subtitleParts = subtitle
    .split(/\s*(?:\u2022|\u00b7|\|)\s*/)
    .map((part) => normalizeText(part))
    .filter(Boolean);

  const afterBullet =
    subtitleParts.length > 1
      ? subtitleParts[subtitleParts.length - 1]
      : subtitle;

  return simplifyMattressLabel(afterBullet);
}

function rankBadgeLabel(rank) {
  if (rank === 1) return "Recommended To Test 1st";
  if (rank === 2) return "Recommended To Test 2nd";
  if (rank === 3) return "Recommended To Test 3rd";
  return "";
}

function buildHeroLine({ pods }) {
  if (!pods.length) return "Preparing your pod matches.";
  return "Here are your 5 SnoozePods. I marked the 3 I'd try first.";
}

function buildResultsVoiceScript({ pods }) {
  if (!pods.length) return "Your results are ready.";
  return "Here are your 5 SnoozePods. I marked the 3 I would try first. You can test them in any order.";
}

function buildReasonContext(pod, recommendationMeta = {}) {
  return {
    hasPartner: recommendationMeta?.hasPartner === true,
    size: normalizeText(recommendationMeta?.size),
    position: normalizeText(recommendationMeta?.position).toLowerCase(),
    firmness: normalizeText(recommendationMeta?.firmness).toLowerCase(),
    isDualComfort: Boolean(pod?.flags?.isDualComfortMattress),
    isAdjustable:
      Boolean(pod?.flags?.isAdjustableFixture) ||
      pod?.hasAdjustableBase === true ||
      normalizeText(pod?.baseType).toLowerCase() === "adjustable",
  };
}

function getReasonVariant(reasonKey, ctx) {
  switch (String(reasonKey || "").trim()) {
    case "requested_full_split":
      return {
        recommended: "it supports the Full Split motion you asked for",
        consider: "you want to compare the Full Split motion you asked for",
      };
    case "requested_half_split":
      return {
        recommended: "it supports the Half Split motion you asked for",
        consider: "you want to compare the Half Split motion you asked for",
      };
    case "split_requires_dual":
      return {
        recommended: "its Dual Comfort setup lines up with the split-motion path from your assessment",
        consider: "you still want a Dual Comfort option for split motion",
      };
    case "partner_friendly":
      return ctx.isDualComfort
        ? {
            recommended: "its Dual Comfort setup is a strong fit for shared sleep",
            consider: "you want a more partner-friendly setup to compare",
          }
        : {
            recommended: "it gives you a more partner-friendly setup to test",
            consider: "you want another partner-friendly option to compare",
          };
    case "primary_mattress_exact":
      return {
        recommended: "it matches the mattress style Snoozer would test first for you",
        consider: "you want to compare Snoozer's closest mattress match again",
      };
    case "primary_mattress_family":
      return {
        recommended: "it stays close to the mattress style Snoozer matched to your assessment",
        consider: "you want to compare another mattress in the same feel family",
      };
    case "side_sleeper_pressure_relief":
      return {
        recommended: "it may give you the pressure relief side sleepers often notice first",
        consider: "you want to compare more pressure relief for side sleeping",
      };
    case "back_or_stomach_support":
      return {
        recommended: "it may give you the support back and stomach sleepers usually need",
        consider: "you want to compare a more supportive feel",
      };
    case "firmness_firm_match":
      return {
        recommended: "it lines up with the firmer feel you selected",
        consider: "you still want to compare a firmer feel",
      };
    case "firmness_soft_match":
      return {
        recommended: "it lines up with the softer feel you selected",
        consider: "you still want to compare a softer feel",
      };
    case "requested_standard_motion":
      return {
        recommended: "it gives you an adjustable setup with standard motion",
        consider: "you still want to compare an adjustable setup with standard motion",
      };
    case "fixture_size_match":
      return {
        recommended: ctx.size
          ? `it is shown in ${ctx.size}, which matches the size you selected`
          : "it matches the size path from your assessment",
        consider: ctx.size
          ? `you want to stay close to the ${ctx.size} setup you selected`
          : "you want to stay close to the size path from your assessment",
      };
    case "simple_non_motion_option":
      return {
        recommended: "it gives you a simple non-motion setup to anchor your comparison",
        consider: "you want a simpler non-motion option in the mix",
      };
    default:
      return null;
  }
}

function getFallbackReasonVariant(ctx) {
  if (ctx.isDualComfort && ctx.hasPartner) {
    return {
      recommended: "its Dual Comfort setup gives shared sleep more flexibility",
      consider: "you want a shared-sleep setup with more flexibility",
    };
  }

  if (ctx.isDualComfort) {
    return {
      recommended: "it gives you a flexible Dual Comfort setup to test early",
      consider: "you want to compare a Dual Comfort setup",
    };
  }

  if (ctx.isAdjustable) {
    return {
      recommended: "it gives you an adjustable setup worth testing early",
      consider: "you still want to compare an adjustable setup",
    };
  }

  if (ctx.position === "side") {
    return {
      recommended: "it gives you another pressure-relief-focused option to test",
      consider: "you want another pressure-relief option to compare",
    };
  }

  if (ctx.firmness === "firm") {
    return {
      recommended: "it gives you another supportive option to test",
      consider: "you want another supportive option to compare",
    };
  }

  return {
    recommended: "it gives you another strong pod to test before deciding",
    consider: "you want another feel to compare before deciding",
  };
}

function buildPodReasonText({ pod, recommendedRank, recommendationMeta }) {
  const scoreReasons = Array.isArray(pod?.diagnostics?.scoreReasons)
    ? pod.diagnostics.scoreReasons
    : [];

  const ctx = buildReasonContext(pod, recommendationMeta);
  const preferredOrder = [
    "requested_full_split",
    "requested_half_split",
    "split_requires_dual",
    "partner_friendly",
    "primary_mattress_exact",
    "primary_mattress_family",
    "side_sleeper_pressure_relief",
    "back_or_stomach_support",
    "firmness_firm_match",
    "firmness_soft_match",
    "requested_standard_motion",
    "fixture_size_match",
    "simple_non_motion_option",
  ];

  const orderedReasons = preferredOrder.filter((key) => scoreReasons.includes(key));
  const variant =
    orderedReasons.map((key) => getReasonVariant(key, ctx)).find(Boolean) ||
    getFallbackReasonVariant(ctx);

  return recommendedRank > 0
    ? `Recommended because ${variant.recommended}.`
    : `Also worth considering if ${variant.consider}.`;
}

function useTypingText(fullText, { enabled = true, speedMs = 18 } = {}) {
  const [text, setText] = useState("");
  const idxRef = useRef(0);

  useEffect(() => {
    const target = String(fullText || "");

    if (!enabled) {
      setText(target);
      return;
    }

    idxRef.current = 0;
    setText("");

    if (!target) return;

    const t = setInterval(() => {
      idxRef.current += 1;
      const next = target.slice(0, idxRef.current);
      setText(next);

      if (idxRef.current >= target.length) clearInterval(t);
    }, Math.max(10, Number(speedMs) || 18));

    return () => clearInterval(t);
  }, [fullText, enabled, speedMs]);

  return text;
}

function TypingDots() {
  return (
    <span className="ml-2 inline-flex items-center gap-1 align-middle">
      <span
        className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
        style={{ animationDelay: "0ms" }}
      />
      <span
        className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
        style={{ animationDelay: "150ms" }}
      />
      <span
        className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
        style={{ animationDelay: "300ms" }}
      />
    </span>
  );
}

export default function Results() {
  const navigate = useNavigate();
  const { muted, replay, noteUserInteraction, runHudAction, setMuted, voiceState } =
    useShowroomHud();

  const shopperId = safeGet("snooze.accessCode") || "";
  const rewards = useRewards(shopperId);

  const answers = useMemo(() => {
    const raw = safeGet("snooze.assessment");
    return raw ? safeParseJson(raw) : {};
  }, []);

  const [loading, setLoading] = useState(true);
  const [recs, setRecs] = useState(null);

  const [imageByHandle, setImageByHandle] = useState({});
  const [productImageStatus, setProductImageStatus] = useState("idle");

  const requestedVoiceRef = useRef(false);
  const lastVoiceScriptRef = useRef("");
  const bootVoiceTimerRef = useRef(null);

  const clearTimer = (ref) => {
    if (ref.current) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  };

  useEffect(() => {
    const prev = window.__SNOOZE_DISABLE_WIDGET;
    window.__SNOOZE_DISABLE_WIDGET = true;
    document.body.classList.add("no-global-chat");
    return () => {
      window.__SNOOZE_DISABLE_WIDGET = prev;
      document.body.classList.remove("no-global-chat");
      clearTimer(bootVoiceTimerRef);
    };
  }, []);

  useEffect(() => {
    const flag = "snooze.snoozepod.resetOnResults.v1";
    if (safeGet(flag)) return;

    try {
      sessionStorage.setItem("snooze.snoozepod", JSON.stringify([]));
      sessionStorage.setItem(
        "snooze.snoozepod.meta",
        JSON.stringify({ couponCode: "", rewardsPointsApplied: 0 })
      );
      safeSet(flag, "1");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);

      try {
        const generated = await generateShowroomRecommendations(answers);
        const safeGenerated = {
          ...(generated || {}),
          pods: Array.isArray(generated?.pods) ? generated.pods : [],
        };

        safeSetJson("snooze.recommendations", safeGenerated || {});

        const handles = new Set();
        (safeGenerated?.pods || []).forEach((p) => {
          const mattressHandle = getMattressHandle(p);
          if (mattressHandle) handles.add(mattressHandle);
          if (p?.baseHandle) handles.add(p.baseHandle);
        });
        safeSetJson("snooze.recommendedProductHandles", Array.from(handles));

        if (!alive) return;
        setRecs(safeGenerated || null);
      } catch (err) {
        console.error("Failed to generate showroom recommendations:", err);
        if (!alive) return;
        setRecs(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [answers]);

  useEffect(() => {
    let alive = true;

    (async () => {
      setProductImageStatus("loading");

      try {
        const index = await api.getProductsIndexByHandle({ limit: 250, lite: true });
        if (!alive) return;

        const next = {};
        for (const [handle, product] of Object.entries(index || {})) {
          const imageUrl = sanitizeImageUrl(
            product?.imageUrl ||
              product?.image ||
              product?.featuredImage?.url ||
              product?.featuredImage?.src ||
              product?.images?.[0]?.url ||
              product?.images?.[0]?.src
          );

          if (handle && imageUrl) {
            next[handle] = imageUrl;
          }
        }

        const podHandles = Array.from(
          new Set(
            (Array.isArray(recs?.pods) ? recs.pods : [])
              .map((p) => getMattressHandle(p))
              .filter(Boolean)
          )
        );

        const missingHandles = podHandles.filter((handle) => !next[handle]);

        if (missingHandles.length) {
          const fallbackResults = await Promise.all(
            missingHandles.map(async (handle) => {
              try {
                const product = await api.getProductById(handle);
                const imageUrl = sanitizeImageUrl(
                  product?.imageUrl ||
                    product?.image ||
                    product?.featuredImage?.url ||
                    product?.featuredImage?.src ||
                    product?.images?.[0]?.url ||
                    product?.images?.[0]?.src
                );

                return { handle, imageUrl };
              } catch (err) {
                console.warn("Fallback product image lookup failed for handle:", handle, err);
                return { handle, imageUrl: "" };
              }
            })
          );

          fallbackResults.forEach(({ handle, imageUrl }) => {
            if (handle && imageUrl && !next[handle]) {
              next[handle] = imageUrl;
            }
          });
        }

        if (!alive) return;
        setImageByHandle(next);
        setProductImageStatus("loaded");
      } catch (err) {
        console.error("Results image index lookup failed:", err);
        if (!alive) return;
        setImageByHandle({});
        setProductImageStatus("failed");
      }
    })();

    return () => {
      alive = false;
    };
  }, [recs]);

  useEffect(() => {
    if (!shopperId) return;
    const flag = `snooze.reward.results.${shopperId}`;
    if (safeGet(flag)) return;
    rewards.earn(150, "Viewed Results");
    safeSet(flag, "1");
  }, [shopperId, rewards]);

  const pods = useMemo(() => {
    const raw = Array.isArray(recs?.pods) ? recs.pods : [];
    return [...raw].sort((a, b) => {
      const aId = podSortValue(a?.podId ?? a?.id);
      const bId = podSortValue(b?.podId ?? b?.id);
      return aId - bId;
    });
  }, [recs]);

  const recommendedRankByPodId = useMemo(() => {
    const explicit = Array.isArray(recs?.pods) ? recs.pods : [];
    const recommended = explicit
      .filter((p) => p?.recommended || Number(p?.rank || 999) <= 3)
      .sort((a, b) => Number(a?.rank || 999) - Number(b?.rank || 999))
      .slice(0, 3);

    const map = {};
    recommended.forEach((p, index) => {
      const id = toPodId(p?.podId ?? p?.id);
      map[id] = index + 1;
    });
    return map;
  }, [recs]);

  const heroLine = useMemo(() => buildHeroLine({ pods }), [pods]);
  const voiceScript = useMemo(() => buildResultsVoiceScript({ pods }), [pods]);
  const typedHeader = useTypingText(heroLine, { enabled: !loading, speedMs: 14 });

  useEffect(() => {
    if (loading || !voiceScript || muted) return;

    const voiceKey = `results::${pods.length}::${voiceScript}`;
    if (requestedVoiceRef.current && lastVoiceScriptRef.current === voiceKey) return;

    clearTimer(bootVoiceTimerRef);

    bootVoiceTimerRef.current = window.setTimeout(() => {
      requestedVoiceRef.current = true;
      lastVoiceScriptRef.current = voiceKey;

      runHudAction("view_results", {
        scriptKey: "results.intro",
        shopperId: shopperId || "guest",
        fallback: {
          speech: voiceScript,
          captions: voiceScript,
          state: "speaking",
          priority: "normal",
          ttlMs: 6000,
          voiceStyle: "default",
          actions: [],
        },
      }).catch((err) => {
        console.warn("Results intro voice failed:", err);
      });
    }, 700);

    return () => clearTimer(bootVoiceTimerRef);
  }, [voiceScript, loading, muted, pods.length, runHudAction, shopperId]);

  const resolveImageUrl = useCallback(
    (p) => {
      const direct = getPodImageFromPod(p);
      if (direct) return direct;

      const handle = getMattressHandle(p);
      if (handle && imageByHandle[handle]) return imageByHandle[handle];

      return "";
    },
    [imageByHandle]
  );

  const getImageStatus = useCallback(
    (p) => {
      const direct = getPodImageFromPod(p);
      if (direct) return "loaded";

      const handle = getMattressHandle(p);
      if (handle && imageByHandle[handle]) return "loaded";

      if (productImageStatus === "loading") return "loading";
      return "failed";
    },
    [imageByHandle, productImageStatus]
  );

  const replayVoice = useCallback(async () => {
    if (!voiceScript) return;
    noteUserInteraction?.();
    await replay?.();
    await runHudAction("view_results", {
      scriptKey: "results.intro",
      shopperId: shopperId || "guest",
      fallback: {
        speech: voiceScript,
        captions: voiceScript,
        state: "speaking",
        priority: "normal",
        ttlMs: 6000,
        voiceStyle: "default",
        actions: [],
      },
      overrides: {
        priority: "high",
        force: true,
        replaceCurrent: true,
      },
    });
  }, [voiceScript, noteUserInteraction, replay, runHudAction, shopperId]);

  const openPodMode = useCallback(
    (podId) => {
      noteUserInteraction?.();
      navigate(`/pod/${encodeURIComponent(podId)}`);
    },
    [navigate, noteUserInteraction]
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#D0D6E4] to-white px-3 py-4 md:px-4 md:py-5">
      <div className="mx-auto max-w-[1500px]">
        <div className="rounded-[28px] border border-white/60 bg-white shadow-2xl">
          <div className="p-4 md:p-5">
            <motion.div
              className="rounded-[24px] border border-blue-100 bg-gradient-to-r from-[#EEF4FF] to-white p-4 shadow-sm md:p-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-start gap-3 md:gap-4">
                  <div className="relative shrink-0">
                    <div
                      className="absolute inset-0 rounded-full blur-2xl opacity-20"
                      style={{ background: BRAND.primary }}
                    />
                    <motion.img
                      src="/snoozer-avatar.png"
                      alt="Snoozer"
                      className="relative h-16 w-16 rounded-full object-cover shadow-xl md:h-20 md:w-20"
                      animate={{ y: [0, -3, 0] }}
                      transition={{ duration: 3, repeat: Infinity }}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>

                  <div className="min-w-0">
                    <div className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-[#1A66D2]">
                      Snoozer
                    </div>
                    <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight text-[#2A2B2A] md:text-4xl">
                      {loading ? (
                        <>
                          Preparing your pod matches
                          <TypingDots />
                        </>
                      ) : (
                        typedHeader
                      )}
                    </h1>
                    {!loading ? (
                      <p className="mt-1 text-sm text-gray-700 md:text-base">
                        You can test them in any order.
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      noteUserInteraction?.();
                      setMuted(!muted);
                    }}
                    className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    {muted ? "Unmute" : "Mute"}
                  </button>

                  <button
                    type="button"
                    onClick={replayVoice}
                    className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    <Volume2 className="h-4 w-4" />
                    Replay
                  </button>
                </div>
              </div>

              {voiceState?.blocked ? (
                <div className="mt-3 text-xs font-semibold text-amber-700">
                  Tap again to enable voice
                </div>
              ) : null}
            </motion.div>

            <section className="mt-4">
              {loading ? (
                <div className="rounded-[24px] border border-gray-200 bg-white px-6 py-10 text-center text-gray-600 shadow-sm">
                  Preparing your pod matches
                </div>
              ) : pods.length ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {pods.map((p) => {
                    const id = toPodId(p?.podId ?? p?.id);
                    const displayMattress = extractDisplayMattress(p);
                    const imageUrl = resolveImageUrl(p);
                    const imageStatus = getImageStatus(p);
                    const recommendedRank = recommendedRankByPodId[id] || 0;
                    const badge = rankBadgeLabel(recommendedRank);
                    const reasonText = buildPodReasonText({
                      pod: p,
                      recommendedRank,
                      recommendationMeta: recs?.meta || {},
                    });

                    return (
                      <PodCard
                        key={id}
                        id={id}
                        displayMattress={displayMattress}
                        imageUrl={imageUrl}
                        imageStatus={imageStatus}
                        badge={badge}
                        reasonText={reasonText}
                        onOpen={() => openPodMode(id)}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[24px] border border-red-200 bg-red-50 px-6 py-10 text-center text-red-700 shadow-sm">
                  Results unavailable
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function PodCard({
  id,
  displayMattress,
  imageUrl,
  imageStatus,
  badge,
  reasonText,
  onOpen,
}) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [imageUrl]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex h-full flex-col rounded-[24px] border border-gray-200 bg-white p-3 shadow-sm"
    >
      <div className="min-h-[44px]">
        {badge ? (
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-[12px] font-bold leading-tight text-blue-900">
            <Star className="mr-1.5 h-3.5 w-3.5" />
            {badge}
          </span>
        ) : null}
      </div>

      <div className="mt-2 text-sm font-semibold text-gray-500">SnoozePod {id}</div>

      <div className="mt-2 aspect-[4/3] overflow-hidden rounded-[18px] border border-gray-200 bg-gray-50">
        {imageUrl && !imgFailed ? (
          <img
            src={imageUrl}
            alt={`${displayMattress} on SnoozePod ${id}`}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
          />
        ) : imageStatus === "loading" ? (
          <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm font-medium text-gray-500">
            Preparing image
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-sm font-medium text-gray-500">
            <ImageOff className="h-5 w-5 text-gray-400" />
            <span>Image unavailable</span>
          </div>
        )}
      </div>

      <div className="mt-3 text-sm font-semibold text-gray-500">SnoozePod {id}</div>

      <div className="mt-1 line-clamp-3 min-h-[84px] text-[20px] font-extrabold leading-tight tracking-tight text-gray-900">
        {displayMattress}
      </div>

      <div className="mt-2 min-h-[64px] text-sm leading-relaxed text-gray-600">
        {reasonText}
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1A66D2] px-4 py-3 text-sm font-extrabold text-white transition hover:opacity-95"
      >
        Test This Pod
        <ArrowRight className="h-4 w-4" />
      </button>
    </motion.div>
  );
}
