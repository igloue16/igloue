# IGLOUE Reservation Email Verification Contract

Status: 3D3-A architecture contract

Scope: reservation email verification only. This document does not implement
database changes, token issuance, email delivery, customer-account access,
SMS, payment, or a reservation portal.

## A. States

Email verification is a separate concern from commercial reservation state,
payment state, and machine-allocation state.

The minimal proposed reservation-level state is:

- `pending`: the reservation has not yet completed email verification.
- `verified`: the verification credential was consumed successfully.
- `revoked`: verification was deliberately invalidated before success.

`expired` should not be persisted as a durable verification state initially.
Expiry is derived from the token's `expires_at` and the reservation/allocation
state. A token can be expired while the reservation is still pending, or the
reservation can already be cancelled because its machine hold expired.

The initial successful reservation creation must produce:

- reservation status `pending`;
- email verification state `pending`;
- payment status `not_started`;
- a held allocation with the existing approximately 30-minute expiry.

## B. Transitions

Allowed transitions:

```text
create reservation
  -> verification pending
  -> verified
```

While verification is pending:

```text
token expires
  -> token unusable
  -> reservation remains pending until its existing hold lifecycle decides its fate

resend request
  -> old token revoked/superseded
  -> new verification token issued for the same reservation
  -> verification state remains pending
```

Separately:

```text
pending reservation + held allocation expires
  -> existing expiry cleanup releases the allocation
  -> existing lifecycle cancels the reservation
```

Verification does not extend the hold, confirm the reservation, change
payment status, or resurrect a cancelled/expired reservation.

Forbidden transitions include:

- browser setting verification state directly;
- GET-only link access marking an email verified;
- a consumed, revoked, or expired token becoming valid again;
- verification changing `pending` to `confirmed`;
- verification changing `payment_status`;
- verification recreating or extending an expired allocation;
- resend creating another reservation, customer, or machine hold;
- a token for one organisation being used for another organisation.

## C. Authorities

| Change | Authoritative component |
| --- | --- |
| Initial reservation, customer, jobs, and hold | Existing `create_reservation_transaction` path |
| Verification state initially pending | Reservation-creation transaction / schema default |
| Token issuance, expiry, revocation, supersession | Trusted token-issuance backend |
| Successful verification | Trusted verification-consumption backend transaction |
| Hold expiry and reservation cancellation | Existing hold-expiry cleanup/lifecycle functions |
| Payment and final confirmation | Future payment/confirmation boundary |

The browser only displays state and submits requests. It is never authoritative
for identity, verification, reservation status, pricing, payment, or allocation.

## D. Token contract

Verification credentials must be single-purpose and reservation-scoped.

- Purpose: `email_verification` only.
- Entropy: at least 32 cryptographically random bytes.
- Representation: URL-safe encoding suitable for a link.
- Storage: store only a cryptographic hash or keyed hash; never a usable token
  or plaintext token in the database.
- Ownership: every token carries `organisation_id` and references the same
  organisation as its reservation and customer.
- Relationship: token references one reservation and its customer/contact.
- Lifetime: short-lived, initially aligned with the checkout hold window;
  exact duration is an implementation/configuration decision.
- Consumption: one successful explicit consume only; record `consumed_at`.
- Revocation: support `revoked_at` and supersession on resend.
- Replay: consumed, revoked, expired, mismatched, and wrong-purpose tokens are
  unusable.
- Logging: never log raw tokens, full verification URLs, or token hashes in
  ordinary application logs.

Verification tokens and future reservation-access tokens are different
purposes and must not be interchangeable.

## E. Link-scanner-safe flow

The email link must lead to a landing/exchange page, not a side-effecting GET.

```text
email link containing token
  -> GET landing page
  -> check token without consuming or verifying
  -> render a generic confirmation page
  -> customer explicitly selects “Confirmer mon adresse e-mail”
  -> POST/controlled consume operation
  -> atomically verify token and reservation contact
```

Required behaviors:

- Scanner visits first: GET performs no verification side effect. The token
  remains available for the customer unless it expires or is revoked.
- Customer opens later: the landing page checks the current token state again;
  it must not trust stale GET data.
- Double-click: the first successful POST consumes the token. Later requests
  return an idempotent generic already-used result and do not repeat effects.
- Expired token: no verification; offer a generic request/resend path if the
  reservation is still eligible.
- Expired hold: no verification and no resurrection. The existing expiry
  lifecycle remains authoritative.

The raw token should be removed from the visible URL after the landing page has
submitted it to a controlled exchange mechanism. Do not place it in analytics,
referrer-bearing third-party URLs, or persistent browser storage.

## F. Hold race

Verification and expiry must serialize on the reservation row, using the same
locking discipline as the existing hold lifecycle.

The verification transaction must, while holding the reservation lock:

1. validate token purpose, hash, expiry, and revocation/consumption state;
2. verify token, reservation, customer, and organisation relationships;
3. confirm reservation is still `pending`;
4. confirm the held allocation exists and `hold_expires_at` is still in the
   future;
5. consume the token and mark verification successful.

If cleanup obtains the lock first, releases the allocation, and cancels the
reservation, verification fails without changing anything. If verification
obtains the lock first, the original hold deadline remains authoritative;
cleanup may still release the unpaid hold and cancel the still-pending
reservation when that deadline is reached.

No operation may recreate an allocation or extend `hold_expires_at` as a side
effect of verification.

## G. Public response rules

Public endpoints must use generic responses and avoid confirming whether a
record exists.

They must not disclose:

- whether an email address exists;
- whether a reservation reference exists;
- customer name, phone, or address;
- organisation membership or organisation identifiers;
- database IDs, allocation IDs, or token state details;
- whether a failure was caused by expiry, revocation, mismatch, or absence when
  that distinction would enable enumeration.

Logs may contain internal diagnostic codes only under controlled server-side
logging; raw credentials and sensitive PII must not be logged.

## H. Future extension points

- Email provider integration will attach delivery to token issuance, but
  provider delivery is never proof of mailbox control.
- Reservation access will use a separate purpose-bound credential and a short-
  lived portal session.
- SMS can later use canonical E.164 contact data and the same reservation-scoped
  backend boundary.
- Payment can require verified contact plus provider-specific authentication;
  verification alone is not payment authorization.
- Audit history can record issuance, resend, consume success/failure, revoke,
  session creation, and sensitive reservation changes without storing raw
  credentials.

## I. Implementation plan

The smallest next batch is **3D3-B — schema only**:

1. Add minimal reservation verification state and timestamps.
2. Add a purpose-bound token table storing only token hashes.
3. Add organisation, reservation, and customer foreign-key ownership.
4. Add expiry, purpose, and active-token constraints/indexes.
5. Enable RLS with no browser policies and preserve backend-only access.
6. Add focused tests for schema, ownership, nullability, purpose separation,
   and browser privilege posture.

3D3-B must not issue, send, or consume tokens. Those concerns belong in later
small batches after the schema contract is verified.
