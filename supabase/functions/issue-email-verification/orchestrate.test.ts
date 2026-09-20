import assert from "node:assert/strict";
import { orchestrateEmailVerification } from "./orchestrate.ts";

const reservationId = "00000000-0000-4000-8000-000000000001";

function issuedRpc() {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: async (name: string, parameters: Record<string, unknown>) => {
      calls.push({ name, parameters });
      return {
        data: [{ token_id: "token-1", reservation_id: reservationId, customer_id: "customer-1", organisation_id: "org-1", expires_at: "2027-01-01T12:30:00Z" }],
        error: null,
      };
    },
  };
}

Deno.test("orchestration delivers a fragment URL with minimal fields", async () => {
  const rpc = issuedRpc();
  let deliveryInput: { destination: string; verificationUrl: string; expiresAt: string } | undefined;
  const result = await orchestrateEmailVerification({
    reservationId,
    destination: "customer@example.com",
    publicBaseUrl: "https://igloue.example/",
    rpc,
    delivery: { async sendVerificationEmail(input) { deliveryInput = input; return { status: "delivered" }; } },
  });
  assert.deepEqual(result, { status: "delivered" });
  assert.equal(rpc.calls.length, 1);
  assert.ok(deliveryInput);
  assert.equal(deliveryInput.destination, "customer@example.com");
  assert.match(deliveryInput.verificationUrl, /#credential=/);
  assert.equal(deliveryInput.verificationUrl.includes("?credential="), false);
  assert.equal(Object.keys(deliveryInput).sort().join(","), "destination,expiresAt,verificationUrl");
});

Deno.test("issuance and delivery failures remain internal outcomes", async () => {
  const failedRpc = { async rpc() { return { data: null, error: { code: "P0001" } }; } };
  assert.deepEqual(await orchestrateEmailVerification({ reservationId, destination: "customer@example.com", publicBaseUrl: "https://igloue.example", rpc: failedRpc, delivery: { async sendVerificationEmail() { return { status: "delivered" }; } } }), { status: "issuance_failed" });
  const rpc = issuedRpc();
  assert.deepEqual(await orchestrateEmailVerification({ reservationId, destination: "customer@example.com", publicBaseUrl: "https://igloue.example", rpc, delivery: { async sendVerificationEmail() { throw new Error("private provider detail"); } } }), { status: "delivery_failed" });
});
