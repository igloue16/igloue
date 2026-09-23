import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { createWorkerDependencies, handleProcessOutboxRequest } from "./handler.ts";

const authenticatedHandler = withSupabase(
  { auth: ["secret"] },
  async (request, context) =>
    await handleProcessOutboxRequest(request, createWorkerDependencies(context.supabaseAdmin)),
);

export default {
  fetch(request: Request) {
    return authenticatedHandler(request);
  },
};
