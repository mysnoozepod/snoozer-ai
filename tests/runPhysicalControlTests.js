const assert = require("assert");

const {
  buildCommandTopic,
  deriveCommandTimeoutResult,
  normalizeAck,
  normalizeReportedState,
  processPhysicalControlAck,
  processPhysicalReportedState,
  validatePhysicalCommand,
} = require("../services/iot/physicalControl");

function createMockDdb() {
  const commands = new Map();
  const reported = new Map();
  const calls = [];
  return {
    calls,
    commands,
    reported,
    async send(command) {
      calls.push(command.constructor.name);
      const input = command.input || {};
      if (command.constructor.name === "PutCommand") {
        const key = `${input.Item.PK}|${input.Item.SK}`;
        if (commands.has(key)) {
          const error = new Error("ConditionalCheckFailedException");
          error.name = "ConditionalCheckFailedException";
          throw error;
        }
        commands.set(key, input.Item);
        return {};
      }
      if (command.constructor.name === "GetCommand") {
        const key = `${input.Key.PK}|${input.Key.SK}`;
        return { Item: commands.get(key) || null };
      }
      if (command.constructor.name === "UpdateCommand") {
        const key = `${input.Key.PK}|${input.Key.SK}`;
        const target = input.Key.PK.startsWith("COMMAND#") ? commands : reported;
        const existing = target.get(key) || { ...input.Key };
        const values = input.ExpressionAttributeValues || {};
        const names = input.ExpressionAttributeNames || {};
        const next = { ...existing };
        for (const [nameKey, attr] of Object.entries(names)) {
          const valueKey = `:${nameKey.slice(1)}`;
          if (Object.prototype.hasOwnProperty.call(values, valueKey)) {
            next[attr] = values[valueKey];
          }
        }
        for (const [valueKey, value] of Object.entries(values)) {
          const attr = valueKey.slice(1);
          if (!next[attr] && !attr.startsWith("gsi")) next[attr] = value;
        }
        target.set(key, next);
        return { Attributes: next };
      }
      return {};
    },
  };
}

const registry = {
  registryVersion: "test",
  env: "prod",
  storeId: "severn-pilot",
  zones: new Map([
    ["pod-3", { zoneId: "pod-3", zoneType: "pod", podId: "pod-3" }],
    ["help", { zoneId: "help", zoneType: "support" }],
  ]),
  devices: new Map([
    [
      "pod-3-edge-01",
      {
        deviceId: "pod-3-edge-01",
        env: "prod",
        storeId: "severn-pilot",
        enabled: true,
        zoneIds: ["pod-3"],
        outputs: [{ outputId: "pod-3-lighting-01", outputType: "lighting-zone", enabled: true }],
      },
    ],
    [
      "showroom-zone-edge-01",
      {
        deviceId: "showroom-zone-edge-01",
        env: "prod",
        storeId: "severn-pilot",
        enabled: true,
        zoneIds: ["help"],
        outputs: [{ outputId: "showroom-ambient-audio-01", outputType: "ambient-audio", enabled: true }],
      },
    ],
  ]),
};

function opts(extra = {}) {
  return {
    registry,
    env: "prod",
    storeId: "severn-pilot",
    commandTable: "physical",
    broadcast: false,
    metricSink: () => {},
    clock: () => new Date("2026-07-16T12:00:00.000Z"),
    ...extra,
  };
}

async function run() {
  assert.strictEqual(
    buildCommandTopic({ env: "prod", storeId: "severn-pilot", deviceId: "pod-3-edge-01" }),
    "mysnoozepod/prod/stores/severn-pilot/devices/pod-3-edge-01/commands"
  );

  const lighting = validatePhysicalCommand(
    {
      commandId: "cmd-lighting",
      commandType: "set_lighting_state",
      zoneId: "pod-3",
      desiredState: { lightingState: "rest-test" },
    },
    opts()
  );
  assert.strictEqual(lighting.ok, true);
  assert.strictEqual(lighting.command.deviceId, "pod-3-edge-01");

  const audio = validatePhysicalCommand(
    {
      commandId: "cmd-audio",
      commandType: "set_audio_state",
      desiredState: { audioState: "playing" },
    },
    opts()
  );
  assert.strictEqual(audio.ok, true);
  assert.strictEqual(audio.command.zoneId, "help");
  assert.strictEqual(audio.command.deviceId, "showroom-zone-edge-01");

  const unauthorized = validatePhysicalCommand(
    {
      commandType: "set_lighting_state",
      zoneId: "pod-3",
      deviceId: "showroom-zone-edge-01",
      desiredState: { lightingState: "active" },
    },
    opts()
  );
  assert.strictEqual(unauthorized.ok, false);
  assert(unauthorized.errors.includes("DEVICE_ZONE_NOT_AUTHORIZED"));

  const ddb = createMockDdb();
  ddb.commands.set("COMMAND#cmd-ack|STATUS", {
    PK: "COMMAND#cmd-ack",
    SK: "STATUS",
    commandId: "cmd-ack",
    deviceId: "pod-3-edge-01",
    storeId: "severn-pilot",
    zoneId: "pod-3",
    desiredState: { lightingState: "rest-test" },
    status: "sent",
  });

  const ack = normalizeAck(
    {
      commandId: "cmd-ack",
      status: "applied",
      zoneId: "pod-3",
      appliedState: { lightingState: "rest-test" },
    },
    {
      env: "prod",
      storeId: "severn-pilot",
      deviceId: "pod-3-edge-01",
    },
    opts()
  );
  assert.strictEqual(ack.status, "applied");
  assert.strictEqual(ack.appliedState.lightingState, "rest-test");

  const ackResult = await processPhysicalControlAck(
    {
      mqttTopic: "mysnoozepod/prod/stores/severn-pilot/devices/pod-3-edge-01/ack",
      payload: {
        commandId: "cmd-ack",
        status: "applied",
        zoneId: "pod-3",
        appliedState: { lightingState: "rest-test" },
      },
    },
    opts({ ddbDoc: ddb })
  );
  assert.strictEqual(ackResult.ok, true);
  assert.strictEqual(ackResult.status, "applied");

  const mismatch = await processPhysicalControlAck(
    {
      mqttTopic: "mysnoozepod/prod/stores/severn-pilot/devices/showroom-zone-edge-01/ack",
      payload: {
        commandId: "cmd-ack",
        status: "applied",
        zoneId: "pod-3",
      },
    },
    opts({ ddbDoc: ddb })
  );
  assert.strictEqual(mismatch.ok, false);
  assert(mismatch.reasonCodes.includes("ACK_DEVICE_MISMATCH"));

  const reported = normalizeReportedState(
    {
      zoneId: "pod-3",
      reportedState: { lightingState: "complete" },
    },
    {
      env: "prod",
      storeId: "severn-pilot",
      deviceId: "pod-3-edge-01",
    },
    opts()
  );
  assert.strictEqual(reported.reportedState.lightingState, "complete");

  const reportedResult = await processPhysicalReportedState(
    {
      mqttTopic: "mysnoozepod/prod/stores/severn-pilot/devices/pod-3-edge-01/reported-state",
      payload: {
        zoneId: "pod-3",
        reportedState: { lightingState: "ready" },
      },
    },
    opts({ ddbDoc: ddb })
  );
  assert.strictEqual(reportedResult.ok, true);

  assert.deepStrictEqual(
    deriveCommandTimeoutResult({
      status: "sent",
      attempts: 1,
      maxAttempts: 2,
      expiresAt: "2026-07-16T11:59:59.000Z",
    }, { now: "2026-07-16T12:00:00.000Z" }),
    { action: "retry", status: "retrying", nextAttempts: 2 }
  );

  assert.deepStrictEqual(
    deriveCommandTimeoutResult({
      status: "sent",
      attempts: 2,
      maxAttempts: 2,
      expiresAt: "2026-07-16T11:59:59.000Z",
    }, { now: "2026-07-16T12:00:00.000Z" }),
    { action: "fail", status: "failed", reason: "COMMAND_ACK_TIMEOUT" }
  );

  console.log("Physical control tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
