async function handleBookingRoutes({ event, method, routePath, traceId, deps = {} }) {
  const { response, bookingSessionService, safeJsonBody, log } = deps;

  if (
    method === "POST" &&
    (routePath === "/booking/calendly-webhook" || routePath === "/calendly/webhook")
  ) {
    if (
      !bookingSessionService ||
      typeof bookingSessionService.upsertBookingSession !== "function"
    ) {
      return response(event, 500, {
        ok: false,
        code: "E_BOOKING_WEBHOOK_UNAVAILABLE",
        message: "Booking webhook unavailable.",
      });
    }

    try {
      const body = safeJsonBody(event);
      const result = await bookingSessionService.upsertBookingSession(body || {}, {
        route: routePath,
        log: (src, msg, extra) => log(src, msg, extra),
      });

      return response(event, 200, {
        ok: true,
        shopperId: result?.identity?.shopperId || null,
        snoozeCode: result?.identity?.snoozeCode || result?.identity?.accessCode || null,
        accessCode: result?.identity?.accessCode || result?.identity?.snoozeCode || null,
        profileId: result?.identity?.profileId || null,
        identityType: result?.identity?.identityType || null,
        eventType: result?.booking?.eventType || null,
        bookingStatus: result?.profilePatch?.bookingStatus || null,
        sessionPrepStatus: result?.sessionPrep?.status || null,
        skipped: Boolean(result?.skipped),
        reason: result?.reason || null,
      });
    } catch (error) {
      log("booking.webhook.error", error.message, {
        traceId,
        route: routePath,
        code: error?.code || null,
      });
      return response(event, Number(error.statusCode || 500), {
        ok: false,
        code: error?.code || "E_BOOKING_WEBHOOK",
        message: error?.message || "Booking webhook failed.",
      });
    }
  }

  return null;
}

module.exports = {
  handleBookingRoutes,
};
