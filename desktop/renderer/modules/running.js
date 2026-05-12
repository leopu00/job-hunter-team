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

export async function startTeam() {
  if (state.starting) return
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
