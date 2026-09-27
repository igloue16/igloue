(function (global) {
  "use strict";

  function credentialFromHash(hash) {
    const match = /^#credential=([A-Za-z0-9_-]{43})$/.exec(String(hash || ""));
    return match ? match[1] : null;
  }

  async function submitCredential(credential, submit) {
    if (
      typeof credential !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(credential)
    ) return "invalid";
    try {
      const result = await submit(credential);
      return result === true ? "success" : "invalid";
    } catch {
      return "failure";
    }
  }

  const api = Object.freeze({ credentialFromHash, submitCredential });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.IgloueEmailVerification = api;
})(typeof window !== "undefined" ? window : globalThis);
