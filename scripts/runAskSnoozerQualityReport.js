#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  QUALITY_TRACE_VERSION,
  SEVERITY_DEFINITIONS,
  aggregateAskSnoozerQualityTraces,
} = require("../services/askSnoozerQualityTrace");

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function parseStructuredMessage(value) {
  if (value && typeof value === "object") return value;
  const text = String(value || "").trim();
  const candidates = [text, text.slice(Math.max(0, text.indexOf("{")))];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // try the next representation
    }
  }
  return null;
}

function extractEvents(payload) {
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.events)
      ? payload.events
      : [];
  return values
    .map((entry) => parseStructuredMessage(entry?.message ?? entry))
    .filter((entry) =>
      entry &&
      entry.version === QUALITY_TRACE_VERSION &&
      ["ask-snoozer.quality-trace", "ask-snoozer.client-timing"].includes(entry.src)
    );
}

function loadInput(filePath) {
  if (!filePath) return null;
  const raw = fs.readFileSync(path.resolve(filePath), "utf8").trim();
  if (!raw) return [];
  try {
    return extractEvents(JSON.parse(raw));
  } catch {
    return raw.split(/\r?\n/).map(parseStructuredMessage).filter(Boolean);
  }
}

function loadCloudWatch({ minutes = 60, logGroup = "/aws/lambda/snoozer-backend" } = {}) {
  const startTime = Date.now() - Math.max(1, Number(minutes) || 60) * 60_000;
  const collected = [];
  let nextToken = null;
  for (let page = 0; page < 10; page += 1) {
    const args = [
      "logs", "filter-log-events",
      "--log-group-name", logGroup,
      "--start-time", String(startTime),
      "--limit", "1000",
      "--output", "json",
    ];
    if (nextToken) args.push("--next-token", nextToken);
    const result = spawnSync("aws", args, {
      encoding: "utf8",
      env: { ...process.env, AWS_DEFAULT_OUTPUT: "json", PYTHONUTF8: "1" },
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(String(result.stderr || result.stdout || "CloudWatch query failed").trim());
    }
    const parsed = JSON.parse(result.stdout || "{}");
    collected.push(...extractEvents(parsed));
    if (!parsed.nextToken || parsed.nextToken === nextToken) break;
    nextToken = parsed.nextToken;
  }
  return collected;
}

function loadReviews(filePath) {
  if (!filePath) return null;
  const parsed = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.reviews) ? parsed.reviews : [];
}

function display(value, suffix = "") {
  return value == null ? "missing" : `${value}${suffix}`;
}

function renderMarkdown(summary, metadata = {}) {
  const lines = [
    "# Ask Snoozer production conversation-quality report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Source: ${metadata.source || "unknown"}`,
    `Telemetry status: **${summary.telemetryStatus}**`,
    "",
    "## Conversation quality",
    "",
    "| Metric | Result |",
    "|---|---:|",
    `| Total turns | ${display(summary.totalTurns)} |`,
    `| Deterministic | ${display(summary.deterministicPercent, "%")} |`,
    `| Model-assisted | ${display(summary.modelAssistedPercent, "%")} |`,
    `| Probe rate | ${display(summary.probeRate, "%")} |`,
    `| Successful advancement | ${display(summary.successfulAdvancementRate, "%")} |`,
    `| Neutral complete | ${display(summary.neutralCompleteRate, "%")} |`,
    `| Friction | ${display(summary.frictionRate, "%")} |`,
    `| Recovery outcomes | ${display(summary.recoveryRate, "%")} |`,
    `| Ready-goal completion | ${display(summary.readyGoalCompletionRate, "%")} |`,
    `| Commercial stranding | ${display(summary.commercialStrandingCount)} |`,
    `| Repeated known question | ${display(summary.repeatedKnownQuestionCount)} |`,
    `| Quote presented when ready | ${display(summary.quotePresentedWhenReadyRate, "%")} |`,
    `| Compatibility resolved when possible | ${display(summary.compatibilityResolvedWhenPossibleRate, "%")} |`,
    `| Unresolved reference rate | ${display(summary.unresolvedReferenceRate, "%")} |`,
    `| Consistency-gate rejection rate | ${display(summary.consistencyGateRejectionRate, "%")} |`,
    `| Deterministic fallback rate | ${display(summary.deterministicFallbackRate, "%")} |`,
    `| Overall fallback rate | ${display(summary.fallbackRate, "%")} |`,
    `| Quote consistency failures | ${display(summary.quoteConsistencyFailures)} |`,
    `| Compatibility conflicts | ${display(summary.compatibilityConflicts)} |`,
    `| Language-firewall violations | ${display(summary.languageFirewallViolations)} |`,
    `| Medical-boundary triggers | ${display(summary.medicalBoundaryTriggers)} |`,
    `| Visit rotations | ${display(summary.visitRotations)} |`,
    `| Recovery attempts | ${display(summary.recoveryAttempts)} |`,
    `| Recovery success rate | ${display(summary.recoverySuccessRate, "%")} |`,
    `| Conversations with repeated questions | ${display(summary.repeatedQuestionConversations)} |`,
    `| Natural ending rate | ${display(summary.naturalEndingRate, "%")} |`,
    `| Justified natural-ending rate | ${display(summary.justifiedNaturalEndingRate, "%")} |`,
    `| Contextual next-action rate | ${display(summary.contextualNextActionRate, "%")} |`,
    `| Generic-answer rate | ${display(summary.genericAnswerRate, "%")} |`,
    "",
    "## Latency",
    "",
    "| Mode | Count | Average | p95 |",
    "|---|---:|---:|---:|",
    `| Deterministic | ${summary.latencyByMode?.deterministic?.count ?? "missing"} | ${display(summary.latencyByMode?.deterministic?.averageMs, " ms")} | ${display(summary.latencyByMode?.deterministic?.p95Ms, " ms")} |`,
    `| Model-assisted | ${summary.latencyByMode?.model_assisted?.count ?? "missing"} | ${display(summary.latencyByMode?.model_assisted?.averageMs, " ms")} | ${display(summary.latencyByMode?.model_assisted?.p95Ms, " ms")} |`,
    `| Client first feedback | ${summary.clientTiming?.eventCount ?? 0} events | ${display(summary.clientTiming?.requestToFirstFeedbackAverageMs, " ms avg")} | — |`,
    `| Response to display | ${summary.clientTiming?.displayCount ?? 0} samples | ${display(summary.clientTiming?.responseToDisplayAverageMs, " ms avg")} | — |`,
    `| Response to TTS start | ${summary.clientTiming?.ttsStartCount ?? 0} samples | ${display(summary.clientTiming?.responseToTtsStartAverageMs, " ms avg")} | — |`,
    `| Speech queue wait | ${summary.clientTiming?.ttsStartCount ?? 0} samples | ${display(summary.clientTiming?.speechQueueWaitAverageMs, " ms avg")} | — |`,
    `| TTS preparation | ${summary.clientTiming?.ttsStartCount ?? 0} samples | ${display(summary.clientTiming?.ttsPreparationAverageMs, " ms avg")} | — |`,
    `| Speech duration | ${summary.clientTiming?.ttsCompleteCount ?? 0} samples | ${display(summary.clientTiming?.speechDurationAverageMs, " ms avg")} | — |`,
    `| Superseded speech | ${summary.clientTiming?.ttsSupersededCount ?? 0} events | ${summary.clientTiming?.staleSpeechPreventedCount ?? 0} stale plays prevented | — |`,
    "",
    "## Alerts and review",
    "",
    `Alert counts: P0=${summary.alertCounts?.P0 ?? 0}, P1=${summary.alertCounts?.P1 ?? 0}, P2=${summary.alertCounts?.P2 ?? 0}, P3=${summary.alertCounts?.P3 ?? 0}.`,
    `Human review: ${summary.humanReview?.status || "missing"}; average=${display(summary.humanReview?.average)}; reviews=${display(summary.humanReview?.reviewCount)}.`,
    "",
    "Severity definitions:",
    "",
    ...Object.entries(SEVERITY_DEFINITIONS).map(([severity, definition]) => `- **${severity}:** ${definition}`),
    "",
    "Zero is an observed zero. `missing` means the source did not provide that telemetry.",
    "",
  ];
  return lines.join("\n");
}

function main() {
  const inputPath = arg("--input");
  const outputPath = path.resolve(arg("--output", "validation/ask-snoozer-quality-report.latest.md"));
  const reviewPath = arg("--reviews");
  const minutes = Number(arg("--minutes", "60"));
  const logGroup = arg("--log-group", "/aws/lambda/snoozer-backend");
  const events = inputPath ? loadInput(inputPath) : loadCloudWatch({ minutes, logGroup });
  const reviews = loadReviews(reviewPath);
  const summary = aggregateAskSnoozerQualityTraces(events, reviews);
  const report = renderMarkdown(summary, {
    source: inputPath ? path.resolve(inputPath) : `${logGroup} (last ${minutes} minutes)`,
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, report);
  console.log(JSON.stringify({ outputPath, eventCount: events.length, summary }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { extractEvents, loadCloudWatch, renderMarkdown };
