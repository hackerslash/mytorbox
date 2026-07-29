const rpdb = require('./rpdb')
const { MAX_POSTER_URL_LENGTH } = require('./config')

const IMDB_TOKEN = '{imdb_id}'
const IMDB_ID_RE = /^tt\d+$/

function posterUrlProblem(pattern) {
  const trimmed = typeof pattern === 'string' ? pattern.trim() : ''
  if (!trimmed) return 'Must be a URL'
  if (!trimmed.includes(IMDB_TOKEN)) return `Must contain ${IMDB_TOKEN}`
  if (trimmed.length > MAX_POSTER_URL_LENGTH) return `Must be under ${MAX_POSTER_URL_LENGTH} characters`
  if (/[\s"'<>]/.test(trimmed)) return 'Must not contain spaces or quotes'
  let url
  try {
    url = new URL(trimmed.replaceAll(IMDB_TOKEN, 'tt0000000'))
  } catch {
    return 'Must be a valid http(s) URL'
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? null : 'Must be a valid http(s) URL'
}

function resolveProvider(posterUrl, rpdbKey) {
  if (!posterUrlProblem(posterUrl)) return { type: 'url', pattern: posterUrl.trim() }
  if (rpdbKey) return { type: 'rpdb', key: rpdbKey }
  return null
}

function byImdb(provider, imdbId) {
  if (!provider || !IMDB_ID_RE.test(imdbId)) return null
  if (provider.type === 'url') return provider.pattern.replaceAll(IMDB_TOKEN, imdbId)
  return rpdb.posterUrlByImdb(provider.key, imdbId)
}

function byTmdb(provider, tmdbId, kind) {
  if (!provider || provider.type !== 'rpdb') return null
  return rpdb.posterUrl(provider.key, tmdbId, kind)
}

module.exports = { posterUrlProblem, resolveProvider, byImdb, byTmdb }
