# Supabase Auth posture gate and remediation

The versioned F-02/F-08 gate reads two fixed Supabase Management API endpoints:
the Auth configuration and the security advisors. It never reads user rows and
has no write operation. Run it from a linked repository with the Supabase CLI
already authenticated:

```bash
python3 scripts/check-auth-security.py live
```

Its output contains only the contract identifier, posture class, aggregate
counts and stable error codes. A transport, credential, parser or contract
failure is a blocking result. Raw API responses, project identity and command
diagnostics are never emitted.

## Desired state A: OAuth-only

This is the smallest configuration aligned with the current JHT login UI.
Applying the same values again has no additional effect:

| Setting | Desired value |
|---|---|
| Email provider | Disabled |
| Approved social providers | At least one of Google or GitHub enabled |

With email disabled, password length, leaked-password rejection and email
confirmation are not authentication controls used by JHT. The gate still
checks that the advisor response agrees with the configuration, but does not
turn password-only recommendations into an OAuth release failure.

## Desired state B: email authentication intentionally retained

Use this only after the product explicitly chooses to support email login.
Set the following exact desired state in **Authentication → Providers** and
**Authentication → Attack Protection**. Reapplying these values is idempotent:

| Setting | Desired value |
|---|---|
| Confirm email | Enabled (`mailer_autoconfirm=false`) |
| Leaked password protection | Enabled |
| Minimum password length | At least 8 |
| TOTP enrollment API | Enabled |
| TOTP challenge/verification APIs | Enabled |

TOTP API availability is not enforcement. Before advertising mandatory MFA,
the application must add enrollment and challenge flows and enforce the
required Authenticator Assurance Level in its application and RLS policies.

After an authorized maintainer changes either desired state, rerun the gate and
require `status=pass`. Do not use `db push`, migration repair, SQL, or user-table
queries for this configuration change. This document is a remediation plan;
F-02/F-08 performs no production mutation.

References: [Supabase general Auth configuration](https://supabase.com/docs/guides/auth/general-configuration),
[password security](https://supabase.com/docs/guides/auth/password-security), and
[MFA](https://supabase.com/docs/guides/auth/auth-mfa).
