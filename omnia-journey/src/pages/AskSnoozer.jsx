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
import { sendAskSnoozerMessage } from "@/lib/snoozer/askSnoozerPage";
import { useStore } from "@/lib/useStore";
import {
  ShowroomBrandMark,
  ShowroomCartBadge,
  ShowroomEyebrow,
  ShowroomFooterAction,
  ShowroomFooterDock,
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
    <div className="rounded-[28px] border border-[#dbe5ff] bg-white/96 p-3.5 shadow-[0_18px_40px_rgba(31,55,117,0.10)] md:p-4">
      <div className="flex gap-3">
        <div className="min-w-0 flex-1 rounded-[22px] border border-slate-200 bg-slate-50/80 px-3 py-2.5 shadow-inner">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onFocus={() => noteUserInteraction?.()}
            rows={3}
            placeholder="Ask about your recommendations, comfort, adjustable bases, policies, Snooze Codes, or what to try next."
            className="min-h-[84px] w-full resize-none bg-transparent text-[15px] leading-7 text-slate-800 outline-none placeholder:text-slate-400"
          />
        </div>

        <button
          type="button"
          onClick={() => onSend(draft)}
          disabled={!canSend}
          className={[
            "inline-flex w-[120px] shrink-0 items-center justify-center gap-2 self-end rounded-[20px] px-4 py-3 text-sm font-semibold transition",
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

function FooterActiveChip() {
  return (
    <div className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#d7e3ff] bg-[#eef4ff] px-4 py-2 text-sm font-extrabold text-[#2340b8] shadow-sm">
      <MessageSquareText className="h-4 w-4 shrink-0 text-[#2f57e8]" />
      <span>Ask Snoozer</span>
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
        chips: Array.isArray(response?.chips) ? response.chips : [],
        actions: Array.isArray(response?.actions) ? response.actions : [],
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
        setDraft("I need human help.");
        textareaRef.current?.focus();
        return;
      default:
        if (action?.target) navigate(action.target);
    }
  }

  function handleChip(chip) {
    noteUserInteraction?.();

    if (chip?.type === "route" && chip?.target) {
      navigate(chip.target);
      return;
    }

    if (chip?.type === "action") {
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

      <div className="mx-auto flex min-h-0 w-full max-w-[1240px] flex-1 flex-col overflow-hidden px-4 pb-2 pt-2 md:px-6 md:pb-3">
        <ShowroomFrame className="flex min-h-0 flex-1 flex-col overflow-hidden p-1.5 md:p-2">
          <ShowroomPanel className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:p-5" tone="soft">
            <div className="shrink-0">
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

              <p className="mt-3 max-w-3xl text-[0.9rem] leading-6 text-slate-600 md:text-[0.95rem]">
                Ask about your recommendations, comfort, adjustable bases, policies,
                Snooze Codes, or what to try next.
              </p>
            </div>

            <div className="mt-4 shrink-0">
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
            </div>

            <div className="mt-3 shrink-0 flex flex-wrap gap-2">
              {STARTER_CHIPS.map((item) => (
                <ChatStarterChip
                  key={item.label}
                  label={item.label}
                  onClick={() => handleStarterClick(item.prompt)}
                />
              ))}
            </div>

            <div
              ref={transcriptRef}
              className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-[26px] border border-white/85 bg-white/92 px-3 py-3 shadow-inner md:px-4 md:py-4"
            >
              {!messages.length ? (
                <div className="flex min-h-[220px] flex-1 items-center justify-center rounded-[22px] border border-dashed border-[#dbe5ff] bg-[#f8faff] px-6 text-center text-[0.96rem] font-medium text-slate-500">
                  Snoozer&apos;s response will appear here.
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
          </ShowroomPanel>
        </ShowroomFrame>

        <ShowroomFooterDock
          sticky={false}
          className="mt-2"
          label="Showroom Footer"
          sublabel="Chat stays active while you move through the showroom."
        >
          <FooterActiveChip />
          <ShowroomFooterAction
            icon={Compass}
            label="View Results"
            onClick={() => {
              noteUserInteraction?.();
              navigate("/results");
            }}
          />
          <ShowroomFooterAction
            icon={Headphones}
            label="Talk to Human"
            onClick={handleTalkToHuman}
          />
        </ShowroomFooterDock>
      </div>
    </ShowroomPageShell>
  );
}
