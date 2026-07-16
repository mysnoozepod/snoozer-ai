const DEFAULT_RECONNECT_BASE_MS = 500;
const DEFAULT_RECONNECT_MAX_MS = 10000;

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

export function buildWebSocketUrl(endpoint, deviceId) {
  const base = cleanString(endpoint);
  const id = cleanString(deviceId);
  if (!base || !id) return "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}deviceId=${encodeURIComponent(id)}`;
}

export function createSubscribeMessage(zoneIds) {
  return JSON.stringify({
    action: "subscribe",
    zoneIds: Array.isArray(zoneIds) ? zoneIds : [],
  });
}

export function createUnsubscribeMessage(zoneIds) {
  return JSON.stringify({
    action: "unsubscribe",
    zoneIds: Array.isArray(zoneIds) ? zoneIds : [],
  });
}

export function getReconnectDelay(attempt, options = {}) {
  const baseMs = Number(options.baseMs || DEFAULT_RECONNECT_BASE_MS);
  const maxMs = Number(options.maxMs || DEFAULT_RECONNECT_MAX_MS);
  const safeAttempt = Math.max(0, Number(attempt || 0));
  return Math.min(maxMs, baseMs * Math.pow(2, safeAttempt));
}

export class ShowroomIotClient {
  constructor(options = {}) {
    this.endpoint = cleanString(options.endpoint);
    this.deviceId = cleanString(options.deviceId);
    this.zoneIds = Array.isArray(options.zoneIds) ? [...options.zoneIds] : [];
    this.WebSocketImpl = options.WebSocketImpl || (typeof WebSocket !== "undefined" ? WebSocket : null);
    this.onOpen = options.onOpen || (() => {});
    this.onMessage = options.onMessage || (() => {});
    this.onClose = options.onClose || (() => {});
    this.onError = options.onError || (() => {});
    this.socket = null;
    this.closedByClient = false;
  }

  connect() {
    const url = buildWebSocketUrl(this.endpoint, this.deviceId);
    if (!url || !this.WebSocketImpl) {
      throw new Error(!url ? "IOT_WEBSOCKET_URL_OR_DEVICE_ID_MISSING" : "WEBSOCKET_NOT_AVAILABLE");
    }

    this.closedByClient = false;
    this.socket = new this.WebSocketImpl(url);
    this.socket.onopen = (event) => {
      this.sendSubscribe();
      this.onOpen(event);
    };
    this.socket.onmessage = (event) => {
      this.onMessage(event?.data ?? event);
    };
    this.socket.onerror = (event) => {
      this.onError(event);
    };
    this.socket.onclose = (event) => {
      this.onClose({ event, closedByClient: this.closedByClient });
    };
    return this.socket;
  }

  sendSubscribe() {
    if (!this.socket || this.socket.readyState !== 1) return false;
    this.socket.send(createSubscribeMessage(this.zoneIds));
    return true;
  }

  sendUnsubscribe() {
    if (!this.socket || this.socket.readyState !== 1) return false;
    this.socket.send(createUnsubscribeMessage(this.zoneIds));
    return true;
  }

  close() {
    this.closedByClient = true;
    if (!this.socket) return;
    try {
      this.sendUnsubscribe();
      this.socket.close();
    } catch {
      // Best-effort cleanup only.
    }
    this.socket = null;
  }
}

export function createShowroomIotClient(options = {}) {
  return new ShowroomIotClient(options);
}
