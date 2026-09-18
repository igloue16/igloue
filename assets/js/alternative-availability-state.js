(function createIgloueAlternativeAvailabilityState(global) {
  const selectionFields = [
    "startDate",
    "endDate",
    "deliverySlotId",
    "collectionSlotId"
  ];

  function selectionKey(selection = {}) {
    return selectionFields
      .map((field) => String(selection[field] || ""))
      .join("|");
  }

  function candidateKey(selection, candidates) {
    return `${selectionKey(selection)}::${candidates
      .map((candidate) => candidate.id)
      .join(",")}`;
  }

  function create(request) {
    let state = {
      status: "idle",
      key: "",
      candidates: [],
      results: [],
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
        candidates: [],
        results: [],
        error: ""
      };
      return state;
    }

    function check(selection, candidates = []) {
      const normalizedCandidates = candidates.filter(
        (candidate) => candidate && candidate.id
      );
      const key = candidateKey(selection, normalizedCandidates);

      if (
        state.key === key &&
        state.status !== "idle"
      ) {
        return pending || Promise.resolve({ ...state });
      }

      const requestGeneration = ++generation;
      const baseSelection = {
        startDate: selection.startDate,
        endDate: selection.endDate,
        deliverySlotId: selection.deliverySlotId,
        collectionSlotId: selection.collectionSlotId
      };

      state = {
        status: normalizedCandidates.length ? "checking" : "complete",
        key,
        candidates: normalizedCandidates.map((candidate) => candidate.id),
        results: [],
        error: ""
      };

      if (!normalizedCandidates.length) {
        pending = Promise.resolve({ ...state });
        return pending;
      }

      pending = (async () => {
        const results = [];

        for (const candidate of normalizedCandidates) {
          let result;

          try {
            const response = await request({
              ...baseSelection,
              productId: candidate.id
            });
            result = {
              productId: candidate.id,
              status:
                response &&
                ["available", "unavailable", "error"].includes(response.status)
                  ? response.status
                  : "error",
              available:
                response && typeof response.available === "boolean"
                  ? response.available
                  : null,
              error:
                response && response.status === "error"
                  ? response.error || "Erreur de disponibilité."
                  : ""
            };
          } catch (error) {
            result = {
              productId: candidate.id,
              status: "error",
              available: null,
              error:
                error instanceof Error
                  ? error.message
                  : "Erreur de disponibilité."
            };
          }

          results.push(result);

          if (requestGeneration !== generation || state.key !== key) {
            return { ...state };
          }

          state = {
            ...state,
            results: [...results]
          };
        }

        const hasError = results.some((result) => result.status === "error");
        state = {
          ...state,
          status: "complete",
          results: [...results],
          error: hasError ? "Certaines alternatives n’ont pas pu être vérifiées." : ""
        };
        return { ...state };
      })();

      return pending;
    }

    return {
      check,
      reset,
      getState: () => ({
        ...state,
        candidates: [...state.candidates],
        results: state.results.map((result) => ({ ...result }))
      }),
      selectionKey,
      candidateKey
    };
  }

  global.IGLOUE_ALTERNATIVE_AVAILABILITY_STATE = Object.freeze({
    create,
    selectionKey,
    candidateKey
  });
})(window);
