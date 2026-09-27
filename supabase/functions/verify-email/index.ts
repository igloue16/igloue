import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  createVerifyEmailOptionsResponse,
  handleVerifyEmailRequest,
} from "./handler.ts";

const publicHandler = withSupabase(
  { auth: ["publishable"] },
  async (request, context) => {
    if (request.method === "OPTIONS") return createVerifyEmailOptionsResponse();
    try {
      return await handleVerifyEmailRequest(request, {
        supabaseAdmin: context.supabaseAdmin,
      });
    } catch {
      return Response.json({
        ok: false,
        error: { code: "VERIFICATION_UNAVAILABLE" },
      }, {
        status: 503,
        headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" },
      });
    }
  },
);

export default {
  fetch(request: Request) {
    return publicHandler(request);
  },
};
