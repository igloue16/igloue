import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  createExecutionDependencies,
  handleExecuteRefundRequest,
} from "./handler.ts";
import { createStripeRefundAdapter } from "./stripe.ts";
import {
  parseExpectedLivemode,
  stripeSecretMatchesExpectedLivemode,
} from "../stripe-webhook/config.ts";

const refundHandler = withSupabase(
  { auth: ["secret"] },
  async (request, context) => {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY")?.trim();
    const expectedLivemode = parseExpectedLivemode(
      Deno.env.get("STRIPE_EXPECTED_LIVEMODE"),
    );
    if (
      !serviceRoleKey || !stripeSecret ||
      !stripeSecretMatchesExpectedLivemode(stripeSecret, expectedLivemode)
    ) {
      return Response.json({
        ok: false,
        error: { code: "REFUND_EXECUTION_UNAVAILABLE" },
      }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return await handleExecuteRefundRequest(
      request,
      createExecutionDependencies(
        context.supabaseAdmin,
        createStripeRefundAdapter(stripeSecret),
        serviceRoleKey,
      ),
    );
  },
);

export default {
  fetch(request: Request) {
    return refundHandler(request);
  },
};
