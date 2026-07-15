import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUp,
  Compass,
  ExternalLink,
  Headphones,
  Loader2,
  MessageSquareText,
  RefreshCcw,
} from "lucide-react";

import { useSnoozer } from "@/Layout";
import {
  canNavigateTo,
  canViewCart,
  filterDeviceActions,
  isDeviceActionAllowed,
} from "@/device/deviceActionGuards";
import {
  emitDeviceActiveResponse,
  emitDeviceHumanHelp,
} from "@/device/deviceActivityTracker";
import { makePodRoute } from "@/device/podRouteUtils";
import { useDeviceMode } from "@/device/useDeviceMode";
import { sendAskSnoozerMessage } from "@/lib/snoozer/askSnoozerPage";
import { useStore } from "@/lib/useStore";
import {
  ShowroomBrandMark,
  ShowroomCartBadge,
  ShowroomEyebrow,
  ShowroomFrame,
  ShowroomPageShell,
  ShowroomPanel,
  ShowroomTopRail,
} from "@/components/showroom/ShowroomPrimitives";

const STARTER_CHIPS = [
  {
    label: "What should I try next?",
    prompt: "What should I try next?",
  },
  {
    label: "Why was this pod recommended?",
    prompt: "Why was this pod recommended?",
  },
  {
    label: "Compare my top pods",
    prompt: "Compare my top pods.",
  },
  {
    label: "Help me choose a base",
    prompt: "Help me choose a base.",
  },
  {
    label: "Talk to a human",
    prompt: "I need human help.",
  },
];

function createMessageId(prefix) {
  if (globalThis?.crypto?.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return String(Date.now());
  }
}

function messageToHistoryEntry(message) {
  return {
    role: message.role,
    content: message.content,
    createdAt: message.createdAt || nowIso(),
  };
}

function composeFallbackReply() {
  return "I had trouble reaching Snoozer for a moment. Try again, or tap Talk to Human.";
}

function formatAssistantStatus(status) {
  const value = String(status || "answered").trim();
  if (!value) return "answered";
  return value.replace(/_/g, " ");
}

function extractResponseContent(response, prompt) {
  const candidates = [
    response?.reply?.content,
    typeof response?.reply === "string" ? response.reply : "",
    response?.answer,
    response?.speech,
    response?.captions,
    response?.message,
  ];

  const match = candidates.find((value) => String(value || "").trim());
  return match ? String(match).trim() : composeFallbackReply(prompt);
}

function ChatStarterChip({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-[#d7e3ff] bg-[#f6f9ff] px-3.5 py-2 text-[0.78rem] font-semibold text-[#2f57e8] transition hover:bg-[#eef4ff]"
    >
      {label}
    </button>
  );
}

function ChatComposer({
  draft,
  pending,
  canSend,
  textareaRef,
  onChange,
  onKeyDown,
  onSend,
  noteUserInteraction,
}) {
  return (
    <div className="rounded-[24px] border border-[#dbe5ff] bg-white/96 p-3 shadow-[0_18px_40px_rgba(31,55,117,0.10)] md:p-3.5">
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1 rounded-[20px] border border-slate-200 bg-slate-50/80 px-3 py-2 shadow-inner">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onFocus={() => noteUserInteraction?.()}
            rows={2}
            placeholder="Ask about your recommendations, comfort, adjustable bases, policies, Snooze Codes, or what to try next."
            className="min-h-[60px] w-full resize-none bg-transparent text-[15px] leading-6 text-slate-800 outline-none placeholder:text-slate-400"
          />
        </div>

        <button
          type="button"
          onClick={() => onSend(draft)}
          disabled={!canSend}
          className={[
            "inline-flex h-[56px] w-[112px] shrink-0 items-center justify-center gap-2 rounded-[18px] px-4 text-sm font-semibold transition",
            canSend
              ? "bg-[#16315F] text-white shadow-[0_14px_28px_rgba(22,49,95,0.18)] hover:bg-[#102749]"
              : "bg-slate-200 text-slate-500",
          ].join(" ")}
        >
          {pending ? "Sending..." : "Send"}
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function AskSnoozer() {
  const navigate = useNavigate();
  const location = useLocation();
  const device = useDeviceMode();
  const transcriptRef = useRef(null);
  const textareaRef = useRef(null);
  const overlayWasOpenRef = useRef(false);
  const handledPrefillLocationRef = useRef("");
  const humanHelpTimerRef = useRef(null);

  const snoozepod = useStore((state) => state.snoozepod || []);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [lastFailedPrompt, setLastFailedPrompt] = useState("");
  const [failedRecommendationImages, setFailedRecommendationImages] = useState({});

  const snoozer = useSnoozer();
  const sayHud = snoozer?.sayHud;
  const noteUserInteraction = snoozer?.noteUserInteraction;
  const closeSnoozer = snoozer?.closeSnoozer;
  const openSnoozer = snoozer?.openSnoozer;
  const hudOpen = snoozer?.hud?.open;

  const canSend = !pending && String(draft || "").trim().length > 0;
  const snoozepodCount = useMemo(
    () => snoozepod.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0),
    [snoozepod]
  );
  const showCommerceAffordances = canViewCart(device);
  const canNavigateToResults = canNavigateTo(device, "/results");
  const devicePodRoute = makePodRoute(device?.podId) || "/pod/pod-1";
  const referrerRoute =
    location.state && typeof location.state === "object"
      ? location.state.from || null
      : null;

  useEffect(() => {
    const previousValue = window.__SNOOZE_DISABLE_WIDGET;
    window.__SNOOZE_DISABLE_WIDGET = true;
    document.body.classList.add("no-global-chat");

    return () => {
      window.__SNOOZE_DISABLE_WIDGET = previousValue;
      document.body.classList.remove("no-global-chat");
    };
  }, []);

  useEffect(() => {
    overlayWasOpenRef.current = hudOpen !== false;
    closeSnoozer?.();

    return () => {
      if (overlayWasOpenRef.current) {
        openSnoozer?.();
      }
    };
  }, [closeSnoozer, hudOpen, openSnoozer]);

  useEffect(() => {
    const transcriptNode = transcriptRef.current;
    if (!transcriptNode) return;
    transcriptNode.scrollTo({
      top: transcriptNode.scrollHeight,
      behavior: messages.length ? "smooth" : "auto",
    });
  }, [messages, pending]);

  useEffect(() => {
    emitDeviceActiveResponse(pending, { reason: "activeResponse" });
  }, [pending]);

  useEffect(() => {
    return () => {
      if (humanHelpTimerRef.current) window.clearTimeout(humanHelpTimerRef.current);
      emitDeviceHumanHelp(false, { reason: "humanHelp" });
      emitDeviceActiveResponse(false, { reason: "activeResponse" });
    };
  }, []);

  useEffect(() => {
    const state =
      location.state && typeof location.state === "object" ? location.state : null;
    const prefill = typeof state?.prefill === "string" ? state.prefill.trim() : "";

    if (!prefill) return;

    setDraft((current) => (String(current || "").trim() ? current : prefill));

    if (state?.autoSend && handledPrefillLocationRef.current !== location.key) {
      handledPrefillLocationRef.current = location.key;
      window.setTimeout(() => {
        sendMessage(prefill);
      }, 0);
    }
  }, [location.key, location.state]);

  function filterResponseChips(chips = []) {
    if (!Array.isArray(chips)) return [];
    return chips.filter((chip) => {
      if (chip?.type === "route" && chip?.target) {
        return canNavigateTo(device, chip.target);
      }

      if (chip?.type === "action") {
        return isDeviceActionAllowed(device, chip);
      }

      if (chip?.target) {
        return isDeviceActionAllowed(device, chip);
      }

      return true;
    });
  }

  async function sendMessage(rawMessage) {
    const content = String(rawMessage || "").trim();
    if (!content || pending) return;

    noteUserInteraction?.();

    const userMessage = {
      id: createMessageId("user"),
      role: "user",
      content,
      createdAt: nowIso(),
    };

    const history = [...messages.map(messageToHistoryEntry), messageToHistoryEntry(userMessage)];
    setMessages((current) => [...current, userMessage]);
    setPending(true);
    setLastFailedPrompt("");
    setDraft("");

    try {
      const response = await sendAskSnoozerMessage({
        message: content,
        history,
        referrerRoute,
        deviceContext: {
          deviceId: device?.deviceId || null,
          deviceMode: device?.deviceMode || null,
          podId: device?.podId || null,
          zoneId: device?.zoneId || null,
        },
      });

      const assistantMessage = {
        id:
          (typeof response?.reply === "object" && response?.reply?.id) ||
          createMessageId("assistant"),
        role: "assistant",
        content: extractResponseContent(response, content),
        createdAt:
          (typeof response?.reply === "object" && response?.reply?.createdAt) || nowIso(),
        status: response?.status || "answered",
        chips: filterResponseChips(response?.chips),
        actions: filterDeviceActions(device, response?.actions),
        recommendations: Array.isArray(response?.recommendations)
          ? response.recommendations
          : [],
        canRetry: response?.ok === false,
        retryPrompt: content,
      };

      setMessages((current) => [...current, assistantMessage]);
      setLastFailedPrompt(response?.ok === false ? content : "");

      if (response?.voice?.speak && response?.voice?.speech && typeof sayHud === "function") {
        sayHud({
          speech: response.voice.speech,
          captions: assistantMessage.content,
          state: "speaking",
          priority: "normal",
          ttlMs: 5000,
          actions: [],
        }).catch(() => {});
      }
    } catch {
      const fallbackMessage = {
        id: createMessageId("assistant"),
        role: "assistant",
        content: composeFallbackReply(content),
        createdAt: nowIso(),
        status: "fallback",
        chips: [],
        actions: [],
        recommendations: [],
        canRetry: true,
        retryPrompt: content,
      };

      setMessages((current) => [...current, fallbackMessage]);
      setLastFailedPrompt(content);
    } finally {
      setPending(false);
    }
  }

  function handleAction(action) {
    noteUserInteraction?.();

    if (!isDeviceActionAllowed(device, action)) return;

    switch (action?.type) {
      case "navigate":
        if (action.target) navigate(action.target);
        return;
      case "start_assessment":
        navigate("/assessment");
        return;
      case "open_builder":
        navigate(devicePodRoute);
        return;
      case "view_recommendation":
        navigate(action?.target || "/results");
        return;
      case "request_human":
        handleTalkToHuman();
        return;
      default:
        if (action?.target) navigate(action.target);
    }
  }

  function handleChip(chip) {
    noteUserInteraction?.();

    if (chip?.type === "route" && chip?.target) {
      if (!canNavigateTo(device, chip.target)) return;
      navigate(chip.target);
      return;
    }

    if (chip?.type === "action") {
      if (!isDeviceActionAllowed(device, chip)) return;
      handleAction({
        type: chip.value === "I need human help" ? "request_human" : "none",
        label: chip.label,
        target: chip.target,
      });
      return;
    }

    sendMessage(chip?.value || chip?.label);
  }

  function handleRetry(prompt) {
    noteUserInteraction?.();
    sendMessage(prompt || lastFailedPrompt);
  }

  function handleStarterClick(prompt) {
    noteUserInteraction?.();
    sendMessage(prompt);
  }

  function handleTalkToHuman() {
    noteUserInteraction?.();
    emitDeviceHumanHelp(true, { reason: "humanHelp" });
    if (humanHelpTimerRef.current) window.clearTimeout(humanHelpTimerRef.current);
    humanHelpTimerRef.current = window.setTimeout(() => {
      emitDeviceHumanHelp(false, { reason: "humanHelp" });
    }, 90000);
    setDraft("I need human help.");
    textareaRef.current?.focus();
  }

  function onComposerKeyDown(event) {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (!String(draft || "").trim()) return;
    event.preventDefault();
    if (!pending) {
      sendMessage(draft);
    }
  }

  return (
    <ShowroomPageShell className="flex min-h-0 flex-col pb-3">
      <ShowroomTopRail className="items-center pt-2 md:pt-3">
        <ShowroomBrandMark />
        {showCommerceAffordances ? (
          <ShowroomCartBadge
            count={snoozepodCount}
            quiet
            onClick={() => {
              noteUserInteraction?.();
              navigate("/cart");
            }}
          />
        ) : null}
      </ShowroomTopRail>

      <div className="mx-auto flex min-h-0 w-full max-w-[1120px] flex-1 flex-col px-4 pt-2 md:px-6 md:pt-3">
        <ShowroomFrame className="flex min-h-0 flex-1 flex-col overflow-hidden p-1 md:p-1.5">
          <ShowroomPanel className="flex min-h-0 flex-1 flex-col overflow-hidden p-0" tone="soft">
            <div className="shrink-0 border-b border-[#dbe5ff] px-5 py-5 md:px-6 md:py-6">
              <div className="flex items-start gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.96),rgba(233,240,255,0.92))] shadow-[0_14px_32px_rgba(46,74,138,0.10)]">
                  <img
                    src="/snoozer-avatar.png"
                    alt="Snoozer"
                    className="h-11 w-11 object-contain"
                  />
                </div>

                <div className="min-w-0">
                  <ShowroomEyebrow className="text-[0.72rem] tracking-[0.18em]">
                    Ask Snoozer
                  </ShowroomEyebrow>
                  <h1 className="mt-1 text-[1.56rem] font-black leading-[0.96] tracking-tight text-slate-900 md:text-[1.82rem]">
                    Chat with Snoozer
                  </h1>
                  <p className="mt-2 max-w-3xl text-[0.94rem] leading-6 text-slate-600">
                    Ask about your recommendations, comfort, adjustable bases, policies,
                    Snooze Codes, or what to try next.
                  </p>
                </div>
              </div>
            </div>

            <div className="shrink-0 border-b border-[#dbe5ff] px-4 py-4 md:px-6 md:py-5">
              <ChatComposer
                draft={draft}
                pending={pending}
                canSend={canSend}
                textareaRef={textareaRef}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onComposerKeyDown}
                onSend={sendMessage}
                noteUserInteraction={noteUserInteraction}
              />

              <div className="mt-3 flex flex-wrap gap-2">
                {STARTER_CHIPS.map((item) => (
                  <ChatStarterChip
                    key={item.label}
                    label={item.label}
                    onClick={() => handleStarterClick(item.prompt)}
                  />
                ))}
              </div>
            </div>

            <div
              ref={transcriptRef}
              className="min-h-0 flex-1 overflow-y-auto bg-white/72 px-4 py-4 md:px-6 md:py-5"
            >
              {!messages.length && !pending ? (
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-[24px] border border-dashed border-[#dbe5ff] bg-[#f8faff] px-6 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#eef3ff] text-[#2f57e8]">
                    <MessageSquareText className="h-7 w-7" />
                  </div>
                  <div className="mt-4 max-w-2xl text-[1.02rem] font-semibold leading-7 text-slate-700">
                    Ask anything and Snoozer will answer right here.
                  </div>
                  <div className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                    Start with one of the quick prompts, or type your own question above.
                  </div>
                </div>
              ) : null}

              <div className="space-y-3">
                {messages.map((message) => {
                  const isAssistant = message.role === "assistant";

                  return (
                    <article
                      key={message.id}
                      className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
                    >
                      <div
                        className={`max-w-[96%] rounded-[24px] px-4 py-3.5 shadow-sm md:max-w-[78%] ${
                          isAssistant
                            ? "border border-slate-200 bg-white text-slate-800"
                            : "bg-[#16315F] text-white"
                        }`}
                      >
                        {isAssistant ? (
                          <div className="mb-2.5 flex items-center gap-3">
                            <img
                              src="/snoozer-avatar.png"
                              alt="Snoozer"
                              className="h-9 w-9 rounded-2xl border border-slate-100 bg-[#F7FAFF] p-1"
                            />
                            <div>
                              <div className="text-sm font-black text-slate-900">Snoozer</div>
                              <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                                {formatAssistantStatus(message.status)}
                              </div>
                            </div>
                          </div>
                        ) : null}

                        <div className="whitespace-pre-wrap text-sm leading-6 md:text-[15px]">
                          {message.content}
                        </div>

                        {isAssistant && Array.isArray(message.chips) && message.chips.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {message.chips.map((chip) => (
                              <button
                                key={`${message.id}-${chip.label}-${chip.value}`}
                                type="button"
                                onClick={() => handleChip(chip)}
                                className="rounded-full border border-[#16315F]/12 bg-[#16315F]/5 px-3 py-1.5 text-xs font-semibold text-[#16315F] transition hover:bg-[#16315F]/10"
                              >
                                {chip.label}
                              </button>
                            ))}
                          </div>
                        ) : null}

                        {isAssistant && Array.isArray(message.actions) && message.actions.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {message.actions.map((action) => (
                              <button
                                key={`${message.id}-${action.label}`}
                                type="button"
                                onClick={() => handleAction(action)}
                                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        ) : null}

                        {isAssistant &&
                        Array.isArray(message.recommendations) &&
                        message.recommendations.length ? (
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {message.recommendations.map((item) => {
                              const cardKey = `${message.id}-${item.id}`;
                              const showImage =
                                Boolean(item.imageUrl) && !failedRecommendationImages[cardKey];

                              return (
                                <button
                                  key={cardKey}
                                  type="button"
                                  onClick={() => {
                                    noteUserInteraction?.();
                                    if (item.url?.startsWith("/")) {
                                      navigate(item.url);
                                    } else if (item.url) {
                                      window.open(item.url, "_blank", "noopener,noreferrer");
                                    }
                                  }}
                                  className="flex items-start gap-3 rounded-[18px] border border-slate-200 bg-slate-50/70 p-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                                >
                                  <div className="h-14 w-14 overflow-hidden rounded-2xl bg-white">
                                    {showImage ? (
                                      <img
                                        src={item.imageUrl}
                                        alt={item.title}
                                        onError={() =>
                                          setFailedRecommendationImages((current) => ({
                                            ...current,
                                            [cardKey]: true,
                                          }))
                                        }
                                        className="h-full w-full object-contain p-1"
                                      />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                                        {item.type}
                                      </div>
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm font-bold text-slate-900">
                                      {item.title}
                                    </div>
                                    {item.subtitle ? (
                                      <div className="mt-1 text-xs leading-5 text-slate-500">
                                        {item.subtitle}
                                      </div>
                                    ) : null}
                                    {item.url ? (
                                      <div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#16315F]">
                                        View
                                        <ExternalLink className="h-3.5 w-3.5" />
                                      </div>
                                    ) : null}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}

                        {isAssistant && message.canRetry ? (
                          <div className="mt-3">
                            <button
                              type="button"
                              onClick={() => handleRetry(message.retryPrompt)}
                              className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
                            >
                              <RefreshCcw className="h-3.5 w-3.5" />
                              Retry
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>

              {pending ? (
                <div className="mt-3 flex justify-start">
                  <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
                    <div className="mb-2.5 flex items-center gap-3">
                      <img
                        src="/snoozer-avatar.png"
                        alt="Snoozer"
                        className="h-9 w-9 rounded-2xl border border-slate-100 bg-[#F7FAFF] p-1"
                      />
                      <div>
                        <div className="text-sm font-black text-slate-900">Snoozer</div>
                        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                          thinking
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Working on that...
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="shrink-0 border-t border-[#dbe5ff] bg-[linear-gradient(180deg,rgba(248,250,255,0.92),rgba(255,255,255,0.97))] px-4 py-3 md:px-6">
              <div className="flex flex-wrap items-center gap-2.5">
                {canNavigateToResults ? (
                  <button
                    type="button"
                    onClick={() => {
                      noteUserInteraction?.();
                      navigate("/results");
                    }}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-900 shadow-sm transition hover:bg-slate-50"
                  >
                    <Compass className="h-4 w-4 shrink-0 text-[#2f57e8]" />
                    <span>View Results</span>
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={handleTalkToHuman}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-900 shadow-sm transition hover:bg-slate-50"
                >
                  <Headphones className="h-4 w-4 shrink-0 text-[#2f57e8]" />
                  <span>Talk to Human</span>
                </button>
              </div>
            </div>
          </ShowroomPanel>
        </ShowroomFrame>
      </div>
    </ShowroomPageShell>
  );
}
