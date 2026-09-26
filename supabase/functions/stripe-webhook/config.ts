export function parseExpectedLivemode(
  value: string | undefined,
): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function stripeSecretMatchesExpectedLivemode(
  secret: string | undefined,
  expectedLivemode: boolean | null,
): boolean {
  if (!secret || expectedLivemode === null) return false;
  return expectedLivemode
    ? /^(?:sk|rk)_live_/.test(secret)
    : /^(?:sk|rk)_test_/.test(secret);
}
