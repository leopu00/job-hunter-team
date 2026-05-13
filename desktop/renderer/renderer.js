// Wizard renderer: entry point.
// Wiring lives in domain modules (wizard-flow, terminal-login, home,
// docker-card, running). This file only imports those modules for
// their side-effects (event listeners get attached at import time)
// and runs boot() to pick the right initial screen.

import { state, dom, appendLog } from './modules/state.js'
import {
  setLang,
  initLangDropdown,
  onLangChange,
} from './modules/i18n.js'
import { SUPPORTED_LANGS, LANG_STORAGE_KEY, DEFAULT_LANG } from './modules/translations.js'
import { STEP_LANGUAGE, STEP_WELCOME, STEP_RUNNING } from './modules/constants.js'
import { showStep } from './modules/state.js'
import {
  renderDockerCard,
  applyPlatformSkeleton,
} from './modules/docker-card.js'
// Side-effect imports: each module wires its own DOM event listeners
// at load time. terminal-login wires login modal + auth list; home
// wires sidebar + dev-additional panel. Drop the import and the
// wiring goes too.
import { smartAdvanceFromWelcome } from './modules/wizard-flow.js'
import './modules/terminal-login.js'
import './modules/telegram-tokens.js'
import { startTeam, stopTeam, refreshRunningStatus } from './modules/running.js'
import { showWizard, showHome, isSetupComplete } from './modules/home.js'

// -------- Wiring (boot-time event listeners that depend on multiple modules) --------

initLangDropdown(document.getElementById('lang-select'), {
  onPick: (lang) => {
    setLang(lang)
  },
})

// Re-render the docker card on language change: the card has dynamic
// hints/labels built from state, not [data-i18n], so applyTranslations
// alone doesn't catch them.
onLangChange(() => {
  if (state.docker) renderDockerCard(state.docker)
})

document.getElementById('btn-language-continue').addEventListener('click', () => {
  showStep(STEP_WELCOME)
})

dom.btnWelcomeBack.addEventListener('click', () => showStep(STEP_LANGUAGE))

dom.btnWelcomeContinue.addEventListener('click', async () => {
  await smartAdvanceFromWelcome()
})

// Dev-mode shortcut: visibile solo quando Electron gira da sorgente.
// Probe async all'avvio; se disponibile, mostra il pulsante accanto al
// "Continue" della welcome. Click → dev:launch (compose + host Next :3001
// + open browser). Vedi main.js IPC 'dev:launch' e scripts/dev-up.sh.
;(async () => {
  try {
    if (!window.launcherApi?.devIsAvailable) return
    const probe = await window.launcherApi.devIsAvailable()
    if (!probe?.available || !dom.devModeActions || !dom.btnDevMode) return
    dom.devModeActions.hidden = false
    dom.btnDevMode.addEventListener('click', async () => {
      const original = dom.btnDevMode.textContent
      dom.btnDevMode.disabled = true
      dom.btnDevMode.textContent = '⏳ Avvio in corso…'
      // Reset del bottone (testo + disabled) dopo `ms`. Serve perche'
      // senza reset il bottone resta bloccato sul messaggio di stato
      // e l'utente non puo' ri-cliccare per fare restart (scenario
      // tipico: cambio a una branch di dev, voglio re-spawnare container).
      const resetAfter = (ms) => setTimeout(() => {
        dom.btnDevMode.textContent = original
        dom.btnDevMode.disabled = false
      }, ms)
      try {
        const res = await window.launcherApi.devLaunch()
        if (!res?.ok) {
          dom.btnDevMode.textContent = `✗ ${res?.error || 'errore sconosciuto'}`
          resetAfter(5000)
          return
        }
        dom.btnDevMode.textContent = res.ready
          ? '✓ Pronto — browser aperto su :3001 (click per restart)'
          : '⚠ Partito ma non ancora pronto (apri :3001 manualmente)'
        resetAfter(6000)
      } catch (err) {
        dom.btnDevMode.textContent = `✗ ${err?.message || err}`
        resetAfter(5000)
      }
    })
  } catch {
    // probe fallito → prod o Electron vecchio senza l'IPC: lascia nascosto
  }
})()

// Running step wiring (start/stop/open browser + status poller).
dom.btnStartTeam.addEventListener('click', startTeam)
dom.btnOpenBrowser.addEventListener('click', () => window.launcherApi.openBrowser())
dom.btnStopTeam.addEventListener('click', stopTeam)

window.launcherApi.onPayloadLog(appendLog)

setInterval(() => {
  if (state.step === STEP_RUNNING) refreshRunningStatus()
}, 3000)

// -------- Boot --------

const stored = (() => {
  try { return localStorage.getItem(LANG_STORAGE_KEY) } catch (_) { return null }
})()

async function boot() {
  if (!(stored && SUPPORTED_LANGS.includes(stored))) {
    setLang(DEFAULT_LANG, { persist: false })
    showWizard(STEP_LANGUAGE)
    return
  }
  setLang(stored, { persist: false })
  try {
    const status = await window.setupApi.getStatus()
    if (isSetupComplete(status)) {
      await showHome('team')
      return
    }
  } catch (error) {
    appendLog(`boot probe: ${error.message || error}`)
  }
  showWizard(STEP_WELCOME)
}

// Paint platform-specific docker-card shape synchronously — before the
// first `setup:get-docker-status` IPC reply — so the user never sees a
// flash of the wrong-platform skeleton on boot.
if (window.platformInfo && window.platformInfo.platform) {
  applyPlatformSkeleton(window.platformInfo.platform)
}

boot()
