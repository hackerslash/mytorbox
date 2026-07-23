const { RPDB_BASE } = require('./config')

function posterUrl(rpdbKey, tmdbId, kind) {
  if (!rpdbKey || !tmdbId) return null
  const prefix = kind === 'movie' ? 'movie' : 'series'
  return `${RPDB_BASE}/${rpdbKey}/tmdb/poster-default/${prefix}-${tmdbId}.jpg?fallback=true`
}

module.exports = { posterUrl }
