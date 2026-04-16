const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const { freeBytes, formatBytes } = require('./disk-space')

test('formatBytes: 0 and negative', () => {
  assert.equal(formatBytes(0), '0 MB')
  assert.equal(formatBytes(-1), '0 MB')
  assert.equal(formatBytes(undefined), '0 MB')
})

test('formatBytes: MB rounding', () => {
  assert.equal(formatBytes(500 * 1024 * 1024), '500 MB')
  assert.equal(formatBytes(1023 * 1024 * 1024), '1023 MB')
})

test('formatBytes: GB with one decimal', () => {
  assert.equal(formatBytes(1024 * 1024 * 1024), '1.0 GB')
  assert.equal(formatBytes(2.5 * 1024 * 1024 * 1024), '2.5 GB')
})

test('freeBytes on current platform returns a positive number', async () => {
  const bytes = await freeBytes(os.homedir())
  assert.ok(bytes > 0, `expected positive free bytes, got ${bytes}`)
  assert.ok(Number.isFinite(bytes), 'expected finite number')
})
