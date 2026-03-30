import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const isWindows = process.platform === 'win32'

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

/** Prefisso WSL per comandi, o stringa vuota su Linux/Mac */
async function wslPrefix(): Promise<string> {
  if (!isWindows) return ''
  const distro = await getWslDistro()
  if (!distro) {
    throw new Error('Nessuna distro WSL trovata. Installa Ubuntu da Microsoft Store.')
  }
  return `wsl -d ${distro} -- `
}

/**
 * Esegui un comando bash inline.
 * - Linux/Mac: bash -c "cmd"
 * - Windows: wsl -d <distro> -- bash -c "cmd"
 */
export async function runBash(cmd: string) {
  const prefix = await wslPrefix()
  return execAsync(`${prefix}bash -c ${JSON.stringify(cmd)}`)
}

/**
 * Esegui uno script bash con argomenti (senza wrapping bash -c).
 * - Linux/Mac: bash /path/to/script args
 * - Windows: wsl -d <distro> -- bash /mnt/c/.../script args
 */
export async function runScript(scriptPath: string, ...args: string[]) {
  const prefix = await wslPrefix()
  // Single-quote POSIX escaping: ogni arg viene wrappato in '' con le ' interne
  // trasformate in '\'' — unico metodo sicuro contro command injection via args
  const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`
  const quotedScript = shellQuote(scriptPath)
  const escapedArgs = args.map(shellQuote).join(' ')
  return execAsync(`${prefix}bash ${quotedScript} ${escapedArgs}`)
}

/** Converti path Windows → WSL (/mnt/c/...). No-op su Linux/Mac. */
export function toWslPath(winPath: string): string {
  if (!isWindows) return winPath
  return winPath
    .replace(/\\/g, '/')
    .replace(/^([A-Z]):/i, (_, drive) => `/mnt/${drive.toLowerCase()}`)
}
