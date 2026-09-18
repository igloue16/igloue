import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { handleReservationRequest } from "./handler.ts";

const authenticatedHandler = withSupabase(
  { auth: ["publishable", "secret"] },
  async (request, context) =>
    await handleReservationRequest(request, {
      supabaseAdmin: context.supabaseAdmin,
      logError: console.error,
    }),
);

export default {
  fetch(request: Request) {
    return authenticatedHandler(request);
  },
};
