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
  assert.equal(await pickCandidate('Dunkirk', 2017, 'movie', results), undefined)
})

test('returns undefined on a malformed response so callers keep the old fallback', async () => {
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) })
  assert.equal(await pickCandidate('Dune', null, 'movie', results), undefined)
})
