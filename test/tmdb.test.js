const test = require('node:test')
const assert = require('node:assert/strict')

const { titleVariants, stripStudioPrefix } = require('../src/tmdb')

test('strips studio branding prepended to the title', () => {
  assert.equal(stripStudioPrefix("Marvel Studios' Black Widow"), 'Black Widow')
  assert.equal(stripStudioPrefix('Marvel Studios Black Widow'), 'Black Widow')
  assert.equal(stripStudioPrefix("Walt Disney Pictures' Frozen"), 'Frozen')
  assert.equal(stripStudioPrefix('Walt Disney Animation Studios Encanto'), 'Encanto')
  assert.equal(stripStudioPrefix('Pixar Soul'), 'Soul')
})

test('leaves titles without studio branding untouched', () => {
  assert.equal(stripStudioPrefix('Black Widow'), 'Black Widow')
  assert.equal(stripStudioPrefix('The Marvels'), 'The Marvels')
  assert.equal(stripStudioPrefix('Studio 54'), 'Studio 54')
})

test('offers a studio-stripped search variant on the retry chain', () => {
  assert.deepEqual(titleVariants("Marvel Studios' Black Widow", 'movie'), ['Black Widow'])
  assert.deepEqual(titleVariants('Black Widow', 'movie'), [])
})

test('expands a P<n>/Pt<n> part abbreviation as a variant, keeping the number', () => {
  assert.ok(titleVariants('The Godfather P1', 'movie').includes('The Godfather Part 1'))
  assert.ok(titleVariants('The Godfather Pt2', 'movie').includes('The Godfather Part 2'))
  assert.deepEqual(titleVariants('The Godfather', 'movie'), [])
})

test('offers a format-stripped variant for 3D/SBS tags', () => {
  assert.ok(titleVariants('Black Adam 3D', 'movie').includes('Black Adam'))
  assert.ok(titleVariants('Avatar Half-SBS', 'movie').includes('Avatar'))
  assert.deepEqual(titleVariants('Black Adam', 'movie'), [])
})

test('offers the leading Cyrillic run first, dropping the Latin/junk tail', () => {
  assert.deepEqual(titleVariants('Донни Дарко DC', 'movie'), ['Донни Дарко'])
  assert.deepEqual(titleVariants('Извне From Сезон 1 Серии 1-10', 'tv'), ['Извне'])
  assert.equal(titleVariants('Перемещение В движении Moving Mubing Сезон 1 Серии 1', 'tv')[0], 'Перемещение В движении')
  assert.equal(titleVariants('Black Widow', 'movie').length, 0)
})

test('searchMulti keeps only movie/tv results and normalizes them', async () => {
  const { searchMulti, clearCache } = require('../src/tmdb')
  const realFetch = global.fetch
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      results: [
        { media_type: 'person', id: 1, name: 'Someone' },
        { media_type: 'movie', id: 27205, title: 'Inception', release_date: '2010-07-15', poster_path: '/p.jpg' },
        { media_type: 'tv', id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20', poster_path: null },
      ],
    }),
  })
  try {
    clearCache()
    const results = await searchMulti('inception', 'key')
    assert.deepEqual(results, [
      { tmdb_id: 27205, type: 'movie', title: 'Inception', year: '2010', poster: 'https://image.tmdb.org/t/p/w500/p.jpg' },
      { tmdb_id: 1396, type: 'series', title: 'Breaking Bad', year: '2008', poster: null },
    ])
  } finally {
    global.fetch = realFetch
    clearCache()
  }
})
