// Prepare the JHT container image on the user's machine.
//
// Strategy: prefer `docker compose pull` (the ghcr.io/leopu00/jht:latest
// image) — fastest path, a ready-made image. If pull fails (offline,
// registry outage, missing image) fall back to `docker compose build`,
// which compiles from the Dockerfile shipped inside the payload.
//
// Both commands stream stdout and stderr through `onLog` so the UI
// can show live progress during the few minutes this can take.

const { spawn } = require('node:child_process')
const os = require('node:os')

const DEFAULT_SERVICE = 'jht'

function dockerEnv() {
  // `docker compose` substitutes ${HOME} in the compose file; on Windows
  // HOME isn't set by default, so the bind-mount paths would collapse.
  const base = {
    ...process.env,
    HOME: process.env.HOME || process.env.USERPROFILE || os.homedir(),
  }
  // macOS GUI apps start with a sanitized PATH that excludes /opt/homebrew/bin
  // and /usr/local/bin, so `spawn('docker', ...)` throws ENOENT even when
  // Colima + Docker CLI are installed via Homebrew. Prepend the standard
  // Homebrew prefixes on darwin only.
  if (process.platform === 'darwin') {
    const extra = ['/opt/homebrew/bin', '/usr/local/bin']
    base.PATH = [...extra, base.PATH || ''].filter(Boolean).join(':')
  }
  return base
}

function runStreamed(cmd, args, { cwd, onLog = () => {}, env }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { cwd, env: env || dockerEnv(), windowsHide: true })
    } catch (error) {
      resolve({ ok: false, code: -1, error: error instanceof Error ? error.message : String(error) })
      return
    }

    const forward = (stream) => {
      stream.setEncoding('utf8')
      let buffer = ''
      stream.on('data', (chunk) => {
        buffer += chunk
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.length > 0) onLog(line)
        }
      })
      stream.on('end', () => {
        if (buffer.length > 0) onLog(buffer)
      })
    }

    forward(child.stdout)
    forward(child.stderr)

    child.on('error', (error) => {
      resolve({ ok: false, code: -1, error: error instanceof Error ? error.message : String(error) })
    })
    child.on('close', (code) => {
      resolve({ ok: code === 0, code: typeof code === 'number' ? code : -1 })
    })
  })
}

async function pullImage({ cwd, service = DEFAULT_SERVICE, onLog, run = runStreamed }) {
  onLog(`$ docker compose pull ${service}`)
  return run('docker', ['compose', 'pull', service], { cwd, onLog })
}

async function buildImage({ cwd, service = DEFAULT_SERVICE, onLog, run = runStreamed }) {
  onLog(`$ docker compose build ${service}`)
  return run('docker', ['compose', 'build', service], { cwd, onLog })
}

async function ensureContainerImage({
  payloadDir,
  service = DEFAULT_SERVICE,
  onLog = () => {},
  run = runStreamed,
} = {}) {
  if (!payloadDir) {
    return { ok: false, stage: 'init', error: 'payloadDir required' }
  }

  // If a local image already exists, skip the pull. Pulling from
  // ghcr.io every launch would clobber any locally-built image (the
  // dev flow when you're iterating on the Dockerfile or the files it
  // bakes in), forcing a painful rebuild every time the registry
  // ships a different SHA. For the first run on a clean machine the
  // image isn't there yet, so we still fall through to pull + build.
  const local = inspectImage()
  if (local.present) {
    onLog(`Using existing local image ${local.image} — skipping pull`)
    return { ok: true, stage: 'local-existing', source: 'local' }
  }

  const pull = await pullImage({ cwd: payloadDir, service, onLog, run })
  if (pull.ok) {
    return { ok: true, stage: 'pulled', source: 'registry' }
  }

  onLog('pull failed, falling back to local build…')
  const build = await buildImage({ cwd: payloadDir, service, onLog, run })
  if (build.ok) {
    return { ok: true, stage: 'built', source: 'local' }
  }

  return {
    ok: false,
    stage: 'build',
    error: build.error || `docker compose build exited with code ${build.code}`,
  }
}

function inspectImage(imageName = 'ghcr.io/leopu00/jht:latest') {
  // Synchronous probe: is the image already on the local Docker?
  // Used by the setup wizard to skip the pull step on re-launch.
  const { execFileSync } = require('node:child_process')
  try {
    execFileSync('docker', ['image', 'inspect', imageName], {
      stdio: 'ignore',
      timeout: 5000,
      windowsHide: true,
      env: dockerEnv(),
    })
    return { present: true, image: imageName }
  } catch {
    return { present: false, image: imageName }
  }
}

module.exports = {
  ensureContainerImage,
  pullImage,
  buildImage,
  inspectImage,
  dockerEnv,
  _internal: { runStreamed },
}
