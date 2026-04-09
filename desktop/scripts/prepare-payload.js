#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..', '..')
const desktopRoot = path.join(repoRoot, 'desktop')
const payloadRoot = path.join(desktopRoot, 'app-payload')
const webRoot = path.join(repoRoot, 'web')
const webPayloadRoot = path.join(payloadRoot, 'web')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npmNeedsShell = process.platform === 'win32'

const payloadDirs = ['shared', 'cli', 'scripts', '.launcher', 'agents']
const payloadFiles = ['package.json', 'package-lock.json', 'requirements.txt', '.env.example']
const standaloneRoot = path.join(webRoot, '.next', 'standalone')
const standaloneStaticRoot = path.join(webRoot, '.next', 'static')

function rm(target) {
  fs.rmSync(target, { recursive: true, force: true })
}

function mkdir(target) {
  fs.mkdirSync(target, { recursive: true })
}

function copyDir(name) {
  const from = path.join(repoRoot, name)
  if (!fs.existsSync(from)) return
  const to = path.join(payloadRoot, name)
  fs.cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (source) => {
      const rel = path.relative(from, source)
      if (!rel) return true
      return !rel.startsWith('.turbo')
        && !rel.startsWith('node_modules/.cache')
        && !rel.startsWith('.next/cache')
    },
  })
}

function copyFile(name) {
  const from = path.join(repoRoot, name)
  if (!fs.existsSync(from)) return
  fs.copyFileSync(from, path.join(payloadRoot, name))
}

function copyWebDir(name) {
  const from = path.join(webRoot, name)
  if (!fs.existsSync(from)) return
  const to = path.join(webPayloadRoot, name)
  fs.cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (source) => {
      const rel = path.relative(from, source)
      if (!rel) return true
      return !rel.startsWith('cache')
        && !rel.startsWith('dev')
        && !rel.startsWith('.next/cache')
        && !rel.startsWith('.next/dev')
        && !rel.startsWith('node_modules')
    },
  })
}

function copyWebFile(name) {
  const from = path.join(webRoot, name)
  if (!fs.existsSync(from)) return
  fs.copyFileSync(from, path.join(webPayloadRoot, name))
}

function copyTreeContents(from, to) {
  if (!fs.existsSync(from)) return

  mkdir(to)
  for (const entry of fs.readdirSync(from)) {
    fs.cpSync(path.join(from, entry), path.join(to, entry), {
      recursive: true,
      dereference: true,
    })
  }
}

function pruneMaps(root) {
  if (!fs.existsSync(root)) return

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      pruneMaps(entryPath)
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.map')) {
      fs.rmSync(entryPath, { force: true })
    }
  }
}

function runNpm(args, cwd) {
  execFileSync(npmCommand, args, {
    cwd,
    stdio: 'inherit',
    shell: npmNeedsShell,
  })
}

function ensureWebDependencies() {
  if (fs.existsSync(path.join(webRoot, 'node_modules'))) return

  console.log('[payload] installing web dependencies...')
  runNpm(['ci'], webRoot)
}

function ensureWebBuild() {
  console.log('[payload] building web production bundle...')
  runNpm(['run', 'build'], webRoot)
}

function prepareWebPayload() {
  rm(webPayloadRoot)
  mkdir(webPayloadRoot)

  if (!fs.existsSync(path.join(standaloneRoot, 'server.js'))) {
    throw new Error(`Standalone web server not found in ${standaloneRoot}. Expected server.js after next build.`)
  }

  console.log('[payload] copying standalone web server...')
  copyTreeContents(standaloneRoot, webPayloadRoot)
  copyWebDir('public')
  copyWebFile('.env.example')
  copyTreeContents(standaloneStaticRoot, path.join(webPayloadRoot, '.next', 'static'))
  pruneMaps(webPayloadRoot)
}

function main() {
  rm(payloadRoot)
  mkdir(payloadRoot)
  ensureWebDependencies()
  ensureWebBuild()
  prepareWebPayload()

  for (const dir of payloadDirs) copyDir(dir)
  for (const file of payloadFiles) copyFile(file)

  console.log(`[payload] staged in ${payloadRoot}`)
}

main()
