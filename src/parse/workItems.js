const { isVideo } = require('../torbox')
const { MIN_FILE_SIZE_BYTES } = require('../config')
const { cleanName, isJunkFile } = require('./normalize')
const {
  EPISODE_MARKER_RE,
  namesTheSeries,
  splitSeasonSuffix,
  dashEpisode,
  looseEpisode,
  titleFromFilename,
} = require('./fallback')
const { DIRECT_RESOLVER } = require('./resolve')

function* parseWorkItems(source, entry, resolver = DIRECT_RESOLVER) {
  const itemId = entry.id
  const createdAt = Date.parse(entry.created_at) || 0
  let entryParse

  for (const f of entry.files || []) {
    const name = f.short_name || f.name || ''
    if (!isVideo(name)) continue
    if (isJunkFile(name)) continue

    const cleaned = cleanName(name)
    const parsed = resolver.resolve(cleaned)

    let title = parsed.title
    let year = parsed.year
    let isEpisode = parsed.isEpisode
    let explicitSeason = isEpisode ? parsed.season : null
    let season = isEpisode ? parsed.season ?? 1 : null
    let episodes = isEpisode ? parsed.episodes : []

    if (isEpisode && !episodes.length) {
      const recovered = dashEpisode(cleaned, parsed.season) ?? looseEpisode(cleaned)
      if (recovered != null) episodes = [recovered]
    }

    if (isEpisode && title && entry.name && !namesTheSeries(cleaned, episodes)) {
      const entryName = cleanName(entry.name)
      if (entryParse === undefined) entryParse = resolver.resolve(entryName)
      if (entryParse.title) title = entryParse.title
    }

    if (!title && entry.name) {
      const entryName = cleanName(entry.name)
      if (entryParse === undefined) entryParse = resolver.resolve(entryName)
      title = entryParse.title
      year = year || entryParse.year
      if (isEpisode) explicitSeason = explicitSeason ?? entryParse.season
      if (!title) {
        const fromEntry = titleFromFilename(entryName)
        if (fromEntry !== 'Unknown') title = fromEntry
      }
    }

    if (isEpisode && !episodes.length && explicitSeason == null && !EPISODE_MARKER_RE.test(cleaned)) {
      isEpisode = false
      season = null
    }

    if (!title) title = titleFromFilename(name)

    if (isEpisode) {
      const split = splitSeasonSuffix(title)
      title = split.title
      if (split.season != null && parsed.season == null) season = split.season
    }

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
      episodes,
    }
  }
}

module.exports = { parseWorkItems }
