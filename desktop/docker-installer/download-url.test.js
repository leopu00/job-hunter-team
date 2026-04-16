const test = require('node:test')
const assert = require('node:assert/strict')
const { downloadUrlFor } = require('./download-url')

test('windows and mac point to docker-desktop product page', () => {
  assert.equal(downloadUrlFor('win32'), 'https://www.docker.com/products/docker-desktop/')
  assert.equal(downloadUrlFor('darwin'), 'https://www.docker.com/products/docker-desktop/')
})

test('linux points to the engine install guide', () => {
  assert.match(downloadUrlFor('linux'), /engine\/install/)
})

test('unknown platform returns null', () => {
  assert.equal(downloadUrlFor('freebsd'), null)
})

test('all URLs are https', () => {
  for (const p of ['win32', 'darwin', 'linux']) {
    assert.match(downloadUrlFor(p), /^https:\/\//)
  }
})
