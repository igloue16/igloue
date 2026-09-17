import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  createOptionsResponse,
  handleAvailabilityRequest,
} from "./handler.ts";

const authenticatedHandler = withSupabase(
  { auth: ["publishable"] },
  async (request, context) =>
    await handleAvailabilityRequest(request, {
      supabaseAdmin: context.supabaseAdmin,
      logError: console.error,
    }),
);

export default {
  fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return createOptionsResponse();
    }

    return authenticatedHandler(request);
  },
};
