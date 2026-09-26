import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  createWorkerDependencies,
  handleProcessOutboxRequest,
} from "./handler.ts";

type QueryResult = { data: unknown | null; error: unknown | null };

const authenticatedHandler = withSupabase(
  { auth: ["secret"] },
  async (request, context) => {
    const supabaseAdmin = {
      async rpc(
        name: string,
        parameters: Record<string, unknown>,
      ): Promise<QueryResult> {
        const result = await context.supabaseAdmin.rpc(name, parameters);
        return { data: result.data, error: result.error };
      },
      from(table: string) {
        return {
          select(columns: string) {
            return {
              eq(column: string, value: string) {
                return {
                  async maybeSingle(): Promise<QueryResult> {
                    const result = await context.supabaseAdmin.from(table)
                      .select(columns)
                      .eq(column, value)
                      .maybeSingle();
                    return { data: result.data, error: result.error };
                  },
                };
              },
            };
          },
        };
      },
    };
    return await handleProcessOutboxRequest(
      request,
      createWorkerDependencies(supabaseAdmin),
    );
  },
);

export default {
  fetch(request: Request) {
    return authenticatedHandler(request);
  },
};
