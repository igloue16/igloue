import "@supabase/functions-js/edge-runtime.d.ts";
import { handleStripeWebhookRequest } from "./handler.ts";
import { createProductionReceiptClient } from "./receipt.ts";

export default {
  fetch(request: Request) {
    return handleStripeWebhookRequest(request, {
      secret: Deno.env.get("STRIPE_WEBHOOK_SECRET")?.trim(),
      receiptClient: createProductionReceiptClient() ?? undefined,
      expectedLivemode: Deno.env.get("STRIPE_EXPECTED_LIVEMODE"),
    });
  },
};
