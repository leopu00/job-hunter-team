const { execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

// electron-builder's ad-hoc signing leaves the main binary and the embedded
// Electron Framework with distinct bundle UUIDs that macOS 26+ treats as
// mismatched Team IDs. dyld then refuses to load the framework at launch
// ("mapping process and mapped file (non-platform) have different Team
// IDs") and the app crashes immediately.
//
// Running as `afterSign` (not afterPack) ensures we re-sign AFTER
// electron-builder has already signed the bundle — otherwise electron-
// builder's later signing pass wipes our uniform signature and the bug
// returns. A single `codesign --force --deep --sign -` pass makes every
// embedded binary share the same ad-hoc Team ID slot, so dyld accepts
// the framework.
//
// No-op when a Developer ID is configured (real signing produces
// consistent Team IDs already).
module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const hasDeveloperIdSigning =
    process.env.CSC_LINK || process.env.CSC_NAME || process.env.APPLE_ID
  if (hasDeveloperIdSigning) return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  if (!fs.existsSync(appPath)) {
    console.warn(`[after-sign] ${appPath} not found, skipping re-sign`)
    return
  }

  console.log(`[after-sign] re-signing ${appName} ad-hoc with --deep for uniform Team ID`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  })
}
