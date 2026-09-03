import { useState, useRef, useCallback, useEffect } from "react";
import { askSnoozer } from "@/lib/api";
import {
  ensureSessionThreadId,
  getCanonicalIdentity,
  getSessionState,
  getShopperId,
  setSessionLinkId,
} from "@/state/sessionStore";

/**
 * useSnoozerSession()
 * Persistent conversational state + product recommendations
 * Shared across pages (Assessment → Explore → Checkout)
 *
 * Handles:
 *  - Thread + session persistence via sessionStorage
 *  - Message history
 *  - Loading + error states
 *  - Product injection (for grid displays)
 *  - Mode hints coming back from Snoozer (meta.mode)
 *  - Context in/out (assessmentSummary, recommendedProductHandles, etc.)
 */

const STORAGE_KEYS = {
  threadId: "snooze.threadId",
  transcript: "snooze.chatTranscript",
  lastMode: "snooze.mode",
  sessionId: "snooze.sessionId",
  lastContext: "snooze.lastContext",
};

// Generate a Snoozer-style ID
function makeId(prefix = "snoozer") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export default function useSnoozerSession(defaultMode = "explore") {
  // Shopper context (per browser session)
  const shopperId = getShopperId() || "guest";

  const sessionIdRef = useRef(
    (() => {
      try {
        const existing =
          getSessionState()?.sessionId || sessionStorage.getItem(STORAGE_KEYS.sessionId);
        return existing || makeId("sess");
      } catch {
        return makeId("sess");
      }
    })()
  );

  // Persist sessionId once
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEYS.sessionId, sessionIdRef.current);
      setSessionLinkId(sessionIdRef.current);
    } catch {
      // ignore
    }
  }, []);

  const [messages, setMessages] = useState(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEYS.transcript);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      // ignore
    }
    // Default greeting if nothing persisted
    return [
      {
        role: "assistant",
        content:
          "Hi, I’m Snoozer. Tell me what you want to try and I’ll set up the right products.",
      },
    ];
  });

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState(
    (() => {
      try {
        return sessionStorage.getItem(STORAGE_KEYS.lastMode) || defaultMode;
      } catch {
        return defaultMode;
      }
    })()
  );

  const [assistantContext, setAssistantContext] = useState(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEYS.lastContext);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  });

  const threadRef = useRef(
    (() => {
      try {
        return (
          ensureSessionThreadId() ||
          sessionStorage.getItem(STORAGE_KEYS.threadId) ||
          makeId("snoozer")
        );
      } catch {
        return makeId("snoozer");
      }
    })()
  );

  // Persist thread ID + mode + context snapshot
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEYS.threadId, threadRef.current);
      sessionStorage.setItem(STORAGE_KEYS.lastMode, mode);
    } catch {
      // ignore
    }
  }, [mode]);

  useEffect(() => {
    try {
      if (assistantContext) {
        sessionStorage.setItem(
          STORAGE_KEYS.lastContext,
          JSON.stringify(assistantContext).slice(0, 20000)
        );
      }
    } catch {
      // ignore
    }
  }, [assistantContext]);

  // Persist message transcript
  useEffect(() => {
    try {
      sessionStorage.setItem(
        STORAGE_KEYS.transcript,
        JSON.stringify(messages).slice(0, 50000)
      );
    } catch {
      // ignore
    }
  }, [messages]);

  // ────────────────────────────────
  // send() — core Snoozer interaction
  // ────────────────────────────────
  const send = useCallback(
    async (
      text,
      {
        mode: overrideMode,
        zone = "online",
        context: extraContext = {},
        assessmentSummary,
        recommendedProductHandles,
      } = {}
    ) => {
      const raw = text?.toString() || "";
      if (!raw.trim() || loading) return;

      const cleanText = raw.trim();
      setMessages((m) => [...m, { role: "user", content: cleanText }]);
      setLoading(true);
      setError("");

      const threadId = threadRef.current;
      const payloadMode = overrideMode || mode || defaultMode;

      // Build context payload for backend
      const ctx = {
        ...(assistantContext && typeof assistantContext === "object"
          ? assistantContext
          : {}),
        ...(extraContext && typeof extraContext === "object"
          ? extraContext
          : {}),
      };

      if (assessmentSummary) {
        ctx.assessmentSummary = assessmentSummary;
      }
      if (Array.isArray(recommendedProductHandles)) {
        ctx.recommendedProductHandles = recommendedProductHandles;
      }

      try {
        const canonicalIdentity = getCanonicalIdentity();
        const res = await askSnoozer(cleanText, {
          thread_id: threadId,
          mode: payloadMode,
          shopperId: canonicalIdentity.shopperId || shopperId,
          sessionId: sessionIdRef.current,
          zone,
          context: {
            ...ctx,
            snoozeCode: canonicalIdentity.snoozeCode || undefined,
            profileId: canonicalIdentity.profileId || undefined,
          },
        });

        const reply = res?.reply || "No response from Snoozer.";
        setMessages((m) => [...m, { role: "assistant", content: reply }]);

        // Products returned for Explore grid (normalized here)
        if (Array.isArray(res?.products) && res.products.length) {
          const formatted = res.products.map((p) => ({
            id: p.id || p.handle || Math.random().toString(36).slice(2, 7),
            handle: p.handle || "",
            title: p.title || "Untitled",
            price:
              typeof p.price === "number"
                ? p.price
                : p?.priceRange?.min ?? null,
            imageUrl:
              p?.imageUrl ||
              p?.image?.url ||
              (Array.isArray(p.images) && p.images[0]?.url) ||
              "/no-image.svg",
            productType: p.productType || "",
            tags: Array.isArray(p.tags) ? p.tags : [],
            reason: p.reason || "",
          }));
          setProducts(formatted);
        }

        // Let backend steer mode if it wants
        if (res?.meta?.mode && res.meta.mode !== mode) {
          setMode(res.meta.mode);
        }

        // Capture updated context coming back from backend
        if (res?.context && typeof res.context === "object") {
          setAssistantContext(res.context);
        }

        // If backend returns a canonical thread id, adopt it
        if (res?.thread_id && res.thread_id !== threadRef.current) {
          threadRef.current = res.thread_id;
          try {
            sessionStorage.setItem(STORAGE_KEYS.threadId, threadRef.current);
          } catch {
            // ignore
          }
        }

        // Bubble full response back if caller wants it
        return res;
      } catch (err) {
        console.error("❌ useSnoozerSession send() error:", err);
        setError(err.message || "Network issue");
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content:
              "⚠️ Snoozer had trouble reaching the server. Please try again in a moment.",
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [mode, defaultMode, shopperId, loading, assistantContext]
  );

  // ────────────────────────────────
  // reset() — start new conversation
  // ────────────────────────────────
  const reset = useCallback(() => {
    const newId = makeId("snoozer");

    setMessages([
      {
        role: "assistant",
        content:
          "Hi, I’m Snoozer. Tell me what you want to try and I’ll set up the right products.",
      },
    ]);
    setProducts([]);
    setError("");
    setLoading(false);
    setAssistantContext(null);

    threadRef.current = newId;

    try {
      sessionStorage.setItem(STORAGE_KEYS.threadId, newId);
      sessionStorage.removeItem(STORAGE_KEYS.transcript);
      sessionStorage.removeItem(STORAGE_KEYS.lastContext);
    } catch {
      // ignore
    }
  }, []);

  return {
    messages,
    products,
    loading,
    error,
    send,
    reset,
    mode,
    setMode,
    threadId: threadRef.current,
    shopperId,
    sessionId: sessionIdRef.current,
    context: assistantContext,
  };
}

