const crypto = require('crypto')
const {
  TMDB_BASE,
  TMDB_IMAGE_BASE,
  TMDB_BACKDROP_BASE,
  TMDB_CACHE_TTL_SECONDS,
  TMDB_NEGATIVE_CACHE_TTL_SECONDS,
  TYPESAFE_API_KEY,
  IMDB_SUGGEST_BASE,
} = require('./config')
const { getJson } = require('./httpUtils')
const redis = require('./redisClient')
const stats = require('./stats')
const jev = require('./jev')

const cache = new Map()
const detailsCache = new Map()
const findCache = new Map()
const multiCache = new Map()
const altCache = new Map()
const broadCache = new Map()
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

async function alternativeTitles(kind, id, apiKey) {
  return cachedLookup('alt', altCache, `${kind}|${id}`, async () => {
    try {
      const data = await getJson(`${TMDB_BASE}/${kind}/${id}/alternative_titles?api_key=${apiKey}`)
      const titles = ((data && (data.titles || data.results)) || []).map((t) => t.title)
      return [...new Set(titles)].slice(0, 15)
    } catch {
      return []
    }
  })
}

async function judge(title, year, kind, candidates, apiKey, filename) {
  if (!candidates.length) return undefined
  const alts = await Promise.all(candidates.map((r) => alternativeTitles(kind, r.id, apiKey)))
  return jev.pickCandidate(title, year, kind, candidates, alts, filename)
}

async function pickBest(allResults, title, year, kind, apiKey) {
  const results = agreeingOnSequel(allResults, title)
  const want = normalizeTitle(title)
  const exact = results.find((r) => normalizeTitle(r.title || r.name) === want)
  if (exact || !TYPESAFE_API_KEY) return exact || results[0] || null
  return (await judge(title, year, kind, results.slice(0, jev.MAX_CANDIDATES), apiKey)) || results[0] || null
}

async function searchOnce(title, year, kind, apiKey) {
  const params = new URLSearchParams({ api_key: apiKey, query: title })
  const yearKey = kind === 'movie' ? 'year' : 'first_air_date_year'
  if (year) params.set(yearKey, year)
  const url = `${TMDB_BASE}/search/${kind}?${params.toString()}`
  const data = await getJson(url)
  return pickBest((data && data.results) || [], title, year, kind, apiKey)
}

const STUDIO_PREFIX_RE =
  /^(?:marvel studios|walt disney(?: pictures| animation studios)?|dreamworks(?: animation)?|pixar)['’]?\s+(?=\S)/i

function stripStudioPrefix(title) {
  return String(title || '').replace(STUDIO_PREFIX_RE, '').trim()
}

function leadingCyrillic(title) {
  const trimmed = title.trim()
  const m = /^[Ѐ-ӿ][Ѐ-ӿ\s]*/.exec(trimmed)
  if (!m) return null
  const v = m[0].replace(/\s+(?:Сезон|Сери[ия])\s.*$/i, '').trim()
  return v && v !== trimmed ? v : null
}

function titleVariants(title, kind) {
  const variants = []
  const cyrillic = leadingCyrillic(title)
  if (cyrillic) variants.push(cyrillic)
  const aka = title.split(/\s+a\.?k\.?a\.?\s+/i)
  if (aka.length > 1) variants.push(aka[0].trim(), aka[1].trim())
  const withoutStudio = stripStudioPrefix(title)
  if (withoutStudio !== title) variants.push(withoutStudio)
  const withoutYear = title.replace(/\s+(?:19|20)\d{2}$/, '').trim()
  if (withoutYear !== title) variants.push(withoutYear)
  const partExpanded = title.replace(/\b(?:p|pt)(\d{1,2})\b/i, 'Part $1')
  if (partExpanded !== title) variants.push(partExpanded)
  const withoutFormat = title.replace(/\s+(?:3d|h?sbs|half[\s-]?sbs|full[\s-]?sbs|hou|imax)\b/gi, '').trim()
  if (withoutFormat !== title) variants.push(withoutFormat)
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
  return cachedLookup(TYPESAFE_API_KEY ? 's3' : 's2', cache, key, async () => {
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

function broadQueries(title) {
  const cleaned = title
    .replace(/^\S+\.\S+\s+-\s+/, '')
    .replace(/^\d{1,2}\s+/, '')
    .replace(/\s+-\s+[a-z]+$/i, '')
  const queries = new Set([cleaned, ...cleaned.split(/\s+a\s?k\s?a\s+/i)])
  const words = cleaned.split(/\s+/)
  for (let n = words.length - 1; n >= Math.max(1, words.length - 3); n--) queries.add(words.slice(0, n).join(' '))
  return [...queries].filter((q) => q.length > 3)
}

// Last resort: loosen the query for candidates and let Jev pick one or reject them all.
async function broadSearch(title, year, filename, kind, apiKey) {
  if (!TYPESAFE_API_KEY) return null
  return cachedLookup('broad', broadCache, `${kind}|${title.trim().toLowerCase()}|${year || ''}`, async () => {
    const pool = new Map()
    for (const query of broadQueries(title)) {
      const data = await getJson(`${TMDB_BASE}/search/${kind}?${new URLSearchParams({ api_key: apiKey, query })}`)
      for (const r of ((data && data.results) || []).slice(0, 4)) pool.set(r.id, r)
      if (pool.size >= jev.MAX_CANDIDATES) break
    }
    const candidates = [...pool.values()].slice(0, jev.MAX_CANDIDATES)
    return (await judge(title, year, kind, candidates, apiKey, filename)) || imdbSuggestionSearch(title, year, filename, kind, apiKey)
  })
}

const IMDB_KINDS = { movie: new Set(['movie', 'tvMovie']), tv: new Set(['tvSeries', 'tvMiniSeries']) }

// IMDb's autocomplete tolerates spellings TMDB search misses ("Fog Hills" -> "Fog Hill").
async function imdbSuggestionSearch(title, year, filename, kind, apiKey) {
  const query = broadQueries(title)[0] || title
  const data = await getJson(`${IMDB_SUGGEST_BASE}/${encodeURIComponent(query.toLowerCase())}.json`).catch(() => null)
  const suggestions = ((data && data.d) || []).filter((d) => /^tt\d+$/.test(d.id) && IMDB_KINDS[kind].has(d.qid))
  const found = await Promise.all(suggestions.slice(0, jev.MAX_CANDIDATES).map((d) => findByImdbId(d.id, apiKey)))
  const candidates = [...new Map(found.filter((f) => f && f.kind === kind).map((f) => [f.result.id, f.result])).values()]
  return (await judge(title, year, kind, candidates, apiKey, filename)) || null
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

async function searchMulti(query, apiKey) {
  return cachedLookup('m', multiCache, query.trim().toLowerCase(), async () => {
    try {
      const params = new URLSearchParams({ api_key: apiKey, query, include_adult: 'false' })
      const data = await getJson(`${TMDB_BASE}/search/multi?${params.toString()}`)
      return ((data && data.results) || [])
        .filter((r) => (r.media_type === 'movie' || r.media_type === 'tv') && (r.title || r.name))
        .slice(0, 8)
        .map((r) => ({
          tmdb_id: r.id,
          type: r.media_type === 'tv' ? 'series' : 'movie',
          title: r.title || r.name,
          year: yearOf(r.release_date || r.first_air_date),
          poster: posterUrl(r),
        }))
    } catch {
      return []
    }
  })
}

function clearCache() {
  cache.clear()
  detailsCache.clear()
  findCache.clear()
  multiCache.clear()
}

module.exports = { search, broadSearch, broadQueries, searchMulti, posterUrl, getDetails, findByImdbId, clearCache, normalizeTitle, titleVariants, stripStudioPrefix }
