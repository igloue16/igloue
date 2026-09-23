import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  createCheckoutOptionsResponse,
  createProductionDependencies,
  handleCheckoutRequest,
} from "./handler.ts";

const authenticatedHandler = withSupabase(
  { auth: ["publishable", "secret"] },
  async (request, context) => {
    if (request.method === "OPTIONS") return createCheckoutOptionsResponse();
    try {
      return await handleCheckoutRequest(request, createProductionDependencies(context.supabaseAdmin));
    } catch {
      return Response.json({ ok: false, error: { code: "INTERNAL_ERROR" } }, { status: 500 });
    }
  },
);

export default {
  fetch(request: Request) {
    return authenticatedHandler(request);
  },
};
