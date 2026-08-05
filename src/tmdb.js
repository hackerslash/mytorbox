const crypto = require('crypto')
const {
  TMDB_BASE,
  TMDB_IMAGE_BASE,
  TMDB_BACKDROP_BASE,
  TMDB_CACHE_TTL_SECONDS,
  TMDB_NEGATIVE_CACHE_TTL_SECONDS,
} = require('./config')
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

function normalizeTitle(str) {
  return String(str == null ? '' : str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

const ROMAN_SEQUELS = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 }
const TRAILING_ROMAN_RE = /(viii|vii|vi|iii|ii|ix|iv|v|i)$/
const TRAILING_SEQUEL_RE = /\s(\d)$/

function trailingSequel(normalized) {
  const digits = /(\d{1,2})$/.exec(normalized)
  if (digits) return Number(digits[1])
  const roman = TRAILING_ROMAN_RE.exec(normalized)
  return roman ? ROMAN_SEQUELS[roman[1]] : null
}

function agreeingOnSequel(results, title) {
  const match = TRAILING_SEQUEL_RE.exec(title.trim())
  if (!match) return results
  const wanted = Number(match[1])
  if (wanted < 2) return results
  const agreeing = results.filter((r) => trailingSequel(normalizeTitle(r.title || r.name)) === wanted)
  return agreeing.length ? agreeing : results
}

function pickBest(allResults, title) {
  const results = agreeingOnSequel(allResults, title)
  const want = normalizeTitle(title)
  return results.find((r) => normalizeTitle(r.title || r.name) === want) || results[0] || null
}

async function searchOnce(title, year, kind, apiKey) {
  const params = new URLSearchParams({ api_key: apiKey, query: title })
  const yearKey = kind === 'movie' ? 'year' : 'first_air_date_year'
  if (year) params.set(yearKey, year)
  const url = `${TMDB_BASE}/search/${kind}?${params.toString()}`
  const data = await getJson(url)
  return pickBest((data && data.results) || [], title)
}

const STUDIO_PREFIX_RE =
  /^(?:marvel studios|walt disney(?: pictures| animation studios)?|dreamworks(?: animation)?|pixar)['’]?\s+(?=\S)/i

function stripStudioPrefix(title) {
  return String(title || '').replace(STUDIO_PREFIX_RE, '').trim()
}

function titleVariants(title, kind) {
  const variants = []
  const aka = title.split(/\s+a\.?k\.?a\.?\s+/i)
  if (aka.length > 1) variants.push(aka[0].trim(), aka[1].trim())
  const withoutStudio = stripStudioPrefix(title)
  if (withoutStudio !== title) variants.push(withoutStudio)
  const withoutYear = title.replace(/\s+(?:19|20)\d{2}$/, '').trim()
  if (withoutYear !== title) variants.push(withoutYear)
  if (kind === 'tv') {
    const withoutTrailingNumber = title.replace(/\s+\d{1,2}$/, '').trim()
    if (withoutTrailingNumber !== title && withoutTrailingNumber.length > 3) {
      variants.push(withoutTrailingNumber)
    }
  }
  return [...new Set(variants.filter((v) => v && v !== title))]
}

async function search(title, year, kind, apiKey) {
  const key = `${kind}|${title.trim().toLowerCase()}|${year || ''}`
  return cachedLookup('s2', cache, key, async () => {
    const want = normalizeTitle(title)
    let result = await searchOnce(title, year, kind, apiKey)

    if (year && result) {
      const got = normalizeTitle(result.title || result.name)
      if (got !== want && got.startsWith(want)) {
        const unfiltered = await searchOnce(title, null, kind, apiKey)
        if (unfiltered && normalizeTitle(unfiltered.title || unfiltered.name) === want) result = unfiltered
      }
    }

    if (!result && year) result = await searchOnce(title, null, kind, apiKey)

    if (!result) {
      for (const variant of titleVariants(title, kind)) {
        result = await searchOnce(variant, year, kind, apiKey)
        if (!result && year) result = await searchOnce(variant, null, kind, apiKey)
        if (result) break
      }
    }
    return result
  })
}

function posterUrl(result) {
  if (!result || !result.poster_path) return null
  return `${TMDB_IMAGE_BASE}${result.poster_path}`
}

/** Prefer a logo in the title's own language, then a language-neutral one, then English. */
function logoUrl(images, originalLanguage) {
  const logos = (images && images.logos) || []
  if (!logos.length) return null
  const byLang = (lang) => logos.find((l) => l.iso_639_1 === lang)
  const chosen = byLang(originalLanguage) || byLang(null) || byLang('en') || logos[0]
  return chosen ? `${TMDB_IMAGE_BASE}${chosen.file_path}` : null
}

function backdropUrls(images) {
  const backdrops = (images && images.backdrops) || []
  const neutral = backdrops.filter((b) => b.iso_639_1 === null)
  const ordered = neutral.length ? neutral : backdrops
  if (!ordered.length) return [null, null]
  const toUrl = (b) => `${TMDB_BACKDROP_BASE}${b.file_path}`
  return [toUrl(ordered[0]), toUrl(ordered[1] || ordered[0])]
}

function formatRuntime(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest}min`
  return rest ? `${hours}h${rest}min` : `${hours}h`
}

function yearOf(date) {
  return typeof date === 'string' && date.length >= 4 ? date.slice(0, 4) : null
}

async function getDetails(kind, tmdbId, apiKey) {
  const key = `${kind}:${tmdbId}`
  return cachedLookup('d2', detailsCache, key, async () => {
    try {
      const append = kind === 'movie' ? 'images' : 'images,external_ids'
      const data = await getJson(`${TMDB_BASE}/${kind}/${tmdbId}?api_key=${apiKey}&append_to_response=${append}`)
      if (!data) return null

      const details = {}
      const imdbId = kind === 'movie' ? data.imdb_id : data.external_ids && data.external_ids.imdb_id
      if (/^tt\d+$/.test(imdbId || '')) details.imdbId = imdbId

      const logo = logoUrl(data.images, data.original_language)
      if (logo) details.logo = logo

      const [background, landscapePoster] = backdropUrls(data.images)
      if (background) details.background = background
      if (landscapePoster) details.landscapePoster = landscapePoster

      const genres = (data.genres || []).map((g) => g.name).filter(Boolean)
      if (genres.length) details.genres = genres

      const runtime = formatRuntime(kind === 'movie' ? data.runtime : (data.episode_run_time || [])[0])
      if (runtime) details.runtime = runtime

      if (kind !== 'movie') {
        const endYear = yearOf(data.last_air_date)
        if (endYear) details.endYear = endYear
        if (data.in_production) details.inProduction = true
      }
      return details
    } catch {
      return null
    }
  })
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

module.exports = { search, posterUrl, getDetails, findByImdbId, clearCache, normalizeTitle, titleVariants, stripStudioPrefix }
