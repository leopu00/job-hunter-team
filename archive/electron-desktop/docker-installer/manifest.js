// Per-OS install strategy for Docker.
// - Windows:  download Docker Desktop Installer.exe, quiet install, accept license.
// - macOS:    brew install colima + docker CLI (policy: no Docker Desktop on Mac).
// - Linux:    run get.docker.com | sh (Engine CE, no Desktop).
//
// Sizes are conservative estimates for the preview screen shown to the user
// before they accept the install. Real sizes fluctuate per release; these are
// tuned to not surprise the user with "it's bigger than I was told".

const WINDOWS_X64_INSTALLER = {
  url: 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe',
  filename: 'Docker Desktop Installer.exe',
  downloadBytes: 620 * 1024 * 1024,
}

const WINDOWS_ARM64_INSTALLER = {
  url: 'https://desktop.docker.com/win/main/arm64/Docker%20Desktop%20Installer.exe',
  filename: 'Docker Desktop Installer.exe',
  downloadBytes: 600 * 1024 * 1024,
}

const DOCKER_DISPLAY_NAME = 'Docker'
const DOCKER_DESCRIPTION =
  'Runtime container leggero. JHT lo usa per isolare i processi degli agenti.'

function getStrategy(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') {
    const installer = arch === 'arm64' ? WINDOWS_ARM64_INSTALLER : WINDOWS_X64_INSTALLER
    return {
      kind: 'windows-docker-desktop',
      displayName: DOCKER_DISPLAY_NAME,
      description: DOCKER_DESCRIPTION,
      version: 'latest',
      download: installer,
      // Docker Desktop on Windows installs about 2.5 GB. JHT recommends 35 GB
      // free because container images (node, python, postgres, ...) eat more.
      installedBytes: 2.5 * 1024 * 1024 * 1024,
      recommendedFreeBytes: 35 * 1024 * 1024 * 1024,
      needsElevation: true,
      stages: ['downloading', 'installing', 'starting-daemon'],
      averageInstallSeconds: 240,
      // If WSL2 is not active, the installer forces a reboot after setup.
      // main.js uses wsl --status to decide whether to warn the user.
      mayRequireReboot: true,
    }
  }

  if (platform === 'darwin') {
    return {
      kind: 'mac-colima',
      displayName: DOCKER_DISPLAY_NAME,
      description: `${DOCKER_DESCRIPTION} Su Mac usiamo Colima (CLI, zero GUI, zero licenza).`,
      version: 'latest',
      packages: ['colima', 'docker'],
      manager: 'brew',
      installedBytes: 350 * 1024 * 1024,
      recommendedFreeBytes: 10 * 1024 * 1024 * 1024,
      needsElevation: false,
      stages: ['installing-brew-packages', 'starting-daemon'],
      averageInstallSeconds: 180,
      mayRequireReboot: false,
    }
  }

  if (platform === 'linux') {
    return {
      kind: 'linux-docker-ce',
      displayName: DOCKER_DISPLAY_NAME,
      description: `${DOCKER_DESCRIPTION} Installato via script ufficiale di Docker.`,
      version: 'latest',
      scriptUrl: 'https://get.docker.com',
      installedBytes: 500 * 1024 * 1024,
      recommendedFreeBytes: 5 * 1024 * 1024 * 1024,
      needsElevation: true,
      stages: ['downloading-script', 'installing', 'configuring-user-group', 'starting-daemon'],
      averageInstallSeconds: 120,
      mayRequireReboot: false,
    }
  }

  return null
}

module.exports = {
  getStrategy,
  DOCKER_DISPLAY_NAME,
}
