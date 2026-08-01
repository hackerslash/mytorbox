const test = require('node:test')
const assert = require('node:assert/strict')

const { mergeParsed, plausibleTitle, parseName, fromGuessit, fromPtt, fromAnitomy } = require('../src/parser')
const { cleanName } = require('../src/parse/normalize')

function parsed(name, over = {}) {
  return { parser: name, title: null, year: null, season: null, episodes: [], isEpisode: false, ...over }
}

test('plausibleTitle rejects parser noise but keeps real titles', () => {
  const rejected = [
    '[', 'S02', 'S02EP01', 'House Of The Dragon S', 'Inside Look S02Exx The Bet', 'a', 'Show S01', '...',
    'SpongeBob SquarePants S01E30E31 Sleepy Time-Suds',
    'House Of The Dragon S03EO1',
  ]
  for (const bad of rejected) {
    assert.equal(plausibleTitle(bad), false, `${JSON.stringify(bad)} should be rejected`)
  }
  for (const good of ['ER', 'Toy Story 2', '1917', 'Fog Hills of the Five Elements', 'S.W.A.T.', 'Se7en', 'Series 7']) {
    assert.equal(plausibleTitle(good), true, `${JSON.stringify(good)} should be accepted`)
  }
})

test('title cascade order is guessit, then anitomy, then ptt', () => {
  const all = mergeParsed([
    parsed('guessit', { title: 'From Guessit' }),
    parsed('ptt', { title: 'From Ptt' }),
    parsed('anitomy', { title: 'From Anitomy' }),
  ])
  assert.equal(all.title, 'From Guessit')

  const noGuessit = mergeParsed([
    parsed('guessit', { title: null }),
    parsed('ptt', { title: 'From Ptt' }),
    parsed('anitomy', { title: 'From Anitomy' }),
  ])
  assert.equal(noGuessit.title, 'From Anitomy')

  const onlyPtt = mergeParsed([
    parsed('guessit', { title: 'Dangling S' }),
    parsed('ptt', { title: 'From Ptt' }),
    parsed('anitomy', { title: 'Show S02EP01' }),
  ])
  assert.equal(onlyPtt.title, 'From Ptt')
})

test('a parser whose title ends in a dangling marker contributes no numbers', () => {
  const merged = mergeParsed([
    parsed('guessit', { title: 'Show S', season: 9, episodes: [3] }),
    parsed('ptt', { title: 'Show', season: 3 }),
  ])
  assert.equal(merged.season, 3)
  assert.deepEqual(merged.episodes, [])
})

test('an episode number equal to the year is discarded', () => {
  const merged = mergeParsed([
    parsed('guessit', { title: 'A Movie', year: 1999, episodes: [] }),
    parsed('anitomy', { title: 'A Movie', episodes: [1999] }),
  ])
  assert.deepEqual(merged.episodes, [])
})

test('a large absolute episode number that is not the year survives', () => {
  const merged = mergeParsed([
    parsed('guessit', { title: 'One Piece', episodes: [] }),
    parsed('anitomy', { title: 'One Piece', episodes: [1080] }),
  ])
  assert.deepEqual(merged.episodes, [1080])
})

test('a truncated numeric guessit title is extended from ptt', () => {
  const merged = mergeParsed([
    parsed('guessit', { title: '10' }),
    parsed('ptt', { title: '10 Things I Hate About You' }),
  ])
  assert.equal(merged.title, '10 Things I Hate About You')
})

test('a genuinely numeric title is not replaced', () => {
  const merged = mergeParsed([
    parsed('guessit', { title: '1917' }),
    parsed('ptt', { title: 'Something Else' }),
  ])
  assert.equal(merged.title, '1917')
})

test('a failing adapter does not break the merge', () => {
  const merged = mergeParsed([null, parsed('ptt', { title: 'Still Works', season: 2 })])
  assert.equal(merged.title, 'Still Works')
  assert.equal(merged.season, 2)
})

test('each adapter normalises to the shared shape', () => {
  const name = cleanName('[Judas] Bleach - S01E366.mkv')
  for (const adapter of [fromGuessit, fromPtt, fromAnitomy]) {
    const p = adapter(name)
    assert.equal(typeof p.parser, 'string')
    assert.ok(p.season === null || Number.isInteger(p.season), `${p.parser} season not an integer`)
    assert.ok(Array.isArray(p.episodes), `${p.parser} episodes not an array`)
    for (const e of p.episodes) assert.ok(Number.isInteger(e), `${p.parser} episode not an integer`)
    assert.equal(typeof p.isEpisode, 'boolean')
  }
})

test('malformed markers only ptt understands', () => {
  const eo1 = parseName(cleanName('House.Of.The.Dragon.S03EO1.2160p.MAX.WEB-DL.mp4'))
  assert.equal(eo1.title, 'House Of The Dragon')
  assert.equal(eo1.season, 3)

  const exx = parseName(cleanName('Inside.Look.S02Exx.The.Bet.(Easter.Egg).mkv'))
  assert.equal(exx.title, 'Inside Look')
  assert.equal(exx.season, 2)
})

test('anime names only anitomy understands', () => {
  const fog = parseName(cleanName('[WEB] Fog Hills of the Five Elements - Season 2 [1080P][HEVC][x265][10-bit][HFR][AAC]'))
  assert.equal(fog.title, 'Fog Hills of the Five Elements')
  assert.equal(fog.season, 2)
})
