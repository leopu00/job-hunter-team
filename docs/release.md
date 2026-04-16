# Release — macOS code signing & notarization

Maintainer playbook for producing a signed, notarized `.dmg` that launches cleanly on end-user Macs (no Gatekeeper warning).

## Why this matters

Without a Developer ID signature and Apple notarization, the first launch of `JHT Desktop.app` triggers the "Apple could not verify this app" block on modern macOS. Non-tech users typically close the app at that point. A signed + notarized DMG opens with the standard "downloaded from the Internet" confirmation only.

Two independent steps are required:

1. **Code signing** with a `Developer ID Application` certificate.
2. **Notarization** — submitting the signed artifact to Apple's notary service and stapling the ticket to the DMG.

The release workflow performs both automatically when the required secrets are configured.

## One-time maintainer setup

### 1. Apple Developer Program

You need an active paid membership at <https://developer.apple.com/programs/> (~99 USD/year). Free accounts cannot issue `Developer ID` certificates.

### 2. Create the Developer ID Application certificate

1. Open **Keychain Access** on a Mac.
2. Menu → _Certificate Assistant_ → _Request a Certificate From a Certificate Authority…_
3. Fill in your email and name, select **Saved to disk**, continue. This produces a `.certSigningRequest` (CSR) file.
4. Go to <https://developer.apple.com/account/resources/certificates/list>, click **+**.
5. Choose **Developer ID Application**, upload the CSR, download the resulting `.cer`.
6. Double-click the `.cer` to import it into the login keychain. The private key from step 2 merges with the certificate.

Reference: <https://developer.apple.com/help/account/create-certificates/create-developer-id-certificates>

### 3. Export the certificate as `.p12`

1. In Keychain Access, locate the certificate (type: `Developer ID Application: <Your Name> (<TEAM_ID>)`).
2. Expand it so both the certificate **and** its private key are selected together.
3. Right-click → **Export 2 items…** → File Format: **Personal Information Exchange (.p12)**.
4. Set a strong password. This is the value for the `MACOS_CERTIFICATE_PWD` secret.

### 4. Base64-encode the `.p12` for the GitHub secret

```bash
base64 -i developer-id.p12 | pbcopy
```

On Linux use `base64 -w0 developer-id.p12`. The output is the value for the `MACOS_CERTIFICATE` secret — one single base64 line, no wrapping.

### 5. App-Specific Password for notarytool

Notarization uses your Apple ID with an app-specific password (not your login password):

1. Go to <https://appleid.apple.com/account/manage> → **Sign-In and Security** → **App-Specific Passwords**.
2. Generate one labeled e.g. `notarytool-jht`.
3. Copy the 4×4 character string. This is the value for `APPLE_APP_SPECIFIC_PASSWORD`.

### 6. Find your Team ID

<https://developer.apple.com/account> → **Membership details** → the 10-character alphanumeric value. This is the value for `APPLE_TEAM_ID`.

## Required GitHub secrets

Set these at `Settings → Secrets and variables → Actions` on the repository:

| Secret | Value |
|---|---|
| `MACOS_CERTIFICATE` | Base64 of the `.p12` (step 4). |
| `MACOS_CERTIFICATE_PWD` | Password chosen when exporting the `.p12` (step 3). |
| `APPLE_ID` | Apple ID email address of the developer account. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password (step 5). |
| `APPLE_TEAM_ID` | 10-character Team ID (step 6). |

All five secrets must be present for the macOS job to sign and notarize. If any is missing, the release workflow falls back to producing an **unsigned** DMG and emits a GitHub Actions warning (the build does not fail, so other platforms still publish).

## What the workflow does

`.github/workflows/release.yml` (job `build-desktop`, matrix entry `macos-14`) on a tag push:

1. Detects whether all five secrets are configured (`HAS_MAC_SIGNING`).
2. If yes: decodes `MACOS_CERTIFICATE` to a temporary `.p12`, points `CSC_LINK` at it and passes `CSC_KEY_PASSWORD` to electron-builder.
3. Passes `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` so `@electron/notarize` (invoked internally by electron-builder 26 when `build.mac.notarize: true`) can submit to Apple's notary service.
4. After the build, runs `codesign -dv --verbose=4` and `spctl --assess --type open --context context:primary-signature --verbose` on the produced `.dmg`. A non-zero exit from `spctl` fails the job.

The signing configuration itself lives in `desktop/package.json` → `build.mac`:

- `hardenedRuntime: true` — required by Apple for notarization.
- `entitlements` / `entitlementsInherit` point at `desktop/build/entitlements.mac.plist` (minimal set: JIT, unsigned executable memory, network client).
- `notarize: true` — electron-builder invokes notarytool when the Apple env vars are present.

## Local build fallback

Running `npm run dist:mac` in `desktop/` locally **without** the signing env vars produces an unsigned DMG:

- `CSC_IDENTITY_AUTO_DISCOVERY` defaults to `false` in the workflow and is unset locally, so electron-builder skips signing when it cannot find a certificate.
- `notarize: true` is a no-op when `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` are not in the environment — electron-builder logs a warning and moves on.

The resulting DMG is fine for local smoke tests but will trigger Gatekeeper on other people's machines. Never ship an unsigned build to real users.

## Verifying a build locally

Mount the DMG (or point these commands at the built `.app`):

```bash
# Signature details: expect "Authority=Developer ID Application: ..."
codesign -dv --verbose=4 /path/to/JHT\ Desktop.app

# Gatekeeper verdict: expect "accepted" + "source=Notarized Developer ID"
spctl --assess --type execute --verbose=4 /path/to/JHT\ Desktop.app

# DMG-level assessment
spctl --assess --type open --context context:primary-signature --verbose /path/to/job-hunter-team-<version>-mac.dmg
```

If `spctl` reports `source=Notarized Developer ID` on both the app and the DMG, the artifact is ready to publish.

## Rotating the certificate

Developer ID certificates expire after 5 years. To rotate:

1. Repeat steps 2–4 above with a fresh CSR.
2. Replace `MACOS_CERTIFICATE` and `MACOS_CERTIFICATE_PWD` in GitHub secrets.
3. The next tag push uses the new certificate. Previously shipped builds remain valid as long as the old certificate was not revoked.

Revoke the old certificate in the Apple Developer console only after confirming the new one produces working builds — revocation invalidates all artifacts signed with it.
