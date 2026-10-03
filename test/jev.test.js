process.env.REDIS_URL = ''
process.env.TYPESAFE_API_KEY = 'test'

const test = require('node:test')
const assert = require('node:assert/strict')

const { pickCandidate } = require('../src/jev')

const results = [
  { id: 1, title: 'Dune', release_date: '1984-12-14' },
  { id: 2, title: 'Dune: Part Two', release_date: '2024-02-27' },
]

function mockJev(choice) {
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body)
    assert.deepEqual(Object.keys(body.questions.match.criteria), ['c0', 'c1', 'none'])
    return { ok: true, status: 200, json: async () => ({ answers: { match: { choice } } }) }
  }
}

test('returns the candidate Jev picks', async () => {
  mockJev('c1')
  assert.equal((await pickCandidate('Dune Part 2', 2024, 'movie', results)).id, 2)
})

test('defers to the caller when Jev rejects every candidate', async () => {
  mockJev('none')
  assert.equal(await pickCandidate('Dunkirk', 2017, 'movie', results), null)
})

test('returns undefined on a malformed response so callers keep the old fallback', async () => {
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) })
  assert.equal(await pickCandidate('Dune', null, 'movie', results), undefined)
})

test('broad search returns false when Jev rejects every candidate, null when the call fails', async () => {
  const { broadSearch } = require('../src/tmdb')
  const route = (jevStatus) => async (url) => {
    if (url.includes('typesafe')) {
      return { ok: jevStatus === 200, status: jevStatus, json: async () => ({ answers: { match: { choice: 'none' } } }) }
    }
    const body = url.includes('/search/') ? { results } : url.includes('alternative_titles') ? { titles: [] } : { d: [] }
    return { ok: true, status: 200, json: async () => body }
  }
  global.fetch = route(200)
  assert.equal(await broadSearch('Junk Featurette', null, 'junk.mkv', 'movie', 'k'), false)
  global.fetch = route(400)
  assert.equal(await broadSearch('Other Junk', null, 'junk.mkv', 'movie', 'k'), null)
})
