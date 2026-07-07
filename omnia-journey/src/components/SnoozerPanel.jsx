// src/components/SnoozerPanel.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  getStoredShopifyCartIdentity,
  persistShopifyCartIdentity,
} from "@/lib/session/shopifyCartState";
import { ChevronDown, ChevronUp } from "lucide-react";

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
  } catch {}
}

function readCheckoutUrl() {
  return getStoredShopifyCartIdentity().checkoutUrl || "";
}

function readLastCaption() {
  return safeGet("snooze.snoozer.lastCaption") || "";
}

function clampText(str, max = 220) {
  const s = String(str || "");
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3).trim()}...`;
}

function normalizeHudState(v) {
  const s = String(v || "").toLowerCase().trim();
  if (s === "thinking") return "thinking";
  if (s === "speaking") return "speaking";
  if (s === "celebrate") return "celebrate";
  if (s === "warning") return "warning";
  if (s === "listening") return "listening";
  return "idle";
}

function normalizeChrome(v) {
  const s = String(v || "").toLowerCase().trim();
  return s === "none" ? "none" : "card";
}

function normalizeSize(v) {
  const s = String(v || "").toLowerCase().trim();
  if (s === "xl") return "xl";
  if (s === "lg") return "lg";
  return "md";
}

function normalizePresentation(v, mode) {
  const s = String(v || "").toLowerCase().trim();
  if (s === "coach") return "coach";
  if (s === "compact") return "compact";
  if (String(mode || "").toLowerCase().trim() === "pod") return "coach";
  return "default";
}

function sizeConfig(size, presentationMode = "default") {
  const isCoach = presentationMode === "coach";

  if (size === "xl") {
    return {
      avatarOuter: isCoach
        ? "h-[320px] w-[320px] lg:h-[420px] lg:w-[420px]"
        : "h-[220px] w-[220px] lg:h-[260px] lg:w-[260px]",
      avatarImg: isCoach
        ? "h-[292px] w-[292px] lg:h-[388px] lg:w-[388px]"
        : "h-[190px] w-[190px] lg:h-[230px] lg:w-[230px]",
      bubbleClamp: isCoach ? 820 : 640,
      inputHeight: "h-12",
    };
  }

  if (size === "lg") {
    return {
      avatarOuter: isCoach
        ? "h-[210px] w-[210px] lg:h-[270px] lg:w-[270px]"
        : "h-[120px] w-[120px]",
      avatarImg: isCoach
        ? "h-[188px] w-[188px] lg:h-[242px] lg:w-[242px]"
        : "h-[98px] w-[98px]",
      bubbleClamp: isCoach ? 600 : 460,
      inputHeight: "h-11",
    };
  }

  return {
    avatarOuter: isCoach
      ? "h-[150px] w-[150px] lg:h-[190px] lg:w-[190px]"
      : "h-16 w-16",
    avatarImg: isCoach
      ? "h-[134px] w-[134px] lg:h-[170px] lg:w-[170px]"
      : "h-12 w-12",
    bubbleClamp: isCoach ? 360 : 260,
    inputHeight: "h-11",
  };
}

function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function shouldAllowIntroSwap(messages) {
  if (!Array.isArray(messages)) return false;
  if (messages.length === 0) return true;
  if (messages.length === 1 && messages[0]?.role === "assistant") return true;
  return false;
}

function tokensForStreaming(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  return raw.match(/\S+\s*/g) || [raw];
}

function getStreamStepDelay(token, mode) {
  const t = String(token || "");
  const trimmed = t.trim();

  if (!trimmed) return 16;
  if (/[.!?]$/.test(trimmed)) return mode === "pod" ? 120 : 140;
  if (/[,:;]$/.test(trimmed)) return mode === "pod" ? 90 : 100;
  if (trimmed.length <= 3) return mode === "pod" ? 35 : 40;
  return mode === "pod" ? 42 : 48;
}

function normalizeTranscriptMessages(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((m) => {
      if (!m || typeof m !== "object") return null;
      const role = m.role === "user" ? "user" : "assistant";
      const text = String(m.text || "").trim();
      if (!text) return null;
      return { role, text };
    })
    .filter(Boolean);
}

export function SnoozerHUD({
  shopperId,
  mode = "explore",
  assessment,
  exploreContext,
  podId,
  context,
  onCheckoutCreated,
  onHud,
  title = "Snoozer",
  subtitle = "Ready",
  chrome = "card",
  size = "md",
  initialCaption,
  introCaption,
  introState = "speaking",
  introTtlMs = 2200,
  introOnceKey,
  showHeader = true,
  showStateLabel = false,
  showTranscriptToggle = true,
  showInput: showInputProp,
  inputPlaceholder,
  presentation,
  avatarSrc,

  // renderer-first controlled props
  speech,
  captions,
  state: controlledState,
  actions: controlledActions,
  messages: controlledMessages,
  busy: controlledBusy,
  error: controlledError,
  openCartUrl: controlledOpenCartUrl,
  onSend,
}) {
  const modeLower = String(mode || "").toLowerCase().trim();

  const [input, setInput] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [localHudState, setLocalHudState] = useState("idle");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const chromeMode = useMemo(() => normalizeChrome(chrome), [chrome]);
  const sizeMode = useMemo(() => normalizeSize(size), [size]);
  const presentationMode = useMemo(
    () => normalizePresentation(presentation, modeLower),
    [presentation, modeLower]
  );
  const sz = useMemo(() => sizeConfig(sizeMode, presentationMode), [sizeMode, presentationMode]);

  const resolvedAvatarSrc = useMemo(() => {
    const explicit = String(avatarSrc || "").trim();
    if (explicit) return explicit;

    if (presentationMode === "coach" || modeLower === "pod") {
      return "/avatars/snoozer-coach.png";
    }

    return "/snoozer-avatar.png";
  }, [avatarSrc, presentationMode, modeLower]);

  const [localMessages, setLocalMessages] = useState(() => [
    {
      role: "assistant",
      text: initialCaption || readLastCaption() || "Ready.",
    },
  ]);

  const transcriptMessages = useMemo(() => {
    if (Array.isArray(controlledMessages)) {
      return normalizeTranscriptMessages(controlledMessages, localMessages);
    }
    return normalizeTranscriptMessages(localMessages, []);
  }, [controlledMessages, localMessages]);

  const [localOpenCartUrl, setLocalOpenCartUrl] = useState(() => readCheckoutUrl());
  const [displayedText, setDisplayedText] = useState(() =>
    clampText(initialCaption || readLastCaption() || "Ready.", sz.bubbleClamp)
  );
  const [isStreaming, setIsStreaming] = useState(false);

  const effectiveBusy =
    typeof controlledBusy === "boolean" ? controlledBusy : localBusy;
  const effectiveError =
    typeof controlledError === "string" ? controlledError : localError;

  const effectiveState = useMemo(() => {
    const external = normalizeHudState(controlledState);
    if (controlledState != null && controlledState !== "") return external;
    return normalizeHudState(localHudState);
  }, [controlledState, localHudState]);

  const showInput = useMemo(() => {
    if (typeof showInputProp === "boolean") return showInputProp;
    if (modeLower === "results") return false;
    if (modeLower === "pod") return false;
    return true;
  }, [showInputProp, modeLower]);

  const placeholder = useMemo(() => {
    if (inputPlaceholder) return inputPlaceholder;
    if (modeLower === "pod") return 'Try "Explain this" or "Add to cart"';
    if (modeLower === "results") return "";
    return 'Try "Compare pods" or "Add to cart"';
  }, [inputPlaceholder, modeLower]);

  const lastAssistantText = useMemo(() => {
    for (let i = transcriptMessages.length - 1; i >= 0; i--) {
      if (transcriptMessages[i]?.role === "assistant") {
        return String(transcriptMessages[i]?.text || "");
      }
    }
    return "";
  }, [transcriptMessages]);

  const externalCaptionText = useMemo(() => {
    const c = String(captions || "").trim();
    if (c) return c;
    const s = String(speech || "").trim();
    if (s) return s;
    return "";
  }, [captions, speech]);

  const activeCaptionSource = externalCaptionText || lastAssistantText || "";
  const bubbleText = useMemo(() => {
    if (effectiveBusy && !isStreaming && !externalCaptionText) return "";
    if (effectiveError) return "Snoozer had trouble responding.";
    return displayedText || "";
  }, [effectiveBusy, effectiveError, displayedText, isStreaming, externalCaptionText]);

  const effectiveOpenCartUrl =
    typeof controlledOpenCartUrl === "string"
      ? controlledOpenCartUrl
      : localOpenCartUrl;

  const listRef = useRef(null);
  const introTimeoutRef = useRef(null);
  const streamTimeoutRef = useRef(null);
  const stateTimeoutRef = useRef(null);
  const lastStreamSourceRef = useRef("");

  const introSeenKey = useMemo(() => {
    const base = introOnceKey || `${mode || "explore"}:${podId != null ? String(podId) : "global"}`;
    return `snooze.snoozer.introSeen.${base}`;
  }, [introOnceKey, mode, podId]);

  useEffect(() => {
    if (typeof controlledOpenCartUrl !== "string") {
      setLocalOpenCartUrl(readCheckoutUrl());
    }
  }, [controlledOpenCartUrl]);

  useEffect(() => {
    const t = String(externalCaptionText || lastAssistantText || "").trim();
    if (!t) return;
    safeSet("snooze.snoozer.lastCaption", t);
  }, [externalCaptionText, lastAssistantText]);

  useEffect(() => {
    if (!drawerOpen) return;
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [transcriptMessages, effectiveBusy, drawerOpen]);

  useEffect(() => {
    const base = clampText(String(activeCaptionSource || ""), sz.bubbleClamp);
    if (!base) {
      setDisplayedText("");
      lastStreamSourceRef.current = "";
      return;
    }

    if (base === lastStreamSourceRef.current) return;

    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;
    }

    const source = base;
    const tokens = tokensForStreaming(source);
    const shouldStream = tokens.length > 1;

    lastStreamSourceRef.current = source;

    if (!shouldStream) {
      setDisplayedText(source);
      setIsStreaming(false);
      return;
    }

    setDisplayedText("");
    setIsStreaming(true);

    if (controlledState == null || controlledState === "") {
      const speakingState =
        normalizeHudState(localHudState) === "thinking"
          ? "speaking"
          : normalizeHudState(localHudState);

      if (speakingState !== "celebrate" && speakingState !== "warning") {
        setLocalHudState("speaking");
      }
    }

    let i = 0;
    const run = () => {
      i += 1;
      setDisplayedText(tokens.slice(0, i).join(""));

      if (i >= tokens.length) {
        setIsStreaming(false);
        streamTimeoutRef.current = null;
        return;
      }

      const delay = getStreamStepDelay(tokens[i - 1], modeLower);
      streamTimeoutRef.current = setTimeout(run, delay);
    };

    streamTimeoutRef.current = setTimeout(run, modeLower === "pod" ? 24 : 28);

    return () => {
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current);
        streamTimeoutRef.current = null;
      }
    };
  }, [activeCaptionSource, sz.bubbleClamp, modeLower, localHudState, controlledState]);

  useEffect(() => {
    if (stateTimeoutRef.current) {
      clearTimeout(stateTimeoutRef.current);
      stateTimeoutRef.current = null;
    }

    if (controlledState != null && controlledState !== "") return;
    if (effectiveBusy) return;
    if (!lastAssistantText) return;
    if (isStreaming) return;

    if (localHudState === "thinking") {
      setLocalHudState("speaking");
      stateTimeoutRef.current = setTimeout(() => {
        setLocalHudState("idle");
        stateTimeoutRef.current = null;
      }, 1600);
      return;
    }

    if (localHudState === "speaking") {
      stateTimeoutRef.current = setTimeout(() => {
        setLocalHudState("idle");
        stateTimeoutRef.current = null;
      }, 1400);
    }

    return () => {
      if (stateTimeoutRef.current) {
        clearTimeout(stateTimeoutRef.current);
        stateTimeoutRef.current = null;
      }
    };
  }, [effectiveBusy, lastAssistantText, localHudState, isStreaming, controlledState]);

  useEffect(() => {
    try {
      if (!introCaption) return;

      const alreadySeen = safeGet(introSeenKey) === "1";
      if (alreadySeen) return;

      if (!shouldAllowIntroSwap(transcriptMessages)) return;

      setLocalMessages([{ role: "assistant", text: String(introCaption) }]);
      safeSet(introSeenKey, "1");

      if (controlledState == null || controlledState === "") {
        const st = normalizeHudState(introState);
        if (st && st !== "idle") setLocalHudState(st);
      }

      if (introTimeoutRef.current) {
        clearTimeout(introTimeoutRef.current);
        introTimeoutRef.current = null;
      }

      introTimeoutRef.current = setTimeout(() => {
        if (controlledState == null || controlledState === "") {
          setLocalHudState("idle");
        }
        introTimeoutRef.current = null;
      }, Number(introTtlMs) || 2200);
    } catch {
      // ignore
    }

    return () => {
      try {
        if (introTimeoutRef.current) {
          clearTimeout(introTimeoutRef.current);
          introTimeoutRef.current = null;
        }
      } catch {
        // ignore
      }
    };
  }, [introCaption, introSeenKey, introState, introTtlMs, transcriptMessages, controlledState]);

  useEffect(() => {
    return () => {
      if (introTimeoutRef.current) clearTimeout(introTimeoutRef.current);
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
      if (stateTimeoutRef.current) clearTimeout(stateTimeoutRef.current);
    };
  }, []);

  async function postAskSnoozer(payload) {
    if (api && typeof api.askSnoozer === "function") {
      return await api.askSnoozer(payload);
    }
    throw new Error("api.askSnoozer is not available");
  }

  async function handleSend() {
    const text = String(input || "").trim();
    if (!text || effectiveBusy) return;

    setLocalError("");
    setLocalBusy(true);
    if (controlledState == null || controlledState === "") {
      setLocalHudState("thinking");
    }
    setInput("");
    setLocalMessages((m) => [...m, { role: "user", text }]);

    const baseCtx = isObject(context) ? { ...context } : {};

    if (podId != null && String(podId).trim()) {
      baseCtx.podId = baseCtx.podId ?? podId;
    }

    if (!Array.isArray(baseCtx.explore) || baseCtx.explore.length === 0) {
      if (Array.isArray(exploreContext) && exploreContext.length) {
        baseCtx.explore = exploreContext;
      }
    }

    if (!baseCtx.assessment && assessment && typeof assessment === "object") {
      baseCtx.assessment = assessment;
    }

    const payload = {
      message: text,
      mode: mode || "explore",
      shopperId: shopperId || "guest",
      podId: podId != null ? podId : undefined,
      context: baseCtx,
    };

    try {
      const res =
        typeof onSend === "function"
          ? await onSend(payload)
          : await postAskSnoozer(payload);

      const reply =
        String(res?.reply || res?.text || res?.hud?.captions || res?.hud?.speech || "").trim() ||
        "No response.";

      setLocalMessages((m) => [...m, { role: "assistant", text: reply }]);


      const hud = res?.hud || null;
      const nextHudState = normalizeHudState(hud?.state || "");

      if (controlledState == null || controlledState === "") {
        if (nextHudState && nextHudState !== "idle") setLocalHudState(nextHudState);
        else setLocalHudState("speaking");
      }

      const cartId = res?.cartId || res?.contextPatch?.ids?.cartId || null;
      const checkoutUrl = res?.checkoutUrl || res?.contextPatch?.checkoutUrl || null;
      const contextPatch = res?.contextPatch || null;

      if (checkoutUrl) {
        persistShopifyCartIdentity({ cartId, checkoutUrl });
        setLocalOpenCartUrl(String(checkoutUrl));
      }

      if (typeof onHud === "function" && hud) {
        onHud(hud, {
          reply,
          cartId,
          checkoutUrl,
          contextPatch,
          raw: res,
        });
      }

      if (cartId || checkoutUrl) {
        if (controlledState == null || controlledState === "") {
          setLocalHudState("celebrate");
          if (stateTimeoutRef.current) clearTimeout(stateTimeoutRef.current);
          stateTimeoutRef.current = setTimeout(() => {
            setLocalHudState("idle");
            stateTimeoutRef.current = null;
          }, 900);
        }
        onCheckoutCreated && onCheckoutCreated({ cartId, checkoutUrl, contextPatch });
      } else if (nextHudState === "warning") {
        if (controlledState == null || controlledState === "") {
          if (stateTimeoutRef.current) clearTimeout(stateTimeoutRef.current);
          stateTimeoutRef.current = setTimeout(() => {
            setLocalHudState("idle");
            stateTimeoutRef.current = null;
          }, 1200);
        }
      } else {
        if (controlledState == null || controlledState === "") {
          if (stateTimeoutRef.current) clearTimeout(stateTimeoutRef.current);
          stateTimeoutRef.current = setTimeout(() => {
            setLocalHudState("idle");
            stateTimeoutRef.current = null;
          }, 1600);
        }
      }
    } catch (e) {
      setLocalError(e?.message || "Snoozer had trouble responding.");
      if (controlledState == null || controlledState === "") {
        setLocalHudState("warning");
      }
      setLocalMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "Snoozer had trouble responding.",
        },
      ]);
      if (controlledState == null || controlledState === "") {
        if (stateTimeoutRef.current) clearTimeout(stateTimeoutRef.current);
        stateTimeoutRef.current = setTimeout(() => {
          setLocalHudState("idle");
          stateTimeoutRef.current = null;
        }, 1200);
      }
    } finally {
      setLocalBusy(false);
    }
  }

  const useGlass = chromeMode === "none";

  const avatarClass = useMemo(() => {
    const coachShape =
      presentationMode === "coach" ? "rounded-[32px]" : "rounded-full";

    return [
      "snoozer-avatar",
      `snoozer-avatar-${effectiveState}`,
      sz.avatarOuter,
      coachShape,
      useGlass ? "bg-transparent border-transparent shadow-none" : "",
      effectiveState === "warning" ? "border-amber-300" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }, [effectiveState, sz.avatarOuter, useGlass, presentationMode]);

  const bubbleClass = useMemo(() => {
    const base = [
      "snoozer-bubble",
      `snoozer-bubble-${effectiveState}`,
      presentationMode === "coach" ? "rounded-[28px] px-5 py-4" : "",
    ]
      .filter(Boolean)
      .join(" ");

    if (!useGlass) return base;

    return [base, "bg-white/35 border-white/40", "backdrop-blur-md", "shadow-sm"].join(" ");
  }, [effectiveState, useGlass, presentationMode]);

  const tailClass = useMemo(() => {
    if (presentationMode === "coach") return "hidden";

    const cls =
      effectiveState === "warning"
        ? "border-amber-300 bg-amber-50/60"
        : effectiveState === "celebrate"
        ? "border-emerald-300 bg-emerald-50/60"
        : effectiveState === "thinking"
          ? "border-indigo-200 bg-indigo-50/60"
          : effectiveState === "speaking"
            ? "border-indigo-200 bg-white/40"
            : "border-white/40 bg-white/35";

    return ["snoozer-bubble-tail", cls].join(" ");
  }, [effectiveState, presentationMode]);

  const outerClass = useMemo(() => {
    if (chromeMode === "none") return "bg-transparent border-transparent shadow-none p-0";
    return "rounded-3xl border bg-white p-5 shadow-sm";
  }, [chromeMode]);

  const rowClass = useMemo(() => {
    if (presentationMode === "coach") {
      return showHeader ? "mt-4 flex items-start gap-8" : "flex items-start gap-8";
    }
    return showHeader ? "mt-4 flex items-start gap-4" : "flex items-start gap-4";
  }, [presentationMode, showHeader]);

  const bubbleTextClass = useMemo(() => {
    if (presentationMode === "coach") {
      return "text-base leading-relaxed text-gray-800 md:text-lg";
    }
    return "text-sm leading-relaxed text-gray-800";
  }, [presentationMode]);

  const thinkingTextClass = useMemo(() => {
    if (presentationMode === "coach") {
      return "text-base leading-relaxed text-gray-700 md:text-lg";
    }
    return "text-sm leading-relaxed text-gray-700";
  }, [presentationMode]);

  const avatarImgClass = useMemo(() => {
    return [
      sz.avatarImg,
      "object-contain",
      presentationMode === "coach" ? "scale-[1.08]" : "",
      useGlass ? "drop-shadow-[0_14px_18px_rgba(0,0,0,0.12)]" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }, [sz.avatarImg, presentationMode, useGlass]);

  const normalizedActions = useMemo(() => {
    return Array.isArray(controlledActions) ? controlledActions.slice(0, 12) : [];
  }, [controlledActions]);

  return (
    <div className={outerClass}>
      {showHeader ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold text-gray-900">{title}</div>
            <div className="mt-0.5 truncate text-xs text-gray-600">{subtitle}</div>
          </div>

          {effectiveOpenCartUrl ? (
            <a
              href={effectiveOpenCartUrl}
              className="shrink-0 text-[11px] font-extrabold text-indigo-700 underline"
              target="_blank"
              rel="noreferrer"
              title="Open Cart"
            >
              Open Cart
            </a>
          ) : null}
        </div>
      ) : null}

      <div className={rowClass}>
        <div className="shrink-0">
          <div className={avatarClass} title={`State: ${effectiveState}`}>
            <img
              src={resolvedAvatarSrc}
              alt="Snoozer"
              className={avatarImgClass}
              onError={(e) => {
                const tried = String(e.currentTarget.src || "");

                if (tried.includes("/avatars/snoozer-coach.png")) {
                  e.currentTarget.src = "/snoozer-avatar.png";
                  return;
                }

                if (tried.includes("/snoozer-avatar.png")) {
                  e.currentTarget.style.display = "none";
                }
              }}
            />
          </div>

          {showStateLabel ? (
            <div className="mt-2 text-center text-[10px] font-extrabold uppercase tracking-wide text-gray-500">
              {effectiveState}
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className={bubbleClass}>
            <div className={tailClass} aria-hidden="true" />

            {!effectiveBusy || isStreaming || externalCaptionText ? (
              <div className={bubbleTextClass}>{bubbleText}</div>
            ) : (
              <div className={thinkingTextClass}>
                <span className="font-semibold">Thinking</span>{" "}
                <span className="snoozer-dots" aria-label="Thinking">
                  <span className="snoozer-dot" />
                  <span className="snoozer-dot" />
                  <span className="snoozer-dot" />
                </span>
              </div>
            )}
          </div>

          {effectiveError ? (
            <div className="mt-2 text-xs font-semibold text-amber-700">{effectiveError}</div>
          ) : null}

          {showInput ? (
            <div className="mt-3 flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                }}
                placeholder={placeholder}
                className={[
                  "flex-1 rounded-2xl border px-4 text-sm outline-none focus:ring-2 focus:ring-indigo-200",
                  useGlass ? "border-white/50 bg-white/65 backdrop-blur-md" : "border-gray-200 bg-white",
                  sz.inputHeight,
                ].join(" ")}
              />
              <Button
                className={[sz.inputHeight, "rounded-2xl px-5"].join(" ")}
                onClick={handleSend}
                disabled={effectiveBusy}
              >
                Send
              </Button>
            </div>
          ) : null}

          {normalizedActions.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {normalizedActions.map((action, idx) => {
                const label =
                  typeof action === "string"
                    ? action
                    : String(action?.label || action?.title || action?.text || "").trim();

                if (!label) return null;

                return (
                  <span
                    key={`${label}-${idx}`}
                    className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-[11px] font-extrabold text-indigo-800"
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          ) : null}

          {showTranscriptToggle ? (
            <div className="mt-2 flex items-center justify-end">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] font-extrabold text-gray-700 hover:text-gray-900"
                onClick={() => setDrawerOpen((v) => !v)}
              >
                {drawerOpen ? (
                  <>
                    Hide history <ChevronUp className="h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    Show history <ChevronDown className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </div>
          ) : null}

          {drawerOpen ? (
            <div
              ref={listRef}
              className={[
                "mt-3 max-h-[260px] overflow-auto rounded-2xl border p-3",
                useGlass ? "border-white/40 bg-white/45 backdrop-blur-md" : "border-gray-200 bg-gray-50",
              ].join(" ")}
            >
              <div className="space-y-2">
                {transcriptMessages.map((m, idx) => {
                  const isUser = m.role === "user";
                  return (
                    <div
                      key={`${m.role}-${idx}`}
                      className={["text-sm leading-relaxed", isUser ? "text-gray-900" : "text-gray-700"].join(" ")}
                    >
                      <span className="font-extrabold">{isUser ? "You: " : "Snoozer: "}</span>
                      <span>{m.text}</span>
                    </div>
                  );
                })}

                {effectiveBusy ? (
                  <div className="text-sm text-gray-600">
                    <span className="font-extrabold">Snoozer: </span>
                    Thinking...
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function SnoozerPanel(props) {
  return <SnoozerHUD {...props} />;
}

