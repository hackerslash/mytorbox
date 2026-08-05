const test = require('node:test')
const assert = require('node:assert/strict')

const { parseWorkItems, stripTechnicalTokens } = require('../src/parser')

function parse(filename, { size = 5 * 1024 ** 3, entryName = filename } = {}) {
  const entry = {
    id: 'item-1',
    created_at: '2026-07-01T00:00:00Z',
    name: entryName,
    files: [{ id: 0, short_name: filename, size }],
  }
  return [...parseWorkItems('torrents', entry)]
}

function parseOne(filename, opts) {
  const items = parse(filename, opts)
  assert.equal(items.length, 1, `expected exactly one work item for ${filename}`)
  return items[0]
}

test('separates a season/episode marker fused to the next word', () => {
  const w = parseOne('Dutton.Ranch.S01E05WEB-DL.1080p.RGzsRutracker.mkv')
  assert.equal(w.title, 'Dutton Ranch')
  assert.equal(w.season, 1)
  assert.deepEqual(w.episodes, [5])
})

test('separates the ...ab multi-episode convention', () => {
  const w = parseOne(
    'SpongeBob.SquarePants.S04E09ab - .Krusty.Towers.and.Mrs.Puff.Youre.Fired.1080p.AMZN.WEB-DL.AAC2.0.h.264-CHX.mp4'
  )
  assert.equal(w.title, 'SpongeBob SquarePants')
  assert.equal(w.season, 4)
  assert.deepEqual(w.episodes, [9])
})

test('separates a marker fused to an episode title', () => {
  const w = parseOne('Futurama.S01E04Loves.Labous.Lost.in.Space.DVDRip.x264.mkv')
  assert.equal(w.title, 'Futurama')
  assert.equal(w.season, 1)
  assert.deepEqual(w.episodes, [4])
})

test('keeps both numbers of a fused double marker', () => {
  const w = parseOne(
    'SpongeBob.SquarePants.S01E28E29.SpongeBob.129-Karate.Choppers.1080p.AMZN.WEB-DL.DDP2.0.x264-TVSmash.mkv'
  )
  assert.equal(w.title, 'SpongeBob SquarePants')
  assert.equal(w.season, 1)
  assert.deepEqual(w.episodes, [28, 29])
})

test('keeps both numbers of a dashed multi-episode file', () => {
  const w = parseOne(
    'SpongeBob SquarePants (1999) - S02E01-E02 - Something Smells and Bossy Boots (1080p AMZN WEB-DL x265 RCVR).mkv'
  )
  assert.equal(w.title, 'SpongeBob SquarePants')
  assert.equal(w.year, 1999)
  assert.equal(w.season, 2)
  assert.deepEqual(w.episodes, [1, 2])
})

test('ignores a release-group tag that looks like a second season', () => {
  const w = parseOne('Futurama S01E01 Space Pilot 3000  [2160p x265 10bit S91 Joy].mkv')
  assert.equal(w.season, 1)
  assert.deepEqual(w.episodes, [1])
})

test('season and episodes are always plain integers', () => {
  const fixtures = [
    'Dutton.Ranch.S01E05WEB-DL.1080p.RGzsRutracker.mkv',
    'SpongeBob SquarePants (1999) - S02E01-E02 - Something Smells (1080p AMZN WEB-DL x265 RCVR).mkv',
    'Futurama S01E01 Space Pilot 3000  [2160p x265 10bit S91 Joy].mkv',
    'Philip K. Dick\'s Electric Dreams S01E01 Real Life  (2160p x265 10bit S101 Joy).mkv',
    'Comedians.In.Cars.Getting.Coffee.S04E05.Jon.Stewart.720p.WEBRip.AAC2. 0.x264-monkee.mkv',
    'Jersey Shore Family Vacation S08E31 No Longer Under Construction 1080p AMZN WEB-DL DDP2 0 H 264-RAWR[EZTVx.to].mkv',
    'Scooby-Doo, Where Are You! (1969) S01E03 1080p BluRay x265.mkv',
  ]
  for (const filename of fixtures) {
    for (const w of parse(filename)) {
      if (!w.isEpisode) continue
      assert.ok(Number.isInteger(w.season), `${filename}: season ${JSON.stringify(w.season)} is not an integer`)
      assert.ok(Array.isArray(w.episodes), `${filename}: episodes is not an array`)
      for (const e of w.episodes) {
        assert.ok(Number.isInteger(e), `${filename}: episode ${JSON.stringify(e)} is not an integer`)
      }
    }
  }
})

test('movies are unaffected', () => {
  const w = parseOne('The.Super.Mario.Bros.Movie.2023.BDRemux.1080p.pk.mkv')
  assert.equal(w.isEpisode, false)
  assert.equal(w.title, 'The Super Mario Bros Movie')
  assert.equal(w.year, 2023)
  assert.equal(w.season, null)
  assert.deepEqual(w.episodes, [])
})

test('an episode with no discoverable number yields an empty episode list', () => {
  const w = parseOne('Wildboyz Season1 Bonus DVD.mp4')
  assert.equal(w.isEpisode, true)
  assert.equal(w.season, 1)
  assert.deepEqual(w.episodes, [])
})

test('junk files and undersized movies are skipped', () => {
  assert.deepEqual(parse('Some.Movie.2024.1080p-sample.mkv'), [])
  assert.deepEqual(parse('The.Super.Mario.Bros.Movie.2023.1080p.mkv', { size: 1024 }), [])
})

test('stripTechnicalTokens only splits a marker glued to a letter', () => {
  assert.equal(stripTechnicalTokens('Show.S01E05WEB-DL.mkv'), 'Show.S01E05.WEB-DL.mkv')
  assert.equal(stripTechnicalTokens('Show.S01E05.WEB-DL.mkv'), 'Show.S01E05.WEB-DL.mkv')
  assert.equal(stripTechnicalTokens('Show - S02E01-E02 - Title.mkv'), 'Show - S02E01-E02 - Title.mkv')
  assert.equal(stripTechnicalTokens('Show.s01e05web.mkv'), 'Show.s01e05.web.mkv')
})

test('a filename that leads with its episode number takes the series name from the torrent', () => {
  const w = parseOne('01- Pilot.mkv', { entryName: 'Rick and Morty Season 1 (2160p)' })
  assert.equal(w.title, 'Rick and Morty')
  assert.equal(w.isEpisode, true)
  assert.deepEqual(w.episodes, [1])
})

test('a filename that leads with Episode N takes the series name from the torrent', () => {
  const w = parseOne('Episode 8 Interdimensional Cable.mkv', {
    entryName: 'Rick And Morty (2013) Season 01 S01 (2160p BluRay X265 HEVC)',
  })
  assert.equal(w.title, 'Rick And Morty')
})

test('a filename that leads with a marker takes the series name from the torrent', () => {
  const w = parseOne('S00E09 - The Rise Of Tommy Shelby (1080p YouTube WEB-DL x265 Ghost).mkv', {
    entryName: 'Peaky Blinders (2013) Season 1-6 S01-S06 + Extras (1080p BluRay x265)',
  })
  assert.equal(w.title, 'Peaky Blinders')
  assert.equal(w.season, 0)
  assert.deepEqual(w.episodes, [9])
})

test('a filename that already names the series keeps its own title', () => {
  const w = parseOne('Rick and Morty S02E08 Interdimensional Cable 2 Tempting Fate.mp4', {
    entryName: 'Rick and Morty.2013.S01-S07.BluRay.2160p.5.1 AAC.H265.10bit-Zero00',
  })
  assert.equal(w.title, 'Rick and Morty')
  assert.equal(w.season, 2)
  assert.deepEqual(w.episodes, [8])
})

test('a series whose name starts with a number is not overwritten', () => {
  const w = parseOne('56 Days S01E03 1080p WEB-DL.mkv', { entryName: 'Some Torrent Pack 2026 1080p' })
  assert.equal(w.title, '56 Days')
  assert.deepEqual(w.episodes, [3])
})

test('a season from the filename marker is not overridden by the torrent title suffix', () => {
  const w = parseOne('01. Episode One.mkv', { entryName: 'Some Show Season 1 Серии 1-10 [2022 WEB-DL]' })
  assert.equal(w.season, 1)
  assert.deepEqual(w.episodes, [1])
})

test('collapses a duplicated year left in the title', () => {
  const w = parseOne('Pressure.2026.2026.1080p.AMZN.WEB-DL.DDP5.1.H.264-KyoGo.mkv')
  assert.equal(w.title, 'Pressure')
  assert.equal(w.year, 2026)
  assert.equal(w.isEpisode, false)
})

test('a leading list number on a bonus feature is not an episode', () => {
  const w = parseOne('09) Shattered by Silence.mkv')
  assert.equal(w.isEpisode, false)
  assert.equal(w.season, null)
  assert.deepEqual(w.episodes, [])
})

test('a numeric movie title with a year is not read as a season/episode', () => {
  const w = parseOne('Crime.101.2026.1080p.WEBRip.x264.AAC5.1-[YTS.BZ].mp4')
  assert.equal(w.title, 'Crime 101')
  assert.equal(w.year, 2026)
  assert.equal(w.isEpisode, false)
})
