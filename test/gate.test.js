const test = require('node:test')
const assert = require('node:assert/strict')

const { canSkipGuessit, parseName, fromPtt, fromAnitomy } = require('../src/parser')
const { cleanName } = require('../src/parse/normalize')

function skips(rawName) {
  const name = cleanName(rawName)
  return canSkipGuessit(name, fromPtt(name), fromAnitomy(name))
}

test('guessit is skipped for a clean, unambiguous episode', () => {
  assert.equal(skips('Big Brother US S28E10 1080p AMZN WEB-DL DDP2 0 H 264-NTb[EZTVx.to].mkv'), true)
  assert.equal(skips('MasterChef.US.S15E04.1080p.WEB.h264-EDITH[EZTVx.to].mkv'), true)
})

test('guessit is required when the cheap parsers drop part of the title', () => {
  assert.equal(skips('The.English.S01E01.1080p.BluRay.x265-RARBG[eztv.re].mp4'), false)
  assert.equal(parseName(cleanName('The.English.S01E01.1080p.BluRay.x265-RARBG[eztv.re].mp4')).title, 'The English')
})

test('guessit is required for multi-episode files', () => {
  const names = [
    'SpongeBob SquarePants (1999) - S02E01-E02 - Something Smells (1080p x265 RCVR).mkv',
    'SpongeBob.SquarePants.S01E28E29.Karate.Choppers.1080p.AMZN.WEB-DL.x264.mkv',
  ]
  for (const n of names) assert.equal(skips(n), false, `${n} must not skip guessit`)

  const parsed = parseName(cleanName(names[0]))
  assert.deepEqual(parsed.episodes, [1, 2])
  assert.equal(parsed.guessit, true)
})

test('guessit is required for spelled-out episode ranges', () => {
  for (const n of [
    'Death.Note.S00E01.Opening.1.Ep01.to.Ep07.mkv',
    'Show.S01.Ep01-Ep04.1080p.WEB-DL.mkv',
  ]) {
    assert.equal(skips(n), false, `${n} must not skip guessit`)
  }
})

test('guessit is required when there is no explicit season/episode marker', () => {
  assert.equal(skips('The.Super.Mario.Bros.Movie.2023.BDRemux.1080p.pk.mkv'), false)
  assert.equal(skips('[SubsPlease] Sousou no Frieren - 12 (1080p) [F0E4A2B1].mkv'), false)
})

test('a resolution that looks like a season/episode does not trigger a skip', () => {
  for (const n of [
    'DOLBY_NATURES_FURY_1920x1080_DD+_ATMOS-thedigitaltheater.mkv',
    'Isolation.2007.720p.DD-2.0x264-Grym@BTNET.mkv',
    'The Bay (2026) [tvdbid=1430698] fsbs 3840x2160 x264 woz3d.mkv',
  ]) {
    assert.equal(skips(n), false, `${n} must not skip guessit`)
    assert.equal(parseName(cleanName(n)).isEpisode, false, `${n} must not be classified as an episode`)
  }
})

test('a malformed marker still falls through to the full cascade', () => {
  const eo1 = parseName(cleanName('House.Of.The.Dragon.S03EO1.2160p.MAX.WEB-DL.mp4'))
  assert.equal(eo1.guessit, true)
  assert.equal(eo1.title, 'House Of The Dragon')

  const exx = parseName(cleanName('Inside.Look.S02Exx.The.Bet.(Easter.Egg).mkv'))
  assert.equal(exx.title, 'Inside Look')
})

test('parseName reports whether guessit ran', () => {
  assert.equal(parseName(cleanName('Big Brother US S28E10 1080p AMZN WEB-DL H 264-NTb.mkv')).guessit, false)
  assert.equal(parseName(cleanName('The.Super.Mario.Bros.Movie.2023.BDRemux.1080p.pk.mkv')).guessit, true)
})

test('the skip path never yields a null title', () => {
  for (const n of [
    'Big Brother US S28E10 1080p AMZN WEB-DL DDP2 0 H 264-NTb[EZTVx.to].mkv',
    'MasterChef US S15E01 The Audition Battles 1080p HULU WEB-DL H 264-RAWR.mkv',
    'Jersey Shore Family Vacation S08E31 No Longer Under Construction 1080p.mkv',
  ]) {
    const parsed = parseName(cleanName(n))
    assert.ok(parsed.title, `${n} produced no title`)
    assert.ok(Number.isInteger(parsed.season))
    assert.ok(parsed.episodes.every(Number.isInteger))
  }
})
