import { NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const KNOWN_SERVICES = ['jht-gateway', 'jht-cron', 'jht-web']
const LOG_DIR = path.join(JHT_HOME, 'logs')
const PLATFORM = process.platform

async function getServiceStatus(name: string) {
  const label = `com.jht.${name}`
  try {
    if (PLATFORM === 'darwin') {
      const { stdout } = await runBash(`launchctl list "${label}" 2>/dev/null || echo MISSING`)
      if (stdout.includes('MISSING')) return { name, label, running: false, pid: null, status: 'stopped' }
      const pidMatch = stdout.match(/"PID"\s*=\s*(\d+)/)
      const pid = pidMatch ? parseInt(pidMatch[1]) : null
      return { name, label, running: !!pid, pid, status: pid ? 'running' : 'loaded' }
    } else {
      const { stdout } = await runBash(`systemctl --user is-active "${name}" 2>/dev/null || echo inactive`)
      const active = stdout.trim() === 'active'
      return { name, label, running: active, pid: null, status: stdout.trim() }
    }
  } catch {
    return { name, label, running: false, pid: null, status: 'error' }
  }
}

async function getUptime(pid: number | null): Promise<number | null> {
  if (!pid) return null
  try {
    const { stdout } = await runBash(`ps -o lstart= -p ${pid} 2>/dev/null`)
    if (!stdout.trim()) return null
    const start = new Date(stdout.trim()).getTime()
    return isNaN(start) ? null : Date.now() - start
  } catch { return null }
}

async function getRecentLogs(name: string, lines = 20): Promise<string[]> {
  const logFile = path.join(LOG_DIR, `${name}.log`)
  try {
    if (!fs.existsSync(logFile)) return []
    const { stdout } = await runBash(`tail -n ${lines} "${logFile}"`)
    return stdout.split('\n').filter(Boolean)
  } catch { return [] }
}

export async function GET() {
  const services = await Promise.all(KNOWN_SERVICES.map(getServiceStatus))
  const withUptime = await Promise.all(
    services.map(async s => ({ ...s, uptimeMs: await getUptime(s.pid) }))
  )
  const withLogs = await Promise.all(
    withUptime.map(async s => ({ ...s, recentLogs: await getRecentLogs(s.name) }))
  )
  const anyRunning = withLogs.some(s => s.running)
  return NextResponse.json({ platform: PLATFORM, services: withLogs, anyRunning, ts: Date.now() })
}

export async function POST(req: Request) {
  const { service, action } = await req.json() as { service: string; action: 'start' | 'stop' | 'restart' }
  if (!KNOWN_SERVICES.includes(service)) return NextResponse.json({ error: 'servizio non valido' }, { status: 400 })
  const label = `com.jht.${service}`
  try {
    if (PLATFORM === 'darwin') {
      const cmd =
        action === 'start'   ? `launchctl load "${label}" 2>&1` :
        action === 'stop'    ? `launchctl unload "${label}" 2>&1` :
        `launchctl unload "${label}" 2>&1; launchctl load "${label}" 2>&1`
      const { stdout } = await runBash(cmd)
      return NextResponse.json({ ok: true, output: stdout.trim() })
    } else {
      const cmd =
        action === 'start'   ? `systemctl --user start "${service}"` :
        action === 'stop'    ? `systemctl --user stop "${service}"` :
                               `systemctl --user restart "${service}"`
      const { stdout } = await runBash(cmd)
      return NextResponse.json({ ok: true, output: stdout.trim() })
    }
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
