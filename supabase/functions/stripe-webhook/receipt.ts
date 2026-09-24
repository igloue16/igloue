export type ReceiptRpcClient = {
  rpc(name: string, parameters: Record<string, unknown>): Promise<{
    data: unknown;
    error: unknown | null;
  }>;
};

export function createProductionReceiptClient(): ReceiptRpcClient | null {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!url || !serviceRoleKey) return null;

  return {
    async rpc(name, parameters) {
      const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(parameters),
      });
      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      return {
        data,
        error: response.ok ? null : data,
      };
    },
  };
}
