import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowUp, BedDouble, Check, ChevronRight, ExternalLink, Gift, Loader2, RefreshCcw, Scale, Search, ShoppingCart } from "lucide-react";

import { useSnoozer } from "@/Layout";
import { canMutateCart, canNavigateTo, filterDeviceActions, isDeviceActionAllowed } from "@/device/deviceActionGuards";
import { emitDeviceActiveResponse, emitDeviceHumanHelp } from "@/device/deviceActivityTracker";
import { makePodRoute } from "@/device/podRouteUtils";
import { useDeviceMode } from "@/device/useDeviceMode";
import { getRewardSummary } from "@/lib/api";
import { createShowroomCommand, sendAskSnoozerMessage, sendAskSnoozerQualityTiming } from "@/lib/snoozer/askSnoozerPage";
import { setActiveJourney } from "@/state/sessionStore";
import {
  ASK_SNOOZER_VOICE_TIMING_EVENT,
  buildAskSnoozerDisplayTiming,
  createAskSnoozerTurnTiming,
  markAskSnoozerTiming,
} from "@/lib/snoozer/askSnoozerPerformance.mjs";
import { buildComparePrompt, buildProductAddAction, cartItemCount, formatProductPrice } from "@/lib/snoozer/askSnoozerStationContract.mjs";
import { useStore } from "@/lib/useStore";
import { useSessionStore } from "@/state/sessionStore";
import { useShowroomZoneExperience } from "@/iot/useShowroomZoneExperience";
import CommerceHeader from "@/components/showroom/CommerceHeader";
import { ShowroomEyebrow, ShowroomFrame, ShowroomPageShell, ShowroomPanel, ShowroomTopRail } from "@/components/showroom/ShowroomPrimitives";

const QUICK_STARTERS = [
  { label: "Compare Products", helper: "See side-by-side differences.", command: createShowroomCommand("compare_products", { productHandles: [] }), icon: Scale },
  { label: "What’s in My Cart?", helper: "Review what you’ve added.", command: createShowroomCommand("analyze_cart"), icon: ShoppingCart },
  { label: "Find a Product", helper: "Search what we carry.", command: createShowroomCommand("browse_products", { offset: 0 }), icon: Search },
  { label: "Motion Base Help", helper: "Understand features and options.", command: createShowroomCommand("motion_base_features"), icon: BedDouble },
  { label: "Show My Rewards", helper: "Check points and progress.", command: createShowroomCommand("find_rewards"), icon: Gift, wide: true },
];

function createMessageId(prefix) {
  if (globalThis?.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  try { return new Date().toISOString(); } catch { return String(Date.now()); }
}

function messageToHistoryEntry(message) {
  return { role: message.role, content: message.content, createdAt: message.createdAt || nowIso() };
}

function composeFallbackReply() {
  return "I had trouble reaching Snoozer for a moment. Try again when you are ready.";
}

function formatAssistantStatus(status) {
  const value = String(status || "answered").trim();
  if (value === "fallback") return "temporary issue";
  if (!value) return "answered";
  return value.replace(/_/g, " ");
}

function extractResponseContent(response) {
  const candidates = [response?.reply?.content, typeof response?.reply === "string" ? response.reply : "", response?.answer, response?.speech, response?.captions, response?.message];
  const match = candidates.find((value) => String(value || "").trim());
  return match ? String(match).trim() : composeFallbackReply();
}

function RewardsPill({ status, points, onClick }) {
  const detail = status === "loading" ? "Checking…" : status === "ready" && Number.isFinite(points) ? `${points.toLocaleString("en-US")} pts` : "View status";
  return (
    <button type="button" onClick={onClick} aria-label="Find Rewards" className="inline-flex items-center gap-2 rounded-[20px] border border-indigo-100/90 bg-white/96 px-3 py-2 text-left shadow-[0_14px_32px_rgba(47,72,137,0.14)] backdrop-blur transition hover:shadow-[0_18px_40px_rgba(47,72,137,0.18)]">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#eef3ff] text-[#2f57e8]"><Gift className="h-[1.125rem] w-[1.125rem]" /></span>
      <span className="leading-tight"><span className="block text-[11px] font-semibold text-slate-500">Rewards</span><span className="mt-0.5 block text-[0.95rem] font-black text-slate-900">{detail}</span></span>
    </button>
  );
}

function QuickStarter({ item, onClick }) {
  const Icon = item.icon;
  return (
    <button data-ask-quick-starter="true" type="button" onClick={onClick} className={`${item.wide ? "col-span-2" : ""} group flex min-h-[56px] items-center gap-2.5 rounded-[16px] border border-[#dbe5ff] bg-white/82 px-2.5 py-2 text-left shadow-[0_8px_20px_rgba(47,72,137,0.06)] transition hover:-translate-y-0.5 hover:border-[#bfcfff] hover:bg-white hover:shadow-[0_12px_26px_rgba(47,72,137,0.1)] focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 motion-reduce:transform-none`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[#eef3ff] text-[#2f57e8]"><Icon className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-black leading-4 text-slate-900">{item.label}</span>
        <span data-ask-quick-starter-helper="true" className="mt-0.5 hidden text-[10px] leading-3.5 text-slate-500 xl:block">{item.helper}</span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#2f57e8] motion-reduce:transform-none" />
    </button>
  );
}

function ChatComposer({ draft, pending, canSend, textareaRef, onChange, onKeyDown, onSend, noteUserInteraction }) {
  return (
    <div data-ask-composer="true" className="rounded-[20px] border border-[#cfdcff] bg-white/96 p-2 shadow-[0_14px_34px_rgba(31,55,117,0.1)]">
      <div className="flex items-end gap-2.5">
        <div className="min-w-0 flex-1 rounded-[15px] border border-slate-200 bg-slate-50/80 px-3 py-1.5 shadow-inner focus-within:border-[#9fb4ff] focus-within:ring-4 focus-within:ring-blue-100">
          <textarea ref={textareaRef} aria-label="Ask Snoozer" value={draft} onChange={onChange} onKeyDown={onKeyDown} onFocus={() => noteUserInteraction?.()} rows={1} placeholder="Ask Snoozer anything about your sleep setup…" className="block min-h-[38px] max-h-[82px] w-full resize-none overflow-y-auto bg-transparent py-2 text-[15px] leading-[22px] text-slate-800 outline-none placeholder:text-slate-400" />
        </div>
        <button type="button" onClick={() => onSend(draft)} disabled={!canSend} className={`inline-flex h-[52px] min-w-[104px] shrink-0 items-center justify-center gap-2 rounded-[15px] px-4 text-sm font-black transition focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 ${canSend ? "bg-[#2f57e8] text-white shadow-[0_12px_26px_rgba(47,87,232,0.24)] hover:bg-[#274bd0]" : "bg-slate-200 text-slate-500"}`}>
          {pending ? "Sending…" : "Send"}<ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ProductCard({ item, siblings, imageFailed, mutationPending, canAdd, canView, onImageError, onAdd, onView, onCompare, onChoose }) {
  const price = formatProductPrice(item);
  const addAction = canAdd && item?.suppressAddToCart !== true ? buildProductAddAction(item) : null;
  return (
    <div data-ask-product-card="true" className="flex min-h-[252px] flex-col overflow-hidden rounded-[20px] border border-[#d8e2fb] bg-white text-left shadow-[0_10px_28px_rgba(38,62,124,0.08)]">
      <div className="grid min-h-[112px] grid-cols-[116px_minmax(0,1fr)] gap-3 border-b border-slate-100 bg-[#f5f8ff] p-3">
        <div className="h-[106px] w-[116px] shrink-0 overflow-hidden rounded-[16px] border border-white bg-white shadow-sm">
          {item.imageUrl && !imageFailed ? <img src={item.imageUrl} alt={item.title} onError={onImageError} className="h-full w-full object-contain p-2" /> : <div className="flex h-full w-full items-center justify-center px-2 text-center text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">{item.type || "Image unavailable"}</div>}
        </div>
        <div className="min-w-0 py-1">
          <div className="text-[15px] font-black leading-5 text-slate-900">{item.title}</div>
          {item.subtitle ? <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item.subtitle}</div> : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {price ? <span className="text-[15px] font-black text-[#2f57e8]">{price}</span> : null}
            {item.available === true ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><Check className="h-3 w-3" />Available</span> : item.available === false ? <span className="font-semibold text-slate-500">Unavailable</span> : null}
          </div>
          {item.selectedOptions?.length ? <div className="mt-1 text-[11px] text-slate-500">{item.selectedOptions.map((option) => `${option.name}: ${option.value}`).join(" · ")}</div> : null}
        </div>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2 p-3">
        {addAction ? <button type="button" disabled={mutationPending} onClick={() => onAdd(addAction)} className="col-span-2 min-h-11 rounded-[13px] bg-[#2f57e8] px-3 py-2 text-xs font-black text-white transition hover:bg-[#274bd0] focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:opacity-50">{mutationPending ? "Adding…" : "Add to Cart"}</button> : canAdd && item.available === true && item.variants?.length > 1 ? <button type="button" onClick={onChoose} className="col-span-2 min-h-11 rounded-[13px] border border-[#b9c9fa] bg-white px-3 py-2 text-xs font-black text-[#2346c6] hover:bg-[#f5f8ff] focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200">Choose Size</button> : null}
        {canView && item.url ? <button type="button" onClick={onView} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-[13px] border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200">View Details <ExternalLink className="h-3 w-3" /></button> : null}
        {item.handle ? <button type="button" onClick={() => onCompare(item, siblings)} className={`${canView && item.url ? "" : "col-span-2"} min-h-11 rounded-[13px] border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200`}>Compare</button> : null}
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
  const handledPrefillLocationRef = useRef("");
  const humanHelpTimerRef = useRef(null);

  const cart = useStore((state) => state.cart || []);
  const addToCart = useStore((state) => state.addToCart);
  const addLinesToAuthoritativeCart = useStore((state) => state.addLinesToAuthoritativeCart);
  const cartMutationPending = useStore((state) => state.cartMutationPending);
  const shopperId = useSessionStore((state) => state?.shopperId || "");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [lastFailedRequest, setLastFailedRequest] = useState(null);
  const [failedRecommendationImages, setFailedRecommendationImages] = useState({});
  const [rewardState, setRewardState] = useState({ status: "idle", points: null });

  const snoozer = useSnoozer();
  const sayHud = snoozer?.sayHud;
  const noteUserInteraction = snoozer?.noteUserInteraction;
  const supersedeConversationalSpeech = snoozer?.supersedeConversationalSpeech;
  const closeSnoozer = snoozer?.closeSnoozer;
  const openSnoozer = snoozer?.openSnoozer;
  const hudOpen = snoozer?.hud?.open;
  const zoneExperience = useShowroomZoneExperience({ sourceSurface: "ask-snoozer" });

  const canSend = !pending && String(draft || "").trim().length > 0;
  const authoritativeCartCount = useMemo(() => cartItemCount(cart), [cart]);
  const latestAssistantId = useMemo(() => [...messages].reverse().find((message) => message.role === "assistant")?.id || null, [messages]);
  const latestUserId = useMemo(() => [...messages].reverse().find((message) => message.role === "user")?.id || null, [messages]);
  const cartMutationAllowed = canMutateCart(device);
  const devicePodRoute = makePodRoute(device?.podId) || "/pod/pod-1";
  const referrerRoute = location.state && typeof location.state === "object" ? location.state.from || null : null;

  useEffect(() => {
    let alive = true;
    if (!shopperId || shopperId === "guest") {
      setRewardState({ status: "idle", points: null });
      return () => { alive = false; };
    }
    setRewardState({ status: "loading", points: null });
    getRewardSummary().then((summary) => {
      if (!alive) return;
      const points = Number(summary?.availableSleepPoints);
      setRewardState({ status: Number.isFinite(points) ? "ready" : "unavailable", points: Number.isFinite(points) ? points : null });
    }).catch(() => { if (alive) setRewardState({ status: "unavailable", points: null }); });
    return () => { alive = false; };
  }, [shopperId]);

  useEffect(() => {
    const previousValue = window.__SNOOZE_DISABLE_WIDGET;
    window.__SNOOZE_DISABLE_WIDGET = true;
    document.body.classList.add("no-global-chat");
    return () => { window.__SNOOZE_DISABLE_WIDGET = previousValue; document.body.classList.remove("no-global-chat"); };
  }, []);

  useEffect(() => {
    const wasOpen = hudOpen !== false;
    closeSnoozer?.();
    return () => { if (wasOpen) openSnoozer?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) {
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      node.scrollTo({ top: node.scrollHeight, behavior: messages.length && !reduceMotion ? "smooth" : "auto" });
    }
  }, [messages, pending]);

  useEffect(() => { emitDeviceActiveResponse(pending, { reason: "activeResponse" }); }, [pending]);
  useEffect(() => {
    const recordVoiceTiming = (event) => {
      if (!event?.detail) return;
      sendAskSnoozerQualityTiming(event.detail).catch(() => {});
    };
    window.addEventListener(ASK_SNOOZER_VOICE_TIMING_EVENT, recordVoiceTiming);
    return () => window.removeEventListener(ASK_SNOOZER_VOICE_TIMING_EVENT, recordVoiceTiming);
  }, []);
  useEffect(() => () => {
    if (humanHelpTimerRef.current) window.clearTimeout(humanHelpTimerRef.current);
    emitDeviceHumanHelp(false, { reason: "humanHelp" });
    emitDeviceActiveResponse(false, { reason: "activeResponse" });
  }, []);

  useEffect(() => {
    const state = location.state && typeof location.state === "object" ? location.state : null;
    const prefill = typeof state?.prefill === "string" ? state.prefill.trim() : "";
    if (!prefill) return;
    setDraft((current) => (String(current || "").trim() ? current : prefill));
    if (state?.autoSend && handledPrefillLocationRef.current !== location.key) {
      handledPrefillLocationRef.current = location.key;
      window.setTimeout(() => sendMessage(prefill), 0);
    }
  }, [location.key, location.state]);

  function filterResponseChips(chips = []) {
    if (!Array.isArray(chips)) return [];
    return chips.filter((chip) => {
      if (chip?.type === "route" && chip?.target) return canNavigateTo(device, chip.target);
      if (chip?.type === "action" || chip?.target) return isDeviceActionAllowed(device, chip);
      return true;
    });
  }

  async function sendMessage(rawMessage, { command = null, comparisonProductHandles = [] } = {}) {
    const content = String(rawMessage || "").trim();
    if (!content || pending) return;
    const turnTiming = createAskSnoozerTurnTiming(createMessageId("ask_timing"));
    const speechSupersession = typeof supersedeConversationalSpeech === "function"
      ? Promise.resolve(supersedeConversationalSpeech()).catch(() => null)
      : Promise.resolve(null);
    noteUserInteraction?.();
    const userMessage = { id: createMessageId("user"), role: "user", content, createdAt: nowIso() };
    const history = [...messages.map(messageToHistoryEntry), messageToHistoryEntry(userMessage)];
    setMessages((current) => [...current, userMessage]);
    const retryRequest = { message: content, command, comparisonProductHandles };
    setPending(true); setLastFailedRequest(null); setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    window.requestAnimationFrame(() => markAskSnoozerTiming(turnTiming, "firstFeedbackAt"));
    try {
      const response = await sendAskSnoozerMessage({
        message: content, command, history, referrerRoute, comparisonProductHandles,
        deviceContext: { deviceId: device?.deviceId || null, deviceMode: device?.deviceMode || null, podId: device?.podId || null, zoneId: device?.zoneId || null, proximity: zoneExperience.proximityContext },
      });
      markAskSnoozerTiming(turnTiming, "responseReceivedAt");
      if (response?.activeJourney) setActiveJourney(response.activeJourney);
      const assistantMessage = {
        id: response?.reply?.id || createMessageId("assistant"), role: "assistant", content: extractResponseContent(response), createdAt: response?.reply?.createdAt || nowIso(),
        status: response?.status || "answered", chips: filterResponseChips(response?.chips), actions: filterDeviceActions(device, response?.actions),
        recommendations: Array.isArray(response?.recommendations) ? response.recommendations : [], canRetry: response?.ok === false, retryRequest,
      };
      setMessages((current) => [...current, assistantMessage]);
      window.requestAnimationFrame(() => {
        markAskSnoozerTiming(turnTiming, "displayAt");
        sendAskSnoozerQualityTiming(buildAskSnoozerDisplayTiming(turnTiming, response)).catch(() => {});
      });
      setLastFailedRequest(response?.ok === false ? retryRequest : null);
      if (response?.voice?.speak && response?.voice?.speech && typeof sayHud === "function") {
        await speechSupersession;
        sayHud({
          speech: response.voice.speech,
          captions: assistantMessage.content,
          state: "speaking",
          priority: "normal",
          ttlMs: 5000,
          actions: [],
          metadata: {
            askSnoozerTimingId: turnTiming.id,
            backendRequestId: response?.meta?.requestId || null,
            requestStartedAt: turnTiming.requestStartedAt,
            responseReceivedAt: turnTiming.responseReceivedAt,
            responsePolicyVersion: response?.meta?.quality?.responsePolicyVersion || "baseline-v1",
            audioScope: "ask_snoozer_conversation",
            conversationTurnId: turnTiming.id,
          },
        }).catch(() => {});
      }
    } catch {
      setMessages((current) => [...current, { id: createMessageId("assistant"), role: "assistant", content: composeFallbackReply(), createdAt: nowIso(), status: "fallback", chips: [], actions: [], recommendations: [], canRetry: true, retryRequest }]);
      setLastFailedRequest(retryRequest);
    } finally { setPending(false); }
  }

  async function handleAction(action) {
    noteUserInteraction?.();
    if (!isDeviceActionAllowed(device, action)) return;
    if (action?.type === "add_to_cart") {
      if (!cartMutationAllowed || cartMutationPending) return;
      let success = false;
      if (Array.isArray(action?.payload?.lines) && action.payload.lines.length) {
        try {
          await addLinesToAuthoritativeCart({ lines: action.payload.lines, sourcePage: "ask-snoozer" });
          success = true;
        } catch {
          success = false;
        }
      } else {
        success = await addToCart(action.payload);
      }
      const addedLabel = action?.payload?.lines?.length > 1
        ? "Your complete setup"
        : action.payload?.title || "That product";
      setMessages((current) => [...current, { id: createMessageId("assistant"), role: "assistant", content: success ? `${addedLabel} was added to your cart.` : "I could not confirm that cart addition. Your cart was not changed; please try again.", createdAt: nowIso(), status: success ? "answered" : "warning", chips: [], actions: [], recommendations: [], canRetry: false }]);
      return;
    }
    switch (action?.type) {
      case "navigate": if (action.target) navigate(action.target); return;
      case "start_assessment": navigate("/assessment"); return;
      case "open_builder": navigate(devicePodRoute); return;
      case "view_recommendation": navigate(action?.target || "/results"); return;
      case "request_human": handleTalkToHuman(); return;
      default: if (action?.target) navigate(action.target);
    }
  }

  function handleChip(chip) {
    noteUserInteraction?.();
    if (chip?.type === "route" && chip?.target) { if (canNavigateTo(device, chip.target)) navigate(chip.target); return; }
    if (chip?.type === "action") { if (isDeviceActionAllowed(device, chip)) handleAction({ type: chip.value === "I need human help" ? "request_human" : "none", label: chip.label, target: chip.target }); return; }
    if (chip?.type === "command" && chip?.command) { sendMessage(chip.label, { command: chip.command }); return; }
    sendMessage(chip?.value || chip?.label);
  }

  function handleTalkToHuman() {
    noteUserInteraction?.(); emitDeviceHumanHelp(true, { reason: "humanHelp" });
    if (humanHelpTimerRef.current) window.clearTimeout(humanHelpTimerRef.current);
    humanHelpTimerRef.current = window.setTimeout(() => emitDeviceHumanHelp(false, { reason: "humanHelp" }), 90000);
    setDraft("I need human help."); textareaRef.current?.focus();
  }

  function onComposerKeyDown(event) {
    if (event.key !== "Enter" || event.shiftKey || !String(draft || "").trim()) return;
    event.preventDefault(); if (!pending) sendMessage(draft);
  }

  function handleDraftChange(event) {
    setDraft(event.target.value);
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(event.target.scrollHeight, 82)}px`;
  }

  return (
    <ShowroomPageShell data-ask-snoozer-workspace="true" className="h-[100dvh] min-h-0 overflow-hidden pb-[82px] pt-2 md:pt-2">
      <ShowroomTopRail className="w-full shrink-0 items-center pt-0 md:pt-0">
        <CommerceHeader
          active="ask"
          cartCount={authoritativeCartCount}
          rewards={<RewardsPill status={rewardState.status} points={rewardState.points} onClick={() => sendMessage("Find Rewards", { command: createShowroomCommand("find_rewards") })} />}
        />
      </ShowroomTopRail>

      <div className="mx-auto flex min-h-0 w-full max-w-[1380px] flex-1 flex-col px-4 pt-2 md:px-6">
        <ShowroomFrame className="flex min-h-0 flex-1 overflow-hidden p-1.5">
          <ShowroomPanel className="min-h-0 flex-1 overflow-hidden p-0" tone="soft">
            <div className="grid h-full min-h-0 grid-cols-[minmax(312px,35%)_minmax(0,65%)]">
              <aside data-ask-section="advisor" className="flex min-h-0 flex-col overflow-hidden border-r border-[#dbe5ff] bg-[linear-gradient(160deg,rgba(255,255,255,0.96),rgba(240,245,255,0.9))] p-4 xl:p-5">
                <div data-ask-advisor-intro="true" className="shrink-0 text-center">
                  <div data-ask-advisor-avatar="true" className="mx-auto flex h-[150px] w-[170px] items-center justify-center rounded-[38px] border border-white/90 bg-[radial-gradient(circle_at_50%_34%,rgba(255,255,255,1),rgba(230,238,255,0.9))] shadow-[0_18px_42px_rgba(46,74,138,0.13)] xl:h-[164px] xl:w-[184px]">
                    <img src="/snoozer-avatar.png" alt="Snoozer" className="h-[142px] w-[142px] object-contain xl:h-[156px] xl:w-[156px]" />
                  </div>
                  <ShowroomEyebrow className="mt-3 text-[0.7rem] tracking-[0.2em]">Ask Snoozer</ShowroomEyebrow>
                  <h1 data-ask-advisor-title="true" className="mt-1 text-[1.55rem] font-black leading-[1.02] tracking-tight text-slate-950 xl:text-[1.72rem]">What can I help you figure out?</h1>
                  <p data-ask-advisor-copy="true" className="mx-auto mt-2 max-w-[360px] text-[0.78rem] leading-5 text-slate-600 xl:text-[0.84rem]">I can help you compare products, understand features, check your cart, find rewards, and more.</p>
                </div>

                <div data-ask-quick-starters="true" className="mt-3 min-h-0 flex-1">
                  <div data-ask-quick-starters-label="true" className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Useful things to ask</div>
                  <div data-ask-quick-starters-grid="true" role="group" aria-label="Quick Starters" className="grid grid-cols-2 gap-2">
                    {QUICK_STARTERS.map((item) => <QuickStarter key={item.label} item={item} onClick={() => sendMessage(item.label, { command: item.command })} />)}
                  </div>
                </div>
              </aside>

              <section data-ask-section="answer-workspace" className="flex min-h-0 flex-col bg-white/76">
                {shopperId && shopperId !== "guest" ? <div className="flex shrink-0 justify-end px-4 pt-3 md:px-5"><span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold text-emerald-700">Session connected</span></div> : null}

                <div ref={transcriptRef} data-ask-section="transcript" role="region" aria-label="Ask Snoozer answers" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-blue-100 md:px-5">
                  {!messages.length && !pending ? (
                    <div data-ask-empty-state="true" className="flex h-full min-h-[220px] items-center justify-center px-6 text-center">
                      <div className="max-w-sm">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] border border-[#dbe5ff] bg-[#f3f6ff] text-[#2f57e8]"><Search className="h-6 w-6" /></div>
                        <h2 className="mt-4 text-lg font-black text-slate-900">Ask me anything about your sleep setup.</h2>
                        <p className="mt-2 text-sm leading-6 text-slate-500">Your answer, helpful next steps, and product options will appear here.</p>
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    {messages.length > 2 ? <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Earlier</div> : null}
                    {messages.map((message) => {
                      const isAssistant = message.role === "assistant";
                      const isLatestAssistant = isAssistant && message.id === latestAssistantId;
                      const isLatestUser = !isAssistant && message.id === latestUserId;
                      const isCurrent = isLatestAssistant || isLatestUser;
                      if (!isCurrent) {
                        return (
                          <article key={message.id} data-ask-history="earlier" className="rounded-[14px] border border-slate-200/80 bg-slate-50/76 px-3 py-2.5 text-slate-600">
                            <div className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">{isAssistant ? "Snoozer" : "You asked"}</div>
                            <div className="mt-1 whitespace-pre-wrap text-xs leading-5">{message.content}</div>
                          </article>
                        );
                      }
                      if (!isAssistant) {
                        return (
                          <article key={message.id} data-ask-message="question" className="rounded-[16px] border-l-4 border-[#9db2fa] bg-[#f5f7fd] px-4 py-3">
                            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#5d79df]">You asked</div>
                            <div className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">{message.content}</div>
                          </article>
                        );
                      }
                      const warning = message.status === "warning" || message.status === "fallback";
                      return (
                        <article key={message.id} data-ask-message="latest-answer" className={`rounded-[22px] border px-4 py-4 shadow-[0_14px_34px_rgba(40,63,126,0.1)] md:px-5 ${warning ? "border-amber-200 bg-amber-50/80" : "border-[#d7e1fb] bg-white"}`}>
                          <div className="mb-3 flex items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-[#eef3ff]"><img src="/snoozer-avatar.png" alt="" className="h-10 w-10 object-contain" /></div>
                            <div><div className="text-sm font-black text-slate-900">Snoozer</div><div className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">{formatAssistantStatus(message.status)}</div></div>
                          </div>
                          <div className="whitespace-pre-wrap text-[15px] leading-6 text-slate-700">{message.content}</div>
                          {message.chips?.length ? <div className="mt-4"><div className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Suggested next questions</div><div className="flex flex-wrap gap-2">{message.chips.map((chip) => <button key={`${message.id}-${chip.label}-${chip.value}`} type="button" onClick={() => handleChip(chip)} className="min-h-11 rounded-[13px] border border-[#cbd8ff] bg-[#f5f8ff] px-3 py-2 text-xs font-bold text-[#2346c6] hover:bg-[#eaf0ff] focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200">{chip.label}</button>)}</div></div> : null}
                          {message.actions?.length ? <div className="mt-4"><div className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Suggested actions</div><div className="flex flex-wrap gap-2">{message.actions.map((action) => <button key={`${message.id}-${action.label}`} type="button" disabled={action.type === "add_to_cart" && cartMutationPending} onClick={() => handleAction(action)} className="min-h-11 rounded-[13px] border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:opacity-50">{action.label}</button>)}</div></div> : null}
                          {message.recommendations?.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">{message.recommendations.map((item) => {
                            const cardKey = `${message.id}-${item.id}`;
                            const canView = Boolean(item.url?.startsWith("/") && canNavigateTo(device, item.url));
                            return <ProductCard key={cardKey} item={item} siblings={message.recommendations} imageFailed={Boolean(failedRecommendationImages[cardKey])} mutationPending={cartMutationPending} canAdd={cartMutationAllowed} canView={canView} onImageError={() => setFailedRecommendationImages((current) => ({ ...current, [cardKey]: true }))} onAdd={handleAction} onView={() => { noteUserInteraction?.(); if (canView) navigate(item.url); }} onCompare={(selected, siblings) => {
                              const productHandles = [selected?.handle, ...(siblings || []).map((candidate) => candidate?.handle)]
                                .filter((handle, index, handles) => handle && handles.indexOf(handle) === index)
                                .slice(0, 2);
                              sendMessage(buildComparePrompt(selected, siblings), {
                                command: createShowroomCommand("compare_products", { productHandles: productHandles.length === 2 ? productHandles : [] }),
                              });
                            }} onChoose={() => sendMessage("Choose Size", { command: createShowroomCommand("product_sizes", { productHandle: item.handle }) })} />;
                          })}</div> : null}
                          {message.canRetry ? <button type="button" onClick={() => {
                            const request = message.retryRequest || lastFailedRequest;
                            if (request?.message) sendMessage(request.message, { command: request.command || null, comparisonProductHandles: request.comparisonProductHandles || [] });
                          }} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-[13px] border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-200"><RefreshCcw className="h-3.5 w-3.5" /> Retry</button> : null}
                        </article>
                      );
                    })}
                  </div>

                  {pending ? <div data-ask-thinking="true" role="status" aria-live="polite" className="mt-3 rounded-[18px] border border-[#d7e1fb] bg-white px-4 py-3.5 shadow-sm"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#eef3ff]"><img src="/snoozer-avatar.png" alt="" className="h-9 w-9 object-contain" /></div><div><div className="text-sm font-black text-slate-900">Snoozer is thinking…</div><div className="mt-0.5 inline-flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> Working on that.</div></div></div></div> : null}
                </div>

                <section data-ask-section="composer" className="shrink-0 border-t border-[#dbe5ff] bg-white/94 px-4 py-3 md:px-5">
                  <ChatComposer draft={draft} pending={pending} canSend={canSend} textareaRef={textareaRef} onChange={handleDraftChange} onKeyDown={onComposerKeyDown} onSend={sendMessage} noteUserInteraction={noteUserInteraction} />
                </section>
              </section>
            </div>
          </ShowroomPanel>
        </ShowroomFrame>
      </div>
    </ShowroomPageShell>
  );
}
