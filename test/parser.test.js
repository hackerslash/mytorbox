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

test('a leading collection index before the year is dropped from the title', () => {
  const w = parseOne('01.2013.Man.Of.Steel.1920x800.BDRip.x264.DTS-HD.MA.mkv')
  assert.equal(w.title, 'Man Of Steel')
  assert.equal(w.year, 2013)
  assert.equal(w.isEpisode, false)
})

test('a numeric title followed by a year and technical tokens is preserved', () => {
  const w = parseOne('10.2021.1080p.BluRay.x265.mkv')
  assert.equal(w.title, '10')
  assert.equal(w.year, 2021)
})

test('the pack index year wins over a year embedded in the title', () => {
  const w = parseOne('09.2020.Wonder.Woman.1984.1920x802.BDRip.x264.TrueHD-Atmos.mkv')
  assert.equal(w.title, 'Wonder Woman 1984')
  assert.equal(w.year, 2020)
  assert.equal(w.isEpisode, false)
})

test('two parsers agreeing on the title outvote guessit dropping the lead word', () => {
  const w = parseOne('www.1TamilMV.Pizza - DC (2026) Tamil HQ PreDVD - 1080p - x264 - HQ Clean - AAC.mkv')
  assert.equal(w.title, 'DC')
  assert.equal(w.year, 2026)
})

test('a single-letter title is kept when a year is present', () => {
  const w = parseOne('M (1931) Criterion BDRip 1080p x264 DD 1.0-HighCode.mkv')
  assert.equal(w.title, 'M')
  assert.equal(w.year, 1931)
  assert.equal(w.isEpisode, false)
})

test('a numeric movie title with a year is not read as a season/episode', () => {
  const w = parseOne('Crime.101.2026.1080p.WEBRip.x264.AAC5.1-[YTS.BZ].mp4')
  assert.equal(w.title, 'Crime 101')
  assert.equal(w.year, 2026)
  assert.equal(w.isEpisode, false)
})

test('a non-breaking space does not derail the season/episode marker', () => {
  const w = parseOne('Stranger Things (2025) V3 S05 EP 08 TRUE WEB-DL - 2160p - HEVC.mkv')
  assert.equal(w.title, 'Stranger Things')
  assert.equal(w.season, 5)
  assert.deepEqual(w.episodes, [8])
})

test('a bare high-numbered scene tag is not treated as a season', () => {
  const w = parseOne('Moana (2016)  [2160p x265 10bit S92 Joy].mkv')
  assert.equal(w.title, 'Moana')
  assert.equal(w.year, 2016)
  assert.equal(w.isEpisode, false)
})

test('the release year is not mistaken for the season number', () => {
  const w = parseOne('Versailles.2015.1x01.Episodio.01.ITA.ENG.1080p.BDMux.x264-Morpheus.mkv')
  assert.equal(w.title, 'Versailles')
  assert.equal(w.season, 1)
  assert.deepEqual(w.episodes, [1])
})

const REAL_MOVIES = [
  ['The Batman (2022) [2160p] [4K] [WEB] [5.1] [YTS.MX].mkv', 'The Batman', 2022],
  ['Everything.Everywhere.All.at.Once.2022.1080p.BluRay.DD5.1.x264-GalaxyRG.mkv', 'Everything Everywhere All at Once', 2022],
  ['John.Wick.Chapter.4.2023.PROPER.1080p.WEBRip.1400MB.DD5.1.x264-GalaxyRG.mkv', 'John Wick Chapter 4', 2023],
  ['Avatar.The.Way.of.Water.2022.REPACK.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv', 'Avatar The Way of Water', 2022],
  ['The.Lord.of.the.Rings.The.Fellowship.of.the.Ring.2001.EXTENDED.1080p.BluRay.x265-RARBG.mp4', 'The Lord of the Rings The Fellowship of the Ring', 2001],
  ['Blade.Runner.2049.2017.1080p.BluRay.x264.DTS-HD.MA.7.1-FGT.mkv', 'Blade Runner 2049', 2017],
  ['Parasite.2019.KOREAN.1080p.BluRay.H264.AAC-VXT.mp4', 'Parasite', 2019],
  ['Amelie.2001.FRENCH.1080p.BluRay.x264-USURY.mkv', 'Amelie', 2001],
  ['Oldboy.2003.KOREAN.REMASTERED.1080p.BluRay.x264.DTS-FGT.mkv', 'Oldboy', 2003],
  ['Crouching.Tiger.Hidden.Dragon.2000.720p.BrRip.x264.YIFY.mp4', 'Crouching Tiger Hidden Dragon', 2000],
  ['Se7en.1995.REMASTERED.1080p.BluRay.x265.HEVC.10bit.AAC.5.1-Tigole.mkv', 'Se7en', 1995],
  ['Guardians.of.the.Galaxy.Vol.3.2023.IMAX.2160p.DSNP.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv', 'Guardians of the Galaxy Vol 3', 2023],
  ['Spider-Man.Across.the.Spider-Verse.2023.1080p.WEBRip.1600MB.DD5.1.x264-GalaxyRG.mkv', 'Spider-Man Across the Spider-Verse', 2023],
  ['Mad.Max.Fury.Road.2015.1080p.BluRay.x264.anoXmous.mp4', 'Mad Max Fury Road', 2015],
  ['No.Country.for.Old.Men.2007.1080p.BluRay.x264-[YTS.AG].mp4', 'No Country for Old Men', 2007],
  ['Dune.2021.PART.ONE.2160p.HDR.DV.WEBRip.6CH.x265.HEVC-PSA.mkv', 'Dune', 2021],
  ['The.Grand.Budapest.Hotel.2014.1080p.BluRay.DTS.x264-PublicHD.mkv', 'The Grand Budapest Hotel', 2014],
  ['12.Angry.Men.1957.1080p.BluRay.x264-HD4U.mkv', '12 Angry Men', 1957],
  ['300.2006.1080p.BluRay.x264.YIFY.mp4', '300', 2006],
  ['2001.A.Space.Odyssey.1968.1080p.BluRay.x264-CiNEFiLE.mkv', '2001 A Space Odyssey', 1968],
  ['Léon.The.Professional.1994.EXTENDED.1080p.BluRay.x264-AMIABLE.mkv', 'Léon The Professional', 1994],
  ['Once.Upon.a.Time.in.Hollywood.2019.1080p.BluRay.x264-SPARKS.mkv', 'Once Upon a Time in Hollywood', 2019],
  ['Kill.Bill.Vol.1.2003.1080p.BluRay.x264-CULTHD.mkv', 'Kill Bill Vol 1', 2003],
  ['WALL-E.2008.1080p.BluRay.x264.DTS-WiKi.mkv', 'WALL-E', 2008],
  ['V.for.Vendetta.2005.1080p.BluRay.x264- amiable.mkv', 'V for Vendetta', 2005],
  ['Everything Everywhere All at Once (2022) 1080p BluRay [Hindi-English] x264.mkv', 'Everything Everywhere All at Once', 2022],
  ['The.Wolf.of.Wall.Street.2013.1080p.BluRay.x264.YIFY.mp4', 'The Wolf of Wall Street', 2013],
  ['RRR.2022.1080p.NF.WEB-DL.DDP5.1.x264-TEPES.mkv', 'RRR', 2022],
  ['Aftersun.2022.1080p.BluRay.DD5.1.x264-SPHD.mkv', 'Aftersun', 2022],
  ['Sicario.2015.1080p.BluRay.x264.DTS-JYK.mkv', 'Sicario', 2015],
]

for (const [filename, title, year] of REAL_MOVIES) {
  test(`movie: ${filename}`, () => {
    const w = parseOne(filename)
    assert.equal(w.title, title)
    assert.equal(w.year, year)
    assert.equal(w.isEpisode, false)
    assert.equal(w.season, null)
    assert.deepEqual(w.episodes, [])
  })
}

const REAL_SERIES = [
  ['Breaking.Bad.S05E14.Ozymandias.1080p.BluRay.x265-RARBG.mp4', 'Breaking Bad', 5, [14]],
  ['Game.of.Thrones.S01E01.Winter.Is.Coming.PROPER.1080p.BluRay.x265-RARBG.mp4', 'Game of Thrones', 1, [1]],
  ['The.Last.of.Us.S01E03.Long.Long.Time.2160p.HMAX.WEB-DL.DDP5.1.HDR.H.265-NTb.mkv', 'The Last of Us', 1, [3]],
  ['Chernobyl.S01E01.1.23.45.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv', 'Chernobyl', 1, [1]],
  ['The.Mandalorian.S03E01.720p.WEB.x265-MiNX.mkv', 'The Mandalorian', 3, [1]],
  ['Succession.S04E03.Connor\'s.Wedding.1080p.HMAX.WEBRip.DD5.1.x264-NTb.mkv', 'Succession', 4, [3]],
  ['Better.Call.Saul.S06E13.REPACK.Saul.Gone.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv', 'Better Call Saul', 6, [13]],
  ['Rick.and.Morty.S06E01.Solaricks.1080p.HMAX.WEBRip.DD5.1.x264-NTb.mkv', 'Rick and Morty', 6, [1]],
  ['Dark.S01E01.Secrets.GERMAN.1080p.NF.WEB-DL.DD5.1.x264-TrollHD.mkv', 'Dark', 1, [1]],
  ['Money.Heist.S03E01.SPANISH.1080p.NF.WEB-DL.DD5.1.x264-CMRG.mkv', 'Money Heist', 3, [1]],
  ['Squid.Game.S01E01.KOREAN.1080p.NF.WEBRip.DDP5.1.x264-SMURF.mkv', 'Squid Game', 1, [1]],
  ['Sherlock.1x03.The.Great.Game.720p.BluRay.x264.mkv', 'Sherlock', 1, [3]],
  ['Doctor.Who.2005.S01E01.Rose.1080p.BluRay.x264-OFT.mkv', 'Doctor Who', 1, [1]],
  ['Peaky.Blinders.S06E06.Lock.and.Key.1080p.iP.WEB-DL.AAC2.0.H.264-RTN.mkv', 'Peaky Blinders', 6, [6]],
  ['True.Detective.S01E01.The.Long.Bright.Dark.1080p.BluRay.x264-ROVERS.mkv', 'True Detective', 1, [1]],
  ['The.Boys.S03E06.Herogasm.1080p.AMZN.WEBRip.DDP5.1.x264-NTb.mkv', 'The Boys', 3, [6]],
  ['Severance.S01E09.The.We.We.Are.2160p.ATVP.WEB-DL.DDP5.1.HDR.H.265-NTb.mkv', 'Severance', 1, [9]],
  ['Andor.S01E12.Rix.Road.1080p.DSNP.WEB-DL.DDP5.1.H.264-NTb.mkv', 'Andor', 1, [12]],
  ['The.White.Lotus.S02E07.Arrivederci.1080p.HMAX.WEB-DL.DD5.1.H.264-NTb.mkv', 'The White Lotus', 2, [7]],
  ['Ted.Lasso.S03E12.So.Long.Farewell.1080p.ATVP.WEB-DL.DDP5.1.H.264-NTb.mkv', 'Ted Lasso', 3, [12]],
  ['House.of.the.Dragon.S01E10.The.Black.Queen.2160p.HMAX.WEB-DL.DDP5.1.HDR.H.265-NTb.mkv', 'House of the Dragon', 1, [10]],
  ['Wednesday.S01E08.A.Murder.of.Woes.1080p.NF.WEB-DL.DDP5.1.Atmos.x264-CMRG.mkv', 'Wednesday', 1, [8]],
  ['Fargo.S05E10.Bisquik.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv', 'Fargo', 5, [10]],
  ['Mr.Robot.S04E13.Series.Finale.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv', 'Mr Robot', 4, [13]],
  ['The.Bear.S02E10.The.Bear.1080p.DSNP.WEB-DL.DDP5.1.H.264-NTb.mkv', 'The Bear', 2, [10]],
  ['Arcane.S01E09.The.Monster.You.Created.1080p.NF.WEB-DL.DDP5.1.Atmos.x264-CMRG.mkv', 'Arcane', 1, [9]],
  ['Fleabag.S02E01.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv', 'Fleabag', 2, [1]],
  ['The.Crown.S05E01.Queen.Victoria.Syndrome.1080p.NF.WEB-DL.DDP5.1.x264-NTb.mkv', 'The Crown', 5, [1]],
  ['Loki.S02E06.Glorious.Purpose.2160p.DSNP.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv', 'Loki', 2, [6]],
  ['Dexter.S04E12.The.Getaway.720p.BluRay.x264-SiNNERS.mkv', 'Dexter', 4, [12]],
]

for (const [filename, title, season, episodes] of REAL_SERIES) {
  test(`series: ${filename}`, () => {
    const w = parseOne(filename)
    assert.equal(w.title, title)
    assert.equal(w.isEpisode, true)
    assert.equal(w.season, season)
    assert.deepEqual(w.episodes, episodes)
  })
}

test('a resolution glued to a source tag is not read as an episode', () => {
  const w = parseOne('[DB]Paprika_-_(Dual Audio_10bit_BD1080p_x265).mkv')
  assert.equal(w.title, 'Paprika')
  assert.equal(w.isEpisode, false)
})

test('a lone 3-4 digit number is not split into season and episode', () => {
  const w = parseOne('Майкл 1080.mkv')
  assert.equal(w.isEpisode, false)
})
