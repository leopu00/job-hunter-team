const path = require('node:path')
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { createRuntimeManager } = require('./runtime')
const containerRuntime = require('./container')
const payload = require('./payload')
const dockerInstaller = require('./docker-installer')
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

let mainWindow = null
let runtime = null
let payloadDir = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 700,
    minWidth: 420,
    minHeight: 600,
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
    const status = await runtime.startRuntime(options)
    if (status.running) {
      shell.openExternal(status.url).catch(() => {})
    }
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
    return {
      platform: process.platform,
      arch: process.arch,
      strategy,
      check,
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
    const auth = providerAuth.authStates({ providers: installed, bindHomeDir })
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
    const installed = providerInstall.inspectInstalledProviders().installed
    const auth = providerAuth.authStates({ providers: installed, bindHomeDir: getBindHomeDir() })
    return { auth, installed }
  })

  ipcMain.handle('terminal:start', (_event, { providerId } = {}) => {
    const meta = providerInstall.PROVIDERS[providerId]
    if (!meta) return { ok: false, error: `unknown provider: ${providerId}` }
    if (!payload.isPayloadPresent(payloadDir)) {
      return { ok: false, error: 'payload not present — run container prep first' }
    }
    // `docker compose run --rm` spins up an ephemeral container so
    // the login step works before the user has hit Start-team.
    // HOME=/jht_home points the CLI's credentials dir at the bind-
    // mounted ~/.jht on the host, so the tokens persist. -it asks
    // compose for a TTY, which our node-pty session actually
    // provides on the host side. No `login` argument: the binary
    // opens its interactive UI (e.g. Claude Code's TUI) where the
    // user types the slash-command for authentication.
    const id = terminal.spawnSession({
      command: 'docker',
      args: [
        'compose', 'run', '--rm', '--no-deps',
        '-it',
        '-e', 'HOME=/jht_home',
        '--entrypoint', meta.binary,
        'jht',
      ],
      cwd: payloadDir,
      env: containerPrep.dockerEnv(),
      onData: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`terminal:data:${id}`, data)
        }
      },
      onExit: (exit) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`terminal:exit:${id}`, exit)
        }
      },
    })
    return { ok: true, sessionId: id }
  })

  ipcMain.on('terminal:write', (_event, { sessionId, data }) => {
    terminal.write(sessionId, data)
  })

  ipcMain.on('terminal:resize', (_event, { sessionId, cols, rows }) => {
    terminal.resize(sessionId, cols, rows)
  })

  ipcMain.handle('terminal:kill', (_event, sessionId) => {
    terminal.kill(sessionId)
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
