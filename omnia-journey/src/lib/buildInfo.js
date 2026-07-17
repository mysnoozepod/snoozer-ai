export const BUILD_INFO = Object.freeze({
  commit:
    typeof __SNOOZE_BUILD_COMMIT__ !== "undefined"
      ? __SNOOZE_BUILD_COMMIT__
      : "unknown",
  timestamp:
    typeof __SNOOZE_BUILD_TIMESTAMP__ !== "undefined"
      ? __SNOOZE_BUILD_TIMESTAMP__
      : "",
  version:
    typeof __SNOOZE_FRONTEND_VERSION__ !== "undefined"
      ? __SNOOZE_FRONTEND_VERSION__
      : "unknown",
});

if (typeof window !== "undefined") {
  window.__SNOOZE_BUILD_INFO = BUILD_INFO;
}

export default BUILD_INFO;
