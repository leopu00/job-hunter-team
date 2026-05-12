// "Open with…" prompt that lets the user pick which installed
// browser receives the OAuth authorize URL. Reason: the user often
// has Google sessions for multiple accounts open in their default
// browser, and Google's account picker + cookie state interact in
// ways that surprise them. Letting the user pick a clean browser
// (typically Safari / Firefox where they don't have another session)
// avoids the "auto-logged into the wrong account" trap.
//
// macOS only for now — on other OSes we fall back to shell.openExternal.

const fs = require('node:fs')
const { execFile } = require('node:child_process')
const { dialog, shell } = require('electron')

// macOS browsers we look for under /Applications. `app` is the value
// passed to `open -a`; it must match the app's display name exactly.
const MAC_BROWSERS = [
  { name: 'Google Chrome',    app: 'Google Chrome',    path: '/Applications/Google Chrome.app' },
  { name: 'Safari',           app: 'Safari',           path: '/Applications/Safari.app' },
  { name: 'Firefox',          app: 'Firefox',          path: '/Applications/Firefox.app' },
  { name: 'Brave Browser',    app: 'Brave Browser',    path: '/Applications/Brave Browser.app' },
  { name: 'Microsoft Edge',   app: 'Microsoft Edge',   path: '/Applications/Microsoft Edge.app' },
  { name: 'Arc',              app: 'Arc',              path: '/Applications/Arc.app' },
  { name: 'Vivaldi',          app: 'Vivaldi',          path: '/Applications/Vivaldi.app' },
  { name: 'Opera',            app: 'Opera',            path: '/Applications/Opera.app' },
  { name: 'Chromium',         app: 'Chromium',         path: '/Applications/Chromium.app' },
  { name: 'Google Chrome Canary', app: 'Google Chrome Canary', path: '/Applications/Google Chrome Canary.app' },
]

function detectMacBrowsers() {
  return MAC_BROWSERS.filter((b) => {
    try { return fs.existsSync(b.path) } catch { return false }
  })
}

function openWithMacApp(url, appName) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', ['-a', appName, url], (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// Show the picker and open the URL with the chosen browser. Returns
// when the open command has been dispatched (not when the user closes
// the browser tab). On non-macOS platforms, or if no browsers are
// detected, falls back to shell.openExternal (system default).
async function openInChosenBrowser(url, { title, message } = {}) {
  if (process.platform !== 'darwin') {
    await shell.openExternal(url)
    return
  }
  const browsers = detectMacBrowsers()
  if (browsers.length === 0) {
    await shell.openExternal(url)
    return
  }
  const buttons = browsers.map((b) => b.name).concat(['Default browser', 'Annulla'])
  const cancelId = buttons.length - 1
  const defaultBrowserId = buttons.length - 2
  const result = await dialog.showMessageBox({
    type: 'question',
    title: title || 'Scegli browser',
    message: message || 'Con quale browser vuoi aprire la pagina di login?',
    detail: 'Suggerimento: scegli un browser dove NON sei già loggato con un account Google diverso da quello che vuoi usare. Altrimenti Google potrebbe autocollegarti con l\'account sbagliato.',
    buttons,
    cancelId,
    defaultId: 0,
    noLink: true,
  })
  if (result.response === cancelId) {
    throw new Error('User cancelled browser selection')
  }
  if (result.response === defaultBrowserId) {
    await shell.openExternal(url)
    return
  }
  const chosen = browsers[result.response]
  await openWithMacApp(url, chosen.app)
}

module.exports = { openInChosenBrowser, detectMacBrowsers }
