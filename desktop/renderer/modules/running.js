import { state, dom, showStep, appendLog } from './state.js'
import { t } from './i18n.js'
import { STEP_RUNNING, STEP_READY } from './constants.js'

export function updateRunningUI(status) {
  if (!status) return
  dom.runningInfo.innerHTML = ''
  const row = (label, value) => {
    const el = document.createElement('div')
    el.className = 'info-row'
    const l = document.createElement('span')
    l.className = 'info-row__label'
    l.textContent = label
    const v = document.createElement('span')
    v.className = 'info-row__value'
    v.textContent = value
    el.appendChild(l)
    el.appendChild(v)
    return el
  }
  if (status.url) dom.runningInfo.appendChild(row(t('running.info.url'), status.url))
  if (status.port) dom.runningInfo.appendChild(row(t('running.info.port'), String(status.port)))
  if (status.mode) dom.runningInfo.appendChild(row(t('running.info.mode'), status.mode))
  if (status.running) {
    dom.runningLead.textContent = t('running.leadRunning')
  } else if (status.mode === 'starting') {
    dom.runningLead.textContent = t('running.leadStarting')
  } else if (status.mode === 'error') {
    const msg = status.lastError || t('running.unknownError')
    dom.runningLead.textContent = t('running.errorGeneric', { msg })
  }
}

export async function refreshRunningStatus() {
  try {
    const status = await window.launcherApi.getStatus()
    updateRunningUI(status)
  } catch (error) {
    appendLog(`refreshRunningStatus: ${error.message || error}`)
  }
}

const _runningLog = (typeof window !== 'undefined' && window.jhtLog && window.jhtLog.scope)
  ? window.jhtLog.scope('running')
  : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

export async function startTeam() {
  _runningLog.info('startTeam.click', { location: state.location, starting: state.starting })
  if (state.starting) {
    _runningLog.warn('startTeam.already-starting')
    return
  }
  // VPS mode: il team gira sulla VPS, non sul Mac. Il container li' si
  // e' gia' auto-pairing-ato via pairing token salvato da install.sh.
  // Il "Start team" sul Mac NON deve scaricare payload + spawn container
  // locale — apre semplicemente la dashboard cloud che legge dal Supabase
  // sincronizzato dalla VPS. Vedi docs/internal/onboarding-flow.md § Path 2.
  if (state.location === 'vps') {
    const dashboardUrl = 'https://jobhunterteam.ai/dashboard'
    _runningLog.info('startTeam.vps.openExternal', { url: dashboardUrl })
    try {
      await window.launcherApi.openExternal(dashboardUrl)
      _runningLog.info('startTeam.vps.openExternal.ok')
    } catch (e) {
      _runningLog.error('startTeam.vps.openExternal.failed', { err: String(e?.message || e) })
      // fallback: prova openBrowser anche se non e' il caso d'uso
      try { await window.launcherApi.openBrowser() } catch { /* ignore */ }
    }
    return
  }
  state.starting = true
  dom.btnStartTeam.disabled = true
  dom.btnStartTeam.textContent = t('running.startingBtn')
  showStep(STEP_RUNNING)
  dom.runningLead.textContent = t('running.leadPrep')
  try {
    const payloadInfo = await window.launcherApi.getPayloadDir()
    if (!payloadInfo?.present) {
      dom.runningLead.textContent = t('running.leadDownload')
      const result = await window.launcherApi.ensurePayload({ update: false })
      if (!result.ok) throw new Error(result.error || 'download failed')
    }
    dom.runningLead.textContent = t('running.leadStartRuntime')
    const status = await window.launcherApi.start({})
    updateRunningUI(status)
    if (status.running && status.url) {
      await window.launcherApi.openBrowser().catch(() => {})
    }
  } catch (error) {
    appendLog(`startTeam error: ${error.message || error}`)
    dom.runningLead.textContent = t('running.errorStart', { msg: error.message || error })
  } finally {
    state.starting = false
    dom.btnStartTeam.disabled = false
    dom.btnStartTeam.textContent = t('ready.start')
  }
}

export async function stopTeam() {
  dom.btnStopTeam.disabled = true
  try {
    await window.launcherApi.stop()
    showStep(STEP_READY)
  } finally {
    dom.btnStopTeam.disabled = false
  }
}
