const { plausibleTitle } = require('./merge')

const EXPLICIT_MARKER_RE = /\b[Ss]\d{1,2}[\s._-]?[Ee][Pp]?[\s._-]?\d{1,3}\b/
const MULTI_EPISODE_RE =
  /[Ss]\d{1,2}[\s._-]?[Ee][Pp]?\d{1,3}(?:[\s._-]*[-–—]?[\s._-]*[Ee][Pp]?\d{1,3}|[\s._-]*[-–—][\s._-]*\d{1,3})|\b[Ee][Pp]?\d{1,3}[\s._-]*(?:to|thru|[-–—])[\s._-]*[Ee][Pp]?\d{1,3}\b/
const RELEASE_TOKEN_RE =
  /\b(?:\d{3,4}[pi]|2160|1080|720|480|x26[45]|h\.?26[45]|hevc|avc|web-?dl|webrip|bluray|bdrip|brrip|hdtv|dvdrip|remux|ddp?5|dts|aac|ac3|atmos|hdr|dv|10bit|nf|amzn|dsnp|hmax|multi|repack|proper|complete|season|extras)\b/i
const YEAR_RE = /\b(?:19|20)\d{2}\b/
const DOTTED_RE = /[a-z]\.[a-z]/i
const MAX_TITLE_LENGTH = 48

function fold(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function titlesComplete(name, ptt, anitomy) {
  if (!plausibleTitle(ptt.title) || !plausibleTitle(anitomy.title)) return false
  if (fold(ptt.title) !== fold(anitomy.title)) return false
  for (const title of [ptt.title, anitomy.title]) {
    if (title.length > MAX_TITLE_LENGTH) return false
    if (RELEASE_TOKEN_RE.test(title) || YEAR_RE.test(title) || DOTTED_RE.test(title)) return false
  }
  const marker = EXPLICIT_MARKER_RE.exec(name)
  return marker != null && fold(name.slice(0, marker.index)) === fold(ptt.title)
}

function numbersUnambiguous(name, ptt, anitomy) {
  if (MULTI_EPISODE_RE.test(name)) return false
  if (ptt.season != null && anitomy.season != null && ptt.season !== anitomy.season) return false
  const season = ptt.season != null ? ptt.season : anitomy.season
  return season != null && (ptt.episodes.length > 0 || anitomy.episodes.length > 0)
}

function canSkipGuessit(name, ptt, anitomy) {
  if (!ptt || !anitomy) return false
  return titlesComplete(name, ptt, anitomy) && numbersUnambiguous(name, ptt, anitomy)
}

module.exports = { canSkipGuessit }
