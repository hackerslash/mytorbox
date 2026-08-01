const DANGLING_MARKER_RE = /[\s._-][Ss]$/
const MARKER_IN_TITLE_RE = /\b[Ss]\d{1,2}[\s._-]?[Ee][Pp]?[0-9A-Za-z]/
const TRAILING_SEASON_RE = /[\s._-][Ss]\d{1,2}$/
const BARE_SEASON_RE = /^[Ss]\d{1,2}$/

function danglingTitle(title) {
  return typeof title === 'string' && DANGLING_MARKER_RE.test(title.trim())
}

function plausibleTitle(title) {
  if (typeof title !== 'string') return false
  const t = title.trim()
  if (t.length < 2) return false
  if (!/[a-z0-9]/i.test(t)) return false
  if (BARE_SEASON_RE.test(t)) return false
  if (TRAILING_SEASON_RE.test(t)) return false
  if (MARKER_IN_TITLE_RE.test(t)) return false
  return !danglingTitle(t)
}

function extendNumericTitle(title, alt) {
  const t = title.trim()
  if (!/^\d+$/.test(t) || typeof alt !== 'string') return t
  const a = alt.trim()
  return a !== t && a.startsWith(t) ? a : t
}

function pick(sources, field) {
  for (const source of sources) {
    if (source[field] != null) return source[field]
  }
  return null
}

function mergeParsed(parsed) {
  const byParser = {}
  for (const p of parsed) if (p) byParser[p.parser] = p
  const { guessit = null, ptt = null, anitomy = null } = byParser
  const ordered = [guessit, ptt, anitomy].filter(Boolean)

  let title = null
  for (const source of [guessit, anitomy, ptt]) {
    if (source && plausibleTitle(source.title)) {
      title = extendNumericTitle(source.title, ptt && ptt.title).replace(/\s+/g, ' ')
      break
    }
  }

  const year = pick(ordered, 'year')
  const trusted = ordered.filter((s) => !danglingTitle(s.title))
  let episodes = []
  for (const source of trusted) {
    const candidates = source.episodes.filter((e) => e !== year)
    if (candidates.length) {
      episodes = candidates
      break
    }
  }
  const season = pick(trusted, 'season')

  return {
    title,
    year,
    season,
    episodes,
    isEpisode: guessit ? guessit.isEpisode : season != null || episodes.length > 0,
  }
}

module.exports = { mergeParsed, plausibleTitle }
