// desktop/vps/remote-config.js — onboarding writers VPS-aware (orari di
// lavoro + documenti del profilo) sul container REMOTO via SSH.
//
// Il wizard in modalità VPS deve far atterrare gli stessi dati del ramo
// locale — team.working_hours in jht.config.json e i documenti del profilo
// nella drop-zone allegati — sulla VPS invece che in ~/.jht / ~/Documents
// sul Mac. Riusa il pattern read→merge→atomic-write di telegram/index.js
// (saveBotsToVps / saveProviderToVps) e SshExec.writeFile, che accetta un
// Buffer come input (`cat > file`) → upload binario dei PDF senza scp.
//
// Path remoti (Hetzner Ubuntu, HOME=/root):
//   - config:   /root/.jht/jht.config.json                 (bind → /jht_home)
//   - allegati: /root/Documents/Job Hunter Team/allegati   (bind → /jht_user/allegati)
// Entrambi vanno chown 1001:1001 (UID del container) o il team non li legge.

const fs = require('node:fs')
const path = require('node:path')
const log = require('../logger').child('vps-remote-config')
const SshExec = require('./ssh-exec')

const REMOTE_CONFIG_PATH = '/root/.jht/jht.config.json'
const REMOTE_CONFIG_DIR = path.posix.dirname(REMOTE_CONFIG_PATH)
const CONTAINER_UID = '1001:1001'
// Speculare a getUserUploadsDir() lato locale (main.js): $HOME/Documents/Job
// Hunter Team/allegati con HOME=/root sulla VPS. Bind compose
// `${HOME}/Documents/Job Hunter Team:/jht_user` → l'Assistente legge
// $JHT_USER_DIR/allegati = /jht_user/allegati al boot.
const REMOTE_UPLOADS_DIR = '/root/Documents/Job Hunter Team/allegati'

// Legge il jht.config.json remoto. File mancante/vuoto → {} (fresh start);
// errore SSH (host irraggiungibile) → propagato come failure.
async function readRemoteConfig(vpsIp) {
  let readRes
  try {
    readRes = await SshExec.run(
      vpsIp, `cat '${REMOTE_CONFIG_PATH}' 2>/dev/null || true`, { timeout: 15000 },
    )
  } catch (e) {
    return { ok: false, error: 'ssh-read-error', detail: e.message }
  }
  if (readRes.ok && readRes.stdout && readRes.stdout.trim()) {
    try {
      const parsed = JSON.parse(readRes.stdout)
      return { ok: true, config: parsed && typeof parsed === 'object' ? parsed : {} }
    } catch (e) {
      log.warn('readRemoteConfig.malformed', { err: e.message })
      return { ok: false, error: 'remote-config-malformed', detail: e.message }
    }
  }
  if (!readRes.ok) {
    log.warn('readRemoteConfig.read-failed', { code: readRes.code, stderr: readRes.stderr })
    return { ok: false, error: 'ssh-read-failed', stderr: readRes.stderr }
  }
  return { ok: true, config: {} }
}

// mkdir -p della dir config + atomic write + chown 1001 (il container legge
// il file come UID 1001; il write-then-rename via SSH lo ricrea root:root).
async function writeRemoteConfig(vpsIp, remote) {
  try {
    const mk = await SshExec.run(vpsIp, `mkdir -p '${REMOTE_CONFIG_DIR}'`, { timeout: 15000 })
    if (!mk.ok) return { ok: false, error: 'ssh-mkdir-failed', stderr: mk.stderr }
  } catch (e) {
    return { ok: false, error: 'ssh-mkdir-error', detail: e.message }
  }
  const serialized = JSON.stringify(remote, null, 2) + '\n'
  try {
    const wr = await SshExec.writeFile(vpsIp, REMOTE_CONFIG_PATH, serialized, { mode: '0644', atomic: true })
    if (!wr.ok) return { ok: false, error: 'ssh-write-failed', detail: wr.err }
  } catch (e) {
    return { ok: false, error: 'ssh-write-error', detail: e.message }
  }
  try {
    await SshExec.run(vpsIp, `chown ${CONTAINER_UID} '${REMOTE_CONFIG_PATH}'`, { timeout: 10000 })
  } catch (e) {
    log.warn('writeRemoteConfig.chown-failed', { err: e.message })
  }
  return { ok: true }
}

// read → set team.working_hours → atomic write. working_hours può essere
// null (=24/7), {timezone, windows:[...]}, o {timezone, windows:[]} (=24/7).
async function saveWorkingHoursToVps(vpsIp, working_hours) {
  if (!vpsIp) return { ok: false, error: 'vps-ip-missing' }
  const read = await readRemoteConfig(vpsIp)
  if (!read.ok) return read
  const remote = read.config && typeof read.config === 'object' ? read.config : {}
  remote.team = {
    ...(remote.team && typeof remote.team === 'object' ? remote.team : {}),
    working_hours: working_hours ?? null,
  }
  const w = await writeRemoteConfig(vpsIp, remote)
  if (!w.ok) return w
  log.info('saveWorkingHoursToVps.ok', { vpsIp, alwaysOn: !working_hours })
  return { ok: true, path: REMOTE_CONFIG_PATH, working_hours: working_hours ?? null }
}

// Prefill del wizard al relaunch: team.working_hours dal config remoto.
async function getWorkingHoursFromVps(vpsIp) {
  if (!vpsIp) return { ok: false, error: 'vps-ip-missing' }
  const read = await readRemoteConfig(vpsIp)
  if (!read.ok) return read
  const cfg = read.config || {}
  const wh = cfg.team && typeof cfg.team === 'object' ? cfg.team.working_hours : null
  return { ok: true, working_hours: wh ?? null }
}

// Sanitizza un basename per single-quote bash + filesystem: via apici
// singoli (rotti dal quoting di writeFile) e i separatori di path.
function safeBasename(name) {
  return String(name).replace(/[/\\]/g, '_').replace(/'/g, '').trim() || 'file'
}

// Carica una lista di file locali nella drop-zone allegati remota. Legge
// ogni file come Buffer e lo scrive via SshExec.writeFile (input
// binario-safe). chown -R 1001 sull'intera dir alla fine.
async function uploadDocsToVps(vpsIp, filePaths) {
  if (!vpsIp) return { ok: false, error: 'vps-ip-missing', files: [] }
  const list = Array.isArray(filePaths) ? filePaths : []
  try {
    const mk = await SshExec.run(vpsIp, `mkdir -p '${REMOTE_UPLOADS_DIR}'`, { timeout: 15000 })
    if (!mk.ok) return { ok: false, error: 'ssh-mkdir-failed', stderr: mk.stderr, files: [] }
  } catch (e) {
    return { ok: false, error: 'ssh-mkdir-error', detail: e.message, files: [] }
  }
  const saved = []
  for (const fp of list) {
    let buf
    try {
      buf = fs.readFileSync(fp)
    } catch (e) {
      log.warn('uploadDocsToVps.read-failed', { file: fp, err: e.message })
      continue
    }
    const base = safeBasename(path.basename(fp))
    const remotePath = `${REMOTE_UPLOADS_DIR}/${base}`
    try {
      const wr = await SshExec.writeFile(vpsIp, remotePath, buf, { mode: '0644', atomic: true })
      if (!wr.ok) {
        log.warn('uploadDocsToVps.write-failed', { file: fp, err: wr.err })
        continue
      }
      saved.push({ name: base, size: buf.length })
    } catch (e) {
      log.warn('uploadDocsToVps.write-error', { file: fp, err: e.message })
    }
  }
  try {
    await SshExec.run(vpsIp, `chown -R ${CONTAINER_UID} '${REMOTE_UPLOADS_DIR}'`, { timeout: 15000 })
  } catch (e) {
    log.warn('uploadDocsToVps.chown-failed', { err: e.message })
  }
  log.info('uploadDocsToVps.ok', { vpsIp, count: saved.length })
  return { ok: true, files: saved }
}

// ls della drop-zone remota → [{name, size}]. Per il merge degli upload
// precedenti come fa listDocs() in locale. find -printf è GNU (Ubuntu);
// esclude le dot-file (.jht-tmp.* dei write atomici).
async function listDocsOnVps(vpsIp) {
  if (!vpsIp) return { ok: false, error: 'vps-ip-missing', files: [] }
  const cmd = `find '${REMOTE_UPLOADS_DIR}' -maxdepth 1 -type f ! -name '.*' -printf '%s\\t%f\\n' 2>/dev/null || true`
  let res
  try {
    res = await SshExec.run(vpsIp, cmd, { timeout: 15000 })
  } catch (e) {
    return { ok: false, error: 'ssh-ls-error', detail: e.message, files: [] }
  }
  if (!res.ok) return { ok: true, files: [] } // dir mancante → nessun file
  const files = []
  for (const line of (res.stdout || '').split('\n')) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const size = parseInt(line.slice(0, tab), 10)
    const name = line.slice(tab + 1).trim()
    if (name) files.push({ name, size: Number.isFinite(size) ? size : 0 })
  }
  return { ok: true, files }
}

module.exports = {
  saveWorkingHoursToVps,
  getWorkingHoursFromVps,
  uploadDocsToVps,
  listDocsOnVps,
  // Esposti per i test / riuso.
  _internal: { readRemoteConfig, writeRemoteConfig, safeBasename, REMOTE_UPLOADS_DIR, REMOTE_CONFIG_PATH },
}
