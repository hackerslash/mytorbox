const { SOURCES, fetchMylist, buildStreamUrl } = require('./torbox')
const { parseWorkItems, slugify } = require('./parser')
const tmdb = require('./tmdb')
const rpdb = require('./rpdb')
const redis = require('./redisClient')
const { LIBRARY_TTL_MS } = require('./config')

const TMDB_CONCURRENCY = 5

function streamDict(w, torboxKey) {
  const url = buildStreamUrl(w.source, w.itemId, w.fileId, torboxKey)
  const sizeGb = (w.size || 0) / 1024 ** 3
  return {
    url,
    name: 'TorBox',
    title: `${w.filename}\n${sizeGb.toFixed(2)} GB`,
    behaviorHints: { bingeGroup: `torbox-${w.itemId}` },
  }
}

function posterUrlFor(tmdbRes, kind, rpdbKey) {
  if (tmdbRes) {
    const rp = rpdb.posterUrl(rpdbKey, tmdbRes.id, kind)
    if (rp) return rp
  }
  return tmdb.posterUrl(tmdbRes)
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Different raw filenames (alternate/regional titles) can resolve to the
 * same TMDB entry. Merge those groups so the catalog shows one entry. */
function dedupeByTmdb(keysAndGroups, results, mergeFn) {
  const merged = new Map()
  const order = []
  keysAndGroups.forEach(([rawKey, g], i) => {
    const res = results[i]
    const canonical = res ? `tmdb-${res.id}` : `raw-${rawKey}`
    if (!merged.has(canonical)) {
      merged.set(canonical, { group: g, tmdb: res })
      order.push(canonical)
    } else {
      const entry = merged.get(canonical)
      mergeFn(entry.group, g)
      entry.tmdb = entry.tmdb || res
    }
  })
  return order.map((k) => {
    const e = merged.get(k)
    return [k, e.group, e.tmdb]
  })
}

function mergeMovieGroups(dst, src) {
  dst.items.push(...src.items)
  dst.year = dst.year || src.year
  dst.createdAt = Math.max(dst.createdAt, src.createdAt)
}

function mergeSeriesGroups(dst, src) {
  dst.year = dst.year || src.year
  dst.createdAt = Math.max(dst.createdAt, src.createdAt)
  for (const [epKey, items] of src.episodes) {
    if (!dst.episodes.has(epKey)) dst.episodes.set(epKey, [])
    dst.episodes.get(epKey).push(...items)
  }
}

function byCreatedAtDesc([, a], [, b]) {
  return b.createdAt - a.createdAt
}

function sortedBySize(items) {
  return [...items].sort((a, b) => (b.size || 0) - (a.size || 0))
}

async function buildLibrary(torboxKey, tmdbKey, rpdbKey) {
  const workItems = []
  for (const source of SOURCES) {
    const entries = await fetchMylist(source, torboxKey)
    for (const entry of entries) {
      workItems.push(...parseWorkItems(source, entry))
    }
  }

  const movieGroups = new Map()
  const seriesGroups = new Map()

  for (const w of workItems) {
    if (w.isEpisode) {
      const key = slugify(w.title)
      if (!seriesGroups.has(key)) {
        seriesGroups.set(key, { title: w.title, year: null, createdAt: 0, episodes: new Map() })
      }
      const g = seriesGroups.get(key)
      g.year = g.year || w.year
      g.createdAt = Math.max(g.createdAt, w.createdAt)
      const epKey = `${w.season}:${w.episode}`
      if (!g.episodes.has(epKey)) g.episodes.set(epKey, [])
      g.episodes.get(epKey).push(w)
    } else {
      const key = `${slugify(w.title)}-${w.year || 'na'}`
      if (!movieGroups.has(key)) {
        movieGroups.set(key, { title: w.title, year: w.year, createdAt: 0, items: [] })
      }
      const g = movieGroups.get(key)
      g.items.push(w)
      g.createdAt = Math.max(g.createdAt, w.createdAt)
    }
  }

  const movieKeys = [...movieGroups.entries()]
  const seriesKeys = [...seriesGroups.entries()]

  const movieResults = await mapLimit(movieKeys, TMDB_CONCURRENCY, ([, g]) =>
    tmdb.search(g.title, g.year, 'movie', tmdbKey)
  )
  const seriesResults = await mapLimit(seriesKeys, TMDB_CONCURRENCY, ([, g]) =>
    tmdb.search(g.title, g.year, 'tv', tmdbKey)
  )

  const lib = { movies: [], series: [], meta: {}, streams: {} }

  const moviesMerged = dedupeByTmdb(movieKeys, movieResults, mergeMovieGroups).sort(byCreatedAtDesc)
  const seriesMerged = dedupeByTmdb(seriesKeys, seriesResults, mergeSeriesGroups).sort(byCreatedAtDesc)

  const movieImages = await mapLimit(moviesMerged, TMDB_CONCURRENCY, ([, , tmdbRes]) =>
    tmdbRes ? tmdb.getImages('movie', tmdbRes.id, tmdbKey) : null
  )
  const seriesImages = await mapLimit(seriesMerged, TMDB_CONCURRENCY, ([, , tmdbRes]) =>
    tmdbRes ? tmdb.getImages('tv', tmdbRes.id, tmdbKey) : null
  )

  moviesMerged.forEach(([canonical, g, tmdbRes], i) => {
    const mid = `tb:movie:${canonical}`
    const year = g.year || (tmdbRes && tmdbRes.release_date ? tmdbRes.release_date.slice(0, 4) : null)
    const preview = {
      id: mid,
      type: 'movie',
      name: (tmdbRes && tmdbRes.title) || g.title,
      poster: posterUrlFor(tmdbRes, 'movie', rpdbKey),
    }
    if (year) preview.releaseInfo = String(year)
    const logo = tmdb.logoUrl(movieImages[i], tmdbRes && tmdbRes.original_language)
    if (logo) preview.logo = logo
    lib.movies.push(preview)
    lib.meta[mid] = { ...preview, description: tmdbRes ? tmdbRes.overview : null }
    lib.streams[mid] = sortedBySize(g.items).map((w) => streamDict(w, torboxKey))
  })

  seriesMerged.forEach(([canonical, g, tmdbRes], i) => {
    const sid = `tb:series:${canonical}`
    const year = g.year || (tmdbRes && tmdbRes.first_air_date ? tmdbRes.first_air_date.slice(0, 4) : null)
    const preview = {
      id: sid,
      type: 'series',
      name: (tmdbRes && tmdbRes.name) || g.title,
      poster: posterUrlFor(tmdbRes, 'series', rpdbKey),
    }
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
      const items = g.episodes.get(epKey)
      const vid = `${sid}:${season}:${episode}`
      videos.push({
        id: vid,
        title: `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`,
        season,
        episode,
      })
      lib.streams[vid] = sortedBySize(items).map((w) => streamDict(w, torboxKey))
    }

    lib.series.push(preview)
    lib.meta[sid] = { ...preview, videos, description: tmdbRes ? tmdbRes.overview : null }
  })

  return lib
}

// Falls back to this in-process Map only when Redis isn't configured (e.g. local dev without REDIS_URL).
const memCache = new Map() // `${torboxKey}|${tmdbKey}|${rpdbKey}` -> { lib, cachedAt }
let buildLock = Promise.resolve()

const LIBRARY_TTL_SECONDS = Math.floor(LIBRARY_TTL_MS / 1000)

function redisKeyFor(cacheKey) {
  return `lib:${cacheKey}`
}

async function getCachedLib(cacheKey) {
  if (redis) {
    try {
      const raw = await redis.get(redisKeyFor(cacheKey))
      return raw ? JSON.parse(raw) : null
    } catch (err) {
      console.warn('library: redis get failed, treating as cache miss:', err.message)
      return null
    }
  }
  const entry = memCache.get(cacheKey)
  return entry && Date.now() - entry.cachedAt < LIBRARY_TTL_MS ? entry.lib : null
}

async function setCachedLib(cacheKey, lib) {
  if (redis) {
    try {
      await redis.set(redisKeyFor(cacheKey), JSON.stringify(lib), 'EX', LIBRARY_TTL_SECONDS)
      return
    } catch (err) {
      console.warn('library: redis set failed:', err.message)
      return
    }
  }
  memCache.set(cacheKey, { lib, cachedAt: Date.now() })
}

async function getLibrary(torboxKey, tmdbKey, rpdbKey = null, force = false) {
  const cacheKey = `${torboxKey}|${tmdbKey}|${rpdbKey || ''}`

  if (!force) {
    const cached = await getCachedLib(cacheKey)
    if (cached) return cached
  }

  const run = buildLock.then(async () => {
    if (!force) {
      const cachedAfterWait = await getCachedLib(cacheKey)
      if (cachedAfterWait) return cachedAfterWait
    }
    const lib = await buildLibrary(torboxKey, tmdbKey, rpdbKey)
    await setCachedLib(cacheKey, lib)
    return lib
  })
  buildLock = run.catch(() => {})
  return run
}

async function clearCache() {
  memCache.clear()
  if (redis) {
    try {
      const keys = await redis.keys('lib:*')
      if (keys.length) await redis.del(...keys)
    } catch (err) {
      console.warn('library: redis clearCache failed:', err.message)
    }
  }
}

module.exports = { getLibrary, buildLibrary, clearCache, posterUrlFor, mapLimit }
