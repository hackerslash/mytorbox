const { guessit } = require('guessit-js')
const PTT = require('parse-torrent-title') // narrow fallback: guessit truncates some numeric-leading titles
const { isVideo } = require('./torbox')
const { MIN_FILE_SIZE_BYTES } = require('./config')

function slugify(text) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'unknown'
}

const SITE_PREFIX_RE = /^www\.\S+?\s*[-–—]\s*/i
const BRACKET_SITE_PREFIX_RE = /^\[\s*[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\s*\]\s*/i
// RiffTrax comedy-commentary releases prepend their own brand before the real movie title.
const RIFFTRAX_PREFIX_RE = /^rifftrax\s*[-–—:]\s*/i

const JUNK_FILE_PATTERNS = [
  /[-_]TLR-\d/i,
  /(?:^|[\s._-])sample(?:[\s._-]|\d|$)/i,
  /^\[AMV\]/i,
  /(?:^|[\s._-])(?:CM|PV|NCOP|NCED|SPDVD|Logo)[\s._-]+(?:RL[\s._-]+)?-[\s._-]*\d/i,
  /(?:^|[\s._-])animatic(?:[\s._-]|$)/i,
]

function isJunkFile(name) {
  return JUNK_FILE_PATTERNS.some((re) => re.test(name))
}

const AUDIO_CHANNELS_RE =
  /\b(DDP?|EAC3|AC3|DTS(?:[-.]?HD)?(?:[-.]?MA)?|TrueHD|THD|AAC|FLAC|LPCM|Opus|Atmos)[\s._-]*[2567][01]\b/gi
const GLUED_RESOLUTION_RE = /\b(4k|uhd)[a-z]*?(?:2160|1080)\b/gi

function stripTechnicalTokens(name) {
  return name.replace(AUDIO_CHANNELS_RE, '$1').replace(GLUED_RESOLUTION_RE, '$1')
}

const EPISODE_MARKER_RE =
  /(?:s\d{1,2}[\s._-]*e(?:p|pisode)?[\s._-]?\d{1,3}|\bs\d{1,2}\b|\be(?:p|pisode)?[\s._-]?\d{1,4}\b|\b\d{1,2}x\d{1,3}\b)/i

const SEASON_SUFFIX_RE =
  /^(.*?)[\s._-]+(?:(\d{1,2})(?:st|nd|rd|th)?[\s._-]+season|season[\s._-]+(\d{1,2})|(\d{1,2})(?:st|nd|rd|th))$/i
const FINAL_ARC_SUFFIX_RE = /^(.*?)[\s._-]+(?:kanketsu-hen|final[\s._-]+season)$/i

function splitSeasonSuffix(title) {
  const seasonMatch = SEASON_SUFFIX_RE.exec(title)
  if (seasonMatch) {
    const season = Number.parseInt(seasonMatch[2] || seasonMatch[3] || seasonMatch[4], 10)
    if (Number.isInteger(season)) return { title: seasonMatch[1].trim(), season }
  }
  const arcMatch = FINAL_ARC_SUFFIX_RE.exec(title)
  if (arcMatch) return { title: arcMatch[1].trim(), season: null }
  return { title, season: null }
}

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
    if (isJunkFile(name)) continue

    const cleanedName = stripTechnicalTokens(stripJunkPrefixes(name))
    const guess = resolver.resolve(cleanedName)

    let title = fixTruncatedNumericTitle(cleanedName, titleToString(guess.title))
    let year = guess.year || null
    let isEpisode = guess.type === 'episode'
    let explicitSeason = isEpisode ? guess.season ?? null : null
    let season = isEpisode ? guess.season || 1 : null
    let episode = isEpisode ? guess.episode ?? guess.absolute_episode ?? null : null
    if (isEpisode && episode == null) episode = dashEpisode(cleanedName, guess.season)
    if (isEpisode && episode == null) episode = looseEpisode(cleanedName)

    if (!title && entry.name) {
      if (entryGuess === undefined) entryGuess = resolver.resolve(stripJunkPrefixes(entry.name))
      title = fixTruncatedNumericTitle(entry.name, titleToString(entryGuess.title))
      year = year || entryGuess.year || null
      if (isEpisode) {
        explicitSeason = explicitSeason ?? entryGuess.season ?? null
        season = season || entryGuess.season || 1
      }
    }

    if (isEpisode && episode == null && explicitSeason == null && !EPISODE_MARKER_RE.test(cleanedName)) {
      isEpisode = false
      season = null
    }

    if (isEpisode) {
      const split = splitSeasonSuffix(title)
      title = split.title
      if (split.season != null) season = split.season
    }

    if (!title) title = titleFromFilename(name)

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
