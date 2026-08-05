const crypto = require('crypto')
const { getJson } = require('./httpUtils')
const redis = require('./redisClient')
const stats = require('./stats')
const { mapLimit } = require('./concurrency')
const { normalizeTitle, stripStudioPrefix } = require('./tmdb')
const {
  CINEMETA_BASE,
  CINEMETA_CACHE_TTL_SECONDS,
  CINEMETA_NEGATIVE_CACHE_TTL_SECONDS,
  CINEMETA_WARM_CONCURRENCY,
  CINEMETA_WARM_MAX_PER_RUN,
  CINEMETA_MAX_TITLE_EDITS,
} = require('./config')

const IMDB_ID_RE = /^tt\d+$/
const CUSTOM_IMDB_ID_RE = /^tb:custom:(?:movie|series):(tt\d+)$/
const EMPTY = '{}'
const ART_FIELDS = ['p', 'b', 'l']
const FIELD_MAP = {
  r: 'imdbRating',
  d: 'description',
  p: 'poster',
  b: 'background',
  l: 'logo',
  rt: 'runtime',
  g: 'genres',
}

const inFlight = new Set()

function metaKey(imdbId) {
  return `cm:${imdbId}`
}

function searchKey(type, title, year) {
  const hash = crypto.createHash('sha1').update(`${type}|${title.toLowerCase()}|${year || ''}`).digest('hex')
  return `cms:${hash}`
}

function imdbIdOf(metaId) {
  if (IMDB_ID_RE.test(metaId)) return metaId
  const match = CUSTOM_IMDB_ID_RE.exec(metaId)
  return match ? match[1] : null
}

async function readCached(imdbIds) {
  const found = new Map()
  if (!redis || !imdbIds.length) return found
  try {
    const values = await redis.mget(...imdbIds.map(metaKey))
    imdbIds.forEach((id, i) => {
      if (values[i] == null) return
      try {
        found.set(id, JSON.parse(values[i]))
      } catch {
      }
    })
  } catch (err) {
    console.warn('cinemeta: redis mget failed, serving unenriched:', err.message)
  }
  return found
}

function distill(meta) {
  const out = {}
  if (!meta) return out
  if (meta.imdbRating) out.r = String(meta.imdbRating)
  if (meta.description) out.d = String(meta.description)
  if (meta.poster) out.p = String(meta.poster)
  if (meta.background) out.b = String(meta.background)
  if (meta.logo) out.l = String(meta.logo)
  if (meta.runtime) out.rt = String(meta.runtime)
  if (Array.isArray(meta.genres) && meta.genres.length) out.g = meta.genres.map(String)
  return out
}

async function resolves(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) })
    return res.ok
  } catch {
    return false
  }
}

async function verifyArt(distilled) {
  await Promise.all(
    ART_FIELDS.filter((f) => distilled[f]).map(async (f) => {
      if (!(await resolves(distilled[f]))) {
        delete distilled[f]
        stats.track(`cinemeta:art_404:${f}`)
      }
    })
  )
  return distilled
}

async function fetchOne(imdbId, type) {
  try {
    const data = await getJson(`${CINEMETA_BASE}/meta/${type}/${imdbId}.json`)
    return verifyArt(distill(data && data.meta))
  } catch {
    return null
  }
}

async function warm(targets) {
  if (!redis) return
  const pending = targets.filter((t) => !inFlight.has(t.imdbId)).slice(0, CINEMETA_WARM_MAX_PER_RUN)
  if (!pending.length) return

  pending.forEach((t) => inFlight.add(t.imdbId))
  try {
    await mapLimit(pending, CINEMETA_WARM_CONCURRENCY, async (t) => {
      const distilled = await fetchOne(t.imdbId, t.type)
      if (distilled == null) {
        stats.track('cinemeta:error')
        return
      }
      const payload = JSON.stringify(distilled)
      const empty = payload === EMPTY
      stats.track(empty ? 'cinemeta:empty' : 'cinemeta:fetched')
      const ttl = empty ? CINEMETA_NEGATIVE_CACHE_TTL_SECONDS : CINEMETA_CACHE_TTL_SECONDS
      try {
        await redis.set(metaKey(t.imdbId), payload, 'EX', ttl)
      } catch {
      }
    })
  } finally {
    pending.forEach((t) => inFlight.delete(t.imdbId))
  }
}

function merge(meta, cached) {
  const patch = {}
  for (const [short, field] of Object.entries(FIELD_MAP)) {
    const value = cached[short]
    if (!value) continue
    const current = meta[field]
    const absent = !current || (Array.isArray(current) && !current.length)
    if (field === 'imdbRating' || absent) patch[field] = value
  }
  return Object.keys(patch).length ? { ...meta, ...patch } : meta
}

async function withEnrichment(metas) {
  if (!redis || !metas.length) return metas
  const targets = metas
    .map((meta) => ({ meta, imdbId: imdbIdOf(meta.id) }))
    .filter((entry) => entry.imdbId)
  if (!targets.length) return metas

  const cached = await readCached(targets.map((entry) => entry.imdbId))
  const missing = targets.filter((entry) => !cached.has(entry.imdbId))
  if (missing.length) {
    warm(missing.map((entry) => ({ imdbId: entry.imdbId, type: entry.meta.type }))).catch((err) =>
      console.warn('cinemeta: warm failed:', err.message)
    )
  }
  if (!cached.size) return metas

  const byMetaId = new Map(targets.map((entry) => [entry.meta.id, entry.imdbId]))
  return metas.map((meta) => {
    const entry = cached.get(byMetaId.get(meta.id))
    return entry ? merge(meta, entry) : meta
  })
}

function editDistance(a, b) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > CINEMETA_MAX_TITLE_EDITS) return CINEMETA_MAX_TITLE_EDITS + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = row
  }
  return prev[b.length]
}

function titleMatches(candidate, title) {
  const a = normalizeTitle(candidate)
  const b = normalizeTitle(title)
  if (!a || !b) return false
  if (a === b) return true
  const budget = Math.min(CINEMETA_MAX_TITLE_EDITS, Math.max(1, Math.floor(b.length * 0.12)))
  return editDistance(a, b) <= budget
}

async function catalogSearch(title, year, type) {
  const url = `${CINEMETA_BASE}/catalog/${type}/top/search=${encodeURIComponent(title)}.json`
  const data = await getJson(url)
  const metas = (data && data.metas) || []
  const byYear = year ? metas.filter((m) => String(m.releaseInfo || '').startsWith(String(year))) : []
  const pool = byYear.length ? byYear : metas
  const chosen = pool.find((m) => titleMatches(m.name, title))
  return chosen && IMDB_ID_RE.test(chosen.id || '') ? chosen.id : null
}

async function searchImdbId(rawTitle, year, type) {
  const title = String(rawTitle || '')
    .split(/\s+a\.?k\.?a\.?\s+/i)[0]
    .trim()
  if (!title) return null

  const key = searchKey(type, title, year)
  if (redis) {
    try {
      const cached = await redis.get(key)
      if (cached != null) return cached === EMPTY ? null : cached
    } catch {
    }
  }

  let imdbId = null
  try {
    imdbId = await catalogSearch(title, year, type)
    if (!imdbId) {
      const stripped = stripStudioPrefix(title)
      if (stripped && stripped !== title) imdbId = await catalogSearch(stripped, year, type)
    }
    stats.track(imdbId ? 'cinemeta:search_hit' : 'cinemeta:search_miss')
  } catch {
    stats.track('cinemeta:search_error')
    return null
  }

  if (redis) {
    try {
      const ttl = imdbId ? CINEMETA_CACHE_TTL_SECONDS : CINEMETA_NEGATIVE_CACHE_TTL_SECONDS
      await redis.set(key, imdbId || EMPTY, 'EX', ttl)
    } catch {
    }
  }
  return imdbId
}

module.exports = { withEnrichment, searchImdbId }
