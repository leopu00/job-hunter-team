// Free disk space on the volume that holds `path`, cross-platform,
// with zero extra dependencies.
//
// Used by the pre-install preview: "Docker needs 2.5 GB, you have 42 GB free".

const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const execFileAsync = promisify(execFile)

async function freeBytesWindows(target) {
  const drive = (target.match(/^[a-zA-Z]:/) || [])[0] || 'C:'
  const letter = drive.replace(':', '').toUpperCase()
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-PSDrive -Name ${letter} -PSProvider FileSystem).Free`,
    ],
    { timeout: 5000 },
  )
  const value = parseInt(stdout.trim(), 10)
  if (!Number.isFinite(value)) {
    throw new Error(`disk-space: could not parse PowerShell output: ${stdout}`)
  }
  return value
}

async function freeBytesUnix(target) {
  if (typeof fs.promises.statfs === 'function') {
    const stats = await fs.promises.statfs(target)
    return stats.bavail * stats.bsize
  }
  const { stdout } = await execFileAsync('df', ['-k', target], { timeout: 5000 })
  const lines = stdout.trim().split('\n')
  const parts = lines[lines.length - 1].trim().split(/\s+/)
  const availableKB = parseInt(parts[3], 10)
  if (!Number.isFinite(availableKB)) {
    throw new Error(`disk-space: could not parse df output: ${stdout}`)
  }
  return availableKB * 1024
}

async function freeBytes(target = os.homedir()) {
  const resolved = path.resolve(target)
  if (process.platform === 'win32') return freeBytesWindows(resolved)
  return freeBytesUnix(resolved)
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(0)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(1)} GB`
}

module.exports = { freeBytes, formatBytes }
