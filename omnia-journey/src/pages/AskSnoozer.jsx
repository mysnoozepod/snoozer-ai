import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUp,
  BedDouble,
  CircleDollarSign,
  ClipboardList,
  Compass,
  ExternalLink,
  Headphones,
  Loader2,
  MessageSquareText,
  ReceiptText,
  RefreshCcw,
  Sparkles,
} from "lucide-react";

import { useSnoozer } from "@/Layout";
import {
  ASK_SNOOZER_ROUTE,
  sendAskSnoozerMessage,
} from "@/lib/snoozer/askSnoozerPage";
import { useStore } from "@/lib/useStore";
import {
  ShowroomBrandMark,
  ShowroomCartBadge,
  ShowroomEyebrow,
  ShowroomFrame,
  ShowroomInlineAction,
  ShowroomPageShell,
  ShowroomPanel,
  ShowroomTopRail,
} from "@/components/showroom/ShowroomPrimitives";

const QUICK_PROMPTS = [
  {
    label: "Help me choose",
    prompt: "Help me choose the right pod for how I sleep.",
  },
  {
    label: "Compare mattresses",
    prompt: "Help me compare mattress feel and support.",
  },
  {
    label: "Adjustable bases",
    prompt: "How do adjustable bases help?",
  },
  {
    label: "Delivery & payment",
    prompt: "Can you explain delivery, financing, and returns?",
  },
  {
    label: "Snooze Code help",
    prompt: "How do I use my Snooze Code?",
  },
];

const STARTER_PROMPTS = [
  "Which pod should I try first?",
  "Can you explain my recommendation?",
  "Which mattress sleeps coolest?",
  "How do adjustable bases help?",
];

const EXPLORE_ACTIONS = [
  {
    icon: Compass,
    label: "Explore products",
    description: "See your matched pods and recommended testing order.",
    onClickTarget: "/results",
  },
  {
    icon: ClipboardList,
    label: "Start assessment",
    description: "Jump back into the guided question flow.",
    onClickTarget: "/assessment",
  },
  {
    icon: Headphones,
    label: "Talk to human",
    description: "Prep a human-help request for the showroom team.",
    draft: "I need human help",
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

function composeFallbackReply(prompt) {
  const safePrompt = String(prompt || "").trim();
  const contextLine = safePrompt
    ? `I hit a snag while answering "${safePrompt}", but I can still help.`
    : "I hit a snag, but I can still help.";

  return `${contextLine} Try asking that another way, or tap one of the quick prompts below.`;
}

function formatAssistantStatus(status) {
  const value = String(status || "answered").trim();
  if (!value) return "answered";
  return value.replace(/_/g, " ");
}

function buttonClass(active = true) {
  return [
    "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition",
    active
      ? "bg-[#16315F] text-white shadow-[0_14px_28px_rgba(22,49,95,0.18)] hover:bg-[#102749]"
      : "bg-slate-200 text-slate-500",
  ].join(" ");
}

function ComposerCard({
  draft,
  canSend,
  compact = false,
  pending = false,
  textareaRef,
  noteUserInteraction,
  onChange,
  onKeyDown,
  onSend,
  onPromptClick,
}) {
  return (
    <div
      className={
        compact
          ? "rounded-[22px] border border-slate-200 bg-slate-50/80 p-3 shadow-inner"
          : "rounded-[28px] border border-[#dbe5ff] bg-white/96 p-4 shadow-[0_18px_40px_rgba(31,55,117,0.10)]"
      }
    >
      {!compact ? (
        <div className="mb-3">
          <div className="text-[0.72rem] font-black uppercase tracking-[0.16em] text-[#2f57e8]">
            Ask anything
          </div>
          <div className="mt-1 text-sm leading-6 text-slate-600">
            Type a question for Snoozer, then send it like a normal chat.
          </div>
        </div>
      ) : null}

      <div
        className={
          compact
            ? ""
            : "rounded-[24px] border border-slate-200 bg-slate-50/72 px-3 py-2 shadow-inner"
        }
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => noteUserInteraction?.()}
          rows={compact ? 2 : 3}
          placeholder="Ask about cooling, comfort, pods, sessions, or your recommendation..."
          className={
            compact
              ? "min-h-[64px] w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400"
              : "min-h-[96px] w-full resize-none bg-transparent px-1 py-1 text-[15px] leading-7 text-slate-800 outline-none placeholder:text-slate-400"
          }
        />
      </div>

      <div
        className={
          compact
            ? "mt-3 flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between"
            : "mt-4 flex flex-col gap-3"
        }
      >
        <div className="flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((item) => (
            <button
              key={`${compact ? "compact" : "empty"}-${item.label}`}
              type="button"
              onClick={() => onPromptClick(item.prompt)}
              className={
                compact
                  ? "rounded-full border border-[#d7e3ff] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#2f57e8] transition hover:bg-[#eef4ff]"
                  : "rounded-full border border-[#d7e3ff] bg-[#f6f9ff] px-3.5 py-2 text-[0.78rem] font-semibold text-[#2f57e8] transition hover:bg-[#eef4ff]"
              }
            >
              {item.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onSend(draft)}
          disabled={!canSend}
          className={
            compact
              ? buttonClass(canSend)
              : [
                  "inline-flex items-center justify-center gap-2 self-end rounded-full px-5 py-3 text-sm font-semibold transition",
                  canSend
                    ? "bg-[#16315F] text-white shadow-[0_14px_28px_rgba(22,49,95,0.18)] hover:bg-[#102749]"
                    : "bg-slate-200 text-slate-500",
                ].join(" ")
          }
        >
          {pending ? "Sending..." : "Send message"}
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function AskSnoozer() {
  const navigate = useNavigate();
  const location = useLocation();
  const transcriptRef = useRef(null);
  const textareaRef = useRef(null);
  const overlayWasOpenRef = useRef(false);

  const snoozepod = useStore((state) => state.snoozepod || []);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [lastFailedPrompt, setLastFailedPrompt] = useState("");
  const [lastAssistantMeta, setLastAssistantMeta] = useState(null);
  const [failedRecommendationImages, setFailedRecommendationImages] = useState({});

  const snoozer = useSnoozer();
  const sayHud = snoozer?.sayHud;
  const noteUserInteraction = snoozer?.noteUserInteraction;
  const closeSnoozer = snoozer?.closeSnoozer;
  const openSnoozer = snoozer?.openSnoozer;
  const hudOpen = snoozer?.hud?.open;

  const hasMessages = messages.length > 0;
  const canSend = !pending && String(draft || "").trim().length > 0;
  const snoozepodCount = useMemo(
    () => snoozepod.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0),
    [snoozepod]
  );
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
  }, []);

  useEffect(() => {
    const transcriptNode = transcriptRef.current;
    if (!transcriptNode) return;
    transcriptNode.scrollTo({
      top: transcriptNode.scrollHeight,
      behavior: hasMessages ? "smooth" : "auto",
    });
  }, [messages, hasMessages, pending]);

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
    setLastAssistantMeta(null);
    setDraft("");

    try {
      const response = await sendAskSnoozerMessage({
        message: content,
        history,
        referrerRoute,
      });

      const assistantMessage = {
        id: response.reply?.id || createMessageId("assistant"),
        role: "assistant",
        content: response.reply?.content || composeFallbackReply(content),
        createdAt: response.reply?.createdAt || nowIso(),
        status: response.status || "answered",
        chips: Array.isArray(response.chips) ? response.chips : [],
        actions: Array.isArray(response.actions) ? response.actions : [],
        recommendations: Array.isArray(response.recommendations)
          ? response.recommendations
          : [],
        canRetry: response.ok === false,
        retryPrompt: content,
      };

      setMessages((current) => [...current, assistantMessage]);
      setLastAssistantMeta(response.meta || null);
      setLastFailedPrompt(response.ok === false ? content : "");

      if (response.voice?.speak && response.voice?.speech && typeof sayHud === "function") {
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
        chips: QUICK_PROMPTS.map((item) => ({
          label: item.label,
          value: item.prompt,
          type: "prompt",
          target: null,
        })),
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

  function handlePromptClick(prompt) {
    noteUserInteraction?.();
    sendMessage(prompt);
  }

  function handleRetry(prompt) {
    noteUserInteraction?.();
    sendMessage(prompt || lastFailedPrompt);
  }

  function handleAction(action) {
    noteUserInteraction?.();

    switch (action?.type) {
      case "navigate":
        if (action.target) navigate(action.target);
        return;
      case "start_assessment":
        navigate("/assessment");
        return;
      case "open_builder":
        navigate("/pod/1");
        return;
      case "view_recommendation":
        navigate(action?.target || "/results");
        return;
      case "request_human":
        setDraft("I need human help");
        textareaRef.current?.focus();
        return;
      default:
        if (action?.target) navigate(action.target);
    }
  }

  function handleChip(chip) {
    noteUserInteraction?.();

    if (chip.type === "route" && chip.target) {
      navigate(chip.target);
      return;
    }

    if (chip.type === "action") {
      handleAction({
        type: chip.value === "I need human help" ? "request_human" : "none",
        label: chip.label,
        target: chip.target,
      });
      return;
    }

    sendMessage(chip.value || chip.label);
  }

  function handleExploreAction(action) {
    noteUserInteraction?.();
    if (action.onClickTarget) {
      navigate(action.onClickTarget);
      return;
    }
    if (action.draft) {
      setDraft(action.draft);
      textareaRef.current?.focus();
    }
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
    <ShowroomPageShell className="flex min-h-0 flex-col overflow-hidden pb-0">
      <ShowroomTopRail className="items-center pt-2 md:pt-3">
        <ShowroomBrandMark />
        <ShowroomCartBadge
          count={snoozepodCount}
          quiet
          onClick={() => {
            noteUserInteraction?.();
            navigate("/snoozepod");
          }}
        />
      </ShowroomTopRail>

      <div className="mx-auto flex min-h-0 w-full max-w-[1380px] flex-1 flex-col overflow-hidden px-4 pb-3 pt-2 md:px-6 md:pb-4">
        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_290px]">
          <ShowroomFrame className="flex min-h-0 flex-1 flex-col overflow-hidden p-1.5 md:p-2">
            <ShowroomPanel className="shrink-0 overflow-hidden p-4" tone="soft">
              <div className="flex flex-col gap-2.5 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
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
                      <h1 className="mt-1 text-[1.6rem] font-black leading-[0.96] tracking-tight text-slate-900 md:text-[1.9rem]">
                        Chat with Snoozer
                      </h1>
                    </div>
                  </div>

                  <p className="mt-2 max-w-3xl text-[0.9rem] leading-6 text-slate-600 md:text-[0.95rem]">
                    Ask about comfort, cooling, partner fit, adjustable bases, Snooze
                    Codes, policy questions, or what to try next in the showroom.
                  </p>
                </div>

                <div className="rounded-full border border-[#dbe5ff] bg-white/88 px-3.5 py-2 text-xs font-semibold text-[#2f57e8] shadow-sm">
                  Responses appear below as soon as you send a message.
                </div>
              </div>
            </ShowroomPanel>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                ref={transcriptRef}
                className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3 pt-3 md:px-4 ${
                  hasMessages ? "" : "justify-center"
                }`}
              >
                {!hasMessages ? (
                  <div className="mx-auto flex w-full max-w-[920px] flex-col gap-4">
                    <div className="text-center">
                      <div className="text-[0.72rem] font-black uppercase tracking-[0.16em] text-[#2f57e8]">
                        Ask Snoozer
                      </div>
                      <h2 className="mt-2 text-[1.5rem] font-black tracking-tight text-slate-900 md:text-[1.9rem]">
                        Start chatting right here.
                      </h2>
                      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600 md:text-[0.96rem]">
                        Ask about your recommendation, cooling, partner comfort,
                        adjustable bases, Snooze Codes, or what pod to try next.
                      </p>
                    </div>

                    <ComposerCard
                      draft={draft}
                      canSend={canSend}
                      pending={pending}
                      textareaRef={textareaRef}
                      noteUserInteraction={noteUserInteraction}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={onComposerKeyDown}
                      onSend={sendMessage}
                      onPromptClick={handlePromptClick}
                    />

                    <div className="grid gap-2 md:grid-cols-2">
                      {STARTER_PROMPTS.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => handlePromptClick(prompt)}
                          className="rounded-[20px] border border-slate-200 bg-white/90 px-4 py-3 text-left text-sm font-semibold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:border-[#16315F]/25 hover:shadow-[0_16px_34px_rgba(15,23,42,0.08)]"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {messages.map((message) => {
                  const isAssistant = message.role === "assistant";

                  return (
                    <article
                      key={message.id}
                      className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
                    >
                      <div
                        className={`max-w-[94%] rounded-[24px] px-4 py-3.5 shadow-sm md:max-w-[78%] ${
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

                        {isAssistant &&
                        Array.isArray(message.actions) &&
                        message.actions.length ? (
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

                {pending ? (
                  <div className="flex justify-start">
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

              {hasMessages ? (
                <div className="shrink-0 border-t border-slate-100 bg-white/94 px-3 pb-3 pt-3 md:px-4 md:pb-4">
                  <ComposerCard
                    draft={draft}
                    canSend={canSend}
                    compact
                    pending={pending}
                    textareaRef={textareaRef}
                    noteUserInteraction={noteUserInteraction}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={onComposerKeyDown}
                    onSend={sendMessage}
                    onPromptClick={handlePromptClick}
                  />
                </div>
              ) : null}
            </div>
          </ShowroomFrame>

          <div className="grid gap-4 xl:grid-rows-[auto_auto]">
            <ShowroomPanel className="p-4 md:p-4.5" tone="frost">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#16315F]/10 bg-[#16315F]/5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#16315F]">
                <Sparkles className="h-3.5 w-3.5" />
                Showroom help
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Use chat for recommendation questions, policy help, adjustable base
                questions, Snooze Code support, or to figure out what to try next.
              </p>
              {lastAssistantMeta?.conversationId ? (
                <div className="mt-3 rounded-full bg-[#FFF6E8] px-3 py-2 text-xs font-semibold text-[#8A5A16]">
                  Conversation {lastAssistantMeta.conversationId}
                </div>
              ) : null}
            </ShowroomPanel>

            <ShowroomPanel className="p-4 md:p-4.5" tone="frost">
              <ShowroomEyebrow className="text-[0.7rem] tracking-[0.16em]">
                Explore More
              </ShowroomEyebrow>
              <div className="mt-3 space-y-3">
                {EXPLORE_ACTIONS.map((action) => (
                  <ShowroomInlineAction
                    key={action.label}
                    icon={action.icon}
                    label={action.label}
                    description={action.description}
                    onClick={() => handleExploreAction(action)}
                  />
                ))}

                <ShowroomInlineAction
                  icon={CircleDollarSign}
                  label="Delivery & payment"
                  description="Ask Snoozer about financing, delivery, and return questions."
                  onClick={() => handlePromptClick("Can you explain delivery, financing, and returns?")}
                />
                <ShowroomInlineAction
                  icon={ReceiptText}
                  label="Snooze Code help"
                  description="Ask how to unlock your session or use your code."
                  onClick={() => handlePromptClick("How do I use my Snooze Code?")}
                />
              </div>
            </ShowroomPanel>
          </div>
        </div>
      </div>
    </ShowroomPageShell>
  );
}
