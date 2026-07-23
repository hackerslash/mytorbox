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

  const movieGroups = new Map() // imdbId -> entry[]
  const seriesGroups = new Map() // imdbId -> { episodes: Map<"season:episode", entry[]> }

  for (const e of entries) {
    if (e.type === 'movie') {
      if (!movieGroups.has(e.imdbId)) movieGroups.set(e.imdbId, [])
      movieGroups.get(e.imdbId).push(e)
    } else {
      if (!seriesGroups.has(e.imdbId)) seriesGroups.set(e.imdbId, { episodes: new Map() })
      const g = seriesGroups.get(e.imdbId)
      const epKey = `${e.season}:${e.episode}`
      if (!g.episodes.has(epKey)) g.episodes.set(epKey, [])
      g.episodes.get(epKey).push(e)
    }
  }

  const movieImdbIds = [...movieGroups.keys()]
  const seriesImdbIds = [...seriesGroups.keys()]

  const movieFinds = await mapLimit(movieImdbIds, TMDB_CONCURRENCY, (id) => tmdb.findByImdbId(id, tmdbKey))
  const seriesFinds = await mapLimit(seriesImdbIds, TMDB_CONCURRENCY, (id) => tmdb.findByImdbId(id, tmdbKey))

  const movieImages = await mapLimit(movieFinds, TMDB_CONCURRENCY, (f) =>
    f ? tmdb.getImages(f.kind, f.result.id, tmdbKey) : null
  )
  const seriesImages = await mapLimit(seriesFinds, TMDB_CONCURRENCY, (f) =>
    f ? tmdb.getImages(f.kind, f.result.id, tmdbKey) : null
  )

  movieImdbIds.forEach((imdbId, i) => {
    const found = movieFinds[i]
    const tmdbRes = found ? found.result : null
    const groupEntries = movieGroups.get(imdbId)
    const mid = `tb:custom:movie:${imdbId}`
    const fallbackTitle = groupEntries.find((e) => e.title) ? groupEntries.find((e) => e.title).title : imdbId
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

  seriesImdbIds.forEach((imdbId, i) => {
    const found = seriesFinds[i]
    const tmdbRes = found ? found.result : null
    const g = seriesGroups.get(imdbId)
    const sid = `tb:custom:series:${imdbId}`
    const allEntries = [...g.episodes.values()].flat()
    const fallbackTitle = allEntries.find((e) => e.title) ? allEntries.find((e) => e.title).title : imdbId
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
