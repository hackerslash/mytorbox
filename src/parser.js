const { guessit } = require('guessit-js')
const PTT = require('parse-torrent-title') // narrow fallback: guessit truncates some numeric-leading titles
const { isVideo } = require('./torbox')
const { MIN_FILE_SIZE_BYTES } = require('./config')

function slugify(text) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'unknown'
}

// Piracy release groups (TamilMV, TamilBlasters, MovieRulz, TamilRockers, ...) prepend their
// site domain as a fake title, e.g. "www.1TamilMV.wtf - Real Movie Name (2024)...". guessit has
// no way to know this isn't the title, so strip it before parsing.
const SITE_PREFIX_RE = /^www\.\S+?\s*[-–—]\s*/i
// RiffTrax comedy-commentary releases prepend their own brand before the real movie title.
const RIFFTRAX_PREFIX_RE = /^rifftrax\s*[-–—:]\s*/i
// Anime Music Videos have no real "movie" title (it's an artist/song, not a film) — skip entirely.
const AMV_TAG_RE = /^\[amv\]/i

function stripJunkPrefixes(name) {
  let cleaned = name
  let changed = true
  while (changed) {
    changed = false
    for (const re of [SITE_PREFIX_RE, RIFFTRAX_PREFIX_RE]) {
      if (re.test(cleaned)) {
        cleaned = cleaned.replace(re, '')
        changed = true
      }
    }
  }
  return cleaned
}

// Despite its own types claiming `title?: string`, guessit-js frequently returns an array
// (e.g. ["Apocalypse Now", "Final Cut"]) when it can't cleanly separate the title from a
// trailing fragment like an edition or language name. The first element is always the title.
function titleToString(title) {
  return Array.isArray(title) ? title[0] : title
}

/** guessit sometimes truncates a numbered title to just the number (e.g. "10 Things I Hate
 * About You" -> "10"). parse-torrent-title doesn't share that bug, so cross-check and prefer
 * its title only when it plausibly extends the same number. */
function fixTruncatedNumericTitle(cleanedName, title) {
  if (!title || !/^\d+$/.test(title.trim())) return title
  const alt = titleToString(PTT.parse(cleanedName).title)
  if (alt && alt.trim() !== title.trim() && alt.trim().startsWith(title.trim())) {
    return alt.trim()
  }
  return title
}

/** Yield one work item per video file in a torbox/webdl mylist entry. */
function* parseWorkItems(source, entry) {
  const itemId = entry.id
  const createdAt = Date.parse(entry.created_at) || 0
  let entryGuess // lazily parsed parent-torrent name, shared across a season pack's files

  for (const f of entry.files || []) {
    const name = f.short_name || f.name || ''
    if (!isVideo(name)) continue
    if (AMV_TAG_RE.test(name.trim())) continue

    const cleanedName = stripJunkPrefixes(name)
    const guess = guessit(cleanedName)

    let title = fixTruncatedNumericTitle(cleanedName, titleToString(guess.title))
    let year = guess.year || null
    let isEpisode = guess.type === 'episode'
    let season = isEpisode ? guess.season || 1 : null
    let episode = isEpisode ? guess.episode ?? guess.absolute_episode ?? null : null

    // Season-pack files sometimes have no show name at all (e.g. "01. Episode Title.mkv") —
    // the real title only lives on the parent torrent/webdl entry.
    if (isEpisode && !title && entry.name) {
      if (entryGuess === undefined) entryGuess = guessit(stripJunkPrefixes(entry.name))
      title = fixTruncatedNumericTitle(entry.name, titleToString(entryGuess.title))
      year = year || entryGuess.year || null
      season = season || entryGuess.season || 1
    }

    if (!title) continue
    if (isEpisode && episode == null) continue
    if (!isEpisode && (f.size || 0) < MIN_FILE_SIZE_BYTES) continue

    yield {
      source,
      itemId,
      fileId: f.id,
      filename: name,
      size: f.size,
      createdAt,
      title,
      year,
      isEpisode,
      season,
      episode,
    }
  }
}

module.exports = { slugify, parseWorkItems }
