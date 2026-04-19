const path = require('node:path')
const { app, BrowserWindow, clipboard, ipcMain, shell } = require('electron')

// macOS GUI apps launched from Finder/Launchpad inherit a sanitized PATH
// that excludes /opt/homebrew/bin and /usr/local/bin. Every spawn/execFile
// we make (docker, colima, brew, git, ...) would then fail with ENOENT
// even though the binaries are installed. Patch the main process PATH
// once at boot so every child inherits the right PATH. Done here (not in
// each module) so third-party dependencies that shell out internally
// also work.
if (process.platform === 'darwin') {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin']
  const current = process.env.PATH || ''
  const parts = current.split(':').filter(Boolean)
  for (const dir of extra.reverse()) {
    if (!parts.includes(dir)) parts.unshift(dir)
  }
  process.env.PATH = parts.join(':')
}

// Dev convenience: when running unpackaged (npm run dev) with a sibling
// web/ checkout, auto-enable the live bind mount so edits to /web show
// up in the container instantly via Next HMR. Temporary — remove once
// we lock the image pipeline for end-users.
if (!app.isPackaged && !('JHT_DEV_WEB_DIR' in process.env)) {
  const siblingWeb = path.resolve(__dirname, '..', 'web')
  if (require('node:fs').existsSync(path.join(siblingWeb, 'package.json'))) {
    process.env.JHT_DEV_WEB_DIR = siblingWeb
  }
}
if (!app.isPackaged && !('JHT_DEV_REPO_DIR' in process.env)) {
  const repoRoot = path.resolve(__dirname, '..')
  if (require('node:fs').existsSync(path.join(repoRoot, '.launcher', 'start-agent.sh'))) {
    process.env.JHT_DEV_REPO_DIR = repoRoot
  }
}
const { createRuntimeManager } = require('./runtime')
const containerRuntime = require('./container')
const payload = require('./payload')
const dockerInstaller = require('./docker-installer')
const winInstaller = require('./win-installer/install')
const deps = require('./deps')
const containerPrep = require('./container-prep')
const providerInstall = require('./provider-install')
const providerStore = require('./provider-store')
const providerAuth = require('./provider-auth')
const terminal = require('./terminal')
const { freeBytes, formatBytes } = require('./disk-space')

function getBindHomeDir() {
  return path.join(require('node:os').homedir(), '.jht')
}

// Map desktop-side provider id → the active_provider value that
// .launcher/start-agent.sh (running inside the container) expects.
// Codex is "openai" in that config because the start-agent script
// dispatches on the vendor, not the product name.
const DESKTOP_TO_LAUNCHER_PROVIDER = {
  claude: 'claude',
  codex: 'openai',
  kimi: 'kimi',
}

// Export the user's chosen provider/plan to ~/.jht/jht.config.json so
// the agent-boot script inside the container can pick the right CLI
// and load the right identity file (CLAUDE.md for Claude, AGENTS.md
// for Codex / Kimi). Written right before `docker run` on Start Team.
function syncJhtConfig() {
  const selection = providerStore.readSelection(require('electron').app.getPath('userData'))
  if (!selection?.provider) return false
  const activeProvider = DESKTOP_TO_LAUNCHER_PROVIDER[selection.provider] || selection.provider
  const config = {
    active_provider: activeProvider,
    plan: selection.plan ?? null,
    providers: {
      [activeProvider]: { auth_method: 'subscription' },
    },
  }
  const bindHomeDir = getBindHomeDir()
  require('node:fs').mkdirSync(bindHomeDir, { recursive: true })
  require('node:fs').writeFileSync(
    path.join(bindHomeDir, 'jht.config.json'),
    JSON.stringify(config, null, 2) + '\n',
  )
  return true
}

let mainWindow = null
let runtime = null
let payloadDir = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    autoHideMenuBar: true,
    title: 'JHT Desktop',
    backgroundColor: '#0d1411',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // Force every link/URL open to go through the host's default browser
  // via shell.openExternal. Without this, Electron would happily spawn
  // a nested BrowserWindow for things like window.open(...) — which
  // would not carry the user's existing session cookies (e.g. Google
  // OAuth) and force them to log in again.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL() && /^https?:\/\//i.test(url)) {
      event.preventDefault()
      shell.openExternal(url).catch(() => {})
    }
  })
}

function broadcastPayloadLog(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:payload-log', String(message))
  }
}

function broadcastContainerLog(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('setup:container-log', String(message))
  }
}

function broadcastProviderLog(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('setup:provider-log', String(message))
  }
}

function broadcastInstallLog(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('setup:install-log', String(message))
  }
}

function broadcastInstallStage(stage, status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('setup:install-stage', { stage, status })
  }
}

async function openRuntimeInBrowser() {
  const status = await runtime.getStatus()
  const launchableStatus = status.mode === 'running' || status.mode === 'external'
    ? status
    : await runtime.startRuntime({ port: status.port })

  if (launchableStatus.running) {
    await shell.openExternal(launchableStatus.url)
  }

  return launchableStatus
}

app.whenReady().then(() => {
  payloadDir = path.join(app.getPath('userData'), 'app-payload')
  runtime = createRuntimeManager({
    containerMode: containerRuntime.shouldUseContainer(),
    payloadDir,
  })

  ipcMain.handle('launcher:get-status', () => runtime.getStatus())
  ipcMain.handle('launcher:inspect-setup', () => runtime.inspectSetup())
  ipcMain.handle('launcher:get-log-file', () => runtime.getLogFile())
  ipcMain.handle('launcher:get-payload-dir', () => ({
    payloadDir,
    present: payload.isPayloadPresent(payloadDir),
  }))
  ipcMain.handle('launcher:ensure-payload', async (_event, options = {}) => {
    try {
      const result = await payload.ensurePayload({
        payloadDir,
        updateIfPresent: options.update === true,
        logger: broadcastPayloadLog,
      })
      return { ok: true, ...result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      broadcastPayloadLog(`Errore: ${message}`)
      return { ok: false, error: message }
    }
  })
  ipcMain.handle('launcher:open-browser', () => openRuntimeInBrowser())
  ipcMain.handle('launcher:start', async (_event, options) => {
    try {
      syncJhtConfig()
    } catch (error) {
      // Non-fatal: the agent-boot script has a Claude-subscription
      // fallback, so a missing or partial config just means the user
      // drops into the default provider.
      broadcastContainerLog(`syncJhtConfig failed: ${error?.message ?? error}`)
    }
    const status = await runtime.startRuntime(options)
    return status
  })
  ipcMain.handle('launcher:stop', () => runtime.stopRuntime())
  ipcMain.handle('launcher:open-external', async (_event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'invalid-url' }
    }
    try {
      await shell.openExternal(url)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Setup wizard — Docker status + download page + disk space preview.
  ipcMain.handle('setup:get-docker-status', async () => {
    const strategy = dockerInstaller.getStrategy()
    const check = await dockerInstaller.checkDocker()
    let free = null
    let freeHuman = null
    try {
      const bytes = await freeBytes(app.getPath('home'))
      free = bytes
      freeHuman = formatBytes(bytes)
    } catch {
      // Preview can show "unknown" if the disk probe fails.
    }
    let steps = null
    try {
      steps = await dockerInstaller.inspectInstallSteps({ platform: process.platform })
    } catch {
      // Leave steps null on failure; renderer falls back to the generic view.
    }
    return {
      platform: process.platform,
      arch: process.arch,
      strategy,
      check,
      steps,
      disk: {
        freeBytes: free,
        freeHuman,
        requiredBytes: strategy ? strategy.installedBytes : null,
        requiredHuman: strategy ? formatBytes(strategy.installedBytes) : null,
        recommendedFreeBytes: strategy ? strategy.recommendedFreeBytes : null,
        recommendedFreeHuman: strategy ? formatBytes(strategy.recommendedFreeBytes) : null,
        meetsRequirement:
          strategy && free !== null ? free >= strategy.installedBytes : null,
        meetsRecommendation:
          strategy && free !== null ? free >= strategy.recommendedFreeBytes : null,
      },
    }
  })

  ipcMain.handle('setup:open-brew-homepage', async () => {
    try {
      await shell.openExternal('https://brew.sh')
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('setup:install-docker', async () => {
    try {
      const result = await dockerInstaller.installDocker({
        platform: process.platform,
        onLog: broadcastInstallLog,
        onStage: broadcastInstallStage,
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      broadcastInstallLog(`Errore: ${message}`)
      return { ok: false, stage: 'exception', error: message }
    }
  })

  // Windows-only: one-click install of WSL2 + Docker Desktop behind a
  // single UAC prompt. Reuses the install-log broadcast channel so the
  // renderer can show live progress in the same panel.
  ipcMain.handle('setup:install-windows-stack', async () => {
    try {
      return await winInstaller.installWindowsStack({
        platform: process.platform,
        onLog: broadcastInstallLog,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      broadcastInstallLog(`Errore: ${message}`)
      return { ok: false, stage: 'exception', error: message }
    }
  })

  // Triggers a full OS reboot. Used at the end of the Windows install
  // flow so WSL2 kernel + Docker engine come up clean on next boot.
  ipcMain.handle('setup:reboot', async () => {
    if (process.platform !== 'win32') {
      return { ok: false, error: 'unsupported-platform' }
    }
    const { spawn } = require('node:child_process')
    try {
      spawn('shutdown.exe', ['/r', '/t', '0'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('setup:open-docker-download-page', async () => {
    const url = dockerInstaller.downloadUrlFor()
    if (!url) return { ok: false, error: 'unsupported-platform' }
    try {
      await shell.openExternal(url)
      return { ok: true, url }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('setup:get-extra-deps', async () => {
    try {
      return await deps.inspectExtraDeps()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { deps: [], allRequiredOk: false, error: message }
    }
  })

  ipcMain.handle('setup:ensure-container', async () => {
    try {
      if (!payload.isPayloadPresent(payloadDir)) {
        broadcastContainerLog('Fetching payload (compose file + Dockerfile)…')
        const result = await payload.ensurePayload({
          payloadDir,
          updateIfPresent: false,
          logger: broadcastContainerLog,
        })
        if (!result) {
          return { ok: false, stage: 'payload', error: 'payload missing after ensure' }
        }
      }
      return await containerPrep.ensureContainerImage({
        payloadDir,
        onLog: broadcastContainerLog,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      broadcastContainerLog(`Error: ${message}`)
      return { ok: false, stage: 'exception', error: message }
    }
  })

  ipcMain.handle('setup:get-status', async () => {
    const docker = await dockerInstaller.checkDocker()
    const extra = await deps.inspectExtraDeps()
    const image = containerPrep.inspectImage()
    const saved = providerStore.readProviders(app.getPath('userData'))
    const { installed } = providerInstall.inspectInstalledProviders()
    const bindHomeDir = getBindHomeDir()
    // Auth only matters for providers the user currently picks (saved).
    // Binaries in the bind-mount from previous runs are ignored — the
    // user deselected them, they shouldn't resurface at login.
    const relevant = saved.filter((id) => installed.includes(id))
    const auth = providerAuth.authStates({ providers: relevant, bindHomeDir })
    return {
      docker,
      extra,
      image,
      providers: {
        saved,
        installed,
        pending: saved.filter((id) => !installed.includes(id)),
        auth,
        authed: auth.filter((a) => a.authed).map((a) => a.id),
        unauthed: auth.filter((a) => !a.authed).map((a) => a.id),
      },
    }
  })

  ipcMain.handle('setup:get-auth-states', () => {
    const saved = providerStore.readProviders(app.getPath('userData'))
    const installed = providerInstall.inspectInstalledProviders().installed
    const relevant = saved.filter((id) => installed.includes(id))
    const auth = providerAuth.authStates({ providers: relevant, bindHomeDir: getBindHomeDir() })
    return { auth, installed: relevant }
  })

  ipcMain.handle('setup:logout-provider', (_event, providerId) => {
    if (typeof providerId !== 'string' || !providerId) {
      return { ok: false, error: 'providerId required' }
    }
    try {
      return providerAuth.logoutProvider(providerId, { bindHomeDir: getBindHomeDir() })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  const loginContainerNames = new Map()

  ipcMain.handle('terminal:start', (_event, { providerId } = {}) => {
    const meta = providerInstall.PROVIDERS[providerId]
    if (!meta) return { ok: false, error: `unknown provider: ${providerId}` }
    if (!payload.isPayloadPresent(payloadDir)) {
      return { ok: false, error: 'payload not present — run container prep first' }
    }
    // Predictable container name so we can docker-kill the orphan
    // if the user closes the modal before the CLI exits cleanly.
    const containerName = `jht-login-${providerId}-${Date.now()}`
    // Append loginArgs (e.g. --yolo for kimi) so the first-run trust
    // dialog is auto-accepted and the approval lands in the CLI's
    // config on disk. Later launches — including the background
    // assistant boot — will skip straight past it.
    const loginArgs = Array.isArray(meta.loginArgs) ? meta.loginArgs : []
    const id = terminal.spawnSession({
      command: 'docker',
      args: [
        'compose', 'run', '--rm', '--no-deps',
        '-it',
        '--name', containerName,
        '-e', 'HOME=/jht_home',
        '--entrypoint', meta.binary,
        'jht',
        ...loginArgs,
      ],
      cwd: payloadDir,
      env: containerPrep.dockerEnv(),
      onData: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`terminal:data:${id}`, data)
        }
      },
      onExit: (exit) => {
        loginContainerNames.delete(id)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`terminal:exit:${id}`, exit)
        }
      },
    })
    loginContainerNames.set(id, containerName)
    return { ok: true, sessionId: id }
  })

  ipcMain.on('terminal:write', (_event, { sessionId, data }) => {
    terminal.write(sessionId, data)
  })

  ipcMain.on('terminal:resize', (_event, { sessionId, cols, rows }) => {
    terminal.resize(sessionId, cols, rows)
  })

  ipcMain.handle('terminal:kill', (_event, sessionId) => {
    const containerName = loginContainerNames.get(sessionId)
    terminal.kill(sessionId)
    loginContainerNames.delete(sessionId)
    if (containerName) {
      const { spawn } = require('node:child_process')
      // Best-effort: remove the ephemeral container. --rm would clean
      // it up if the CLI exited normally, but closing the modal
      // early leaves it running.
      try {
        spawn('docker', ['rm', '-f', containerName], {
          stdio: 'ignore',
          windowsHide: true,
          detached: true,
        }).unref()
      } catch { /* ignore */ }
    }
    return { ok: true }
  })

  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.handle('clipboard:write', (_event, text) => {
    if (typeof text === 'string') clipboard.writeText(text)
    return { ok: true }
  })

  ipcMain.handle('setup:install-providers', async (_event, providerIds) => {
    try {
      if (!payload.isPayloadPresent(payloadDir)) {
        return { ok: false, stage: 'payload', error: 'payload not present — run container prep first' }
      }
      const result = await providerInstall.installProviders({
        providerIds: Array.isArray(providerIds) ? providerIds : [],
        payloadDir,
        onLog: broadcastProviderLog,
      })
      if (result.ok) {
        providerStore.writeProviders(app.getPath('userData'), providerIds)
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      broadcastProviderLog(`Error: ${message}`)
      return { ok: false, stage: 'exception', error: message }
    }
  })

  ipcMain.handle('setup:get-providers', () => {
    return { providers: providerStore.readProviders(app.getPath('userData')) }
  })

  // New single-select API used by the redesigned provider picker:
  // one provider, one plan tier. The plan value is purely
  // informational — the sentinel reads it later to size context
  // windows against the account's actual quota.
  ipcMain.handle('setup:get-selection', () => {
    return providerStore.readSelection(app.getPath('userData'))
  })

  ipcMain.handle('setup:save-selection', (_event, { provider, plan } = {}) => {
    try {
      return {
        ok: true,
        selection: providerStore.writeSelection(app.getPath('userData'), { provider, plan }),
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('setup:open-docker-desktop', async () => {
    const desktopPath = dockerInstaller.dockerDesktopPath()
    if (!desktopPath) return { ok: false, error: 'docker-desktop-not-found' }
    try {
      const result = await shell.openPath(desktopPath)
      if (result) return { ok: false, error: result }
      return { ok: true, path: desktopPath }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  if (runtime) runtime.stopRuntime().catch(() => {})
  terminal.killAll()
})

app.on('window-all-closed', () => {
  app.quit()
})
