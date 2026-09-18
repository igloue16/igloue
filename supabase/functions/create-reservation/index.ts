import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  getServerDeliveryZoneByPostcode,
  isServerProductAvailableInZone,
} from "./delivery.ts";
import {
  buildServerOperationalPeriod,
} from "./operations.ts";
import {
  calculateServerBookingPrice,
  IGLOUE_SERVER_PRICING,
} from "./pricing.ts";
import {
  validateCustomer,
  validateDeliveryAddress,
  validateProductId,
  validateRentalDates,
  validateServiceChoices,
} from "./validation.ts";

export default {
  fetch: withSupabase(
    { auth: ["publishable", "secret"] },
    async (req, ctx) => {
      if (req.method !== "POST") {
        return Response.json(
          { error: "Method not allowed" },
          { status: 405 },
        );
      }

      let body: unknown;

      try {
        body = await req.json();
      } catch {
        return Response.json(
          { error: "Invalid JSON body" },
          { status: 400 },
        );
      }

      if (
        typeof body !== "object" ||
        body === null
      ) {
        return Response.json(
          { error: "Invalid request body" },
          { status: 400 },
        );
      }

      const requestBody =
        body as Record<string, unknown>;

      const idempotencyKey =
        typeof requestBody.idempotencyKey === "string"
          ? requestBody.idempotencyKey.trim()
          : "";

      if (idempotencyKey === "") {
        return Response.json(
          { error: "Invalid idempotencyKey" },
          { status: 400 },
        );
      }

      if (idempotencyKey.length > 200) {
        return Response.json(
          { error: "Invalid idempotencyKey" },
          { status: 400 },
        );
      }

      const customerValidation = validateCustomer(
        requestBody.customer,
      );

      if (!customerValidation.ok) {
        return Response.json(
          { error: customerValidation.error },
          { status: 400 },
        );
      }

      const productValidation = validateProductId(
        requestBody.productId,
      );

      if (!productValidation.ok) {
        return Response.json(
          { error: productValidation.error },
          { status: 400 },
        );
      }

      const productId = productValidation.productId;

      const addressValidation =
        validateDeliveryAddress(
          requestBody.deliveryAddress,
        );

      if (!addressValidation.ok) {
        return Response.json(
          { error: addressValidation.error },
          { status: 400 },
        );
      }

      const rentalValidation = validateRentalDates(
        requestBody.rental,
      );

      if (!rentalValidation.ok) {
        return Response.json(
          { error: rentalValidation.error },
          { status: 400 },
        );
      }

      const serviceValidation =
        validateServiceChoices(
          requestBody.service,
          productId,
        );

      if (!serviceValidation.ok) {
        return Response.json(
          { error: serviceValidation.error },
          { status: 400 },
        );
      }

      const customer = customerValidation.customer;
      const deliveryAddress =
        addressValidation.address;
      const rental = rentalValidation.rental;
      const service = serviceValidation.service;

      const operationalPeriodResult =
        buildServerOperationalPeriod(
          rental.startDate,
          service.deliverySlotId,
          rental.endDate,
          service.collectionSlotId,
        );

      if (!operationalPeriodResult.ok) {
        return Response.json(
          { error: operationalPeriodResult.error },
          { status: 400 },
        );
      }

      const operationalPeriod =
        operationalPeriodResult.operationalPeriod;

      const deliveryZone =
        getServerDeliveryZoneByPostcode(
          deliveryAddress.postcode,
        );

      if (!deliveryZone) {
        return Response.json(
          {
            error:
              "Delivery postcode requires manual review",
          },
          { status: 400 },
        );
      }

      if (
        !isServerProductAvailableInZone(
          productId,
          deliveryZone.id,
        )
      ) {
        return Response.json(
          {
            error:
              "Product is not available in this delivery zone",
          },
          { status: 400 },
        );
      }

      const pricing = calculateServerBookingPrice({
        productId:
          productId as keyof typeof IGLOUE_SERVER_PRICING.products,
        nights: rental.nights,
        deliveryFee: deliveryZone.price,
        setupMode:
          service.setupMode as keyof typeof IGLOUE_SERVER_PRICING.setup,
        expressSelected: service.expressSelected,
      });

      const optionsTotal =
        pricing.setupPrice + pricing.expressPrice;

      const { data, error } =
        await ctx.supabaseAdmin.rpc(
          "create_reservation_transaction",
          {
            p_first_name: customer.firstName,
            p_last_name: customer.lastName,
            p_email: customer.email,
            p_phone: customer.phone,
            p_product_id: productId,
            p_rental_start:
              `${rental.startDate}T12:00:00Z`,
            p_rental_end:
              `${rental.endDate}T12:00:00Z`,
            p_delivery_address_line_1:
              deliveryAddress.line1,
            p_delivery_address_line_2:
              deliveryAddress.line2,
            p_delivery_postcode:
              deliveryAddress.postcode,
            p_delivery_city:
              deliveryAddress.city,
            p_delivery_zone:
              deliveryZone.id,
            p_weekly_price_at_booking:
              pricing.weeklyPrice,
            p_delivery_fee:
              pricing.deliveryFee,
            p_options_total:
              optionsTotal,
            p_deposit_amount:
              pricing.depositAmount,
            p_total_amount:
              pricing.totalAmount,
            p_delivery_date:
              rental.startDate,
            p_delivery_time_slot:
              service.deliverySlotId,
            p_collection_date:
              rental.endDate,
            p_collection_time_slot:
              service.collectionSlotId,
            p_idempotency_key:
              idempotencyKey,
            p_operational_start:
              operationalPeriod.operationalStart,
            p_operational_end:
              operationalPeriod.operationalEnd,
          },
        );

      if (error) {
        console.error(
          "create_reservation_transaction failed",
          error,
        );

        if (
          error.code === "P0001" &&
          error.message === "No eligible machine available"
        ) {
          return Response.json(
            {
              error:
                "No machine available for these dates",
              code: "NO_MACHINE_AVAILABLE",
            },
            { status: 409 },
          );
        }

        return Response.json(
          {
            error:
              "Reservation could not be created",
          },
          { status: 500 },
        );
      }

      const created = Array.isArray(data)
        ? data[0]
        : data;

      if (!created) {
        console.error(
          "create_reservation_transaction returned no data",
        );

        return Response.json(
          {
            error:
              "Reservation could not be created",
          },
          { status: 500 },
        );
      }

      return Response.json(
        {
          ok: true,
          reservationId: created.reservation_id,
          customerId: created.customer_id,
          allocationId: created.allocation_id,
          machineId: created.machine_id,
          serviceJobs: {
            deliveryId: created.delivery_job_id,
            collectionId: created.collection_job_id,
          },
          productId,
          rental,
          operationalPeriod,
          deliveryZone: {
            id: deliveryZone.id,
            name: deliveryZone.name,
          },
          pricing,
        },
        { status: 201 },
      );
    },
  ),
};
