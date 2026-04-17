// Pseudo-terminal manager for embedded xterm sessions in the renderer.
//
// The renderer's xterm instance talks to this module via IPC. Each
// session gets a numeric id; data flows bidirectionally:
//   renderer keystroke → write(sessionId, data)
//   pty output         → onData callback → renderer event
// The renderer also resizes on layout changes and kills on modal close.
//
// node-pty is a native module — `npm run postinstall` (electron-rebuild)
// must run against the target Electron ABI before `electron .` works.

let pty
try {
  pty = require('node-pty')
} catch (error) {
  // Leave as undefined; callers handle the "terminal unavailable" case.
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

function spawnPty({
  command,
  args = [],
  cwd,
  env = process.env,
  cols = 100,
  rows = 28,
  onData,
  onExit,
}) {
  if (!pty) throw new Error('node-pty not available (run npm run postinstall)')
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
    if (onExit) onExit(exit)
  })
  return id
}

function write(id, data) {
  const proc = sessions.get(id)
  if (proc) proc.write(data)
}

function resize(id, cols, rows) {
  const proc = sessions.get(id)
  if (!proc) return
  try {
    proc.resize(cols, rows)
  } catch {
    // Resize can race with exit; ignore.
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
  spawnPty,
  write,
  resize,
  kill,
  killAll,
}
