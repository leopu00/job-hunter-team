// Resolve the local Docker Desktop launcher path so the renderer can
// open it with shell.openPath when the daemon is not running.
//
// Returns null for Linux (no Desktop app there) and for any platform
// where the standard install path does not exist.

const fs = require('node:fs')

function candidatePaths(platform = process.platform) {
  if (platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
    return [
      `${programFiles}\\Docker\\Docker\\Docker Desktop.exe`,
      'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
    ]
  }
  if (platform === 'darwin') {
    return ['/Applications/Docker.app']
  }
  return []
}

function dockerDesktopPath(platform = process.platform) {
  for (const p of candidatePaths(platform)) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      // ignore
    }
  }
  return null
}

module.exports = { dockerDesktopPath, candidatePaths }
