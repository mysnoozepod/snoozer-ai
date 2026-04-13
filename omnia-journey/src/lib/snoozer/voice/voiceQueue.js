// src/lib/snoozer/voice/voiceQueue.js

const DEFAULT_MAX_CARRYOVER_MS = 3000;
const DEFAULT_FADE_OUT_MS = 250;
const DEFAULT_CAPTION_GRACE_MS = 350;
const DEFAULT_TTL_MS = 5000;
const DEFAULT_PRIORITY = 'normal';

function now() {
  return Date.now();
}

function safeId(prefix = 'voice') {
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export function createVoiceJob(input = {}) {
  const createdAt = now();

  return {
    id: input.id || safeId(),
    speech: typeof input.speech === 'string' ? input.speech : '',
    captions: typeof input.captions === 'string' ? input.captions : (input.speech || ''),
    state: input.state || 'speaking',
    priority: input.priority || DEFAULT_PRIORITY,
    ttlMs: Number.isFinite(input.ttlMs) ? input.ttlMs : DEFAULT_TTL_MS,
    actions: Array.isArray(input.actions) ? input.actions : [],
    voiceStyle: input.voiceStyle || 'default',
    allowContinuation: input.allowContinuation !== false,
    interruptible: input.interruptible !== false,
    createdAt,
    expiresAt: createdAt + (Number.isFinite(input.ttlMs) ? input.ttlMs : DEFAULT_TTL_MS),
    status: 'pending', // pending | preparing | playing | captions-only | done | cancelled | failed
    audioUrl: input.audioUrl || null,
    durationMs: Number.isFinite(input.durationMs) ? input.durationMs : null,
    metadata: input.metadata || {},
  };
}

export class VoiceQueueController {
  constructor(options = {}) {
    this.queue = [];
    this.currentJob = null;
    this.listeners = new Set();

    this.maxCarryoverMs = Number.isFinite(options.maxCarryoverMs)
      ? options.maxCarryoverMs
      : DEFAULT_MAX_CARRYOVER_MS;

    this.fadeOutMs = Number.isFinite(options.fadeOutMs)
      ? options.fadeOutMs
      : DEFAULT_FADE_OUT_MS;

    this.captionGraceMs = Number.isFinite(options.captionGraceMs)
      ? options.captionGraceMs
      : DEFAULT_CAPTION_GRACE_MS;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit() {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  getSnapshot() {
    return {
      queue: [...this.queue],
      currentJob: this.currentJob,
      isBusy: Boolean(this.currentJob),
      pendingCount: this.queue.length,
      fadeOutMs: this.fadeOutMs,
      maxCarryoverMs: this.maxCarryoverMs,
      captionGraceMs: this.captionGraceMs,
    };
  }

  enqueue(input) {
    const job = createVoiceJob(input);

    if (job.priority === 'high') {
      this.interruptCurrent({ reason: 'high-priority-job', preserveQueue: true });
      this.queue.unshift(job);
    } else {
      this.queue.push(job);
    }

    this.emit();
    return job;
  }

  startPreparing(jobId) {
    if (this.currentJob?.id === jobId) {
      this.currentJob = { ...this.currentJob, status: 'preparing' };
      this.emit();
      return;
    }

    this.queue = this.queue.map((job) =>
      job.id === jobId ? { ...job, status: 'preparing' } : job
    );
    this.emit();
  }

  markCaptionsOnly(jobId) {
    if (this.currentJob?.id === jobId) {
      this.currentJob = { ...this.currentJob, status: 'captions-only' };
      this.emit();
      return;
    }

    this.queue = this.queue.map((job) =>
      job.id === jobId ? { ...job, status: 'captions-only' } : job
    );
    this.emit();
  }

  promoteNext() {
    if (this.currentJob || this.queue.length === 0) return null;

    const next = this.queue.shift();
    this.currentJob = { ...next, status: next.status === 'captions-only' ? 'captions-only' : 'preparing' };
    this.emit();
    return this.currentJob;
  }

  attachAudio(jobId, audioUrl, durationMs = null) {
    if (!audioUrl) return;

    if (this.currentJob?.id === jobId) {
      this.currentJob = {
        ...this.currentJob,
        audioUrl,
        durationMs: Number.isFinite(durationMs) ? durationMs : this.currentJob.durationMs,
      };
      this.emit();
      return;
    }

    this.queue = this.queue.map((job) =>
      job.id === jobId
        ? {
            ...job,
            audioUrl,
            durationMs: Number.isFinite(durationMs) ? durationMs : job.durationMs,
          }
        : job
    );
    this.emit();
  }

  markPlaying(jobId) {
    if (this.currentJob?.id !== jobId) return;
    this.currentJob = { ...this.currentJob, status: 'playing' };
    this.emit();
  }

  completeCurrent(reason = 'done') {
    if (!this.currentJob) return null;
    const finished = { ...this.currentJob, status: reason === 'cancelled' ? 'cancelled' : 'done' };
    this.currentJob = null;
    this.emit();
    return finished;
  }

  failCurrent(reason = 'failed') {
    if (!this.currentJob) return null;
    const failed = { ...this.currentJob, status: reason };
    this.currentJob = null;
    this.emit();
    return failed;
  }

  interruptCurrent({ reason = 'cancelled', preserveQueue = true } = {}) {
    if (!this.currentJob) return null;
    const interrupted = { ...this.currentJob, status: reason };

    this.currentJob = null;

    if (!preserveQueue) {
      this.queue = [];
    }

    this.emit();
    return interrupted;
  }

  clearQueue() {
    this.queue = [];
    this.emit();
  }

  handleRouteChange({ allowContinuation = true, maxCarryoverMs } = {}) {
    if (!this.currentJob) return { action: 'none' };

    const carryoverLimit = Number.isFinite(maxCarryoverMs)
      ? maxCarryoverMs
      : this.maxCarryoverMs;

    if (!allowContinuation || !this.currentJob.interruptible) {
      return { action: 'continue' };
    }

    const startedAt = this.currentJob.startedAt || this.currentJob.createdAt;
    const elapsedMs = now() - startedAt;
    const totalMs = this.currentJob.durationMs || this.currentJob.ttlMs || DEFAULT_TTL_MS;
    const remainingMs = Math.max(totalMs - elapsedMs, 0);

    if (remainingMs <= carryoverLimit) {
      return { action: 'continue' };
    }

    return { action: 'fade-and-stop', fadeOutMs: this.fadeOutMs };
  }

  markStarted(jobId) {
    if (this.currentJob?.id !== jobId) return;
    this.currentJob = { ...this.currentJob, startedAt: now() };
    this.emit();
  }
}