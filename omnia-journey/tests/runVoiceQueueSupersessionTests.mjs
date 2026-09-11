import assert from "node:assert/strict";
import { VoiceQueueController } from "../src/lib/snoozer/voice/voiceQueue.js";

function conversationalJob(label, overrides = {}) {
  return {
    speech: label,
    captions: label,
    priority: "normal",
    interruptible: true,
    metadata: {
      audioScope: "ask_snoozer_conversation",
      askSnoozerTimingId: label,
    },
    ...overrides,
  };
}

const playing = new VoiceQueueController();
const first = playing.enqueue(conversationalJob("question-1"));
playing.promoteNext();
playing.startPreparing(first.id);
playing.markPlaying(first.id);
assert.equal(playing.canInterruptCurrent((job) => job.metadata.audioScope === "ask_snoozer_conversation"), true);
const interrupted = playing.interruptCurrent({ preserveQueue: true, reason: "superseded" });
assert.equal(interrupted.status, "superseded");
assert.equal(playing.currentJob, null);

const queued = new VoiceQueueController();
queued.enqueue(conversationalJob("question-1"));
queued.enqueue(conversationalJob("question-2"));
queued.enqueue(conversationalJob("question-3"));
const removed = queued.supersedeQueued(
  (job) => job.metadata.audioScope === "ask_snoozer_conversation",
  "superseded"
);
assert.equal(removed.length, 3);
assert(removed.every((job) => job.status === "superseded"));
assert.equal(queued.getSnapshot().queue.length, 0);

const protectedQueue = new VoiceQueueController();
const protectedJob = protectedQueue.enqueue({
  speech: "Critical showroom transition",
  captions: "Critical showroom transition",
  priority: "high",
  interruptible: false,
  metadata: { audioScope: "protected_showroom_event" },
});
protectedQueue.promoteNext();
protectedQueue.markPlaying(protectedJob.id);
protectedQueue.enqueue(conversationalJob("old-ask-answer"));
assert.equal(
  protectedQueue.canInterruptCurrent((job) => job.metadata.audioScope === "ask_snoozer_conversation"),
  false
);
const stale = protectedQueue.supersedeQueued(
  (job) => job.metadata.audioScope === "ask_snoozer_conversation",
  "superseded"
);
assert.equal(stale.length, 1);
assert.equal(protectedQueue.currentJob.id, protectedJob.id);

console.log("Ask Snoozer voice-queue supersession tests passed (playing, queued, rapid-turn, protected audio).");
