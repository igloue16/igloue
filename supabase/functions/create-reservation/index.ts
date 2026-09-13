import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { IGLOUE_SERVER_PRICING } from "./pricing.ts";
import {
  validateCustomer,
  validateDeliveryAddress,
  validateProductId,
  validateRentalDates,
} from "./validation.ts";

export default {
  fetch: withSupabase(
    { auth: ["publishable", "secret"] },
    async (req) => {
      if (req.method !== "POST") {
        return Response.json(
          { error: "Method not allowed" },
          { status: 405 },
        );
      }

      const body = await req.json();

      const customerValidation = validateCustomer(
        body?.customer,
      );

      if (!customerValidation.ok) {
        return Response.json(
          { error: customerValidation.error },
          { status: 400 },
        );
      }

      const productValidation = validateProductId(
        body?.productId,
      );

      if (!productValidation.ok) {
        return Response.json(
          { error: productValidation.error },
          { status: 400 },
        );
      }

      const addressValidation = validateDeliveryAddress(
        body?.deliveryAddress,
      );

      if (!addressValidation.ok) {
        return Response.json(
          { error: addressValidation.error },
          { status: 400 },
        );
      }

      const rentalValidation = validateRentalDates(
        body?.rental,
      );

      if (!rentalValidation.ok) {
        return Response.json(
          { error: rentalValidation.error },
          { status: 400 },
        );
      }

      const customer = customerValidation.customer;
      const productId = productValidation.productId;
      const deliveryAddress = addressValidation.address;
      const rental = rentalValidation.rental;

      const product =
        IGLOUE_SERVER_PRICING.products[
          productId as keyof typeof IGLOUE_SERVER_PRICING.products
        ];

      return Response.json({
        ok: true,
        productId,
        weeklyPrice: product.weeklyPrice,
        customer,
        deliveryAddress,
        rental,
      });
    },
  ),
};