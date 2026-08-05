const { fromGuessit } = require('./guessit')
const { fromPtt } = require('./ptt')
const { fromAnitomy } = require('./anitomy')
const { mergeParsed } = require('./merge')
const { canSkipGuessit } = require('./gate')
const { EPISODE_MARKER_RE } = require('./fallback')

const warned = new Set()

const DASH_OR_DATE_RE =
  /[\s._-][-–—][\s._-]*\d{1,3}(?=$|[\s._)\]])|\b(?:19|20)\d{2}[.\-]\d{2}[.\-]\d{2}\b/
const LEADING_LIST_NUMBER_RE = /^\d{1,3}\)/
const YEAR_RE = /\b(?:19|20)\d{2}\b/

function credibleEpisode(name) {
  return EPISODE_MARKER_RE.test(name) || DASH_OR_DATE_RE.test(name)
}

function demoteFalseEpisode(merged, name, guessit, ptt) {
  if (!merged.isEpisode || !guessit || !guessit.isEpisode) return merged
  if (!ptt || ptt.isEpisode || credibleEpisode(name)) return merged
  if (!YEAR_RE.test(name) && !LEADING_LIST_NUMBER_RE.test(name.trim())) return merged
  return { ...merged, isEpisode: false, season: null, episodes: [] }
}

function run(adapter, name) {
  try {
    return adapter(name)
  } catch (err) {
    if (!warned.has(adapter.name)) {
      warned.add(adapter.name)
      console.warn(`parse: ${adapter.name} failed on ${JSON.stringify(name)}: ${err.message}`)
    }
    return null
  }
}

function parseName(name) {
  const ptt = run(fromPtt, name)
  const anitomy = run(fromAnitomy, name)
  const skip = canSkipGuessit(name, ptt, anitomy)
  const guessit = skip ? null : run(fromGuessit, name)
  const parsed = skip ? [ptt, anitomy] : [guessit, ptt, anitomy]
  const merged = demoteFalseEpisode(mergeParsed(parsed), name, guessit, ptt)
  return { ...merged, guessit: !skip }
}

function makeParseResolver(loaded) {
  const current = new Map()
  return {
    resolve(str) {
      if (current.has(str)) return current.get(str)
      const parsed = loaded && loaded.has(str) ? loaded.get(str) : parseName(str)
      current.set(str, parsed)
      return parsed
    },
    current,
  }
}

module.exports = { parseName, makeParseResolver, DIRECT_RESOLVER: { resolve: parseName, current: null } }
