const { RPDB_BASE } = require('./config')

function posterUrl(rpdbKey, tmdbId, kind) {
  if (!rpdbKey || !tmdbId) return null
  const prefix = kind === 'movie' ? 'movie' : 'series'
  return `${RPDB_BASE}/${rpdbKey}/tmdb/poster-default/${prefix}-${tmdbId}.jpg?fallback=true`
}

function posterUrlByImdb(rpdbKey, imdbId) {
  if (!rpdbKey || !imdbId) return null
  return `${RPDB_BASE}/${rpdbKey}/imdb/poster-default/${imdbId}.jpg?fallback=true`
}

module.exports = { posterUrl, posterUrlByImdb }
