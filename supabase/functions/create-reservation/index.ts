import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { handleReservationRequest } from "./handler.ts";
import { noOpVerificationEmailDelivery } from "../issue-email-verification/delivery.ts";

const authenticatedHandler = withSupabase(
  { auth: ["publishable", "secret"] },
  async (request, context) => {
    const lookupCustomerEmail = async (reservationId: string, customerId: string) => {
      const reservation = await context.supabaseAdmin
        .from("reservations")
        .select("customer_id, organisation_id")
        .eq("id", reservationId)
        .maybeSingle();
      if (reservation.error || !reservation.data || reservation.data.customer_id !== customerId) return null;

      const customer = await context.supabaseAdmin
        .from("customers")
        .select("email, organisation_id")
        .eq("id", customerId)
        .maybeSingle();
      if (
        customer.error || !customer.data ||
        customer.data.organisation_id !== reservation.data.organisation_id
      ) return null;
      return typeof customer.data.email === "string" ? customer.data.email : null;
    };

    return await handleReservationRequest(request, {
      supabaseAdmin: context.supabaseAdmin,
      loadProducts: async (productIds: string[]) => {
        const result = await context.supabaseAdmin
          .from("products")
          .select("id,weekly_price,deposit_amount,active")
          .in("id", productIds);
        if (result.error) throw result.error;
        return result.data;
      },
      lookupCustomerEmail,
      publicBaseUrl: Deno.env.get("IGLOUE_PUBLIC_BASE_URL") ?? "",
      paymentCapabilitySecret: Deno.env.get("PAYMENT_CAPABILITY_SECRET"),
      verificationDelivery: noOpVerificationEmailDelivery,
      logError: console.error,
    });
  },
);

export default {
  fetch(request: Request) {
    return authenticatedHandler(request);
  },
};
