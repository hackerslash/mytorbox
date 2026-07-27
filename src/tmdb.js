const crypto = require('crypto')
const { TMDB_BASE, TMDB_IMAGE_BASE, TMDB_CACHE_TTL_SECONDS, TMDB_NEGATIVE_CACHE_TTL_SECONDS } = require('./config')
const { getJson } = require('./httpUtils')
const redis = require('./redisClient')
const stats = require('./stats')

const cache = new Map()
const detailsCache = new Map()
const findCache = new Map()
async function cachedLookup(ns, l1, l1key, fetchFn) {
  if (l1.has(l1key)) {
    stats.track('tmdb:hit_memory')
    return l1.get(l1key)
  }
  const rk = `tmdb:${ns}:${crypto.createHash('sha1').update(l1key).digest('hex')}`
  if (redis) {
    try {
      const raw = await redis.get(rk)
      if (raw != null) {
        const value = JSON.parse(raw)
        l1.set(l1key, value)
        stats.track('tmdb:hit_redis')
        return value
      }
    } catch {
      // fall through to a live fetch on any Redis error
    }
  }
  const value = await fetchFn()
  stats.track('tmdb:fetch')
  if (value == null) stats.track('tmdb:no_match')
  l1.set(l1key, value)
  if (redis) {
    // Cache "no match"/errors only briefly so late-arriving TMDB entries surface soon.
    const ttl = value == null ? TMDB_NEGATIVE_CACHE_TTL_SECONDS : TMDB_CACHE_TTL_SECONDS
    try {
      await redis.set(rk, JSON.stringify(value), 'EX', ttl)
    } catch {
      // caching is best-effort
    }
  }
  return value
}

async function searchOnce(title, year, kind, apiKey) {
  const params = new URLSearchParams({ api_key: apiKey, query: title })
  const yearKey = kind === 'movie' ? 'year' : 'first_air_date_year'
  if (year) params.set(yearKey, year)
  const url = `${TMDB_BASE}/search/${kind}?${params.toString()}`
  const data = await getJson(url)
  const results = (data && data.results) || []
  return results[0] || null
}

async function search(title, year, kind, apiKey) {
  const key = `${kind}|${title.trim().toLowerCase()}|${year || ''}`
  return cachedLookup('s', cache, key, async () => {
    let result = await searchOnce(title, year, kind, apiKey)
    if (!result && year) {
      result = await searchOnce(title, null, kind, apiKey)
    }
    return result
  })
}

function posterUrl(result) {
  if (!result || !result.poster_path) return null
  return `${TMDB_IMAGE_BASE}${result.poster_path}`
}

async function getDetails(kind, tmdbId, apiKey) {
  const key = `${kind}:${tmdbId}`
  return cachedLookup('d', detailsCache, key, async () => {
    try {
      const append = kind === 'movie' ? 'images' : 'images,external_ids'
      const data = await getJson(`${TMDB_BASE}/${kind}/${tmdbId}?api_key=${apiKey}&append_to_response=${append}`)
      if (!data) return null
      const imdbId = kind === 'movie' ? data.imdb_id : data.external_ids && data.external_ids.imdb_id
      return {
        imdbId: /^tt\d+$/.test(imdbId || '') ? imdbId : null,
        images: data.images || null,
      }
    } catch {
      return null
    }
  })
}

/** Prefer a logo in the title's own language, then a language-neutral one, then English. */
function logoUrl(images, originalLanguage) {
  const logos = (images && images.logos) || []
  if (!logos.length) return null
  const byLang = (lang) => logos.find((l) => l.iso_639_1 === lang)
  const chosen = byLang(originalLanguage) || byLang(null) || byLang('en') || logos[0]
  return chosen ? `${TMDB_IMAGE_BASE}${chosen.file_path}` : null
}

async function findByImdbId(imdbId, apiKey) {
  const key = `find:${imdbId}`
  return cachedLookup('f', findCache, key, async () => {
    try {
      const url = `${TMDB_BASE}/find/${imdbId}?api_key=${apiKey}&external_source=imdb_id`
      const data = await getJson(url)
      const movie = (data && data.movie_results && data.movie_results[0]) || null
      const tv = (data && data.tv_results && data.tv_results[0]) || null
      return movie ? { kind: 'movie', result: movie } : tv ? { kind: 'tv', result: tv } : null
    } catch {
      return null
    }
  })
}

function clearCache() {
  cache.clear()
  detailsCache.clear()
  findCache.clear()
}

module.exports = { search, posterUrl, getDetails, logoUrl, findByImdbId, clearCache }
