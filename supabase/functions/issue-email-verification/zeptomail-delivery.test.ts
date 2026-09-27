import assert from "node:assert/strict";
import {
  createZeptoMailVerificationEmailDelivery,
  VERIFICATION_EMAIL_SENDER,
} from "./zeptomail-delivery.ts";

const input = {
  destination: "client@example.com",
  verificationUrl: "https://igloue.example/verify-email#credential=Abc_123",
  expiresAt: "2027-07-12T10:30:00.000Z",
};

Deno.test("builds minimal French HTML and text verification email and delivers it", async () => {
  let message: Record<string, string> | undefined;
  const delivery = createZeptoMailVerificationEmailDelivery(async (value) => {
    message = value;
    return { ok: true };
  });
  assert.deepEqual(await delivery.sendVerificationEmail(input), {
    status: "delivered",
  });
  assert.ok(message);
  assert.equal(message.sender, "commandes@igloue.fr");
  assert.equal(message.sender, VERIFICATION_EMAIL_SENDER);
  assert.equal(message.recipient, "client@example.com");
  assert.equal(message.subject, "Confirmez votre adresse e-mail — IGLOUE");
  assert.match(
    message.htmlBody,
    /href="https:\/\/igloue\.example\/verify-email#credential=Abc_123"/,
  );
  assert.match(message.htmlBody, /Confirmer mon adresse e-mail/);
  assert.match(message.htmlBody, /expire dans 30 minutes/);
  assert.match(message.htmlBody, /ignorez ce message/);
  assert.ok(message.textBody.includes(input.verificationUrl));
  assert.match(message.textBody, /expire dans 30 minutes/);
  assert.match(message.textBody, /ignorez ce message/);
});

Deno.test("HTML-escapes URL content and maps transport failures without leaking details", async () => {
  let htmlBody = "";
  const delivery = createZeptoMailVerificationEmailDelivery(async (value) => {
    htmlBody = value.htmlBody;
    return { ok: false, code: "private-provider-detail" };
  });
  const url =
    "https://igloue.example/verify-email?x=1&credential=Abc_123#credential=Abc_123";
  const result = await delivery.sendVerificationEmail({
    ...input,
    verificationUrl: url,
  });
  assert.deepEqual(result, { status: "failed" });
  assert.match(htmlBody, /x=1&amp;credential=/);
  assert.equal(
    JSON.stringify(result).includes("private-provider-detail"),
    false,
  );
  assert.equal(JSON.stringify(result).includes("Abc_123"), false);
});

Deno.test("normalizes thrown provider details to a safe failure without logging or echoing the token", async () => {
  const delivery = createZeptoMailVerificationEmailDelivery(async () => {
    throw new Error(`private provider error ${input.verificationUrl}`);
  });
  const result = await delivery.sendVerificationEmail(input);
  assert.deepEqual(result, { status: "failed" });
  assert.equal(JSON.stringify(result).includes("Abc_123"), false);
  assert.equal(
    JSON.stringify(result).includes("private provider error"),
    false,
  );
});
