const TOPIC_ROOT = "mysnoozepod";

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function parseMqttTopic(topic) {
  const rawTopic = cleanString(topic);
  const parts = rawTopic.split("/").filter(Boolean);

  if (!rawTopic || parts[0] !== TOPIC_ROOT || parts[2] !== "stores") {
    return {
      ok: false,
      topic: rawTopic,
      errors: ["UNSUPPORTED_TOPIC_SHAPE"],
    };
  }

  const base = {
    ok: true,
    topic: rawTopic,
    env: parts[1],
    storeId: parts[3],
    scope: parts[4],
  };

  if (parts.length === 7 && parts[4] === "zones" && parts[6] === "events") {
    return {
      ...base,
      kind: "zone-events",
      zoneId: parts[5],
    };
  }

  if (parts.length === 7 && parts[4] === "devices") {
    const topicType = parts[6];
    if (["heartbeat", "fault", "status"].includes(topicType)) {
      return {
        ...base,
        kind: `device-${topicType}`,
        deviceId: parts[5],
      };
    }
  }

  return {
    ok: false,
    topic: rawTopic,
    errors: ["UNSUPPORTED_TOPIC_SHAPE"],
  };
}

function validateTopicMatchesEvent(topicInfo, event) {
  const errors = [];

  if (!topicInfo?.ok) {
    errors.push(...(topicInfo?.errors || ["UNSUPPORTED_TOPIC_SHAPE"]));
    return errors;
  }

  if (topicInfo.env !== event.env) errors.push("TOPIC_ENV_MISMATCH");
  if (topicInfo.storeId !== event.storeId) errors.push("TOPIC_STORE_MISMATCH");

  if (topicInfo.kind === "zone-events") {
    if (topicInfo.zoneId !== event.zoneId) errors.push("TOPIC_ZONE_MISMATCH");
    return errors;
  }

  if (topicInfo.kind === "device-heartbeat") {
    if (topicInfo.deviceId !== event.deviceId) errors.push("TOPIC_DEVICE_MISMATCH");
    if (event.eventType !== "device_heartbeat") errors.push("TOPIC_EVENT_TYPE_MISMATCH");
    return errors;
  }

  if (topicInfo.kind === "device-fault") {
    if (topicInfo.deviceId !== event.deviceId) errors.push("TOPIC_DEVICE_MISMATCH");
    if (event.eventType !== "device_fault") errors.push("TOPIC_EVENT_TYPE_MISMATCH");
    return errors;
  }

  if (topicInfo.kind === "device-status") {
    if (topicInfo.deviceId !== event.deviceId) errors.push("TOPIC_DEVICE_MISMATCH");
    if (!["device_heartbeat", "manual_override"].includes(event.eventType)) {
      errors.push("TOPIC_EVENT_TYPE_MISMATCH");
    }
  }

  return errors;
}

module.exports = {
  parseMqttTopic,
  validateTopicMatchesEvent,
};
