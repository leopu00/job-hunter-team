const path = require('node:path')
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const runtime = require('./runtime')

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 640,
    minWidth: 420,
    minHeight: 560,
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

async function openRuntimeInBrowser() {
  const status = await runtime.getStatus()
  await shell.openExternal(status.url)
  return status
}

app.whenReady().then(() => {
  ipcMain.handle('launcher:get-status', () => runtime.getStatus())
  ipcMain.handle('launcher:inspect-setup', () => runtime.inspectSetup())
  ipcMain.handle('launcher:get-log-file', () => runtime.getLogFile())
  ipcMain.handle('launcher:open-browser', () => openRuntimeInBrowser())
  ipcMain.handle('launcher:start', async (_event, options) => {
    const status = await runtime.startRuntime(options)
    if (status.running) {
      shell.openExternal(status.url).catch(() => {})
    }
    return status
  })
  ipcMain.handle('launcher:stop', () => runtime.stopRuntime())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  runtime.stopRuntime().catch(() => {})
})

app.on('window-all-closed', () => {
  app.quit()
})
