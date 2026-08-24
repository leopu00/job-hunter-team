#!/usr/bin/env node
'use strict'

// Vendors the Windows-only prebuilt native binaries needed by the packaged app.
//
// Why this exists: node-pty (@lydell/node-pty) and the keyring (@napi-rs/keyring)
// ship their native `.node` binaries as per-platform optional dependencies. When
// you `npm install` on macOS/Linux, npm filters out the win32 packages (os/cpu
// mismatch), so they never land in node_modules — and electron-builder then has
// nothing to bundle. The Windows installer ships without node-pty / keyring and
// the app fails at runtime with "node-pty not available" / "keyring.unavailable".
//
// This runs as `predist:win`: before building the Windows installer we make sure
// the win32-x64 and win32-arm64 binaries are on disk. It fetches each package as
// a tarball via `npm pack` and extracts it into node_modules. It is idempotent
// and a no-op when the binaries already exist (e.g. on a native Windows runner),
// so it never disturbs a normal Windows build.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const desktopDir = path.resolve(__dirname, '..')
const nodeModules = path.join(desktopDir, 'node_modules')

function pkgVersion(pkgDir) {
  return require(path.join(nodeModules, pkgDir, 'package.json')).version
}

// Resolve the exact versions from the already-installed parent packages so the
// win32 binaries always match the host-platform ones (no drift).
const ptyVersion = pkgVersion('@lydell/node-pty')
const keyringVersion = pkgVersion('@napi-rs/keyring')

const targets = [
  { spec: `@lydell/node-pty-win32-x64@${ptyVersion}`, dir: '@lydell/node-pty-win32-x64' },
  { spec: `@lydell/node-pty-win32-arm64@${ptyVersion}`, dir: '@lydell/node-pty-win32-arm64' },
  { spec: `@napi-rs/keyring-win32-x64-msvc@${keyringVersion}`, dir: '@napi-rs/keyring-win32-x64-msvc' },
  { spec: `@napi-rs/keyring-win32-arm64-msvc@${keyringVersion}`, dir: '@napi-rs/keyring-win32-arm64-msvc' },
]

function hasNativeBinary(dir) {
  const root = path.join(nodeModules, dir)
  if (!fs.existsSync(root)) return false
  const stack = [root]
  while (stack.length) {
    const cur = stack.pop()
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name.endsWith('.node')) return true
    }
  }
  return false
}

function vendor(target) {
  const dest = path.join(nodeModules, target.dir)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jht-native-'))
  try {
    // npm pack prints the tarball filename on stdout (last non-empty line).
    // On Windows npm is npm.cmd and recent Node refuses to spawn .cmd files
    // without a shell — hence the shell flag (args are simple, no quoting risk).
    const isWin = process.platform === 'win32'
    const out = execFileSync(isWin ? 'npm.cmd' : 'npm', ['pack', target.spec, '--silent'], {
      cwd: tmp,
      encoding: 'utf8',
      shell: isWin,
    })
    const tarball = out.trim().split('\n').filter(Boolean).pop().trim()
    // Extract with RELATIVE paths only (cwd=tmp): absolute Windows paths like
    // C:\... make GNU tar (Git bash) treat the drive letter as a remote host.
    // npm tarballs always unpack into ./package — copy that over dest with Node.
    execFileSync('tar', ['-xzf', tarball], { cwd: tmp })
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(path.join(tmp, 'package'), dest, { recursive: true })
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

let vendored = 0
for (const target of targets) {
  if (hasNativeBinary(target.dir)) {
    console.log(`[win-natives] ok      ${target.dir}`)
    continue
  }
  console.log(`[win-natives] fetch   ${target.spec}`)
  vendor(target)
  if (!hasNativeBinary(target.dir)) {
    console.error(`[win-natives] FAILED  no .node binary after extracting ${target.spec}`)
    process.exit(1)
  }
  console.log(`[win-natives] vendored ${target.dir}`)
  vendored += 1
}

console.log(`[win-natives] done (${vendored} vendored, ${targets.length - vendored} already present)`)
