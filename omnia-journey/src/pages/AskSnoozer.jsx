import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowUp, BedDouble, Check, ChevronRight, ExternalLink, Gift, Loader2, RefreshCcw, Scale, Search, ShoppingCart } from "lucide-react";

import { useSnoozer } from "@/Layout";
import { canMutateCart, canNavigateTo, canViewCart, filterDeviceActions, isDeviceActionAllowed } from "@/device/deviceActionGuards";
import { emitDeviceActiveResponse, emitDeviceHumanHelp } from "@/device/deviceActivityTracker";
import { makePodRoute } from "@/device/podRouteUtils";
import { useDeviceMode } from "@/device/useDeviceMode";
import { getRewardSummary } from "@/lib/api";
import { sendAskSnoozerMessage } from "@/lib/snoozer/askSnoozerPage";
import { buildComparePrompt, buildProductAddAction, cartItemCount, formatProductPrice } from "@/lib/snoozer/askSnoozerStationContract.mjs";
import { useStore } from "@/lib/useStore";
import { useSessionStore } from "@/state/sessionStore";
import { useShowroomZoneExperience } from "@/iot/useShowroomZoneExperience";
import { ShowroomCartBadge, ShowroomDownstreamHeader, ShowroomEyebrow, ShowroomFrame, ShowroomPageShell, ShowroomPanel, ShowroomTopRail } from "@/components/showroom/ShowroomPrimitives";

const QUICK_STARTERS = [
  { label: "Find Rewards", prompt: "Find Rewards", icon: Gift },
  { label: "Analyze My Cart", prompt: "Analyze My Cart", icon: ShoppingCart },
  { label: "Compare Products", prompt: "Compare Products", icon: Scale },
  { label: "Motion Base Features", prompt: "Motion Base Features", icon: BedDouble },
  { label: "Browse Products", prompt: "Browse Products", icon: Search },
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
  return value ? value.replace(/_/g, " ") : "answered";
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
    <button type="button" onClick={onClick} className="group flex min-h-[52px] items-center gap-3 rounded-[18px] border border-[#dbe5ff] bg-white/84 px-3 py-2.5 text-left shadow-[0_10px_24px_rgba(47,72,137,0.07)] transition hover:-translate-y-0.5 hover:border-[#bfcfff] hover:bg-white hover:shadow-[0_14px_30px_rgba(47,72,137,0.11)]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#eef3ff] text-[#2f57e8]"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1 text-[13px] font-extrabold leading-4 text-[#16315F]">{item.label}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#2f57e8]" />
    </button>
  );
}

function ChatComposer({ draft, pending, canSend, textareaRef, onChange, onKeyDown, onSend, noteUserInteraction }) {
  return (
    <div className="rounded-[24px] border border-[#dbe5ff] bg-white/96 p-3 shadow-[0_18px_40px_rgba(31,55,117,0.10)] md:p-3.5">
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1 rounded-[20px] border border-slate-200 bg-slate-50/80 px-3 py-2 shadow-inner">
          <textarea ref={textareaRef} value={draft} onChange={onChange} onKeyDown={onKeyDown} onFocus={() => noteUserInteraction?.()} rows={2} placeholder="Ask about products, rewards, your cart, sleep tips, or what to try next." className="min-h-[58px] w-full resize-none bg-transparent text-[15px] leading-6 text-slate-800 outline-none placeholder:text-slate-400" />
        </div>
        <button type="button" onClick={() => onSend(draft)} disabled={!canSend} className={`inline-flex h-[54px] w-[108px] shrink-0 items-center justify-center gap-2 rounded-[18px] px-4 text-sm font-semibold transition ${canSend ? "bg-[#16315F] text-white shadow-[0_14px_28px_rgba(22,49,95,0.18)] hover:bg-[#102749]" : "bg-slate-200 text-slate-500"}`}>
          {pending ? "Sending…" : "Send"}<ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ProductCard({ item, siblings, imageFailed, mutationPending, canAdd, canView, onImageError, onAdd, onView, onCompare, onChoose }) {
  const price = formatProductPrice(item);
  const addAction = canAdd ? buildProductAddAction(item) : null;
  return (
    <div className="rounded-[18px] border border-slate-200 bg-slate-50/70 p-3 text-left">
      <div className="flex items-start gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white">
          {item.imageUrl && !imageFailed ? <img src={item.imageUrl} alt={item.title} onError={onImageError} className="h-full w-full object-contain p-1" /> : <div className="flex h-full w-full items-center justify-center text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">{item.type}</div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-slate-900">{item.title}</div>
          {item.subtitle ? <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item.subtitle}</div> : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {price ? <span className="font-extrabold text-[#16315F]">{price}</span> : null}
            {item.available === true ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><Check className="h-3 w-3" />Available</span> : item.available === false ? <span className="font-semibold text-slate-500">Unavailable</span> : null}
          </div>
          {item.selectedOptions?.length ? <div className="mt-1 text-[11px] text-slate-500">{item.selectedOptions.map((option) => `${option.name}: ${option.value}`).join(" · ")}</div> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {addAction ? <button type="button" disabled={mutationPending} onClick={() => onAdd(addAction)} className="rounded-full bg-[#16315F] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#102749] disabled:opacity-50">{mutationPending ? "Adding…" : "Add to Cart"}</button> : canAdd && item.available === true && item.variants?.length > 1 ? <button type="button" onClick={onChoose} className="rounded-full border border-[#c9d7ff] bg-white px-3 py-1.5 text-xs font-bold text-[#16315F] hover:bg-[#f5f8ff]">Choose Size</button> : null}
        {canView && item.url ? <button type="button" onClick={onView} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">View Details <ExternalLink className="h-3 w-3" /></button> : null}
        {item.handle ? <button type="button" onClick={() => onCompare(buildComparePrompt(item, siblings))} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Compare</button> : null}
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
  const cartMutationPending = useStore((state) => state.cartMutationPending);
  const shopperId = useSessionStore((state) => state?.shopperId || "");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [lastFailedPrompt, setLastFailedPrompt] = useState("");
  const [failedRecommendationImages, setFailedRecommendationImages] = useState({});
  const [rewardState, setRewardState] = useState({ status: "idle", points: null });

  const snoozer = useSnoozer();
  const sayHud = snoozer?.sayHud;
  const noteUserInteraction = snoozer?.noteUserInteraction;
  const closeSnoozer = snoozer?.closeSnoozer;
  const openSnoozer = snoozer?.openSnoozer;
  const hudOpen = snoozer?.hud?.open;
  const zoneExperience = useShowroomZoneExperience({ sourceSurface: "ask-snoozer" });

  const canSend = !pending && String(draft || "").trim().length > 0;
  const authoritativeCartCount = useMemo(() => cartItemCount(cart), [cart]);
  const showCommerceAffordances = canViewCart(device);
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
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: messages.length ? "smooth" : "auto" });
  }, [messages, pending]);

  useEffect(() => { emitDeviceActiveResponse(pending, { reason: "activeResponse" }); }, [pending]);
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

  async function sendMessage(rawMessage, { comparisonProductHandles = [] } = {}) {
    const content = String(rawMessage || "").trim();
    if (!content || pending) return;
    noteUserInteraction?.();
    const userMessage = { id: createMessageId("user"), role: "user", content, createdAt: nowIso() };
    const history = [...messages.map(messageToHistoryEntry), messageToHistoryEntry(userMessage)];
    setMessages((current) => [...current, userMessage]);
    setPending(true); setLastFailedPrompt(""); setDraft("");
    try {
      const response = await sendAskSnoozerMessage({
        message: content, history, referrerRoute, comparisonProductHandles,
        deviceContext: { deviceId: device?.deviceId || null, deviceMode: device?.deviceMode || null, podId: device?.podId || null, zoneId: device?.zoneId || null, proximity: zoneExperience.proximityContext },
      });
      const assistantMessage = {
        id: response?.reply?.id || createMessageId("assistant"), role: "assistant", content: extractResponseContent(response), createdAt: response?.reply?.createdAt || nowIso(),
        status: response?.status || "answered", chips: filterResponseChips(response?.chips), actions: filterDeviceActions(device, response?.actions),
        recommendations: Array.isArray(response?.recommendations) ? response.recommendations : [], canRetry: response?.ok === false, retryPrompt: content,
      };
      setMessages((current) => [...current, assistantMessage]);
      setLastFailedPrompt(response?.ok === false ? content : "");
      if (response?.voice?.speak && response?.voice?.speech && typeof sayHud === "function") {
        sayHud({ speech: response.voice.speech, captions: assistantMessage.content, state: "speaking", priority: "normal", ttlMs: 5000, actions: [] }).catch(() => {});
      }
    } catch {
      setMessages((current) => [...current, { id: createMessageId("assistant"), role: "assistant", content: composeFallbackReply(), createdAt: nowIso(), status: "fallback", chips: [], actions: [], recommendations: [], canRetry: true, retryPrompt: content }]);
      setLastFailedPrompt(content);
    } finally { setPending(false); }
  }

  async function handleAction(action) {
    noteUserInteraction?.();
    if (!isDeviceActionAllowed(device, action)) return;
    if (action?.type === "add_to_cart") {
      if (!cartMutationAllowed || cartMutationPending) return;
      const success = await addToCart(action.payload);
      setMessages((current) => [...current, { id: createMessageId("assistant"), role: "assistant", content: success ? `${action.payload?.title || "That product"} was added to your verified Shopify cart.` : "I could not confirm that cart addition. Your cart was not changed; please try again.", createdAt: nowIso(), status: success ? "answered" : "warning", chips: [], actions: [], recommendations: [], canRetry: false }]);
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

  return (
    <ShowroomPageShell className="flex min-h-0 flex-col pb-24">
      <ShowroomTopRail className="items-center pt-2 md:pt-3">
        <ShowroomDownstreamHeader
          rewards={<RewardsPill status={rewardState.status} points={rewardState.points} onClick={() => sendMessage("Find Rewards")} />}
          cart={showCommerceAffordances ? <ShowroomCartBadge count={authoritativeCartCount} quiet onClick={() => { noteUserInteraction?.(); if (canNavigateTo(device, "/cart")) navigate("/cart"); }} /> : null}
        />
      </ShowroomTopRail>

      <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-1 flex-col px-4 pt-2 md:px-6 md:pt-3">
        <ShowroomFrame className="flex min-h-0 flex-1 flex-col overflow-hidden p-1 md:p-1.5">
          <ShowroomPanel className="flex min-h-0 flex-1 flex-col overflow-hidden p-0" tone="soft">
            <section data-ask-section="hero" className="shrink-0 border-b border-[#dbe5ff] px-5 py-4 md:px-6 md:py-5">
              <div className="grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
                <div className="flex items-start gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.98),rgba(233,240,255,0.92))] shadow-[0_14px_32px_rgba(46,74,138,0.10)]">
                    <img src="/snoozer-avatar.png" alt="Snoozer" className="h-12 w-12 object-contain" />
                  </div>
                  <div className="min-w-0 pt-1">
                    <ShowroomEyebrow className="text-[0.72rem] tracking-[0.18em]">Ask Snoozer</ShowroomEyebrow>
                    <h1 className="mt-1 text-[1.7rem] font-black leading-[0.96] tracking-tight text-slate-900 md:text-[2rem]">Chat with Snoozer</h1>
                    <p className="mt-2 max-w-xl text-[0.92rem] leading-6 text-slate-600">Your showroom advisor for products, rewards, comparisons, and a cart you can trust.</p>
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Quick Starters</div>
                  <div className="grid gap-2 sm:grid-cols-2">{QUICK_STARTERS.map((item) => <QuickStarter key={item.label} item={item} onClick={() => sendMessage(item.prompt)} />)}</div>
                </div>
              </div>
            </section>

            <section ref={transcriptRef} data-ask-section="transcript" className="min-h-0 flex-1 overflow-y-auto bg-white/72 px-4 py-4 md:px-6 md:py-5">
              {!messages.length && !pending ? <div className="flex min-h-[150px] items-center justify-center px-5 text-center"><p className="max-w-2xl text-[0.96rem] font-semibold leading-7 text-slate-500">{shopperId && shopperId !== "guest" ? "Welcome back. Your session is connected—what would you like to explore?" : "I can help you compare products, understand motion bases, explore sleep tips, or build your cart."}</p></div> : null}
              <div className="space-y-3">
                {messages.map((message) => {
                  const isAssistant = message.role === "assistant";
                  return (
                    <article key={message.id} className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[96%] rounded-[22px] px-4 py-3.5 shadow-sm md:max-w-[82%] ${isAssistant ? "border border-slate-200 bg-white text-slate-800" : "bg-[#16315F] text-white"}`}>
                        {isAssistant ? <div className="mb-2 flex items-center gap-2"><span className="text-sm font-black text-slate-900">Snoozer</span><span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">{formatAssistantStatus(message.status)}</span></div> : null}
                        <div className="whitespace-pre-wrap text-sm leading-6 md:text-[15px]">{message.content}</div>
                        {isAssistant && message.chips?.length ? <div className="mt-3 flex flex-wrap gap-2">{message.chips.map((chip) => <button key={`${message.id}-${chip.label}-${chip.value}`} type="button" onClick={() => handleChip(chip)} className="rounded-full border border-[#16315F]/12 bg-[#16315F]/5 px-3 py-1.5 text-xs font-semibold text-[#16315F] hover:bg-[#16315F]/10">{chip.label}</button>)}</div> : null}
                        {isAssistant && message.actions?.length ? <div className="mt-3 flex flex-wrap gap-2">{message.actions.map((action) => <button key={`${message.id}-${action.label}`} type="button" disabled={action.type === "add_to_cart" && cartMutationPending} onClick={() => handleAction(action)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{action.label}</button>)}</div> : null}
                        {isAssistant && message.recommendations?.length ? <div className="mt-3 grid gap-2 md:grid-cols-2">{message.recommendations.map((item) => {
                          const cardKey = `${message.id}-${item.id}`;
                          const canView = Boolean(item.url?.startsWith("/") && canNavigateTo(device, item.url));
                          return <ProductCard key={cardKey} item={item} siblings={message.recommendations} imageFailed={Boolean(failedRecommendationImages[cardKey])} mutationPending={cartMutationPending} canAdd={cartMutationAllowed} canView={canView} onImageError={() => setFailedRecommendationImages((current) => ({ ...current, [cardKey]: true }))} onAdd={handleAction} onView={() => { noteUserInteraction?.(); if (canView) navigate(item.url); }} onCompare={(prompt) => sendMessage(prompt, { comparisonProductHandles: [item.handle, ...message.recommendations.map((candidate) => candidate.handle)].filter(Boolean).slice(0, 2) })} onChoose={() => sendMessage(`What sizes are available for ${item.handle}?`)} />;
                        })}</div> : null}
                        {isAssistant && message.canRetry ? <button type="button" onClick={() => sendMessage(message.retryPrompt || lastFailedPrompt)} className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"><RefreshCcw className="h-3.5 w-3.5" /> Retry</button> : null}
                      </div>
                    </article>
                  );
                })}
              </div>
              {pending ? <div className="mt-3 flex justify-start"><div className="rounded-[22px] border border-slate-200 bg-white px-4 py-3.5 shadow-sm"><div className="text-sm font-black text-slate-900">Snoozer <span className="ml-1 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">thinking</span></div><div className="mt-2 inline-flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Working on that…</div></div></div> : null}
            </section>

            <section data-ask-section="composer" className="shrink-0 border-t border-[#dbe5ff] bg-[linear-gradient(180deg,rgba(248,250,255,0.92),rgba(255,255,255,0.98))] px-4 py-3 md:px-6 md:py-4">
              <ChatComposer draft={draft} pending={pending} canSend={canSend} textareaRef={textareaRef} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKeyDown} onSend={sendMessage} noteUserInteraction={noteUserInteraction} />
            </section>
          </ShowroomPanel>
        </ShowroomFrame>
      </div>
    </ShowroomPageShell>
  );
}
