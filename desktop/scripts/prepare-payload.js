#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..', '..')
const desktopRoot = path.join(repoRoot, 'desktop')
const payloadRoot = path.join(desktopRoot, 'app-payload')
const webRoot = path.join(repoRoot, 'web')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npmNeedsShell = process.platform === 'win32'

const payloadDirs = ['web', 'shared', 'cli', 'scripts', '.launcher', 'agents']
const payloadFiles = ['package.json', 'package-lock.json', 'requirements.txt', '.env.example']

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

function main() {
  rm(payloadRoot)
  mkdir(payloadRoot)
  ensureWebDependencies()
  ensureWebBuild()

  for (const dir of payloadDirs) copyDir(dir)
  for (const file of payloadFiles) copyFile(file)

  console.log(`[payload] staged in ${payloadRoot}`)
}

main()
