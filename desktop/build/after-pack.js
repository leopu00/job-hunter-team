const { execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

// electron-builder's ad-hoc signature on macOS produces a .app whose main
// binary and its bundled Electron Framework sometimes end up with mismatched
// Team IDs (both empty but distinct in the signature). macOS 26+ refuses to
// load the framework with "mapping process and mapped file (non-platform)
// have different Team IDs", crashing the app at launch.
//
// Re-signing the whole bundle ad-hoc with --deep makes every embedded
// binary share the same (empty) Team ID, so dyld accepts the framework.
// This runs only when no Developer ID cert is in env (real signing path
// produces consistent Team IDs already).
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const hasDeveloperIdSigning =
    process.env.CSC_LINK || process.env.CSC_NAME || process.env.APPLE_ID
  if (hasDeveloperIdSigning) return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  if (!fs.existsSync(appPath)) {
    console.warn(`[after-pack] ${appPath} not found, skipping re-sign`)
    return
  }

  console.log(`[after-pack] re-signing ${appName} ad-hoc with --deep for uniform Team ID`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  })
}
