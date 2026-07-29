const crypto = require('crypto')
const zlib = require('zlib')
const { SOURCES, fetchMylist, fetchNewest, buildStreamUrl } = require('./torbox')
const { parseWorkItems, slugify, makeGuessResolver } = require('./parser')
const tmdb = require('./tmdb')
const posters = require('./posters')
const redis = require('./redisClient')
const stats = require('./stats')
const { mapLimit } = require('./concurrency')
const cinemeta = require('./cinemeta')
const {
  LIBRARY_CHECK_INTERVAL_MS,
  LIBRARY_PROBE_INTERVAL_MS,
  LIBRARY_HARD_TTL_MS,
  PARSE_CACHE_TTL_SECONDS,
  MAX_CACHE_VALUE_BYTES,
} = require('./config')

const TMDB_CONCURRENCY = 20
const CINEMETA_SEARCH_CONCURRENCY = 5

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

function posterUrlFor(tmdbRes, kind, provider, imdbId = null) {
  const custom = posters.byImdb(provider, imdbId) || (tmdbRes && posters.byTmdb(provider, tmdbRes.id, kind))
  if (custom) return custom
  return tmdb.posterUrl(tmdbRes)
}

const TMDB_ID_IN_ID_RE = /^tb:(?:movie|series):tmdb-(\d+)(?::|$)/
const IMDB_ID_RE = /^tt\d+$/

function extraFields(details) {
  const extras = {}
  if (details.background) extras.background = details.background
  if (details.landscapePoster) extras.landscapePoster = details.landscapePoster
  if (details.genres && details.genres.length) extras.genres = details.genres
  if (details.runtime) extras.runtime = details.runtime
  return extras
}

function seriesReleaseInfo(startYear, details) {
  if (!startYear) return null
  if (details.inProduction) return `${startYear}-`
  if (details.endYear && details.endYear !== String(startYear)) return `${startYear}-${details.endYear}`
  return String(startYear)
}

function providerPosterFor(id, type, provider) {
  const byImdb = posters.byImdb(provider, id)
  if (byImdb) return byImdb
  const match = TMDB_ID_IN_ID_RE.exec(id)
  return match ? posters.byTmdb(provider, match[1], type) : null
}

function withPosters(items, provider) {
  if (!provider) return items
  return items.map((item) => {
    const poster = providerPosterFor(item.id || '', item.type, provider)
    return poster ? { ...item, poster } : item
  })
}

async function fetchDetails(kind, results, tmdbKey) {
  const ids = [...new Set(results.filter(Boolean).map((res) => res.id))]
  const fetched = await mapLimit(ids, TMDB_CONCURRENCY, (id) => tmdb.getDetails(kind, id, tmdbKey))
  return new Map(ids.map((id, i) => [id, fetched[i]]))
}

function detailsOf(details, tmdbRes) {
  return (tmdbRes && details.get(tmdbRes.id)) || null
}

/** Different raw filenames (alternate/regional titles) can resolve to the
 * same TMDB entry. Merge those groups so the catalog shows one entry. */
function dedupeByTmdb(keysAndGroups, results, imdbIds, mergeFn) {
  const merged = new Map()
  const order = []
  keysAndGroups.forEach(([rawKey, g], i) => {
    const res = results[i]
    const canonical = imdbIds[i] || (res ? `tmdb-${res.id}` : `raw-${rawKey}`)
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

function catalogIdFor(type, canonical) {
  return IMDB_ID_RE.test(canonical) ? canonical : `tb:${type}:${canonical}`
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

function newestOf(items) {
  let newest = null
  for (const e of items || []) {
    if (!newest || String(e.created_at) > String(newest.created_at)) newest = e
  }
  return newest
}

function tipOfEntry(source, entry) {
  return entry ? `${source}:${entry.id}:${entry.created_at || ''}:${entry.updated_at || ''}` : `${source}:none`
}

function tipEntries(entriesBySource) {
  return SOURCES.map((source) => tipOfEntry(source, newestOf(entriesBySource[source]))).join('|')
}

async function fetchTip(torboxKey) {
  const parts = []
  for (const source of SOURCES) {
    parts.push(tipOfEntry(source, await fetchNewest(source, torboxKey)))
  }
  return parts.join('|')
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

async function resolveGroups(keysAndGroups, kind, tmdbKey) {
  const results = await mapLimit(keysAndGroups, TMDB_CONCURRENCY, ([, g]) =>
    tmdb.search(g.title, g.year, kind, tmdbKey)
  )
  const details = await fetchDetails(kind, results, tmdbKey)

  const unresolved = []
  results.forEach((res, i) => {
    if (!res || !(detailsOf(details, res) || {}).imdbId) unresolved.push(i)
  })
  if (!unresolved.length) return { results, details }

  const cinemetaType = kind === 'movie' ? 'movie' : 'series'
  const recovered = await mapLimit(unresolved, CINEMETA_SEARCH_CONCURRENCY, async (i) => {
    const g = keysAndGroups[i][1]
    const imdbId = await cinemeta.searchImdbId(g.title, g.year, cinemetaType)
    if (!imdbId) return null
    const found = await tmdb.findByImdbId(imdbId, tmdbKey)
    return found && found.kind === kind ? found.result : null
  })

  const added = []
  unresolved.forEach((i, n) => {
    if (!recovered[n]) return
    results[i] = recovered[n]
    added.push(recovered[n])
    stats.track(`lib:recovered:${kind}`)
  })
  if (added.length) {
    for (const [id, value] of await fetchDetails(kind, added, tmdbKey)) details.set(id, value)
  }
  return { results, details }
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

  const { results: movieResults, details: movieDetails } = await resolveGroups(movieKeys, 'movie', tmdbKey)
  const { results: seriesResults, details: seriesDetails } = await resolveGroups(seriesKeys, 'tv', tmdbKey)

  const movieImdbIds = movieResults.map((res) => (detailsOf(movieDetails, res) || {}).imdbId || null)
  const seriesImdbIds = seriesResults.map((res) => (detailsOf(seriesDetails, res) || {}).imdbId || null)

  const lib = { movies: [], series: [], meta: {}, streams: {} }

  const moviesMerged = dedupeByTmdb(movieKeys, movieResults, movieImdbIds, mergeMovieGroups).sort(byCreatedAtDesc)
  const seriesMerged = dedupeByTmdb(seriesKeys, seriesResults, seriesImdbIds, mergeSeriesGroups).sort(byCreatedAtDesc)

  moviesMerged.forEach(([canonical, g, tmdbRes]) => {
    const mid = catalogIdFor('movie', canonical)
    const details = detailsOf(movieDetails, tmdbRes) || {}
    const year = g.year || (tmdbRes && tmdbRes.release_date ? tmdbRes.release_date.slice(0, 4) : null)
    const preview = {
      id: mid,
      type: 'movie',
      name: (tmdbRes && tmdbRes.title) || g.title,
      poster: tmdb.posterUrl(tmdbRes),
      ...extraFields(details),
    }
    if (year) preview.releaseInfo = String(year)
    const logo = details.logo
    if (logo) preview.logo = logo
    lib.movies.push(preview)
    lib.meta[mid] = { ...preview, description: tmdbRes ? tmdbRes.overview : null }
    lib.streams[mid] = sortedBySize(g.items).map(streamEntry)
  })

  seriesMerged.forEach(([canonical, g, tmdbRes]) => {
    const sid = catalogIdFor('series', canonical)
    const details = detailsOf(seriesDetails, tmdbRes) || {}
    const year = g.year || (tmdbRes && tmdbRes.first_air_date ? tmdbRes.first_air_date.slice(0, 4) : null)
    const preview = {
      id: sid,
      type: 'series',
      name: (tmdbRes && tmdbRes.name) || g.title,
      poster: tmdb.posterUrl(tmdbRes),
      ...extraFields(details),
    }
    const releaseInfo = seriesReleaseInfo(year, details)
    if (releaseInfo) preview.releaseInfo = releaseInfo
    const logo = details.logo
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
const memCache = new Map() // sha256(`${torboxKey}|${tmdbKey}|`) -> { record, storedAt }
const buildLocks = new Map()

// Redis/memory keys are hashed rather than built from the raw keys directly —
// otherwise anyone with Redis access could read every user's API keys straight
// out of the key names (`redis-cli KEYS lib:*`, MONITOR, RDB backups, etc).
// The trailing separator keeps this equal to the old `torbox|tmdb|rpdb` hash for users with
// no RPDB key; dropping it invalidates every cached library.
function cacheKeyFor(torboxKey, tmdbKey) {
  return crypto.createHash('sha256').update(`${torboxKey}|${tmdbKey}|`).digest('hex')
}

const LIBRARY_HARD_TTL_SECONDS = Math.floor(LIBRARY_HARD_TTL_MS / 1000)

function redisKeyFor(cacheKey) {
  return `lib:${cacheKey}`
}

function parseCacheKeyFor(cacheKey) {
  return `pc:${cacheKey}`
}

function partKeyFor(cacheKey, index) {
  return `libp:${cacheKey}:${index}`
}

const GZIP_PREFIX = 'gz:'
const ENVELOPE_PREFIX = 'e2:'
const MAX_CACHE_PARTS = 8

function packValue(obj) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(obj)))
}

function isGzip(buf) {
  return buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b
}

function unpackValue(raw) {
  if (Buffer.isBuffer(raw)) {
    if (isGzip(raw)) return JSON.parse(zlib.gunzipSync(raw).toString())
    return unpackValue(raw.toString())
  }
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

function chunksOf(packed) {
  const parts = []
  for (let i = 0; i < packed.length; i += MAX_CACHE_VALUE_BYTES) {
    parts.push(packed.subarray(i, i + MAX_CACHE_VALUE_BYTES))
  }
  return parts.length ? parts : [packed]
}

function envelopeValue(record, parts) {
  return ENVELOPE_PREFIX + JSON.stringify({
    parts,
    fingerprint: record.fingerprint,
    tip: record.tip,
    validatedAt: record.validatedAt,
    probedAt: record.probedAt,
  })
}

function isEnvelope(buf) {
  return buf.length >= ENVELOPE_PREFIX.length && buf.subarray(0, ENVELOPE_PREFIX.length).toString() === ENVELOPE_PREFIX
}

async function getCachedRecord(cacheKey) {
  if (redis) {
    try {
      const raw = await redis.getBuffer(redisKeyFor(cacheKey))
      if (!raw) return null
      if (!isEnvelope(raw)) return unpackValue(raw)
      const envelope = JSON.parse(raw.subarray(ENVELOPE_PREFIX.length).toString())
      const chunks = await Promise.all(
        Array.from({ length: envelope.parts }, (_, i) => redis.getBuffer(partKeyFor(cacheKey, i)))
      )
      if (chunks.some((chunk) => !chunk)) {
        stats.track('lib:parts_missing')
        return null
      }
      return { ...envelope, lib: unpackValue(Buffer.concat(chunks)) }
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
      const parts = chunksOf(packValue(record.lib))
      if (parts.length > MAX_CACHE_PARTS) {
        console.warn('library: skipping cache write, library too large even compressed')
        stats.track('lib:too_big')
        return
      }
      for (let i = 0; i < parts.length; i++) {
        await redis.set(partKeyFor(cacheKey, i), parts[i], 'EX', LIBRARY_HARD_TTL_SECONDS)
      }
      const tail = redis.pipeline()
      for (let i = parts.length; i < MAX_CACHE_PARTS; i++) tail.del(partKeyFor(cacheKey, i))
      tail.set(redisKeyFor(cacheKey), envelopeValue(record, parts.length), 'EX', LIBRARY_HARD_TTL_SECONDS)
      await tail.exec()
      if (parts.length > 1) stats.track('lib:chunked')
      return
    } catch (err) {
      console.warn('library: redis set failed:', err.message)
      return
    }
  }
  memCache.set(cacheKey, { record, storedAt: Date.now() })
}

// A revalidation that leaves the library bytes untouched only needs the envelope
// rewritten — rewriting the parts too would re-upload the whole library.
async function touchCachedRecord(cacheKey, record) {
  if (!redis) {
    memCache.set(cacheKey, { record, storedAt: Date.now() })
    return
  }
  if (!record.parts) {
    await setCachedRecord(cacheKey, record)
    return
  }
  try {
    const touch = redis.pipeline()
    for (let i = 0; i < record.parts; i++) touch.expire(partKeyFor(cacheKey, i), LIBRARY_HARD_TTL_SECONDS)
    touch.set(redisKeyFor(cacheKey), envelopeValue(record, record.parts), 'EX', LIBRARY_HARD_TTL_SECONDS)
    await touch.exec()
  } catch (err) {
    console.warn('library: redis touch failed:', err.message)
  }
}

async function loadParseCache(cacheKey) {
  const map = new Map()
  if (!redis || !cacheKey) return map
  try {
    const raw = await redis.getBuffer(parseCacheKeyFor(cacheKey))
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

async function probeUnchanged(cacheKey, cached, torboxKey) {
  if (!cached.tip) return false
  try {
    const tip = await fetchTip(torboxKey)
    if (tip !== cached.tip) {
      stats.track('lib:probe_changed')
      return false
    }
    stats.track('lib:probe_unchanged')
    await touchCachedRecord(cacheKey, { ...cached, probedAt: Date.now() })
    return true
  } catch (err) {
    stats.track('lib:probe_error')
    console.warn('library: tip probe failed, falling back to cached library:', err.message)
    await touchCachedRecord(cacheKey, { ...cached, probedAt: Date.now() })
    return true
  }
}

async function getLibrary(torboxKey, tmdbKey, force = false) {
  const cacheKey = cacheKeyFor(torboxKey, tmdbKey)

  const cached = await getCachedRecord(cacheKey)
  if (!force && cached && cached.lib && Date.now() - cached.validatedAt < LIBRARY_CHECK_INTERVAL_MS) {
    if (Date.now() - (cached.probedAt || cached.validatedAt) < LIBRARY_PROBE_INTERVAL_MS) {
      stats.track('lib:hit')
      return cached.lib
    }
    stats.track('lib:probe')
    if (await probeUnchanged(cacheKey, cached, torboxKey)) return cached.lib
  }

  // Serialize concurrent (re)validations per user so a burst of requests triggers at
  // most one TorBox fetch / rebuild.
  const prevLock = buildLocks.get(cacheKey) || Promise.resolve()
  const run = prevLock.then(async () => {
    const fresh = await getCachedRecord(cacheKey)
    if (!force && fresh && fresh.lib && Date.now() - fresh.validatedAt < LIBRARY_PROBE_INTERVAL_MS) {
      stats.track('lib:hit_coalesced')
      return fresh.lib
    }
    stats.track(force ? 'lib:force' : 'lib:revalidate')

    const entriesBySource = await fetchEntriesBySource(torboxKey, force)
    const fingerprint = fingerprintEntries(entriesBySource)

    const tip = tipEntries(entriesBySource)

    if (!force && fresh && fresh.lib && fresh.fingerprint === fingerprint) {
      stats.track('lib:unchanged')
      await touchCachedRecord(cacheKey, { ...fresh, fingerprint, tip, validatedAt: Date.now(), probedAt: Date.now() })
      return fresh.lib
    }
    const startedAt = Date.now()
    const lib = await buildLibrary(torboxKey, tmdbKey, entriesBySource, cacheKey)
    const buildMs = Date.now() - startedAt
    stats.track('lib:rebuild')
    stats.trackDuration('lib:build', buildMs)
    stats.trackLibraryShape(cacheKey, lib, buildMs)
    await setCachedRecord(cacheKey, { lib, fingerprint, tip, validatedAt: Date.now(), probedAt: Date.now() })
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
        ...(await redis.keys('libp:*')),
        ...(await redis.keys('pc:*')),
        ...(await redis.keys('tmdb:*')),
        ...(await redis.keys('cm:*')),
        ...(await redis.keys('cms:*')),
      ]
      for (let i = 0; i < all.length; i += 500) {
        await redis.del(...all.slice(i, i + 500))
      }
    } catch (err) {
      console.warn('library: redis clearCache failed:', err.message)
    }
  }
}

module.exports = {
  getLibrary,
  buildLibrary,
  clearCache,
  posterUrlFor,
  withPosters,
  hydrateStreams,
  extraFields,
  seriesReleaseInfo,
}
