const tmdb = require('./tmdb')
const { posterUrlFor, mapLimit } = require('./library')
const { listCustomStreams } = require('./customStreams')

const TMDB_CONCURRENCY = 5

function streamDictFor(entry) {
  return {
    url: entry.streamUrl,
    name: 'Custom',
    title: entry.title || entry.streamUrl,
  }
}

async function buildCustomCatalog(torboxKey, tmdbKey, rpdbKey) {
  const entries = await listCustomStreams(torboxKey, tmdbKey, rpdbKey)
  const lib = { movies: [], series: [], meta: {}, streams: {} }
  if (!entries.length) return lib

  const movieGroups = new Map() // groupKey -> entry[]
  const seriesGroups = new Map() // groupKey -> { episodes: Map<"season:episode", entry[]> }

  for (const e of entries) {
    if (e.type === 'movie') {
      if (!movieGroups.has(e.groupKey)) movieGroups.set(e.groupKey, [])
      movieGroups.get(e.groupKey).push(e)
    } else {
      if (!seriesGroups.has(e.groupKey)) seriesGroups.set(e.groupKey, { episodes: new Map() })
      const g = seriesGroups.get(e.groupKey)
      const epKey = `${e.season}:${e.episode}`
      if (!g.episodes.has(epKey)) g.episodes.set(epKey, [])
      g.episodes.get(epKey).push(e)
    }
  }

  const movieGroupKeys = [...movieGroups.keys()]
  const seriesGroupKeys = [...seriesGroups.keys()]

  // Groups with no IMDb id have nothing to look up on TMDB — they run on the title alone.
  const movieFinds = await mapLimit(movieGroupKeys, TMDB_CONCURRENCY, (key) => {
    const imdbId = movieGroups.get(key)[0].imdbId
    return imdbId ? tmdb.findByImdbId(imdbId, tmdbKey) : null
  })
  const seriesFinds = await mapLimit(seriesGroupKeys, TMDB_CONCURRENCY, (key) => {
    const imdbId = seriesGroups.get(key).episodes.values().next().value[0].imdbId
    return imdbId ? tmdb.findByImdbId(imdbId, tmdbKey) : null
  })

  const movieImages = await mapLimit(movieFinds, TMDB_CONCURRENCY, (f) =>
    f ? tmdb.getImages(f.kind, f.result.id, tmdbKey) : null
  )
  const seriesImages = await mapLimit(seriesFinds, TMDB_CONCURRENCY, (f) =>
    f ? tmdb.getImages(f.kind, f.result.id, tmdbKey) : null
  )

  movieGroupKeys.forEach((groupKey, i) => {
    const found = movieFinds[i]
    const tmdbRes = found ? found.result : null
    const groupEntries = movieGroups.get(groupKey)
    const mid = `tb:custom:movie:${groupKey}`
    const fallbackTitle = groupEntries.find((e) => e.title) ? groupEntries.find((e) => e.title).title : groupKey
    const name = (tmdbRes && tmdbRes.title) || fallbackTitle

    const preview = {
      id: mid,
      type: 'movie',
      name,
      poster: posterUrlFor(tmdbRes, 'movie', rpdbKey),
    }
    const year = tmdbRes && tmdbRes.release_date ? tmdbRes.release_date.slice(0, 4) : null
    if (year) preview.releaseInfo = String(year)
    const logo = tmdb.logoUrl(movieImages[i], tmdbRes && tmdbRes.original_language)
    if (logo) preview.logo = logo

    lib.movies.push(preview)
    lib.meta[mid] = {
      ...preview,
      description: tmdbRes ? tmdbRes.overview : 'Custom stream added manually.',
    }
    lib.streams[mid] = groupEntries
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(streamDictFor)
  })

  seriesGroupKeys.forEach((groupKey, i) => {
    const found = seriesFinds[i]
    const tmdbRes = found ? found.result : null
    const g = seriesGroups.get(groupKey)
    const sid = `tb:custom:series:${groupKey}`
    const allEntries = [...g.episodes.values()].flat()
    const fallbackTitle = allEntries.find((e) => e.title) ? allEntries.find((e) => e.title).title : groupKey
    const name = (tmdbRes && tmdbRes.name) || fallbackTitle

    const preview = {
      id: sid,
      type: 'series',
      name,
      poster: posterUrlFor(tmdbRes, 'series', rpdbKey),
    }
    const year = tmdbRes && tmdbRes.first_air_date ? tmdbRes.first_air_date.slice(0, 4) : null
    if (year) preview.releaseInfo = String(year)
    const logo = tmdb.logoUrl(seriesImages[i], tmdbRes && tmdbRes.original_language)
    if (logo) preview.logo = logo

    const videos = []
    const epKeysSorted = [...g.episodes.keys()].sort((a, b) => {
      const [aSeason, aEpisode] = a.split(':').map(Number)
      const [bSeason, bEpisode] = b.split(':').map(Number)
      return aSeason - bSeason || aEpisode - bEpisode
    })
    for (const epKey of epKeysSorted) {
      const [season, episode] = epKey.split(':').map(Number)
      const vid = `${sid}:${season}:${episode}`
      videos.push({
        id: vid,
        title: `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`,
        season,
        episode,
      })
      lib.streams[vid] = g.episodes
        .get(epKey)
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(streamDictFor)
    }

    lib.series.push(preview)
    lib.meta[sid] = {
      ...preview,
      videos,
      description: tmdbRes ? tmdbRes.overview : 'Custom stream added manually.',
    }
  })

  return lib
}

module.exports = { buildCustomCatalog }
