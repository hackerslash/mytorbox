const crypto = require('crypto')
const zlib = require('zlib')
const { SOURCES, fetchMylist, buildStreamUrl } = require('./torbox')
const { parseWorkItems, slugify, makeGuessResolver } = require('./parser')
const tmdb = require('./tmdb')
const rpdb = require('./rpdb')
const redis = require('./redisClient')
const stats = require('./stats')
const {
  LIBRARY_CHECK_INTERVAL_MS,
  LIBRARY_HARD_TTL_MS,
  PARSE_CACHE_TTL_SECONDS,
  MAX_CACHE_VALUE_BYTES,
} = require('./config')

const TMDB_CONCURRENCY = 5

// Cached streams keep only what's needed to rebuild the download URL later —
// never the raw TorBox key, since this object is what gets persisted to Redis.
function streamEntry(w) {
  const sizeGb = (w.size || 0) / 1024 ** 3
  return {
    source: w.source,
    itemId: w.itemId,
    fileId: w.fileId,
    name: 'TorBox',
    title: `${w.filename}\n${sizeGb.toFixed(2)} GB`,
    behaviorHints: { bingeGroup: `torbox-${w.itemId}` },
  }
}

function hydrateStreams(entries, torboxKey) {
  return entries.map((e) => ({
    url: buildStreamUrl(e.source, e.itemId, e.fileId, torboxKey),
    name: e.name,
    title: e.title,
    behaviorHints: e.behaviorHints,
  }))
}

function posterUrlFor(tmdbRes, kind, rpdbKey) {
  if (tmdbRes) {
    const rp = rpdb.posterUrl(rpdbKey, tmdbRes.id, kind)
    if (rp) return rp
  }
  return tmdb.posterUrl(tmdbRes)
}

const TMDB_ID_IN_ID_RE = /^tb:(?:movie|series):tmdb-(\d+)(?::|$)/

function withRpdbPosters(items, rpdbKey) {
  if (!rpdbKey) return items
  return items.map((item) => {
    const match = TMDB_ID_IN_ID_RE.exec(item.id || '')
    if (!match) return item
    const poster = rpdb.posterUrl(rpdbKey, match[1], item.type)
    return poster ? { ...item, poster } : item
  })
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
  dst.unnumbered.push(...src.unnumbered)
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

async function fetchEntriesBySource(torboxKey, bypassCache = false) {
  const bySource = {}
  for (const source of SOURCES) {
    bySource[source] = await fetchMylist(source, torboxKey, { bypassCache })
    stats.track(`torbox:mylist:${source}`)
    stats.track('torbox:items', bySource[source].length)
  }
  return bySource
}

function fingerprintEntries(entriesBySource) {
  const parts = []
  for (const source of SOURCES) {
    for (const e of entriesBySource[source] || []) {
      parts.push(`${source}:${e.id}:${e.updated_at || e.created_at || ''}`)
    }
  }
  parts.sort()
  return `${parts.length}:${crypto.createHash('sha1').update(parts.join('|')).digest('hex')}`
}

async function buildLibrary(torboxKey, tmdbKey, entriesBySource = null, cacheKey = null) {
  const bySource = entriesBySource || (await fetchEntriesBySource(torboxKey))

  const resolver = makeGuessResolver(await loadParseCache(cacheKey))
  const workItems = []
  for (const source of SOURCES) {
    for (const entry of bySource[source] || []) {
      workItems.push(...parseWorkItems(source, entry, resolver))
    }
  }
  await saveParseCache(cacheKey, resolver.current)

  const movieGroups = new Map()
  const seriesGroups = new Map()

  for (const w of workItems) {
    if (w.isEpisode) {
      const key = slugify(w.title)
      if (!seriesGroups.has(key)) {
        seriesGroups.set(key, { title: w.title, year: null, createdAt: 0, episodes: new Map(), unnumbered: [] })
      }
      const g = seriesGroups.get(key)
      g.year = g.year || w.year
      g.createdAt = Math.max(g.createdAt, w.createdAt)
      if (w.episode == null) {
        g.unnumbered.push(w)
        continue
      }
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
      poster: tmdb.posterUrl(tmdbRes),
    }
    if (year) preview.releaseInfo = String(year)
    const logo = tmdb.logoUrl(movieImages[i], tmdbRes && tmdbRes.original_language)
    if (logo) preview.logo = logo
    lib.movies.push(preview)
    lib.meta[mid] = { ...preview, description: tmdbRes ? tmdbRes.overview : null }
    lib.streams[mid] = sortedBySize(g.items).map(streamEntry)
  })

  seriesMerged.forEach(([canonical, g, tmdbRes], i) => {
    const sid = `tb:series:${canonical}`
    const year = g.year || (tmdbRes && tmdbRes.first_air_date ? tmdbRes.first_air_date.slice(0, 4) : null)
    const preview = {
      id: sid,
      type: 'series',
      name: (tmdbRes && tmdbRes.name) || g.title,
      poster: tmdb.posterUrl(tmdbRes),
    }
    if (year) preview.releaseInfo = String(year)
    const logo = tmdb.logoUrl(seriesImages[i], tmdbRes && tmdbRes.original_language)
    if (logo) preview.logo = logo

    const specialTitles = new Map()
    if (g.unnumbered.length) {
      let slot = 0
      for (const epKey of g.episodes.keys()) {
        const [s, e] = epKey.split(':').map(Number)
        if (s === 0) slot = Math.max(slot, e)
      }
      const ordered = [...g.unnumbered].sort((a, b) => a.filename.localeCompare(b.filename))
      ordered.forEach((w, i) => {
        const epKey = `0:${slot + i + 1}`
        g.episodes.set(epKey, [w])
        specialTitles.set(epKey, w.filename.replace(/\.[a-z0-9]{2,4}$/i, ''))
      })
    }

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
        title: specialTitles.get(epKey) || `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`,
        season,
        episode,
      })
      lib.streams[vid] = sortedBySize(items).map(streamEntry)
    }

    lib.series.push(preview)
    lib.meta[sid] = { ...preview, videos, description: tmdbRes ? tmdbRes.overview : null }
  })

  return lib
}

// Falls back to this in-process Map only when Redis isn't configured (e.g. local dev without REDIS_URL).
const memCache = new Map() // sha256(`${torboxKey}|${tmdbKey}|${rpdbKey}`) -> { record, storedAt }
const buildLocks = new Map()

// Redis/memory keys are hashed rather than built from the raw keys directly —
// otherwise anyone with Redis access could read every user's API keys straight
// out of the key names (`redis-cli KEYS lib:*`, MONITOR, RDB backups, etc).
function cacheKeyFor(torboxKey, tmdbKey, rpdbKey) {
  return crypto.createHash('sha256').update(`${torboxKey}|${tmdbKey}|${rpdbKey || ''}`).digest('hex')
}

const LIBRARY_HARD_TTL_SECONDS = Math.floor(LIBRARY_HARD_TTL_MS / 1000)

function redisKeyFor(cacheKey) {
  return `lib:${cacheKey}`
}

function parseCacheKeyFor(cacheKey) {
  return `pc:${cacheKey}`
}
const GZIP_PREFIX = 'gz:'

function packValue(obj) {
  return GZIP_PREFIX + zlib.gzipSync(Buffer.from(JSON.stringify(obj))).toString('base64')
}

function unpackValue(raw) {
  if (typeof raw !== 'string') return null
  if (raw.startsWith(GZIP_PREFIX)) {
    return JSON.parse(zlib.gunzipSync(Buffer.from(raw.slice(GZIP_PREFIX.length), 'base64')).toString())
  }
  return JSON.parse(raw) // legacy uncompressed entry
}

// True if a packed value is too big to safely store. Returns [tooBig, packed].
function packWithLimit(obj) {
  const packed = packValue(obj)
  return [Buffer.byteLength(packed) > MAX_CACHE_VALUE_BYTES, packed]
}

async function getCachedRecord(cacheKey) {
  if (redis) {
    try {
      const raw = await redis.get(redisKeyFor(cacheKey))
      return raw ? unpackValue(raw) : null
    } catch (err) {
      console.warn('library: redis get failed, treating as cache miss:', err.message)
      return null
    }
  }
  const entry = memCache.get(cacheKey)
  if (!entry) return null
  if (Date.now() - entry.storedAt >= LIBRARY_HARD_TTL_MS) {
    memCache.delete(cacheKey)
    return null
  }
  return entry.record
}

async function setCachedRecord(cacheKey, record) {
  if (redis) {
    try {
      const [tooBig, packed] = packWithLimit(record)
      if (tooBig) {
        console.warn('library: skipping cache write, library too large even compressed')
        stats.track('lib:too_big')
        return
      }
      await redis.set(redisKeyFor(cacheKey), packed, 'EX', LIBRARY_HARD_TTL_SECONDS)
      return
    } catch (err) {
      console.warn('library: redis set failed:', err.message)
      return
    }
  }
  memCache.set(cacheKey, { record, storedAt: Date.now() })
}

async function loadParseCache(cacheKey) {
  const map = new Map()
  if (!redis || !cacheKey) return map
  try {
    const raw = await redis.get(parseCacheKeyFor(cacheKey))
    if (raw) {
      const obj = unpackValue(raw)
      for (const k of Object.keys(obj)) map.set(k, obj[k])
    }
  } catch (err) {
    console.warn('library: parse cache load failed:', err.message)
  }
  return map
}

async function saveParseCache(cacheKey, map) {
  if (!redis || !cacheKey || !map || map.size === 0) return
  try {
    const obj = {}
    for (const [k, v] of map) obj[k] = v
    const [tooBig, packed] = packWithLimit(obj)
    if (tooBig) {
      console.warn('library: skipping parse-cache write, blob too large even compressed')
      return
    }
    await redis.set(parseCacheKeyFor(cacheKey), packed, 'EX', PARSE_CACHE_TTL_SECONDS)
  } catch (err) {
    console.warn('library: parse cache save failed:', err.message)
  }
}

async function getLibrary(torboxKey, tmdbKey, rpdbKey = null, force = false) {
  const cacheKey = cacheKeyFor(torboxKey, tmdbKey, rpdbKey)

  const cached = await getCachedRecord(cacheKey)
  if (!force && cached && cached.lib && Date.now() - cached.validatedAt < LIBRARY_CHECK_INTERVAL_MS) {
    stats.track('lib:hit')
    return cached.lib
  }

  // Serialize concurrent (re)validations per user so a burst of requests triggers at
  // most one TorBox fetch / rebuild.
  const prevLock = buildLocks.get(cacheKey) || Promise.resolve()
  const run = prevLock.then(async () => {
    const fresh = await getCachedRecord(cacheKey)
    if (!force && fresh && fresh.lib && Date.now() - fresh.validatedAt < LIBRARY_CHECK_INTERVAL_MS) {
      stats.track('lib:hit_coalesced')
      return fresh.lib
    }
    stats.track(force ? 'lib:force' : 'lib:revalidate')

    const entriesBySource = await fetchEntriesBySource(torboxKey, force)
    const fingerprint = fingerprintEntries(entriesBySource)

    if (!force && fresh && fresh.lib && fresh.fingerprint === fingerprint) {
      stats.track('lib:unchanged')
      await setCachedRecord(cacheKey, { lib: fresh.lib, fingerprint, validatedAt: Date.now() })
      return fresh.lib
    }
    const startedAt = Date.now()
    const lib = await buildLibrary(torboxKey, tmdbKey, entriesBySource, cacheKey)
    const buildMs = Date.now() - startedAt
    stats.track('lib:rebuild')
    stats.trackDuration('lib:build', buildMs)
    stats.trackLibraryShape(cacheKey, lib, buildMs)
    await setCachedRecord(cacheKey, { lib, fingerprint, validatedAt: Date.now() })
    return lib
  })
  const settled = run.then(() => {}, () => {})
  buildLocks.set(cacheKey, settled)
  settled.finally(() => {
    if (buildLocks.get(cacheKey) === settled) buildLocks.delete(cacheKey)
  })
  return run
}

async function clearCache() {
  memCache.clear()
  if (redis) {
    try {
      const all = [
        ...(await redis.keys('lib:*')),
        ...(await redis.keys('pc:*')),
        ...(await redis.keys('tmdb:*')),
      ]
      for (let i = 0; i < all.length; i += 500) {
        await redis.del(...all.slice(i, i + 500))
      }
    } catch (err) {
      console.warn('library: redis clearCache failed:', err.message)
    }
  }
}

module.exports = { getLibrary, buildLibrary, clearCache, posterUrlFor, withRpdbPosters, mapLimit, hydrateStreams }
