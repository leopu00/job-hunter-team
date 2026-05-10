import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

const isWindows = process.platform === 'win32'

// JHT_SHELL_VIA = "docker:<container>" dirotta ogni runBash/runScript dentro
// al container via `docker exec`. Usato in dev su host Windows: Next gira
// nativo con hot-reload, il team resta nel container. Le API che parlano con
// tmux/agenti runnano dentro jht anche se Next è fuori.
const shellVia = process.env.JHT_SHELL_VIA
const dockerContainer = shellVia?.startsWith('docker:') ? shellVia.slice('docker:'.length) : null

// Repo root dell'host: assumendo che Next dev gira da web/, il parent è
// la radice del repo montata a /app dentro il container.
const hostRepoRoot = path.resolve(process.cwd(), '..')

// Cache della distro WSL rilevata
let _wslDistro: string | null | undefined

/** Rileva la prima distro WSL reale (esclude docker-desktop) */
async function getWslDistro(): Promise<string | null> {
  if (_wslDistro !== undefined) return _wslDistro

  try {
    const { stdout } = await execAsync('wsl --list --quiet')
    // Output UTF-16 di wsl.exe ha NUL bytes — rimuovili
    const clean = stdout.replace(/\0/g, '').trim()
    const distros = clean.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    // Prendi la prima distro che non è docker
    _wslDistro = distros.find(d => !d.toLowerCase().includes('docker')) ?? null
  } catch {
    _wslDistro = null
  }
  return _wslDistro
}

/** Prefisso shell WSL o niente (Linux/Mac nativo). Non usato in docker mode. */
async function shellPrefix(): Promise<string> {
  if (!isWindows) return ''
  const distro = await getWslDistro()
  if (!distro) {
    throw new Error('Nessuna distro WSL trovata. Installa Ubuntu da Microsoft Store.')
  }
  return `wsl -d ${distro} -- `
}

/**
 * Esegui un comando bash inline.
 * - JHT_SHELL_VIA=docker:<c>: docker exec -i <c> bash -c "cmd"
 * - Linux/Mac: bash -c "cmd"
 * - Windows: wsl -d <distro> -- bash -c "cmd"
 */
export async function runBash(cmd: string) {
  if (dockerContainer) {
    if (process.env.JHT_SHELL_DEBUG) console.log('[shell] runBash (docker) →', cmd)
    return execFileAsync('docker', ['exec', '-i', dockerContainer, 'bash', '-c', cmd])
  }
  const prefix = await shellPrefix()
  const full = `${prefix}bash -c ${JSON.stringify(cmd)}`
  if (process.env.JHT_SHELL_DEBUG) console.log('[shell] runBash →', full)
  return execAsync(full)
}

/**
 * Esegui uno script bash con argomenti (senza wrapping bash -c).
 * - JHT_SHELL_VIA=docker:<c>: docker exec -i <c> bash /app/<rel> args
 * - Linux/Mac: bash /path/to/script args
 * - Windows: wsl -d <distro> -- bash /mnt/c/.../script args
 */
export async function runScript(scriptPath: string, ...args: string[]) {
  if (dockerContainer) {
    // In docker mode `toWslPath` dovrebbe aver già trasformato scriptPath in
    // /app/<rel>. Passiamo tutto come args separati, niente parsing shell.
    if (process.env.JHT_SHELL_DEBUG) console.log('[shell] runScript (docker) →', scriptPath, args)
    return execFileAsync('docker', ['exec', '-i', dockerContainer, 'bash', scriptPath, ...args])
  }
  const prefix = await shellPrefix()
  // Single-quote POSIX escaping: ogni arg viene wrappato in '' con le ' interne
  // trasformate in '\'' — unico metodo sicuro contro command injection via args
  const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`
  const quotedScript = shellQuote(scriptPath)
  const escapedArgs = args.map(shellQuote).join(' ')
  return execAsync(`${prefix}bash ${quotedScript} ${escapedArgs}`)
}

/**
 * Converti path host in path utilizzabile dalla shell bersaglio.
 * - docker-exec mode: path sotto il repo root → /app/<rel>
 * - Windows + WSL: C:\... → /mnt/c/...
 * - Linux/Mac: no-op
 */
export function toWslPath(winPath: string): string {
  if (dockerContainer) {
    const normalized = path.normalize(winPath)
    if (normalized.toLowerCase().startsWith(hostRepoRoot.toLowerCase())) {
      const rel = normalized.slice(hostRepoRoot.length).replace(/\\/g, '/')
      return `/app${rel.startsWith('/') ? '' : '/'}${rel}`
    }
    // Fuori dal repo root: passa così com'è (comando probabilmente fallirà)
    return winPath.replace(/\\/g, '/')
  }
  if (!isWindows) return winPath
  return winPath
    .replace(/\\/g, '/')
    .replace(/^([A-Z]):/i, (_, drive) => `/mnt/${drive.toLowerCase()}`)
}
