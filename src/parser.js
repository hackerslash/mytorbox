const { guessit } = require('guessit-js')
const PTT = require('parse-torrent-title') // narrow fallback: guessit truncates some numeric-leading titles
const { isVideo } = require('./torbox')
const { MIN_FILE_SIZE_BYTES } = require('./config')

function slugify(text) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'unknown'
}

const SITE_PREFIX_RE = /^www\.\S+?\s*[-–—]\s*/i
// Same trackers, bracketed form: "[ Torrent911.ke ] Real.Movie.2024...". The final label must be
// letters only so this can't eat an episode tag like "[S0.E05]".
const BRACKET_SITE_PREFIX_RE = /^\[\s*[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\s*\]\s*/i
// RiffTrax comedy-commentary releases prepend their own brand before the real movie title.
const RIFFTRAX_PREFIX_RE = /^rifftrax\s*[-–—:]\s*/i

function stripJunkPrefixes(name) {
  let cleaned = name
  let changed = true
  while (changed) {
    changed = false
    for (const re of [SITE_PREFIX_RE, BRACKET_SITE_PREFIX_RE, RIFFTRAX_PREFIX_RE]) {
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
function dashEpisode(name, season) {
  if (!Number.isInteger(season)) return null
  const m = new RegExp(`s0*${season}\\s*[-–—]\\s*(\\d{1,4})(?:v\\d+)?\\b`, 'i').exec(name)
  if (!m) return null
  const episode = Number.parseInt(m[1], 10)
  return Number.isInteger(episode) ? episode : null
}

function stripTags(name) {
  return name
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
}

function looseEpisode(name) {
  const stem = stripTags(name)
  const explicit = /(?:^|[\s._-])e(?:p|pisode)?[\s._-]?(\d{1,4})(?:v\d+)?(?=$|[\s._)\]-])/i.exec(stem)
  if (explicit) return Number.parseInt(explicit[1], 10)
  const dashed = /[\s._][-–—][\s._]*(\d{1,3})(?:v\d+)?(?=$|[\s._])/.exec(stem)
  return dashed ? Number.parseInt(dashed[1], 10) : null
}

function titleFromFilename(name) {
  const cleaned = stripTags(name).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || name.replace(/\.[a-z0-9]{2,4}$/i, '').trim() || 'Unknown'
}

function makeGuessResolver(loaded) {
  const current = new Map()
  return {
    resolve(str) {
      if (current.has(str)) return current.get(str)
      const g = loaded && loaded.has(str) ? loaded.get(str) : guessit(str)
      current.set(str, g)
      return g
    },
    current,
  }
}

// Default resolver: no caching, straight through to guessit.
const DIRECT_RESOLVER = { resolve: (str) => guessit(str), current: null }

/** Yield one work item per video file in a torbox/webdl mylist entry. */
function* parseWorkItems(source, entry, resolver = DIRECT_RESOLVER) {
  const itemId = entry.id
  const createdAt = Date.parse(entry.created_at) || 0
  let entryGuess // lazily parsed parent-torrent name, shared across a season pack's files

  for (const f of entry.files || []) {
    const name = f.short_name || f.name || ''
    if (!isVideo(name)) continue

    const cleanedName = stripJunkPrefixes(name)
    const guess = resolver.resolve(cleanedName)

    let title = fixTruncatedNumericTitle(cleanedName, titleToString(guess.title))
    let year = guess.year || null
    let isEpisode = guess.type === 'episode'
    let season = isEpisode ? guess.season || 1 : null
    let episode = isEpisode ? guess.episode ?? guess.absolute_episode ?? null : null
    if (isEpisode && episode == null) episode = dashEpisode(cleanedName, guess.season)
    if (isEpisode && episode == null) episode = looseEpisode(cleanedName)

    if (!title && entry.name) {
      if (entryGuess === undefined) entryGuess = resolver.resolve(stripJunkPrefixes(entry.name))
      title = fixTruncatedNumericTitle(entry.name, titleToString(entryGuess.title))
      year = year || entryGuess.year || null
      if (isEpisode) season = season || entryGuess.season || 1
    }

    if (!title) title = titleFromFilename(name)

    // The only remaining reason to skip a video file: samples, trailers and disc menus, which are
    // small and would otherwise mint junk rows. A failure to parse never costs a file — an episode
    // with no number reaches season 0 via buildLibrary, and a nameless file borrows its filename.
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

module.exports = { slugify, parseWorkItems, makeGuessResolver }
