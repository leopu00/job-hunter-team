import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { raiseOomScore } from '../src/commands/pid1.js'

function scoreFile(value) {
  const dir = mkdtempSync(join(tmpdir(), 'oom-'))
  const file = join(dir, 'oom_score_adj')
  if (value !== null) writeFileSync(file, `${value}\n`)
  return { dir, file }
}

test('a lower score is raised so the agents are the ones the kernel picks', () => {
  const { dir, file } = scoreFile(0)
  assert.equal(raiseOomScore(500, file), true)
  assert.equal(readFileSync(file, 'utf8'), '500')
  rmSync(dir, { recursive: true })
})

test('a score already as high or higher is left alone', () => {
  const { dir, file } = scoreFile(700)
  assert.equal(raiseOomScore(500, file), false)
  assert.equal(readFileSync(file, 'utf8').trim(), '700')
  rmSync(dir, { recursive: true })
})

test('no /proc file (a Mac, a read-only /proc) is silent', () => {
  const { dir, file } = scoreFile(null)
  assert.equal(raiseOomScore(500, join(dir, 'nothing', 'oom_score_adj')), false)
  rmSync(dir, { recursive: true })
})
