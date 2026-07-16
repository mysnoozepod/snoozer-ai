const METRIC_NAMESPACE = "MySnoozePod/IoT";

function emitIotMetric(metricName, dimensions = {}, options = {}) {
  const sink = options.metricSink || console.log;
  const payload = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: METRIC_NAMESPACE,
          Dimensions: [["env", "storeId"]],
          Metrics: [{ Name: metricName, Unit: "Count" }],
        },
      ],
    },
    env: dimensions.env || "unknown",
    storeId: dimensions.storeId || "unknown",
    zoneId: dimensions.zoneId || "unknown",
    deviceId: dimensions.deviceId || "unknown",
    [metricName]: 1,
  };

  sink(JSON.stringify(payload));
}

module.exports = {
  METRIC_NAMESPACE,
  emitIotMetric,
};
