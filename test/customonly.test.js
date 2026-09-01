process.env.REDIS_URL = ''

const test = require('node:test')
const assert = require('node:assert/strict')

const addon = require('../src/addon')

const CUSTOM_ONLY = { tmdb_key: 'tmdb-key' }
const FULL = { torbox_key: 'torbox-key', tmdb_key: 'tmdb-key' }

test('tmdb-only config installs with the two custom catalogs and no search', async () => {
  const m = await addon.manifestFor(CUSTOM_ONLY)
  assert.deepEqual(m.catalogs.map((c) => c.id), ['torbox-custom-movies', 'torbox-custom-series'])
  assert.ok(m.catalogs.every((c) => !c.extraSupported.includes('search')))
  assert.deepEqual(m.idPrefixes, ['tb:'])
  assert.deepEqual(m.resources.find((r) => r.name === 'stream').idPrefixes, ['tb:'])
  assert.equal(m.behaviorHints.configurationRequired, false)
})

test('a torbox key keeps the library catalogs and imdb streams', async () => {
  const m = await addon.manifestFor(FULL)
  assert.deepEqual(m.catalogs.map((c) => c.id), [
    'torbox-movies', 'torbox-series', 'torbox-custom-movies', 'torbox-custom-series',
  ])
  assert.ok(m.catalogs.every((c) => c.extraSupported.includes('search')))
  assert.deepEqual(m.resources.find((r) => r.name === 'stream').idPrefixes, ['tt', 'tb:'])
})

// Reaching the library here would call TorBox with `undefined` as the bearer token.
test('library resources are inert without a torbox key', async () => {
  assert.deepEqual(
    await addon.getCatalog({ type: 'movie', id: 'torbox-movies', config: CUSTOM_ONLY, extra: {} }),
    { metas: [] }
  )
  assert.equal(await addon.getMeta({ type: 'movie', id: 'tb:movie:tmdb-550', config: CUSTOM_ONLY }), null)
  assert.equal(await addon.getStream({ type: 'movie', id: 'tt0111161', config: CUSTOM_ONLY }), null)
})
