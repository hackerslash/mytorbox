process.env.REDIS_URL = ''

const test = require('node:test')
const assert = require('node:assert/strict')

const { groupWorkItems, seriesVideos } = require('../src/library')

function episodeItem(filename, season, episodes) {
  return {
    source: 'torrents',
    itemId: 'item-' + filename,
    fileId: 0,
    filename,
    size: 1024 ** 3,
    createdAt: 0,
    title: 'SpongeBob SquarePants',
    year: 1999,
    isEpisode: true,
    season,
    episodes,
  }
}

test('a multi-episode file is registered under every episode it covers', () => {
  const { seriesGroups } = groupWorkItems([episodeItem('S02E01-E02.mkv', 2, [1, 2])])
  const g = seriesGroups.get('spongebob-squarepants')
  assert.deepEqual([...g.episodes.keys()], ['2:1', '2:2'])
  assert.equal(g.episodes.get('2:1')[0].filename, 'S02E01-E02.mkv')
  assert.equal(g.episodes.get('2:2')[0].filename, 'S02E01-E02.mkv')
})

test('multi-episode files in one season do not overwrite each other', () => {
  const { seriesGroups } = groupWorkItems([
    episodeItem('S02E01-E02.mkv', 2, [1, 2]),
    episodeItem('S02E03-E04.mkv', 2, [3, 4]),
    episodeItem('S02E05-E06.mkv', 2, [5, 6]),
  ])
  const g = seriesGroups.get('spongebob-squarepants')
  const { videos, streams } = seriesVideos('tt0206512', g)

  assert.deepEqual(
    videos.map((v) => v.id),
    ['tt0206512:2:1', 'tt0206512:2:2', 'tt0206512:2:3', 'tt0206512:2:4', 'tt0206512:2:5', 'tt0206512:2:6']
  )
  assert.equal(Object.keys(streams).length, 6)
  for (const v of videos) {
    assert.equal(streams[v.id].length, 1, `${v.id} lost its stream`)
  }
  assert.equal(streams['tt0206512:2:1'][0].itemId, 'item-S02E01-E02.mkv')
  assert.equal(streams['tt0206512:2:6'][0].itemId, 'item-S02E05-E06.mkv')
})

test('video ids and episode numbers never contain NaN', () => {
  const { seriesGroups } = groupWorkItems([
    episodeItem('S02E01-E02.mkv', 2, [1, 2]),
    episodeItem('S01E28E29.mkv', 1, [28, 29]),
  ])
  const g = seriesGroups.get('spongebob-squarepants')
  const { videos, streams } = seriesVideos('tt0206512', g)

  for (const v of videos) {
    assert.ok(!v.id.includes('NaN'), `${v.id} contains NaN`)
    assert.ok(Number.isInteger(v.season), `season ${JSON.stringify(v.season)} is not an integer`)
    assert.ok(Number.isInteger(v.episode), `episode ${JSON.stringify(v.episode)} is not an integer`)
    assert.match(v.title, /^S\d{2}E\d{2}$/)
  }
  for (const id of Object.keys(streams)) {
    assert.ok(!id.includes('NaN'), `${id} contains NaN`)
  }
  assert.ok(JSON.stringify(videos).indexOf('null') === -1, 'a video field serialised to null')
})

test('videos are ordered by season then episode', () => {
  const { seriesGroups } = groupWorkItems([
    episodeItem('S02E10.mkv', 2, [10]),
    episodeItem('S01E02.mkv', 1, [2]),
    episodeItem('S02E02.mkv', 2, [2]),
    episodeItem('S01E10.mkv', 1, [10]),
  ])
  const { videos } = seriesVideos('tt0206512', seriesGroups.get('spongebob-squarepants'))
  assert.deepEqual(
    videos.map((v) => `${v.season}x${v.episode}`),
    ['1x2', '1x10', '2x2', '2x10']
  )
})

test('unnumbered episodes are parked in season 0 after existing specials', () => {
  const { seriesGroups } = groupWorkItems([
    episodeItem('S00E01.mkv', 0, [1]),
    episodeItem('Bonus Feature.mkv', 1, []),
    episodeItem('Another Extra.mkv', 1, []),
  ])
  const g = seriesGroups.get('spongebob-squarepants')
  assert.equal(g.unnumbered.length, 2)

  const { videos, streams } = seriesVideos('tt0206512', g)
  const specials = videos.filter((v) => v.season === 0)
  assert.deepEqual(
    specials.map((v) => v.id),
    ['tt0206512:0:1', 'tt0206512:0:2', 'tt0206512:0:3']
  )
  assert.equal(specials[1].title, 'Another Extra')
  assert.equal(specials[2].title, 'Bonus Feature')
  assert.equal(streams['tt0206512:0:2'].length, 1)
})

test('a non-numeric episode key is skipped instead of emitting a NaN id', () => {
  const g = {
    title: 'SpongeBob SquarePants',
    year: 1999,
    createdAt: 0,
    unnumbered: [],
    episodes: new Map([
      ['2:1,2', [episodeItem('corrupt.mkv', 2, [1, 2])]],
      ['2:3', [episodeItem('S02E03.mkv', 2, [3])]],
    ]),
  }
  const { videos, streams } = seriesVideos('tt0206512', g)
  assert.deepEqual(
    videos.map((v) => v.id),
    ['tt0206512:2:3']
  )
  assert.deepEqual(Object.keys(streams), ['tt0206512:2:3'])
})

test('movies group by title and year', () => {
  const movie = (filename, year) => ({
    source: 'torrents',
    itemId: 'item-' + filename,
    fileId: 0,
    filename,
    size: 5 * 1024 ** 3,
    createdAt: 0,
    title: 'Toy Story',
    year,
    isEpisode: false,
    season: null,
    episodes: [],
  })
  const { movieGroups } = groupWorkItems([movie('a.mkv', 1995), movie('b.mkv', 1995), movie('c.mkv', 1999)])
  assert.deepEqual([...movieGroups.keys()], ['toy-story-1995', 'toy-story-1999'])
  assert.equal(movieGroups.get('toy-story-1995').items.length, 2)
})
