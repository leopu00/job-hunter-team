// Resolve the local "Docker launcher" path so the renderer can point the
// user at the right thing when the daemon is not running.
//
//   win32   → Docker Desktop.exe (shell.openPath launches the GUI)
//   darwin  → the `colima` CLI binary (policy: no Docker Desktop on Mac;
//             Colima has no .app — detection is "is the binary on disk?")
//   linux   → null (no Desktop app; systemd handles the daemon)
//
// Returns null when the expected binary/app is not found.

const fs = require('node:fs')
const path = require('node:path')

function candidatePaths(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const programFiles = env['ProgramFiles'] || 'C:\\Program Files'
    return [
      `${programFiles}\\Docker\\Docker\\Docker Desktop.exe`,
      'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
    ]
  }
  if (platform === 'darwin') {
    const paths = [
      '/opt/homebrew/bin/colima', // Apple Silicon brew
      '/usr/local/bin/colima',    // Intel brew
    ]
    // Also honour a PATH-based lookup so non-standard brew prefixes work.
    const pathEnv = env.PATH || ''
    for (const dir of pathEnv.split(path.delimiter)) {
      if (!dir) continue
      const candidate = path.join(dir, 'colima')
      if (!paths.includes(candidate)) paths.push(candidate)
    }
    return paths
  }
  return []
}

function dockerDesktopPath(platform = process.platform, env = process.env) {
  for (const p of candidatePaths(platform, env)) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      // ignore
    }
  }
  return null
}

module.exports = { dockerDesktopPath, candidatePaths }
