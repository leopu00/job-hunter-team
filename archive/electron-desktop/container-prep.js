// Prepare the JHT container image on the user's machine.
//
// Strategy: always keep the user on the current ghcr.io/leopu00/jht:latest.
// `docker compose pull` refreshes to the newest registry image and is cheap
// when already current — it checks the manifest digest and downloads only
// changed layers (an up-to-date image pulls nothing). If pull fails (offline,
// registry outage, missing image) fall back to the existing local image when
// there is one, otherwise `docker compose build` from the shipped Dockerfile.
//
// The one image we must NOT clobber is a locally-BUILT one (the dev flow,
// iterating on the Dockerfile with `docker compose build`). Those never came
// from a registry, so they carry no RepoDigests — that's how we tell them
// apart from a pulled release and skip the refresh only for them.
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
  inspect = inspectImage,
} = {}) {
  if (!payloadDir) {
    return { ok: false, stage: 'init', error: 'payloadDir required' }
  }

  const local = inspect()

  // A locally-BUILT image has no RepoDigests — it was compiled here, never
  // pulled from a registry. Leave it alone: this is the dev flow where a pull
  // would clobber your work and force a painful rebuild on every registry SHA.
  // Everything else (a registry-pulled image, or none) goes through the pull
  // so end users always land on the current :latest.
  if (isLocallyBuiltImage(local)) {
    onLog(`Using locally-built image ${local.image} — skipping pull`)
    return { ok: true, stage: 'local-build', source: 'local' }
  }

  // Refresh to the current registry :latest. Cheap when already up to date.
  const pull = await pullImage({ cwd: payloadDir, service, onLog, run })
  if (pull.ok) {
    return { ok: true, stage: 'pulled', source: 'registry' }
  }

  // Pull failed (offline / registry down). If a usable image is already on
  // disk, run with it rather than blocking startup on a network hiccup.
  if (local.present) {
    onLog('pull failed — using existing local image')
    return { ok: true, stage: 'local-existing', source: 'local' }
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

// True only for an image that was built locally (present, but with no
// registry digest). A pulled image always carries a RepoDigest; a missing
// image has none but isn't `present`. Anything ambiguous errs toward pulling,
// which is the safe default for end users (they get the latest release).
function isLocallyBuiltImage(local) {
  return Boolean(
    local &&
    local.present &&
    Array.isArray(local.digests) &&
    local.digests.length === 0,
  )
}

function inspectImage(imageName = 'ghcr.io/leopu00/jht:latest') {
  // Synchronous probe: is the image already on the local Docker?
  // Used by the setup wizard to skip the pull step on re-launch, and
  // by the home Docker panel to show id/created/size to the user.
  // We capture stdout (vs stdio:ignore) so we can parse the JSON
  // metadata; failures fall back to the bare {present:false} shape.
  const { execFileSync } = require('node:child_process')
  try {
    const stdout = execFileSync(
      'docker',
      ['image', 'inspect', '--format', '{{json .}}', imageName],
      {
        timeout: 5000,
        windowsHide: true,
        env: dockerEnv(),
      },
    )
    let parsed = null
    try { parsed = JSON.parse(stdout.toString()) } catch { /* best effort */ }
    if (!parsed) return { present: true, image: imageName }
    return {
      present: true,
      image: imageName,
      id: typeof parsed.Id === 'string' ? parsed.Id : null,
      tags: Array.isArray(parsed.RepoTags) ? parsed.RepoTags : [],
      digests: Array.isArray(parsed.RepoDigests) ? parsed.RepoDigests : [],
      created: typeof parsed.Created === 'string' ? parsed.Created : null,
      size: typeof parsed.Size === 'number' ? parsed.Size : null,
      architecture: typeof parsed.Architecture === 'string' ? parsed.Architecture : null,
    }
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
