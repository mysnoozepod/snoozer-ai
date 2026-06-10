#!/usr/bin/env node

const assert = require("assert");

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

function buildEvent(path, body) {
  return {
    version: "2.0",
    routeKey: `POST ${path}`,
    rawPath: path,
    headers: {
      "content-type": "application/json",
      host: "local.customer-profile.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: {
        method: "POST",
        path,
        sourceIp: "127.0.0.1",
        userAgent: "customer-profile-route-skip-smoke",
      },
      requestId: `${path}-${Date.now()}`,
      routeKey: `POST ${path}`,
      stage: "local",
      timeEpoch: Date.now(),
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function parseBody(response) {
  assert.strictEqual(response.statusCode, 200, "expected HTTP 200");
  return JSON.parse(response.body);
}

async function invokeRoute(path, body) {
  const { lambdaHandler } = require("../index");
  return parseBody(await lambdaHandler(buildEvent(path, body)));
}

async function main() {
  const captured = [];

  console.log = function patchedConsoleLog(...args) {
    const line = args
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ");
    captured.push(line);
    originalConsoleLog(...args);
  };

  console.error = function patchedConsoleError(...args) {
    const line = args
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ");
    captured.push(line);
    originalConsoleError(...args);
  };

  delete process.env.CUSTOMER_PROFILE_TABLE;

  try {
    const assessmentBody = await invokeRoute("/assessment", {
      shopperId: "profile-route-smoke",
      origin: "assessment_api",
      answers: {
        size: "Queen",
        motionMode: "No Motion",
        firmness: "Soft",
        sleepPosition: "Side",
        sleepPartner: "No",
        baseType: "No Base",
      },
    });
    assert.strictEqual(assessmentBody.ok, true, "assessment route should still succeed");

    const hudBody = await invokeRoute("/hud/ask", {
      query: "Which mattress fits me?",
      path: "/pages/snooze-assessment",
      page_type: "page",
      context: {
        assessment: {
          size: "Queen",
          motionMode: "No Motion",
          firmness: "Soft",
          sleepPosition: "Side",
          sleepPartner: "No",
          baseType: "No Base",
        },
      },
    });
    assert.strictEqual(hudBody.status, "ok", "/hud/ask should still succeed");

    const askBody = await invokeRoute("/ask-snoozer", {
      message: "What do you recommend?",
      sessionId: "profile-route-smoke-session",
      context: {
        assessment: {
          size: "Queen",
          motionMode: "No Motion",
          firmness: "Soft",
          sleepPosition: "Side",
          sleepPartner: "No",
          baseType: "No Base",
        },
      },
    });
    assert.strictEqual(askBody.ok, true, "/ask-snoozer should still succeed");

    const routeSkipLines = captured.filter((line) =>
      (
        line.includes("\"src\":\"customer.profile.identity.skipped\"") ||
        line.includes("\"src\":\"customer.profile.hud.skipped\"") ||
        line.includes("\"src\":\"customer.profile.ask.skipped\"")
      ) && line.includes("CUSTOMER_PROFILE_TABLE_NOT_CONFIGURED")
    );
    const errorLines = captured.filter(
      (line) =>
        line.includes("\"src\":\"customer.profile.error\"") ||
        line.includes("\"src\":\"customer.profile.identity.error\"")
    );

    assert.strictEqual(
      routeSkipLines.length,
      3,
      "assessment, /hud/ask, and /ask-snoozer should each log a skipped profile outcome"
    );
    assert.strictEqual(errorLines.length, 0, "missing table config should not log profile errors");

    console.log("Customer profile route skip smoke passed.");
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }
}

main().catch((error) => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.error(error);
  process.exit(1);
});
