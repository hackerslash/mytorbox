const { stripTags } = require('./normalize')

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

function dashEpisode(name, season) {
  if (!Number.isInteger(season)) return null
  const m = new RegExp(`s0*${season}\\s*[-–—]\\s*(\\d{1,4})(?:v\\d+)?\\b`, 'i').exec(name)
  if (!m) return null
  const episode = Number.parseInt(m[1], 10)
  return Number.isInteger(episode) ? episode : null
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

module.exports = {
  EPISODE_MARKER_RE,
  splitSeasonSuffix,
  dashEpisode,
  looseEpisode,
  titleFromFilename,
}
