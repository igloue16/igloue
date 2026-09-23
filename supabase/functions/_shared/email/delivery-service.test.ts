import assert from "node:assert/strict";
import { buildReservationConfirmationEmail } from "./templates.ts";
import { deliverTransactionalEmail } from "./delivery-service.ts";

const baseData = {
  recipientEmail: "client@example.com",
  customerName: "Camille Test",
  reservationReference: "TEST-2026-001",
  productName: "IGLOUE Essential",
  startDate: "12 juillet 2026",
  endDate: "19 juillet 2026",
  totalAmount: "88,00 €",
};

function captureTransport(result: { ok: true } | { ok: false; code: "provider_timeout" | "provider_unavailable" | "provider_rate_limited" | "delivery_rejected" | "missing_configuration" | "invalid_message" | "invalid_sender" | "delivery_failed"; retryable: boolean } = { ok: true }) {
  const calls: Array<Record<string, string>> = [];
  const transport = async (input: Record<string, string>) => {
    calls.push(input);
    return result;
  };
  return { calls, transport };
}

Deno.test("maps a French message to the minimal provider transport input", async () => {
  const fake = captureTransport();
  const message = buildReservationConfirmationEmail(baseData, "fr");
  const result = await deliverTransactionalEmail(message, { transport: fake.transport });
  assert.deepEqual(result, { status: "delivered" });
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0], {
    sender: message.from.address,
    recipient: message.to.address,
    subject: message.subject,
    htmlBody: message.htmlBody,
    textBody: message.textBody,
  });
  assert.equal("locale" in fake.calls[0], false);
  assert.equal("template" in fake.calls[0], false);
});

Deno.test("maps an English message and preserves both body formats", async () => {
  const fake = captureTransport();
  const message = buildReservationConfirmationEmail(baseData, "en");
  await deliverTransactionalEmail(message, { transport: fake.transport });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].sender, message.from.address);
  assert.equal(fake.calls[0].recipient, message.to.address);
  assert.equal(fake.calls[0].subject, message.subject);
  assert.equal(fake.calls[0].htmlBody, message.htmlBody);
  assert.equal(fake.calls[0].textBody, message.textBody);
});

Deno.test("preserves safe retryable and terminal classifications without leaking provider details", async () => {
  const failures = [
    { ok: false as const, code: "provider_unavailable" as const, retryable: true },
    { ok: false as const, code: "delivery_rejected" as const, retryable: false },
    { ok: false as const, code: "missing_configuration" as const, retryable: true },
  ];

  for (const failure of failures) {
    const fake = captureTransport(failure);
    const result = await deliverTransactionalEmail(
      buildReservationConfirmationEmail(baseData, "fr"),
      { transport: fake.transport },
    );
    assert.deepEqual(result, failure.retryable
      ? { status: "retryable_failure", errorCode: failure.code }
      : { status: "terminal_failure", errorCode: failure.code });
    assert.equal(fake.calls.length, 1);
  }
});

Deno.test("does not retry after a failed transport call", async () => {
  let calls = 0;
  const result = await deliverTransactionalEmail(
    buildReservationConfirmationEmail(baseData, "en"),
    {
      transport: async () => {
        calls += 1;
        return { ok: false, code: "provider_unavailable", retryable: true };
      },
    },
  );
  assert.deepEqual(result, { status: "retryable_failure", errorCode: "provider_unavailable" });
  assert.equal(calls, 1);
});

Deno.test("converts a thrown transport failure to a single safe failure", async () => {
  let calls = 0;
  const result = await deliverTransactionalEmail(
    buildReservationConfirmationEmail(baseData, "fr"),
    {
      transport: async () => {
        calls += 1;
        throw new Error("private provider response");
      },
    },
  );
  assert.deepEqual(result, { status: "retryable_failure", errorCode: "delivery_failed" });
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes("private"), false);
});
