import {
  buildServerOperationalPeriod,
} from "../create-reservation/operations.ts";
import {
  IGLOUE_SERVER_PRICING,
} from "../create-reservation/pricing.ts";
import {
  IGLOUE_SERVER_SERVICE_WINDOWS,
} from "../create-reservation/validation.ts";
import {
  validateBookingDates,
} from "../create-reservation/date-rules.ts";

const MAX_REQUEST_BYTES = 8_192;

const CORS_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
});

type RpcResult = {
  data: unknown;
  error: {
    code?: string;
    message?: string;
  } | null;
};

export type AvailabilityRpcClient = {
  rpc: (
    name: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<RpcResult>;
};

type AvailabilityDependencies = {
  supabaseAdmin: AvailabilityRpcClient;
  now?: Date;
  logError?: (...values: unknown[]) => void;
};

type ErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_PRODUCT"
  | "INVALID_DATES"
  | "INVALID_SERVICE_WINDOW"
  | "METHOD_NOT_ALLOWED"
  | "AVAILABILITY_UNAVAILABLE";

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  additionalHeaders: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      ...additionalHeaders,
    },
  });
}

function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  additionalHeaders: Record<string, string> = {},
) {
  return jsonResponse(
    {
      ok: false,
      error: { code, message },
    },
    status,
    additionalHeaders,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  expectedKeys: string[],
) {
  const actualKeys = Object.keys(value);

  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key) => expectedKeys.includes(key))
  );
}

function isServiceWindowId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    IGLOUE_SERVER_SERVICE_WINDOWS.some((window) => window.id === value)
  );
}

function extractAvailability(data: unknown) {
  const result = Array.isArray(data) ? data[0] : data;

  if (!isPlainObject(result) || typeof result.available !== "boolean") {
    return null;
  }

  return result.available;
}

export function createOptionsResponse() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function handleAvailabilityRequest(
  request: Request,
  dependencies: AvailabilityDependencies,
) {
  if (request.method === "OPTIONS") {
    return createOptionsResponse();
  }

  if (request.method !== "POST") {
    return errorResponse(
      405,
      "METHOD_NOT_ALLOWED",
      "Only POST requests are supported",
      { Allow: "POST, OPTIONS" },
    );
  }

  const contentLength = Number(request.headers.get("content-length"));

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BYTES
  ) {
    return errorResponse(400, "INVALID_REQUEST", "Invalid request body");
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "Invalid JSON body");
  }

  if (
    !isPlainObject(body) ||
    !hasOnlyKeys(body, ["productId", "rental", "service"])
  ) {
    return errorResponse(400, "INVALID_REQUEST", "Invalid request body");
  }

  if (
    typeof body.productId !== "string" ||
    !(body.productId in IGLOUE_SERVER_PRICING.products)
  ) {
    return errorResponse(400, "INVALID_PRODUCT", "Invalid product");
  }

  const productId = body.productId;

  if (
    !isPlainObject(body.rental) ||
    !hasOnlyKeys(body.rental, ["startDate", "endDate"])
  ) {
    return errorResponse(400, "INVALID_DATES", "Invalid rental dates");
  }

  const dateValidation = validateBookingDates(
    body.rental.startDate,
    body.rental.endDate,
    dependencies.now ?? new Date(),
  );

  if (!dateValidation.ok) {
    return errorResponse(400, "INVALID_DATES", dateValidation.error);
  }

  if (
    !isPlainObject(body.service) ||
    !hasOnlyKeys(body.service, [
      "deliverySlotId",
      "collectionSlotId",
    ]) ||
    !isServiceWindowId(body.service.deliverySlotId) ||
    !isServiceWindowId(body.service.collectionSlotId)
  ) {
    return errorResponse(
      400,
      "INVALID_SERVICE_WINDOW",
      "Invalid service window",
    );
  }

  const operationalPeriodResult = buildServerOperationalPeriod(
    body.rental.startDate as string,
    body.service.deliverySlotId,
    body.rental.endDate as string,
    body.service.collectionSlotId,
  );

  if (!operationalPeriodResult.ok) {
    return errorResponse(
      400,
      "INVALID_SERVICE_WINDOW",
      "Invalid service window",
    );
  }

  const operationalPeriod = operationalPeriodResult.operationalPeriod;
  const { data, error } = await dependencies.supabaseAdmin.rpc(
    "check_product_machine_availability",
    {
      p_product_id: productId,
      p_operational_start: operationalPeriod.operationalStart,
      p_operational_end: operationalPeriod.operationalEnd,
    },
  );

  if (error) {
    if (error.code === "P0001" || error.code === "P0002") {
      return errorResponse(400, "INVALID_PRODUCT", "Invalid product");
    }

    dependencies.logError?.(
      "check_product_machine_availability failed",
      error,
    );

    return errorResponse(
      503,
      "AVAILABILITY_UNAVAILABLE",
      "Availability is temporarily unavailable",
    );
  }

  const available = extractAvailability(data);

  if (available === null) {
    dependencies.logError?.(
      "check_product_machine_availability returned invalid data",
    );

    return errorResponse(
      503,
      "AVAILABILITY_UNAVAILABLE",
      "Availability is temporarily unavailable",
    );
  }

  return jsonResponse(
    {
      ok: true,
      available,
      productId,
    },
    200,
  );
}
