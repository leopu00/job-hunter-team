// Colori agente condivisi tra AgentTokensChart e ThrottleChart.
//
// Ogni ruolo ha un colore base (stesso usato in TeamOrgChart e nella pagina
// team). Le istanze numerate (es. scrittore-1, scrittore-2) ottengono
// varianti dello stesso hue, in modo da restare riconoscibili come
// "scrittore" ma distinguersi a colpo d'occhio: la 1ª istanza usa il colore
// base, le successive applicano uno shift di lightness/hue.

const AGENT_COLORS: Record<string, string> = {
  capitano:   '#ff9100',
  sentinella: '#9c27b0',
  scout:      '#2196f3',
  analista:   '#00e676',
  scorer:     '#b388ff',
  scrittore:  '#ffd600',
  critico:    '#f44336',
  assistente: '#26c6da',
}
const FALLBACK_COLOR = '#94a3b8'

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return [r, g, b]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r1 = 0, g1 = 0, b1 = 0
  if (0 <= hp && hp < 1) [r1, g1, b1] = [c, x, 0]
  else if (hp < 2) [r1, g1, b1] = [x, c, 0]
  else if (hp < 3) [r1, g1, b1] = [0, c, x]
  else if (hp < 4) [r1, g1, b1] = [0, x, c]
  else if (hp < 5) [r1, g1, b1] = [x, 0, c]
  else if (hp < 6) [r1, g1, b1] = [c, 0, x]
  const m = l - c / 2
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`
}

// Shift visibile ma riconoscibile: alterna +/- lightness e leggero hue
// shift, così istanze multiple non si confondono.
//   istanza 1 → colore base
//   istanza 2 → l +18%, h -10°
//   istanza 3 → l -15%, h +12°
//   istanza 4+ → continua a oscillare in modo deterministico
const INSTANCE_SHIFTS: { dl: number; dh: number }[] = [
  { dl: 0,    dh: 0   },  // 1
  { dl: 0.18, dh: -10 }, // 2
  { dl: -0.15, dh: 12 }, // 3
  { dl: 0.10, dh: 25  }, // 4
  { dl: -0.22, dh: -22 }, // 5
]

function shiftColor(baseHex: string, instanceIdx: number): string {
  if (instanceIdx <= 0) return baseHex
  const shift = INSTANCE_SHIFTS[instanceIdx % INSTANCE_SHIFTS.length]
  const [r, g, b] = hexToRgb(baseHex)
  const [h, s, l] = rgbToHsl(r, g, b)
  let newH = (h + shift.dh + 360) % 360
  let newL = Math.max(0.20, Math.min(0.80, l + shift.dl))
  return hslToHex(newH, s, newL)
}

/**
 * Ritorna un colore univoco per ogni agente.
 *
 *   `capitano`     → base
 *   `scrittore-1`  → scrittore base
 *   `scrittore-2`  → scrittore variant 1 (più chiaro, hue lievemente shifted)
 *   `scrittore-3`  → scrittore variant 2 (più scuro)
 *   agenti ignoti  → grigio
 */
export function colorForAgent(agent: string): string {
  // Match `nome-N` per ruoli con istanza
  const m = agent.match(/^(.+?)-(\d+)$/)
  if (m) {
    const base = AGENT_COLORS[m[1]]
    if (base) return shiftColor(base, parseInt(m[2], 10) - 1)
  }
  return AGENT_COLORS[agent] ?? FALLBACK_COLOR
}
