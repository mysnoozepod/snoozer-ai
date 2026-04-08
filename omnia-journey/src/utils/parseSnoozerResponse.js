// src/utils/parseSnoozerResponse.js
// Day 2 frontend guardrails: never trust APIs to behave (because they won't).

export function parseSnoozerResponse(res) {
  const r = res || {};

  const reply =
    (typeof r.reply === "string" && r.reply) ||
    (typeof r?.message?.text === "string" && r.message.text) ||
    "";

  const actions = Array.isArray(r.actions) ? r.actions : [];
  const products = Array.isArray(r.products) ? r.products : [];

  const traceId =
    r.traceId ||
    r?.metadata?.requestId ||
    r?.metadata?.traceId ||
    "missing-trace";

  const sessionId =
    r.sessionId ||
    r.thread_id ||
    r.threadId ||
    r?.context?.sessionId ||
    "";

  const status =
    r.status ||
    (r.ok ? "completed" : "error");

  const error = r.error || null;

  return { reply, actions, products, traceId, sessionId, status, error, raw: r };
}
