import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  createPaymentOperatorDependencies,
  handlePaymentOperatorRequest,
} from "./handler.ts";

const paymentOperatorHandler = withSupabase(
  { auth: ["secret"] },
  async (request, context) => {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (!serviceRoleKey) {
      return Response.json({
        ok: false,
        error: { code: "OPERATOR_UNAVAILABLE", retryable: true },
      }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return await handlePaymentOperatorRequest(
      request,
      createPaymentOperatorDependencies(context.supabaseAdmin, serviceRoleKey),
    );
  },
);

export default {
  fetch(request: Request) {
    return paymentOperatorHandler(request);
  },
};
