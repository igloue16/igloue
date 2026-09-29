# Admin authentication setup

The browser admin entry point is `admin/index.html`. It uses Supabase Auth email/password sign-in and the project's publishable key. The page has no registration or membership-provisioning action.

## Auth provider requirements

Before exposing the admin entry point on a hosted project, configure that project's Supabase Auth settings to:

- Disable new-user signups globally.
- Disable email-provider signups.
- Require email confirmation.
- Allow only the exact admin URL needed for invite and confirmation redirects.

`supabase/config.toml` applies the no-signup and email-confirmation settings to local Supabase. Hosted Auth provider settings are configured separately in the Supabase Dashboard and are not changed by a database migration or by this static site.

Staff accounts must be created or invited through the Supabase Dashboard or a trusted server-side process. Never call Auth Admin APIs from the browser; they require a secret key. Provisioning the corresponding `organisation_members` row is a separate trusted operation and is not part of this login foundation.

## Invitation completion

The invited user follows the Supabase invitation link to `/admin/`. Supabase JS v2 consumes the Auth callback, and the page asks the user to set and confirm a password before it loads active organisation memberships. The password must contain at least 12 characters, including a lowercase letter, an uppercase letter, and a digit. Supabase Auth remains authoritative and can reject passwords that fail the hosted project's policy.

If the invitation is expired or invalid, the page shows a safe error and asks the administrator to issue a new invitation. Do not reuse an invitation link after it has been consumed. The page does not load dashboard data, and an invited user without an active membership sees the access-not-configured state.

## Production security follow-up

Before production staff access, enforce MFA assurance for owner/admin users. The A2.1 UI does not claim or simulate MFA enforcement.
