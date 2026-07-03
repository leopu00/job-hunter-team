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
import { STEP_WELCOME_INTRO, STEP_WELCOME } from './modules/constants.js'
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
import { startTeam } from './modules/running.js'
import { showWizard, showHome, isSetupComplete } from './modules/home.js'

// -------- Wiring (boot-time event listeners that depend on multiple modules) --------

initLangDropdown(document.getElementById('intro-lang-select'), {
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

// Welcome-intro entry point. The language picker lives on this same
// screen; "Get started" goes straight to the readiness check. The sign-in
// shortcut was removed — it was confusing and could skip setup steps a
// returning user still needs, so everyone goes through the full flow.
if (dom.btnIntroStart) {
  dom.btnIntroStart.addEventListener('click', () => {
    state.onboardingIntent = 'start'
    showStep(STEP_WELCOME)
  })
}

// Null-guard boot-time listeners: these run at module-import, before boot().
// A missing id (renamed/removed in HTML) would otherwise throw here and abort
// the whole renderer boot → frozen screen. Guarding degrades gracefully to
// "that one button does nothing" instead of "nothing works".
if (dom.btnWelcomeBack) {
  dom.btnWelcomeBack.addEventListener('click', () => showStep(STEP_WELCOME_INTRO))
}

if (dom.btnWelcomeContinue) {
  dom.btnWelcomeContinue.addEventListener('click', async () => {
    await smartAdvanceFromWelcome()
  })
}

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

// Wizard "Start team" wiring. Il bottone della step Ready delega l'avvio
// alla Home (startTeam → showHome + startTeamFromHome): non c'è più uno step
// "running" terminale, la Home segue warming→running e apre la dashboard in-app.
const _bootLog = (typeof window !== 'undefined' && window.jhtLog && window.jhtLog.scope)
  ? window.jhtLog.scope('boot')
  : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
_bootLog.info('wiring.start', {
  btnStartTeam: !!dom.btnStartTeam,
})
if (dom.btnStartTeam) {
  dom.btnStartTeam.addEventListener('click', (e) => {
    _bootLog.info('btnStartTeam.click-raw', { isTrusted: e.isTrusted, defaultPrevented: e.defaultPrevented })
    startTeam()
  })
} else {
  _bootLog.error('btnStartTeam.missing-at-wire-time')
}

// preload wires launcherApi via contextBridge; guard in case an old/partial
// preload didn't expose it, so the boot doesn't die on a missing API.
if (window.launcherApi?.onPayloadLog) {
  window.launcherApi.onPayloadLog(appendLog)
} else {
  _bootLog.warn('launcherApi.onPayloadLog.missing')
}

// -------- Boot --------

const stored = (() => {
  try { return localStorage.getItem(LANG_STORAGE_KEY) } catch (_) { return null }
})()

async function boot() {
  // Lingua: fonte affidabile = prefsApi (file nel main). localStorage su
  // origine file:// NON persiste in Electron → prima era sempre null e
  // forzava il wizard lingua → "setup da capo" ad ogni riavvio. La decisione
  // Home NON dipende più dalla lingua: se il provider è salvato → Home.
  let lang = null
  try { lang = await window.prefsApi?.get?.('lang') } catch (_) { /* ignore */ }
  if (!lang) lang = stored // fallback localStorage legacy
  const validLang = lang && SUPPORTED_LANGS.includes(lang) ? lang : null
  setLang(validLang || DEFAULT_LANG, { persist: false })
  _bootLog.info('boot.start', { lang: validLang || null })

  try {
    const status = await window.setupApi.getStatus()
    const saved = status && status.providers && Array.isArray(status.providers.saved)
      ? status.providers.saved : []
    const complete = isSetupComplete(status)
    _bootLog.info('boot.status', { saved, complete })
    if (complete) {
      _bootLog.info('boot.decision', { screen: 'home' })
      await showHome('team')
      return
    }
  } catch (error) {
    _bootLog.warn('boot.probe-failed', { err: error && (error.message || String(error)) })
    appendLog(`boot probe: ${error.message || error}`)
  }
  // Setup incompleto: primissimo avvio (lingua mai scelta) → schermata di
  // benvenuto con pitch + Inizia/Accedi. Relaunch a metà setup (lingua già
  // scelta) → riprende dallo step tecnico, saltando l'intro.
  const screen = validLang ? STEP_WELCOME : STEP_WELCOME_INTRO
  _bootLog.info('boot.decision', { screen: validLang ? 'wizard:welcome' : 'wizard:welcome-intro', reason: 'setup-incomplete' })
  showWizard(screen)
}

// Paint platform-specific docker-card shape synchronously — before the
// first `setup:get-docker-status` IPC reply — so the user never sees a
// flash of the wrong-platform skeleton on boot.
if (window.platformInfo && window.platformInfo.platform) {
  applyPlatformSkeleton(window.platformInfo.platform)
}

boot()
