const test = require('node:test')
const assert = require('node:assert/strict')

const { fetchMylist, buildStreamUrl } = require('../src/torbox')

function withStatus(status, fn) {
  const real = globalThis.fetch
  globalThis.fetch = async () => new Response('{}', { status })
  return fn().finally(() => {
    globalThis.fetch = real
  })
}

test('a 4xx from usenet reads as an empty list, but not from other sources', () =>
  withStatus(403, async () => {
    assert.deepEqual(await fetchMylist('usenet', 'k'), [])
    await assert.rejects(fetchMylist('torrents', 'k'), /HTTP 403/)
  }))

test('usenet streams use usenet_id', () => {
  assert.match(buildStreamUrl('usenet', 7, 3, 'k'), /\/usenet\/requestdl\?token=k&usenet_id=7&file_id=3&/)
})
