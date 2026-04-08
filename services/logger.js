// services/logger.js
// Minimal structured logger with reqId propagation and simple timers.

const DEFAULT_SOURCE = process.env.LOG_SOURCE || "app";

function serializeError(err) {
  if (!err) return undefined;
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  if (typeof err === "object") {
    const { message, stack, ...rest } = err;
    return { message, stack, ...rest };
  }
  return { message: String(err) };
}

function emit(level, event, data = {}) {
  const rec = {
    ts: new Date().toISOString(),
    level,
    source: data.source || DEFAULT_SOURCE,
    event,
    ...data,
  };
  if (rec.error) rec.error = serializeError(rec.error);
  try { console.log(JSON.stringify(rec)); }
  catch { console.log(`[${rec.level}] ${rec.source}:${rec.event}`, rec); }
}

function createLogger({ reqId, source } = {}) {
  const base = { reqId, source: source || DEFAULT_SOURCE };

  const log = (level) => (event, data = {}) => emit(level, event, { ...base, ...data });

  // Simple timing helper:
  function start(event, data = {}) {
    const t0 = Date.now();
    emit("debug", `${event}.start`, { ...base, ...data });
    return {
      end(extra = {}) {
        emit("info", `${event}.end`, {
          ...base, ...data, ...extra, duration_ms: Date.now() - t0,
        });
      }
    };
  }

  // Create a child logger with same reqId but different source or extras
  function child(extra = {}) {
    return createLogger({
      reqId: extra.reqId ?? base.reqId,
      source: extra.source ?? base.source,
    });
  }

  return {
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    debug: log("debug"),
    start,
    child,
    withReqId(newReqId) { return createLogger({ reqId: newReqId, source: base.source }); }
  };
}

module.exports = { createLogger, emit };

