const PTT = require('parse-torrent-title')
const { isVideo } = require('./torbox')

function slugify(text) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'unknown'
}

/** Yield one work item per video file in a torbox/webdl mylist entry. */
function* parseWorkItems(source, entry) {
  const itemId = entry.id
  for (const f of entry.files || []) {
    const name = f.short_name || f.name || ''
    if (!isVideo(name)) continue

    const guess = PTT.parse(name)
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
      title,
      year: guess.year || null,
      isEpisode,
      season,
      episode,
    }
  }
}

module.exports = { slugify, parseWorkItems }
