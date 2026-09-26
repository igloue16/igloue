import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  createRecoveryDependencies,
  createRefundRecoveryDependencies,
  handleRecoveryRequest,
} from "./handler.ts";
import { parseExpectedLivemode } from "../stripe-webhook/config.ts";

const recoveryHandler = withSupabase(
  { auth: ["secret"] },
  async (request, context) =>
    await handleRecoveryRequest(
      request,
      createRecoveryDependencies(
        context.supabaseAdmin,
        parseExpectedLivemode(Deno.env.get("STRIPE_EXPECTED_LIVEMODE")),
      ),
      createRefundRecoveryDependencies(
        context.supabaseAdmin,
        parseExpectedLivemode(Deno.env.get("STRIPE_EXPECTED_LIVEMODE")),
      ),
    ),
);

export default {
  fetch(request: Request) {
    return recoveryHandler(request);
  },
};
