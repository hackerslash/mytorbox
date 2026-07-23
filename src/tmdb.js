const { TMDB_BASE, TMDB_IMAGE_BASE } = require('./config')
const { getJson } = require('./httpUtils')

const cache = new Map()

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

function clearCache() {
  cache.clear()
}

module.exports = { search, posterUrl, clearCache }
