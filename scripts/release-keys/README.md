# Production release trust root

`production-spki.pem` is intentionally absent until the operator provisions an
independent offline vault or non-exportable HSM/KMS. No provider has been
selected: repository workflows and tools contain no AWS, GCP or other vendor
assumption. The file must contain only the RSA-3072 public key in SPKI PEM
form. Private key bytes are forbidden in GitHub secrets, source, logs and
artifacts.

Tag workflows fail closed while the public key or detached 384-byte signature
is absent. The public key is committed before the v0.3.6 baseline is built so
both the desktop verifier and the protected Windows helper embed identical
bytes. v0.3.5 to v0.3.6 remains a one-time manual transition.

## Provider-neutral signing ceremony

1. The tag workflow verifies the tagged production commit, builds every asset,
   creates canonical `RELEASE-MANIFEST.json`, and uploads one immutable
   `release-candidate` Actions artifact. It creates no GitHub Release.
2. Two operators independently confirm the source run id, repository, tag,
   40-hex commit, manifest SHA-256 and that `sequence` exceeds the recorded
   signing floor. The offline `sign-offline` command requires those values as
   explicit arguments before it will use a private key.
3. The offline vault or selected non-exportable KMS signs the exact manifest
   bytes with RSA-3072 PKCS#1 v1.5 and SHA-256. Only the public raw 384-byte
   signature leaves custody.
4. `Publish signed release candidate` is manually dispatched with the original
   run id, tag and base64 transport encoding of that public signature. It
   downloads the original artifact, verifies run/tag/production identity and
   the signature, audits every signed size and hash, and only then creates a
   draft release. A second download/audit gates completion.

GitHub stores no private signing credential. A future provider adapter must be
an explicit, separately reviewed implementation of the same boundary; it must
not weaken or bypass the offline authorization inputs.

## Key rotation

Version 1 never accepts a key learned from the release channel. Rotation uses
three ordered releases: an old-key-signed bridge embeds current+next; a
new-key-signed overlap release still embeds both (so interrupted recovery can
verify either snapshot); only a later new-key-signed release removes the old
key. The helper writes the irreversible floor before atomically promoting a
new keyring, and forward recovery no longer depends on the retired-key backup.
Duplicate keys and keyrings larger than two are rejected.
