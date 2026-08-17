-- Technical identity of the client behind a cloud-sync token.
--
-- Until now no client declared which build it was, so the server could not
-- tell a current box from one four releases behind: reconstructing it took a
-- manual audit against `git tag` and still landed on "probably". Every box
-- now signs its cloud-sync calls with an `X-JHT-Client` header and the last
-- value wins here.
--
-- Scope discipline, non-negotiable: build, OS family, feature flags and
-- timestamps. No message bodies, no positions, no profile fields, no IP, no
-- hostname. The product's promise is that user data stays on the user's
-- machine; a version string does not touch it, and anything that would must
-- not be added to these columns. Whatever lands here is readable by the user
-- it came from (`jht cloud status` and the cloud-sync settings page).

ALTER TABLE public.cloud_sync_tokens
  ADD COLUMN IF NOT EXISTS client_version text
    CHECK (client_version IS NULL OR char_length(client_version) <= 32),
  ADD COLUMN IF NOT EXISTS client_platform text
    CHECK (client_platform IS NULL OR client_platform IN ('linux', 'macos', 'windows', 'unknown')),
  ADD COLUMN IF NOT EXISTS client_capabilities text[],
  ADD COLUMN IF NOT EXISTS client_seen_at timestamptz;

-- Install-base distribution ("who is affected by this bug") reads active
-- tokens grouped by version; the partial index keeps revoked ones out.
CREATE INDEX IF NOT EXISTS idx_cloud_sync_tokens_client_version
  ON public.cloud_sync_tokens (client_version)
  WHERE revoked_at IS NULL;

COMMENT ON COLUMN public.cloud_sync_tokens.client_version IS
  'Build the box declared on its last cloud-sync call (e.g. 0.3.5). Last write wins. Technical telemetry only.';
COMMENT ON COLUMN public.cloud_sync_tokens.client_platform IS
  'OS family of the box: linux | macos | windows | unknown. Never a hostname or an address.';
COMMENT ON COLUMN public.cloud_sync_tokens.client_capabilities IS
  'Feature flags the build declares it can serve (e.g. chat). Lets the web UI gate on what the box can actually do.';
COMMENT ON COLUMN public.cloud_sync_tokens.client_seen_at IS
  'When the declaration above was last recorded. Distinct from last_used_at, which any authenticated call refreshes.';
