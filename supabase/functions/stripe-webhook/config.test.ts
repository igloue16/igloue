import { assertEquals } from "jsr:@std/assert@1";
import {
  parseExpectedLivemode,
  stripeSecretMatchesExpectedLivemode,
} from "./config.ts";

Deno.test("expected Stripe mode accepts only exact true and false values", () => {
  assertEquals(parseExpectedLivemode("true"), true);
  assertEquals(parseExpectedLivemode("false"), false);
  for (
    const value of [undefined, "", "TRUE", "False", " true", "false ", "1"]
  ) {
    assertEquals(parseExpectedLivemode(value), null);
  }
});

Deno.test("Stripe secret key mode must match the explicit expected mode", () => {
  assertEquals(
    stripeSecretMatchesExpectedLivemode("sk_test_local", false),
    true,
  );
  assertEquals(
    stripeSecretMatchesExpectedLivemode("rk_test_local", false),
    true,
  );
  assertEquals(
    stripeSecretMatchesExpectedLivemode("sk_live_local", true),
    true,
  );
  assertEquals(
    stripeSecretMatchesExpectedLivemode("rk_live_local", true),
    true,
  );
  assertEquals(
    stripeSecretMatchesExpectedLivemode("sk_live_local", false),
    false,
  );
  assertEquals(
    stripeSecretMatchesExpectedLivemode("sk_test_local", true),
    false,
  );
  assertEquals(stripeSecretMatchesExpectedLivemode("sk_local", false), false);
  assertEquals(stripeSecretMatchesExpectedLivemode("", false), false);
  assertEquals(
    stripeSecretMatchesExpectedLivemode("sk_test_local", null),
    false,
  );
});
