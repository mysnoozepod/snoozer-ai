import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUp,
  ExternalLink,
  Loader2,
  MessageSquareText,
  RefreshCcw,
  Sparkles,
} from "lucide-react";

import { useSnoozer } from "@/Layout";
import {
  ASK_SNOOZER_ROUTE,
  sendAskSnoozerMessage,
} from "@/lib/snoozer/askSnoozerPage";

const STARTER_PROMPTS = [
  "Which pod should I try first?",
  "Help me compare plush vs firm.",
  "What should I know if I sleep hot?",
  "How do adjustable bases help?",
  "I sleep with a partner. What should we compare?",
  "Help me build a SnoozePod.",
  "What happens during a Snooze Session?",
  "Can you explain my recommendation?",
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

function buttonClass(active = true) {
  return [
    "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition",
    active
      ? "bg-[#16315F] text-white shadow-[0_14px_28px_rgba(22,49,95,0.18)] hover:bg-[#102749]"
      : "bg-slate-200 text-slate-500",
  ].join(" ");
}

export default function AskSnoozer() {
  const navigate = useNavigate();
  const location = useLocation();
  const overlayWasOpenRef = useRef(false);
  const transcriptRef = useRef(null);
  const textareaRef = useRef(null);
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
    // Intentionally run once for this full-page chat route.
  }, []);

  useEffect(() => {
    const transcriptNode = transcriptRef.current;
    if (!transcriptNode) return;
    transcriptNode.scrollTo({
      top: transcriptNode.scrollHeight,
      behavior: hasMessages ? "smooth" : "auto",
    });
  }, [messages, hasMessages]);

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

    const response = await sendAskSnoozerMessage({
      message: content,
      history,
      referrerRoute,
    });

    const assistantMessage = {
      id: response.reply.id || createMessageId("assistant"),
      role: "assistant",
      content: response.reply.content,
      createdAt: response.reply.createdAt || nowIso(),
      status: response.status,
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
    setPending(false);

    if (response.voice?.speak && response.voice?.speech && typeof sayHud === "function") {
      sayHud({
        speech: response.voice.speech,
        captions: response.reply.content,
        state: "speaking",
        priority: "normal",
        ttlMs: 5000,
        actions: [],
      }).catch(() => {});
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

  function onComposerKeyDown(event) {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (!String(draft || "").trim()) return;
    event.preventDefault();
    if (!pending) {
      sendMessage(draft);
    }
  }

  const starterCards = useMemo(
    () =>
      STARTER_PROMPTS.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() => handlePromptClick(prompt)}
          className="rounded-[24px] border border-slate-200 bg-white/90 px-4 py-4 text-left text-sm font-semibold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:border-[#16315F]/25 hover:shadow-[0_16px_34px_rgba(15,23,42,0.08)]"
        >
          {prompt}
        </button>
      )),
    []
  );

  return (
    <section className="min-h-screen bg-[radial-gradient(circle_at_top,#eef4ff_0%,#f8fbff_34%,#ffffff_75%)] px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-[34px] border border-white/80 bg-white/85 p-5 shadow-[0_28px_80px_rgba(20,38,78,0.10)] backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#16315F]/10 bg-[#16315F]/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-[#16315F]">
                <Sparkles className="h-3.5 w-3.5" />
                Ask Snoozer
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900 md:text-5xl">
                Ask Snoozer
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 md:text-base">
                Get clear sleep guidance, product help, and next-step support.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <button
                type="button"
                onClick={() => navigate("/results")}
                className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                View Results
              </button>
              <button
                type="button"
                onClick={() => navigate("/pod/1")}
                className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Open Pod Builder
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 text-xs font-medium text-slate-500">
            <span className="rounded-full bg-slate-100 px-3 py-1.5">
              Sleep guidance
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5">
              Product help
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5">
              Session support
            </span>
            {lastAssistantMeta?.conversationId ? (
              <span className="rounded-full bg-[#FFF6E8] px-3 py-1.5 text-[#8A5A16]">
                Conversation {lastAssistantMeta.conversationId}
              </span>
            ) : null}
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-[34px] border border-white/80 bg-white/88 shadow-[0_28px_80px_rgba(20,38,78,0.08)] backdrop-blur">
            <div
              ref={transcriptRef}
              className="flex min-h-[56vh] flex-col gap-4 overflow-y-auto px-4 pb-4 pt-5 md:px-6 md:pb-6"
            >
              {!hasMessages ? (
                <div className="flex min-h-[50vh] flex-col justify-between gap-8">
                  <div className="rounded-[28px] border border-[#16315F]/10 bg-[linear-gradient(135deg,rgba(22,49,95,0.07),rgba(255,255,255,0.92))] p-5 md:p-6">
                    <div className="flex items-start gap-4">
                      <img
                        src="/snoozer-avatar.png"
                        alt="Snoozer"
                        className="h-14 w-14 rounded-2xl border border-white bg-white p-1 shadow-sm"
                      />
                      <div className="space-y-2">
                        <div className="text-lg font-black text-slate-900">
                          Start with a quick question.
                        </div>
                        <p className="max-w-2xl text-sm leading-6 text-slate-600">
                          Snoozer can help you compare comfort levels, understand
                          adjustable bases, explain your recommendation, or guide
                          you into the right next step without losing the showroom
                          flow.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
                      <MessageSquareText className="h-4 w-4 text-[#16315F]" />
                      Starter prompts
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">{starterCards}</div>
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
                      className={`max-w-[92%] rounded-[28px] px-4 py-4 shadow-sm md:max-w-[78%] ${
                        isAssistant
                          ? "border border-slate-200 bg-white text-slate-800"
                          : "bg-[#16315F] text-white"
                      }`}
                    >
                      {isAssistant ? (
                        <div className="mb-3 flex items-center gap-3">
                          <img
                            src="/snoozer-avatar.png"
                            alt="Snoozer"
                            className="h-10 w-10 rounded-2xl border border-slate-100 bg-[#F7FAFF] p-1"
                          />
                          <div>
                            <div className="text-sm font-black text-slate-900">
                              Snoozer
                            </div>
                            <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                              {message.status || "answered"}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <div className="whitespace-pre-wrap text-sm leading-6 md:text-[15px]">
                        {message.content}
                      </div>

                      {isAssistant && Array.isArray(message.chips) && message.chips.length ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {message.chips.map((chip) => (
                            <button
                              key={`${message.id}-${chip.label}-${chip.value}`}
                              type="button"
                              onClick={() => handleChip(chip)}
                              className="rounded-full border border-[#16315F]/12 bg-[#16315F]/5 px-3 py-2 text-xs font-semibold text-[#16315F] transition hover:bg-[#16315F]/10"
                            >
                              {chip.label}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {isAssistant &&
                      Array.isArray(message.actions) &&
                      message.actions.length ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {message.actions.map((action) => (
                            <button
                              key={`${message.id}-${action.label}`}
                              type="button"
                              onClick={() => handleAction(action)}
                              className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {isAssistant &&
                      Array.isArray(message.recommendations) &&
                      message.recommendations.length ? (
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
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
                                className="flex items-start gap-3 rounded-[22px] border border-slate-200 bg-slate-50/70 p-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
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
                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={() => handleRetry(message.retryPrompt)}
                            className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
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
                  <div className="rounded-[26px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-3">
                      <img
                        src="/snoozer-avatar.png"
                        alt="Snoozer"
                        className="h-10 w-10 rounded-2xl border border-slate-100 bg-[#F7FAFF] p-1"
                      />
                      <div>
                        <div className="text-sm font-black text-slate-900">Snoozer</div>
                        <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
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

            <div className="border-t border-slate-100 px-4 pb-4 pt-4 md:px-6 md:pb-6">
              <div className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-3 shadow-inner">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onComposerKeyDown}
                  onFocus={() => noteUserInteraction?.()}
                  rows={3}
                  placeholder="Ask about cooling, comfort, pods, sessions, or your recommendation..."
                  className="min-h-[96px] w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400"
                />
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs leading-5 text-slate-500">
                    Press Enter to send. Use Shift+Enter for a new line.
                  </div>
                  <button
                    type="button"
                    onClick={() => sendMessage(draft)}
                    disabled={!canSend}
                    className={buttonClass(canSend)}
                  >
                    Send
                    <ArrowUp className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-[28px] border border-white/80 bg-white/88 p-5 shadow-[0_20px_60px_rgba(20,38,78,0.08)] backdrop-blur">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                Good questions
              </div>
              <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
                <p>
                  Ask about firmness, sleeping hot, partner fit, adjustable base
                  benefits, or what to expect during a Snooze Session.
                </p>
                <p>
                  Snoozer can also explain why a recommendation showed up and point
                  you to the next route in the showroom flow.
                </p>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/80 bg-[#16315F] p-5 text-white shadow-[0_20px_60px_rgba(20,38,78,0.18)]">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-white/65">
                Quick routes
              </div>
              <div className="mt-4 grid gap-2">
                <button
                  type="button"
                  onClick={() => navigate("/assessment")}
                  className="rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-left text-sm font-semibold transition hover:bg-white/15"
                >
                  Start the assessment
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/results")}
                  className="rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-left text-sm font-semibold transition hover:bg-white/15"
                >
                  Review recommendations
                </button>
                <button
                  type="button"
                  onClick={() =>
                    navigate("/what-to-expect", { state: { from: ASK_SNOOZER_ROUTE } })
                  }
                  className="rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-left text-sm font-semibold transition hover:bg-white/15"
                >
                  Learn about Snooze Sessions
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
