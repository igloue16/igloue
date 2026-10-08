/* Customer slot labels and capacity are cached only from the tenant-scoped
   service-slot-availability backend response. There is no browser-side schedule. */
(function createServiceWindowCache(global) {
  const cache = new Map();

  function requestKey({ productId, date, serviceType }) {
    return [productId, date, serviceType].map((value) => String(value || "")).join("|");
  }

  function setAvailableSlots(request, slots) {
    if (!request || !Array.isArray(slots)) return false;
    cache.set(requestKey(request), slots.filter((slot) => slot && typeof slot.id === "string"));
    return true;
  }

  function getAvailableSlots(request = {}) {
    return (cache.get(requestKey(request)) || []).filter((slot) => slot.available === true);
  }

  function getWindowById(slotId, request = {}) {
    return (cache.get(requestKey(request)) || []).find((slot) => slot.id === slotId) || null;
  }

  function clear() {
    cache.clear();
  }

  const provider = Object.freeze({
    setAvailableSlots,
    getAvailableSlots,
    getWindowById,
    evaluateSlots: (request) => (cache.get(requestKey(request)) || []).slice(),
    hasAvailableSameDaySlot({ deliveryDate, nowDate, productId } = {}) {
      const date = deliveryDate || nowDate;
      if (!date) return false;
      if (productId) {
        return getAvailableSlots({ productId, date, serviceType: "delivery" }).length > 0;
      }
      for (const [key, slots] of cache.entries()) {
        if (key.endsWith(`|${date}|delivery`) && slots.some((slot) => slot.available === true)) return true;
      }
      return false;
    },
    clear,
  });

  global.IGLOUE_DELIVERY_SLOT_PROVIDER = provider;
  global.IGLOUE_SERVICE_WINDOW_CACHE = provider;
})(window);
