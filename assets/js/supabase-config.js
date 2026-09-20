(function configureIgloueSupabase(global) {
  // Browser-safe public configuration. Hosted values remain the default.
  const hosted = {
    projectUrl: "https://ksciaqmlvdycrnoqjzgt.supabase.co",
    publishableKey: "sb_publishable_IG_lvSMc3xrNA_8sirNouA_fYlW4r9x",
    backend: "hosted"
  };

  const localHostnames = new Set(["localhost", "127.0.0.1"]);
  const location = global.location || {};
  const useLocal = localHostnames.has(String(location.hostname || "").toLowerCase()) &&
    /(?:^|&)ig-dev-backend=local(?:&|$)/.test(String(location.search || "").replace(/^\?/, ""));

  const local = {
    projectUrl: "http://127.0.0.1:54321",
    publishableKey: "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
    backend: "local"
  };

  global.IGLOUE_SUPABASE_CONFIG = Object.freeze(useLocal ? local : hosted);
})(window);
