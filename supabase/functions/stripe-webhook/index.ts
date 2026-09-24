import "@supabase/functions-js/edge-runtime.d.ts";
import { handleStripeWebhookRequest } from "./handler.ts";

export default {
  fetch(request: Request) {
    return handleStripeWebhookRequest(request, {
      secret: Deno.env.get("STRIPE_WEBHOOK_SECRET")?.trim(),
    });
  },
};
