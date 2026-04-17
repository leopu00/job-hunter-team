// Terminal session manager for the embedded xterm login UI.
//
// Uses @homebridge/node-pty-prebuilt-multiarch — a node-pty fork that
// ships prebuilt binaries for Win/Mac/Linux, so `npm install` doesn't
// require a C++ toolchain or electron-rebuild. The public API matches
// upstream node-pty (spawn / onData / onExit / resize / kill).
//
// The pty gives us a real TTY on the host side, which docker compose
// forwards to the container via `run -it`. Interactive CLI flows that
// depend on raw-mode input (Ink-based TUIs like Claude Code's /login)
// then work as expected.

let pty
try {
  pty = require('@homebridge/node-pty-prebuilt-multiarch')
} catch {
  pty = null
}

const sessions = new Map()
let nextId = 0

function isAvailable() {
  return pty !== null
}

function nextSessionId() {
  nextId += 1
  return nextId
}

function spawnSession({
  command,
  args = [],
  cwd,
  env = process.env,
  cols = 100,
  rows = 28,
  onData,
  onExit,
}) {
  if (!pty) throw new Error('node-pty not available')
  const id = nextSessionId()
  const proc = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env,
    useConpty: true,
  })
  sessions.set(id, proc)

  proc.onData((data) => {
    if (onData) onData(data)
  })
  proc.onExit((exit) => {
    sessions.delete(id)
    if (onExit) {
      onExit({
        exitCode: typeof exit.exitCode === 'number' ? exit.exitCode : -1,
        signal: exit.signal || null,
      })
    }
  })
  return id
}

function write(id, data) {
  const proc = sessions.get(id)
  if (!proc) return
  try {
    proc.write(data)
  } catch {
    // pty already closed
  }
}

function resize(id, cols, rows) {
  const proc = sessions.get(id)
  if (!proc) return
  try {
    proc.resize(Math.max(1, cols | 0), Math.max(1, rows | 0))
  } catch {
    // ignore resize-after-exit
  }
}

function kill(id) {
  const proc = sessions.get(id)
  if (!proc) return
  try {
    proc.kill()
  } catch {
    // already exited
  }
  sessions.delete(id)
}

function killAll() {
  for (const id of sessions.keys()) kill(id)
}

module.exports = {
  isAvailable,
  spawnSession,
  write,
  resize,
  kill,
  killAll,
}
