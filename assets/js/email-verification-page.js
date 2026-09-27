(function () {
  "use strict";

  const form = document.querySelector("#verification-form");
  const message = document.querySelector("#verification-message");
  const submit = document.querySelector("#verification-submit");
  const copy = {
    ready: [
      "Confirmez votre adresse e-mail",
      "Sélectionnez le bouton pour confirmer votre adresse e-mail.",
    ],
    verifying: [
      "Vérification en cours",
      "Vérification de votre adresse e-mail…",
    ],
    success: [
      "Adresse e-mail confirmée",
      "Votre adresse e-mail est confirmée.",
    ],
    invalid: ["Lien non valide", "Ce lien de vérification n’est plus valide."],
    failure: [
      "Vérification indisponible",
      "Impossible de vérifier votre adresse e-mail pour le moment.",
    ],
  };

  function show(state) {
    const [heading, text] = copy[state];
    message.querySelector("h1").textContent = heading;
    message.querySelector("p").textContent = text;
    message.setAttribute("aria-live", "polite");
    form.hidden = state !== "ready";
  }

  let credential = window.IgloueEmailVerification.credentialFromHash(
    window.location.hash,
  );
  // Strip the credential before any network activity, retaining no browser history copy.
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
  if (!credential) show("invalid");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!credential || submit.disabled) return;
    submit.disabled = true;
    show("verifying");
    const heldCredential = credential;
    credential = null;
    const state = await window.IgloueEmailVerification.submitCredential(
      heldCredential,
      async (value) => {
        const config = window.IGLOUE_SUPABASE_CONFIG || {};
        const response = await fetch(
          config.projectUrl + "/functions/v1/verify-email",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              apikey: config.publishableKey,
            },
            cache: "no-store",
            referrerPolicy: "no-referrer",
            body: JSON.stringify({ credential: value }),
          },
        );
        if (!response.ok) return false;
        const result = await response.json();
        return result && result.ok === true;
      },
    );
    show(state);
  });
})();
