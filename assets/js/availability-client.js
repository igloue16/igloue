(function createAvailabilityClient(global) {
  const endpointName = "check-availability";

  function getConfig() {
    const config = global.IGLOUE_SUPABASE_CONFIG || {};
    const projectUrl = String(config.projectUrl || "").replace(/\/$/, "");
    const publishableKey = String(config.publishableKey || "");
    if (!projectUrl || /YOUR_PROJECT_REF|REPLACE_WITH_PROJECT_KEY/.test(projectUrl + publishableKey)) {
      throw new Error("La configuration Supabase publique est manquante.");
    }
    return { projectUrl, publishableKey };
  }

  function normaliseResponse(payload, requestedProductId) {
    if (!payload || payload.ok !== true || typeof payload.available !== "boolean" ||
        typeof payload.productId !== "string" || payload.productId !== requestedProductId) {
      throw new Error("Réponse de disponibilité invalide.");
    }
    return {
      status: payload.available ? "available" : "unavailable",
      available: payload.available,
      productId: payload.productId
    };
  }

  async function checkAvailability({ productId, startDate, endDate, deliverySlotId, collectionSlotId }) {
    try {
      const config = getConfig();
      const response = await global.fetch(`${config.projectUrl}/functions/v1/${endpointName}`, {
        method: "POST",
        headers: {
          apikey: config.publishableKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          productId,
          rental: { startDate, endDate },
          service: { deliverySlotId, collectionSlotId }
        })
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error("Réponse de disponibilité illisible.");
      }
      if (!response.ok) throw new Error("Service de disponibilité indisponible.");
      return normaliseResponse(payload, productId);
    } catch (error) {
      return {
        status: "error",
        available: null,
        productId: typeof productId === "string" ? productId : null,
        error: error instanceof Error ? error.message : "Erreur de disponibilité."
      };
    }
  }

  global.IGLOUE_AVAILABILITY_CLIENT = Object.freeze({ checkAvailability });
})(window);
