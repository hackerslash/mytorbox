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
// RiffTrax comedy-commentary releases prepend their own brand before the real movie title.
const RIFFTRAX_PREFIX_RE = /^rifftrax\s*[-–—:]\s*/i
// Anime fansub groups prefix a bracketed release-group tag, e.g. "[SubsPlease] Title - 01...".
// The negative lookahead avoids eating a bracketed year like "[2024] Movie.mkv".
const GROUP_TAG_RE = /^\[(?!\d+\])[^\]]+\]\s*/
// Anime Music Videos have no real "movie" title (it's an artist/song, not a film) — skip entirely.
const AMV_TAG_RE = /^\[amv\]/i

function stripJunkPrefixes(name) {
  let cleaned = name
  let changed = true
  while (changed) {
    changed = false
    for (const re of [SITE_PREFIX_RE, RIFFTRAX_PREFIX_RE, GROUP_TAG_RE]) {
      if (re.test(cleaned)) {
        cleaned = cleaned.replace(re, '')
        changed = true
      }
    }
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
    if (AMV_TAG_RE.test(name.trim())) continue

    const guess = PTT.parse(stripJunkPrefixes(name))
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
