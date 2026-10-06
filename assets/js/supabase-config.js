(function configureIgloueSupabase(global) {
  // Browser-safe public configuration. Hosted values remain the default.
  const hosted = {
    projectUrl: "https://ksciaqmlvdycrnoqjzgt.supabase.co",
    publishableKey: "sb_publishable_IG_lvSMc3xrNA_8sirNouA_fYlW4r9x",
    verificationGatewayUrl: "",
    backend: "hosted"
  };

  const staging = {
    projectUrl: "https://fxhdxilvbzojkyyhktnu.supabase.co",
    publishableKey: "sb_publishable_S3ZxgVBNinu51_rSlB_L2w_HuYZ-pN-",
    verificationGatewayUrl: "https://igloue-customer-email-verification-gateway.plain-lab-58bb.workers.dev/customer-email-verification",
    backend: "staging"
  };

  const localHostnames = new Set(["localhost", "127.0.0.1"]);
  const location = global.location || {};
  const useLocal = localHostnames.has(String(location.hostname || "").toLowerCase()) &&
    /(?:^|&)ig-dev-backend=local(?:&|$)/.test(String(location.search || "").replace(/^\?/, ""));
  // Temporary deployment-environment routing only. Hostname never selects a
  // tenant; A27A3 tenant access is derived exclusively from the bearer token.
  const hostname = String(location.hostname || "").toLowerCase();
  const knownHosted = new Set(["igloue.fr", "www.igloue.fr", "test.igloue.fr", "app.igloue.eu", "test.app.igloue.eu"]);
  const useStaging = hostname === "test.igloue.fr" || hostname === "test.app.igloue.eu";

  const local = {
    projectUrl: "http://127.0.0.1:54321",
    publishableKey: "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
    verificationGatewayUrl: "http://127.0.0.1:8787/customer-email-verification",
    backend: "local"
  };

  global.IGLOUE_SUPABASE_CONFIG = Object.freeze(useLocal ? local : !knownHosted.has(hostname) ? null : useStaging ? staging : hosted);
})(window);
