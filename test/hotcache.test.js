const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const zlib = require('zlib')

process.env.STATS_ENABLED = '0'
const store = new Map()
let reads = 0
const fakeRedis = {
  async getBuffer(k) {
    reads++
    return store.get(k) || null
  },
  keys: async () => [],
  pipeline() {
    const p = { expire: () => p, set: () => p, del: () => p, hset: () => p, exec: async () => [] }
    return p
  },
}
require.cache[require.resolve('../src/redisClient')] = { exports: fakeRedis }
const { getLibrary, clearCache } = require('../src/library')

test('a fresh library is served from memory after the first Redis read', async () => {
  const key = crypto.createHash('sha256').update('tb|tm|').digest('hex')
  const now = Date.now()
  const lib = { movies: [{ id: 'tt1' }], series: [], meta: {}, streams: {} }
  store.set(`lib:${key}`, Buffer.from('e2:' + JSON.stringify({ parts: 1, fingerprint: 'f', tip: 't', validatedAt: now, probedAt: now })))
  store.set(`libp:${key}:0`, zlib.gzipSync(Buffer.from(JSON.stringify(lib))))

  assert.deepEqual(await getLibrary('tb', 'tm'), lib)
  assert.equal(reads, 2)
  assert.deepEqual(await getLibrary('tb', 'tm'), lib)
  assert.equal(reads, 2)

  await clearCache()
  await getLibrary('tb', 'tm').catch(() => {})
  assert.ok(reads > 2)
})
