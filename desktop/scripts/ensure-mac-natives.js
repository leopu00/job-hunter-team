#!/usr/bin/env node
'use strict'

// Vendors the macOS prebuilt native binaries needed by the packaged app.
//
// Why this exists: node-pty (@lydell/node-pty) and the keyring (@napi-rs/keyring)
// ship their native `.node` binaries as per-platform optional dependencies. A
// plain `npm install` only lands the binary for the HOST arch — it filters out
// the other darwin arch (cpu mismatch). So an Apple-Silicon `npm install` never
// fetches @lydell/node-pty-darwin-x64, and vice-versa. `build.files` lists both
// darwin dirs, but electron-builder can only bundle what is actually on disk —
// so a cross-arch or universal dmg ships without node-pty / keyring for the
// other arch and the login terminal dies at runtime with "node-pty not
// available" (the same class of bug ensure-win-natives.js fixes for Windows).
//
// This runs as `predist:mac`: before building the mac installer we make sure
// BOTH darwin arches (arm64 + x64) are on disk for node-pty and keyring. It
// fetches each missing package as a tarball via `npm pack` and extracts it into
// node_modules. It is idempotent and a no-op when a binary already exists (e.g.
// the host-arch one npm just installed), so it never disturbs a normal build.

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
// vendored binaries always match the host-platform ones (no drift).
const ptyVersion = pkgVersion('@lydell/node-pty')
const keyringVersion = pkgVersion('@napi-rs/keyring')

const targets = [
  { spec: `@lydell/node-pty-darwin-arm64@${ptyVersion}`, dir: '@lydell/node-pty-darwin-arm64' },
  { spec: `@lydell/node-pty-darwin-x64@${ptyVersion}`, dir: '@lydell/node-pty-darwin-x64' },
  { spec: `@napi-rs/keyring-darwin-arm64@${keyringVersion}`, dir: '@napi-rs/keyring-darwin-arm64' },
  { spec: `@napi-rs/keyring-darwin-x64@${keyringVersion}`, dir: '@napi-rs/keyring-darwin-x64' },
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
    const out = execFileSync('npm', ['pack', target.spec, '--silent'], {
      cwd: tmp,
      encoding: 'utf8',
    })
    const tarball = out.trim().split('\n').filter(Boolean).pop().trim()
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
    console.log(`[mac-natives] ok      ${target.dir}`)
    continue
  }
  console.log(`[mac-natives] fetch   ${target.spec}`)
  vendor(target)
  if (!hasNativeBinary(target.dir)) {
    console.error(`[mac-natives] FAILED  no .node binary after extracting ${target.spec}`)
    process.exit(1)
  }
  console.log(`[mac-natives] vendored ${target.dir}`)
  vendored += 1
}

console.log(`[mac-natives] done (${vendored} vendored, ${targets.length - vendored} already present)`)
