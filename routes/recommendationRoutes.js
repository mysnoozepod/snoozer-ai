async function handleRecommendationRoutes({ event, method, routePath, deps = {} }) {
  const { response, recsService, getSeedRecommendations, recommendationResolver, safeJsonBody } =
    deps;

  if (method === "GET" && routePath.startsWith("/recommendations/")) {
    const shopperId = decodeURIComponent(routePath.split("/").pop() || "guest");

    let recs;
    if (recsService && typeof recsService.getRecommendations === "function") {
      recs = await recsService.getRecommendations(shopperId, { mode: "explore" });
    } else {
      recs = await getSeedRecommendations(shopperId);
    }

    return response(event, 200, recs);
  }

  if (method === "POST" && routePath === "/recommendations/resolve") {
    if (!recommendationResolver || typeof recommendationResolver.resolveRecommendation !== "function") {
      return response(event, 500, {
        ok: false,
        code: "E_RECOMMENDATION_RESOLVER_UNAVAILABLE",
        message: "Recommendation resolver unavailable.",
      });
    }

    try {
      const body = safeJsonBody(event);
      const resolved = await recommendationResolver.resolveRecommendation(body || {});
      return response(event, 200, resolved);
    } catch (error) {
      return response(event, Number(error.statusCode || 500), {
        ok: false,
        code: error.code || "E_RECOMMENDATION_RESOLVE",
        message: error.message || "Unable to resolve recommendations.",
      });
    }
  }

  return null;
}

module.exports = {
  handleRecommendationRoutes,
};
