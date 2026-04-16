const path = require('node:path')
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { createRuntimeManager } = require('./runtime')
const containerRuntime = require('./container')
const payload = require('./payload')

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

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  if (runtime) runtime.stopRuntime().catch(() => {})
})

app.on('window-all-closed', () => {
  app.quit()
})
