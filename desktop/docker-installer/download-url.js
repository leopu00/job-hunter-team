// Official download/install guide for each OS.
// The launcher opens this URL in the user's default browser when they click
// "Scarica installer" in the checklist. The user installs manually, reboots
// if the OS asks, then clicks "Ricontrolla" back in the launcher.
//
// On macOS the project policy is Colima (CLI, no GUI, no license) — see the
// `mac-colima` strategy in manifest.js — so we point users to the Colima
// project page instead of Docker Desktop.

const WINDOWS_URL = 'https://www.docker.com/products/docker-desktop/'
const MAC_URL = 'https://github.com/abiosoft/colima'
const LINUX_URL = 'https://docs.docker.com/engine/install/'

function downloadUrlFor(platform = process.platform) {
  if (platform === 'win32') return WINDOWS_URL
  if (platform === 'darwin') return MAC_URL
  if (platform === 'linux') return LINUX_URL
  return null
}

module.exports = { downloadUrlFor }
