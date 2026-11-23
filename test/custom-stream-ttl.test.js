const assert = require('node:assert/strict')
const test = require('node:test')

test('a short-lived stream does not expire the index for longer-lived streams', async () => {
  let now = Date.now()
  const originalNow = Date.now
  Date.now = () => now
  const indexes = new Map()
  const values = new Map()
  const getIndex = key => {
    const index = indexes.get(key)
    if (index?.expires <= now) {
      indexes.delete(key)
      return undefined
    }
    return index
  }
  const redisFile = require.resolve('../src/redisClient')
  const statsFile = require.resolve('../src/stats')
  require.cache[statsFile] = { exports: { track() {} } }
  require.cache[redisFile] = { exports: {
    get: async () => '1', // already verified
    set: async (key, value, _, ttl) => values.set(key, { value, expires: now + ttl * 1000 }),
    expire: async (key, ttl) => { getIndex(key).expires = now + ttl * 1000 },
    zadd: async (key, score, id) => {
      const index = getIndex(key) || { scores: new Map(), expires: Infinity }
      index.scores.set(id, score)
      indexes.set(key, index)
    },
    zremrangebyscore: async (key, _, max) => {
      const index = getIndex(key)
      for (const [id, score] of index?.scores || []) if (score <= max) index.scores.delete(id)
    },
    zcard: async key => getIndex(key)?.scores.size ?? 0,
    zrange: async key => [...(getIndex(key)?.scores.keys() || [])],
    mget: async (...keys) => keys.map(key => {
      const entry = values.get(key)
      return entry?.expires > now ? entry.value : null
    }),
  } }

  try {
    const { addCustomStream, listCustomStreams } = require('../src/customStreams')
    const keys = ['torbox-key', 'tmdb-key']
    const stream = { type: 'movie', imdbId: 'tt1234567', streamUrl: 'https://cdn.test/long.mp4' }
    const long = await addCustomStream(...keys, { ...stream, ttlMs: 12 * 60 * 60 * 1000 })
    const short = await addCustomStream(...keys, {
      ...stream, streamUrl: 'https://cdn.test/short.mp4', ttlMs: 5 * 60 * 1000,
    })
    assert.ok(long && short)
    assert.equal((await listCustomStreams(...keys)).length, 2)
    now += 7 * 60 * 1000
    assert.deepEqual((await listCustomStreams(...keys)).map(entry => entry.id), [long.id])
  } finally {
    Date.now = originalNow
    delete require.cache[redisFile]
    delete require.cache[statsFile]
    delete require.cache[require.resolve('../src/customStreams')]
  }
})
