const PTT = require('parse-torrent-title')
const { isVideo } = require('./torbox')
const { MIN_FILE_SIZE_BYTES } = require('./config')

function slugify(text) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'unknown'
}

// Piracy release groups (TamilMV, TamilBlasters, MovieRulz, TamilRockers, ...) prepend their
// site domain as a fake title, e.g. "www.1TamilMV.wtf - Real Movie Name (2024)...". PTT has no
// way to know this isn't the title, so strip it before parsing.
const SITE_PREFIX_RE = /^www\.\S+?\s*[-–—]\s*/i

function stripSitePrefixes(name) {
  let cleaned = name
  while (SITE_PREFIX_RE.test(cleaned)) {
    cleaned = cleaned.replace(SITE_PREFIX_RE, '')
  }
  return cleaned
}

/** Yield one work item per video file in a torbox/webdl mylist entry. */
function* parseWorkItems(source, entry) {
  const itemId = entry.id
  const createdAt = Date.parse(entry.created_at) || 0
  for (const f of entry.files || []) {
    const name = f.short_name || f.name || ''
    if (!isVideo(name)) continue
    if ((f.size || 0) < MIN_FILE_SIZE_BYTES) continue

    const guess = PTT.parse(stripSitePrefixes(name))
    const title = guess.title
    if (!title) continue

    const isEpisode = typeof guess.episode === 'number'
    const season = isEpisode ? (typeof guess.season === 'number' ? guess.season : 1) : null
    const episode = isEpisode ? guess.episode : null

    yield {
      source,
      itemId,
      fileId: f.id,
      filename: name,
      size: f.size,
      createdAt,
      title,
      year: guess.year || null,
      isEpisode,
      season,
      episode,
    }
  }
}

module.exports = { slugify, parseWorkItems }
