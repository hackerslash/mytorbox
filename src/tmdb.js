const { TMDB_BASE, TMDB_IMAGE_BASE } = require('./config')
const { getJson } = require('./httpUtils')

const cache = new Map()
const imagesCache = new Map()

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
  if (cache.has(key)) return cache.get(key)

  let result = await searchOnce(title, year, kind, apiKey)
  if (!result && year) {
    result = await searchOnce(title, null, kind, apiKey)
  }

  cache.set(key, result)
  return result
}

function posterUrl(result) {
  if (!result || !result.poster_path) return null
  return `${TMDB_IMAGE_BASE}${result.poster_path}`
}

async function getImages(kind, tmdbId, apiKey) {
  const key = `${kind}:${tmdbId}`
  if (imagesCache.has(key)) return imagesCache.get(key)

  let result = null
  try {
    result = await getJson(`${TMDB_BASE}/${kind}/${tmdbId}/images?api_key=${apiKey}`)
  } catch {
    result = null
  }

  imagesCache.set(key, result)
  return result
}

/** Prefer a logo in the title's own language, then a language-neutral one, then English. */
function logoUrl(images, originalLanguage) {
  const logos = (images && images.logos) || []
  if (!logos.length) return null
  const byLang = (lang) => logos.find((l) => l.iso_639_1 === lang)
  const chosen = byLang(originalLanguage) || byLang(null) || byLang('en') || logos[0]
  return chosen ? `${TMDB_IMAGE_BASE}${chosen.file_path}` : null
}

function clearCache() {
  cache.clear()
  imagesCache.clear()
}

module.exports = { search, posterUrl, getImages, logoUrl, clearCache }
