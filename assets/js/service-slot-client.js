(function createServiceSlotClient(global) {
  const endpointName = "service-slot-availability";
  const pending = new Map();

  function getConfig() {
    const config = global.IGLOUE_SUPABASE_CONFIG || {};
    const projectUrl = String(config.projectUrl || "").replace(/\/+$/, "");
    const publishableKey = String(config.publishableKey || "");
    if (!projectUrl || !publishableKey || /YOUR_PROJECT_REF|REPLACE_WITH_PROJECT_KEY/i.test(projectUrl + publishableKey)) {
      throw new Error("PUBLIC_CONFIGURATION_ERROR");
    }
    return { projectUrl, publishableKey };
  }

  function validRequest(value) {
    return value && typeof value.productId === "string" && value.productId.trim() &&
      typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
      ["delivery", "collection"].includes(value.serviceType);
  }

  function validPricing(value) {
    return value && typeof value === "object" && [value.currentRental, value.proposedRental, value.rentalImpact,
      value.deliveryCharge, value.collectionCharge, value.setupCharge, value.expressCharge, value.schedulingSurcharge,
      value.currentTotal, value.total, value.delta]
      .every(Number.isFinite) && value.currency === "EUR" && value.vat?.status === "not_configured";
  }

  async function loadAvailability(input) {
    if (!validRequest(input)) throw new Error("INVALID_SERVICE_SLOT_REQUEST");
    const request = { productId: input.productId, date: input.date, serviceType: input.serviceType,
      includeAlternatives: input.includeAlternatives === true,
      ...(input.includeAlternatives === true ? { quoteContext: input.quoteContext } : {}) };
    const key = JSON.stringify(request);
    if (pending.has(key)) return pending.get(key);
    const operation = (async () => {
      const config = getConfig();
      const response = await global.fetch(`${config.projectUrl}/functions/v1/${endpointName}`, {
        method: "POST",
        headers: { apikey: config.publishableKey, "content-type": "application/json" },
        body: JSON.stringify({ productId: request.productId, serviceDate: request.date, serviceType: request.serviceType,
          ...(request.includeAlternatives ? { includeAlternatives: true, quoteContext: request.quoteContext } : {}) }),
      });
      let payload;
      try { payload = await response.json(); } catch { throw new Error("SERVICE_SCHEDULE_UNAVAILABLE"); }
      if (!response.ok || !payload || payload.ok !== true || !Array.isArray(payload.windows) ||
        payload.serviceDate !== request.date || payload.serviceType !== request.serviceType) {
        throw new Error("SERVICE_SCHEDULE_UNAVAILABLE");
      }
      const slots = payload.windows.filter((slot) => slot && typeof slot.id === "string" &&
        typeof slot.label === "string" && typeof slot.startTime === "string" && typeof slot.endTime === "string" &&
        typeof slot.timeZone === "string" && Number.isInteger(slot.remainingCapacity) && typeof slot.available === "boolean");
      global.IGLOUE_SERVICE_WINDOW_CACHE?.setAvailableSlots(request, slots);
      let alternatives = null;
      if (request.includeAlternatives && payload.alternatives && typeof payload.alternatives === "object") {
        const normalizeSide = (side) => {
          if (side === null) return null;
          if (!side || typeof side.date !== "string" || typeof side.timeZone !== "string" || !Array.isArray(side.windows) || !validPricing(side.pricing)) return undefined;
          const windows = side.windows.filter((window) => window && typeof window.id === "string" && typeof window.label === "string" &&
            typeof window.startTime === "string" && typeof window.endTime === "string");
          return windows.length ? { date: side.date, timeZone: side.timeZone, windows, pricing: side.pricing } : null;
        };
        const earlier = normalizeSide(payload.alternatives.earlier);
        const later = normalizeSide(payload.alternatives.later);
        if (earlier !== undefined && later !== undefined) {
          alternatives = { earlier, later, horizonDays: 14 };
        }
      }
      return { windows: slots.filter((slot) => slot.available), alternatives };
    })().finally(() => pending.delete(key));
    pending.set(key, operation);
    return operation;
  }

  async function loadAvailableSlots(input) { return (await loadAvailability(input)).windows; }
  global.IGLOUE_SERVICE_SLOT_CLIENT = Object.freeze({ loadAvailableSlots, loadAvailability });
})(window);
