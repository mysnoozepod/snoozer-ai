import React from "react";
import { useLocation } from "react-router-dom";
import { recordActiveJourneyEvent, resolveActiveJourney } from "@/lib/api";
import { useSessionStore } from "@/state/sessionStore";

const ActiveJourneyContext = React.createContext({ activeJourney: null, ready: true, refresh: async () => null, recordEvent: async () => null });

function surfaceFromPath(pathname = "") {
  if (pathname.startsWith("/pod/")) return "pod";
  if (pathname.startsWith("/ask-snoozer")) return "ask_snoozer";
  if (pathname.startsWith("/sleep-essentials")) return "sleep_essentials";
  if (pathname.startsWith("/snoozepod")) return "snoozepod";
  if (pathname.startsWith("/checkout")) return "checkout";
  return pathname.replace(/^\//, "").replace(/-/g, "_") || "welcome";
}

export function ActiveJourneyProvider({ children }) {
  const location = useLocation();
  const identityKey = useSessionStore((state) => state.profileId || state.shopperId || state.snoozeCode || "");
  const activeJourney = useSessionStore((state) => state.activeJourney);
  const [ready, setReady] = React.useState(!identityKey);
  const requestRef = React.useRef(0);
  const surface = surfaceFromPath(location.pathname);

  const refresh = React.useCallback(async () => {
    if (!identityKey) { setReady(true); return null; }
    const requestId = ++requestRef.current;
    const resolutionStartedAt = performance.now();
    setReady(false);
    try {
      const resolved = await resolveActiveJourney({ surface });
      if (requestId !== requestRef.current) return resolved?.activeJourney || null;
      let journey = resolved?.activeJourney || null;
      if (journey && journey.currentSurface !== surface) {
        const transitioned = await recordActiveJourneyEvent({ type: "journey_surface_changed", payload: { surface } }, { surface, expectedRevision: journey.revision });
        journey = transitioned?.activeJourney || journey;
      }
      window.dispatchEvent(new CustomEvent("snooze:active-journey-ready", { detail: { journeyId: journey?.journeyId || null, revision: journey?.revision ?? null, surface, resolutionMs: Math.round((performance.now() - resolutionStartedAt) * 10) / 10 } }));
      return journey;
    } finally {
      if (requestId === requestRef.current) setReady(true);
    }
  }, [identityKey, surface]);

  React.useEffect(() => { void refresh().catch(() => setReady(true)); }, [refresh]);

  const recordEvent = React.useCallback(async (event) => {
    try {
      return await recordActiveJourneyEvent(event, { surface });
    } catch (error) {
      await refresh().catch(() => null);
      throw error;
    }
  }, [refresh, surface]);

  const value = React.useMemo(() => ({ activeJourney, ready, refresh, recordEvent, surface }), [activeJourney, ready, refresh, recordEvent, surface]);
  const guarded = Boolean(identityKey) && !ready && ["results", "pod", "ask_snoozer", "cart", "checkout"].includes(surface);
  return (
    <ActiveJourneyContext.Provider value={value}>
      {guarded ? <main aria-busy="true" className="min-h-screen bg-[#f7f9ff]" /> : children}
    </ActiveJourneyContext.Provider>
  );
}

export function useActiveJourney() {
  return React.useContext(ActiveJourneyContext);
}
