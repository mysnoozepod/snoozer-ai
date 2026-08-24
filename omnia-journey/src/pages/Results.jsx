// src/pages/Results.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { generateShowroomRecommendations } from "@/lib/utils/recommendations";
import {
  getResultsRecommendations,
  isCanonicalRecommendationsEnabled,
} from "@/lib/utils/resultsRecommendations";
import { api } from "@/lib/api";
import { useStore } from "@/lib/useStore";
import { useShowroomHud } from "@/lib/snoozer/hud/useShowroomHud";
import { getShopperId } from "@/state/sessionStore";
import { canNavigateTo } from "@/device/deviceActionGuards";
import { makePodRoute } from "@/device/podRouteUtils";
import { useDeviceMode } from "@/device/useDeviceMode";
import {
  ArrowRight,
  ImageOff,
} from "lucide-react";
import {
  ShowroomBrandMark,
  ShowroomEyebrow,
  ShowroomFrame,
  ShowroomPanel,
  ShowroomPageShell,
  ShowroomTopRail,
} from "@/components/showroom/ShowroomPrimitives";

const BRAND = {
  primary: "#1A66D2",
};

const USE_CANONICAL_RECOMMENDATIONS = isCanonicalRecommendationsEnabled(
  import.meta.env.VITE_USE_CANONICAL_RECOMMENDATIONS,
  { defaultValue: true }
);

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

function toPodId(v) {
  const s = String(v ?? "").trim();
  return s || "1";
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

function formatPodLabel(podOrId) {
  return `SnoozePod ${toPodId(
    typeof podOrId === "object" ? podOrId?.podId ?? podOrId?.id : podOrId
  )}`;
}

function joinReadableList(items = []) {
  const list = items.map((item) => normalizeText(item)).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

function buildHeroLine({ leadPodId }) {
  if (!leadPodId) return "Preparing your pod matches.";
  return `Start with SnoozePod ${leadPodId}.`;
}

function buildHeroSupportLine({ comparePodIds = [] }) {
  if (comparePodIds.length >= 2) {
    return "Then compare your next two matches. You can explore other pods later if you want a wider look.";
  }

  if (comparePodIds.length === 1) {
    return "Then compare your next match. You can explore other pods later if you want a wider look.";
  }

  return "Start here first. You can explore other pods later if you want a wider look.";
}

function buildResultsVoiceScript({ leadPodId, comparePodIds = [] }) {
  if (!leadPodId) return "Your results are ready.";
  if (comparePodIds.length >= 2) {
    return `Start with SnoozePod ${leadPodId}. Then compare your next two matches. You can explore other pods later, and Ask Snoozer or your sleep expert stay available throughout the showroom.`;
  }
  if (comparePodIds.length === 1) {
    return `Start with SnoozePod ${leadPodId}. Then compare your next match. You can explore other pods later, and Ask Snoozer or your sleep expert stay available throughout the showroom.`;
  }
  return `Start with SnoozePod ${leadPodId}. Ask Snoozer and your sleep expert stay available while you test.`;
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
        recommended: "it matches the mattress style your assessment points to first",
        consider: "you want to compare the closest mattress match again",
      };
    case "primary_mattress_family":
      return {
        recommended: "it stays close to the mattress style that matched your assessment",
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

  if (recommendedRank > 0) {
    if (orderedReasons.includes("primary_mattress_exact")) return "Best first match for your sleep profile.";
    if (orderedReasons.includes("primary_mattress_family")) return "Strong feel-family match to start with.";
    if (orderedReasons.includes("fixture_size_match")) return "Good match for your selected size.";
    if (orderedReasons.includes("partner_friendly") || orderedReasons.includes("split_requires_dual")) {
      return "Strong shared-sleep option to compare.";
    }
    if (orderedReasons.includes("side_sleeper_pressure_relief")) return "Pressure-relief match worth testing first.";
    if (orderedReasons.includes("back_or_stomach_support")) return "Supportive fit for your sleep style.";
    if (orderedReasons.includes("requested_standard_motion")) return "Adjustable setup that fits your motion preference.";
    return variant.recommended.charAt(0).toUpperCase() + variant.recommended.slice(1) + ".";
  }

  if (orderedReasons.includes("primary_mattress_family")) return "Good feel-family compare.";
  if (orderedReasons.includes("fixture_size_match")) return "Good compare for your selected size.";
  if (orderedReasons.includes("partner_friendly") || orderedReasons.includes("split_requires_dual")) {
    return "Flexible shared-sleep compare.";
  }
  if (orderedReasons.includes("requested_standard_motion")) return "Useful adjustable setup to compare.";
  return "Good compare option before you decide.";
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
  const device = useDeviceMode();
  const { muted, replay, noteUserInteraction, runHudAction, setMuted, voiceState } =
    useShowroomHud();

  const shopperId = getShopperId() || "";
  const storedAssessment = useStore((state) => state.assessment);
  const setRecommendations = useStore((state) => state.setRecommendations);
  const setRecommendedProductHandles = useStore((state) => state.setRecommendedProductHandles);

  const answers = useMemo(() => {
    if (storedAssessment && typeof storedAssessment === "object") return storedAssessment;
    const raw = safeGet("snooze.assessment");
    return raw ? safeParseJson(raw) : {};
  }, [storedAssessment]);

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
        const { recommendations } = await getResultsRecommendations({
          answers,
          useCanonical: USE_CANONICAL_RECOMMENDATIONS,
          resolveCanonical: (payload) => api.resolveRecommendations(payload),
          generateLocal: generateShowroomRecommendations,
          logger: console,
        });
        const safeGenerated = recommendations || { pods: [] };

        const handles = new Set();
        (safeGenerated?.pods || []).forEach((p) => {
          const mattressHandle = getMattressHandle(p);
          if (mattressHandle) handles.add(mattressHandle);
          if (p?.baseHandle) handles.add(p.baseHandle);
        });
        setRecommendations?.(safeGenerated || {});
        setRecommendedProductHandles?.(Array.from(handles));

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
  }, [answers, setRecommendations, setRecommendedProductHandles]);

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

  const pods = useMemo(() => (Array.isArray(recs?.pods) ? recs.pods : []), [recs]);

  const rankedPods = useMemo(() => {
    return [...pods]
      .map((pod, index) => {
        const explicitRank = Number(pod?.rank);
        const sortRank =
          Number.isFinite(explicitRank) && explicitRank > 0
            ? explicitRank
            : pod?.recommended
              ? index + 1
              : 100 + index;

        return { pod, index, sortRank };
      })
      .sort((a, b) => a.sortRank - b.sortRank || a.index - b.index)
      .map(({ pod }) => pod);
  }, [pods]);

  const leadPod = rankedPods[0] || null;
  const comparisonPods = rankedPods.slice(1, 3);
  const recommendedRankByPodId = useMemo(() => {
    const map = {};
    rankedPods.slice(0, 3).forEach((p, index) => {
      const id = toPodId(p?.podId ?? p?.id);
      map[id] = index + 1;
    });
    return map;
  }, [rankedPods]);

  const leadPodId = leadPod ? toPodId(leadPod?.podId ?? leadPod?.id) : "";
  const comparisonPodIds = useMemo(
    () => comparisonPods.map((pod) => toPodId(pod?.podId ?? pod?.id)),
    [comparisonPods]
  );

  const heroLine = useMemo(() => buildHeroLine({ leadPodId }), [leadPodId]);
  const heroSupportLine = useMemo(
    () => buildHeroSupportLine({ comparePodIds: comparisonPodIds }),
    [comparisonPodIds]
  );
  const voiceScript = useMemo(
    () => buildResultsVoiceScript({ leadPodId, comparePodIds: comparisonPodIds }),
    [leadPodId, comparisonPodIds]
  );
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
      const route = makePodRoute(podId) || "/pod/pod-1";
      if (canNavigateTo(device, route)) {
        navigate(route);
        return;
      }

      runHudAction("view_results", {
        fallback: {
          speech: `Head to SnoozePod ${podId} in the showroom when you are ready to test it.`,
          captions: `Head to SnoozePod ${podId} in the showroom when you are ready to test it.`,
          state: "speaking",
          priority: "normal",
          ttlMs: 4200,
          actions: [],
        },
      }).catch(() => {});
    },
    [device, navigate, noteUserInteraction, runHudAction]
  );

  const leadImageUrl = leadPod ? resolveImageUrl(leadPod) : "";
  const leadImageStatus = leadPod ? getImageStatus(leadPod) : "idle";

  return (
    <ShowroomPageShell className="flex min-h-0 flex-col overflow-hidden pb-0">
      <ShowroomTopRail className="justify-center pt-3 md:pt-4">
        <ShowroomBrandMark imageClassName="w-[190px] md:w-[220px]" />
      </ShowroomTopRail>

      <div className="mx-auto flex min-h-0 w-full max-w-[1380px] flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-3 pt-1 md:px-6 md:pt-2 lg:overflow-hidden">
        <ShowroomFrame className="flex min-h-0 shrink-0 flex-col p-2 md:p-2.5 lg:flex-1">
          {loading ? (
            <div className="rounded-[28px] border border-white/80 bg-white/92 px-6 py-10 text-center text-slate-600 shadow-sm">
              Preparing your pod matches
            </div>
          ) : rankedPods.length ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <motion.div
                className="shrink-0"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              >
                <ShowroomPanel className="min-h-0 overflow-hidden p-3.5 md:p-4 lg:h-full" tone="soft">
                  <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)] lg:items-stretch">
                    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(300px,1.1fr)] lg:items-center">
                      <div className="min-w-0">
                        <h1 className="text-[1.95rem] font-black tracking-tight text-slate-900 md:text-[2.35rem]">
                          Your Recommended Pods
                        </h1>
                        <p className="mt-2 max-w-xl text-[0.92rem] leading-6 text-slate-600 md:text-[0.98rem]">
                          {heroLine} {heroSupportLine}
                        </p>

                        <div className="mt-5 text-[0.74rem] font-black uppercase tracking-[0.22em] text-[#2f57e8]">
                          Top Recommendation
                        </div>
                        <div className="mt-1 whitespace-nowrap text-[2rem] font-black leading-[0.95] tracking-tight text-slate-900 md:text-[2.45rem]">
                          SnoozePod {leadPodId}
                        </div>
                        <div className="mt-2 text-[1.02rem] font-extrabold leading-tight text-slate-700 md:text-[1.12rem]">
                          {extractDisplayMattress(leadPod)}
                        </div>

                        <button
                          type="button"
                          onClick={() => openPodMode(leadPodId)}
                          className="mt-5 inline-flex w-full items-center justify-center gap-3 rounded-[18px] bg-[#1A66D2] px-5 py-3.5 text-sm font-black text-white shadow-[0_22px_46px_rgba(26,102,210,0.24)] transition hover:bg-[#1550A0] sm:w-auto"
                        >
                          {canNavigateTo(device, makePodRoute(leadPodId) || "/pod/pod-1")
                            ? "Go to"
                            : "Head to"}{" "}
                          SnoozePod {leadPodId}
                          <ArrowRight className="h-5 w-5" />
                        </button>
                      </div>

                      <div className="rounded-[26px] border border-white/80 bg-white p-3 shadow-sm">
                        <ResultImageCard
                          imageUrl={leadImageUrl}
                          imageStatus={leadImageStatus}
                          displayMattress={extractDisplayMattress(leadPod)}
                        />
                        <div className="mt-2 inline-flex rounded-full border border-[#dfe7ff] bg-[#f7faff] px-3 py-1 text-xs font-black text-[#2f57e8] md:text-sm">
                          Best First Match
                        </div>
                      </div>
                    </div>

                    <div className="flex min-h-0 flex-col rounded-[26px] border border-white/80 bg-white/96 p-3.5 shadow-sm">
                      <ShowroomEyebrow className="text-[0.72rem]">Next To Try</ShowroomEyebrow>
                      <div className="mt-1 text-[1.08rem] font-black tracking-tight text-slate-900">
                        Compare while the feel is fresh
                      </div>
                      <div className="mt-3 grid min-h-0 flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                        {comparisonPods.map((pod, index) => {
                          const id = toPodId(pod?.podId ?? pod?.id);
                          return (
                            <CompareNextTile
                              key={id}
                              index={index + 2}
                              id={id}
                              displayMattress={extractDisplayMattress(pod)}
                              imageUrl={resolveImageUrl(pod)}
                              imageStatus={getImageStatus(pod)}
                              reasonText={buildPodReasonText({
                                pod,
                                recommendedRank: recommendedRankByPodId[id] || 0,
                                recommendationMeta: recs?.meta || {},
                              })}
                              canOpen={canNavigateTo(device, makePodRoute(id) || "/pod/pod-1")}
                              onOpen={() => openPodMode(id)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </ShowroomPanel>
              </motion.div>
            </div>
          ) : (
            <div className="rounded-[28px] border border-red-200 bg-red-50 px-6 py-10 text-center text-red-700 shadow-sm">
              Results unavailable
            </div>
          )}
        </ShowroomFrame>
      </div>
    </ShowroomPageShell>
  );
}

function ResultImageCard({ displayMattress, imageUrl, imageStatus }) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [imageUrl]);

  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50">
      <div className="aspect-[16/8.6]">
        {imageUrl && !imgFailed ? (
          <img
            src={imageUrl}
            alt={displayMattress}
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
    </div>
  );
}

function CompareNextTile({
  index,
  id,
  displayMattress,
  imageUrl,
  imageStatus,
  reasonText,
  canOpen = true,
  onOpen,
}) {
  const className = [
    "grid min-h-[152px] grid-cols-[112px_minmax(0,1fr)] items-center gap-3 rounded-[22px] border border-slate-200 bg-white p-3 text-left shadow-sm",
    canOpen ? "transition hover:border-indigo-100 hover:shadow-md" : "",
  ].join(" ");

  const content = (
    <>
      <div className="min-w-0">
        <ResultImageCard
          displayMattress={displayMattress}
          imageUrl={imageUrl}
          imageStatus={imageStatus}
        />
      </div>
      <div className="min-w-0">
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#eef3ff] text-xs font-black text-[#2f57e8]">
          {index}
        </div>
        <div className="mt-2 whitespace-nowrap text-[1.12rem] font-black tracking-tight text-slate-900">
          SnoozePod&nbsp;{id}
        </div>
        <div className="mt-1 text-[0.78rem] font-semibold leading-4 text-slate-600">{displayMattress}</div>
        <div className="mt-1.5 text-[0.72rem] leading-4 text-slate-500">{reasonText}</div>
        {canOpen ? (
          <div className="mt-2 inline-flex items-center gap-1 text-xs font-black text-[#2f57e8]">
            View pod
            <ArrowRight className="h-3.5 w-3.5" />
          </div>
        ) : (
          <span className="mt-2 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
            In showroom
          </span>
        )}
      </div>
    </>
  );

  if (!canOpen) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button type="button" onClick={onOpen} className={className}>
      {content}
    </button>
  );
}
