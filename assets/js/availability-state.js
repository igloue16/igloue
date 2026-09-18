(function createIgloueAvailabilityState(global) {
  const fields = [
    "productId",
    "startDate",
    "endDate",
    "deliverySlotId",
    "collectionSlotId"
  ];

  function selectionKey(selection = {}) {
    return fields.map((field) => String(selection[field] || "")).join("|");
  }

  function isComplete(selection = {}) {
    return fields.every((field) => String(selection[field] || "").length > 0);
  }

  function create(request) {
    let state = {
      status: "idle",
      key: "",
      productId: null,
      available: null,
      error: ""
    };
    let generation = 0;
    let pending = null;

    function reset() {
      generation += 1;
      pending = null;
      state = {
        status: "idle",
        key: "",
        productId: null,
        available: null,
        error: ""
      };
      return state;
    }

    function check(selection, { force = false } = {}) {
      const key = selectionKey(selection);
      if (!isComplete(selection)) {
        reset();
        return Promise.resolve(state);
      }

      if (!force && state.key === key && state.status !== "idle") {
        return pending || Promise.resolve(state);
      }

      const requestGeneration = ++generation;
      state = {
        status: "checking",
        key,
        productId: selection.productId,
        available: null,
        error: ""
      };

      pending = Promise.resolve()
        .then(() => request(selection))
        .then((result) => ({
          status: result && (result.status === "available" || result.status === "unavailable")
            ? result.status
            : "error",
          key,
          productId: selection.productId,
          available: result && typeof result.available === "boolean"
            ? result.available
            : null,
          error: result && result.status === "error"
            ? (result.error || "Erreur de disponibilité.")
            : ""
        }))
        .catch((error) => ({
          status: "error",
          key,
          productId: selection.productId,
          available: null,
          error: error instanceof Error ? error.message : "Erreur de disponibilité."
        }))
        .then((result) => {
          if (requestGeneration === generation && key === state.key) {
            state = result;
          }
          return result;
        });

      return pending;
    }

    return {
      check,
      reset,
      getState: () => ({ ...state }),
      selectionKey,
      isComplete
    };
  }

  global.IGLOUE_AVAILABILITY_STATE = Object.freeze({
    create,
    selectionKey,
    isComplete
  });
})(window);
