const SITE_PREFIX_RE = /^www\.\S+?\s*[-–—]\s*/i
const BRACKET_SITE_PREFIX_RE = /^\[\s*[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\s*\]\s*/i
const RIFFTRAX_PREFIX_RE = /^rifftrax\s*[-–—:]\s*/i

const JUNK_FILE_PATTERNS = [
  /[-_]TLR-\d/i,
  /(?:^|[\s._-])sample(?:[\s._-]|\d|$)/i,
  /^\[AMV\]/i,
  /(?:^|[\s._-])(?:CM|PV|NCOP|NCED|SPDVD|Logo)[\s._-]+(?:RL[\s._-]+)?-[\s._-]*\d/i,
  /(?:^|[\s._-])animatic(?:[\s._-]|$)/i,
]

const AUDIO_CHANNELS_RE =
  /\b(DDP?|EAC3|AC3|DTS(?:[-.]?HD)?(?:[-.]?MA)?|TrueHD|THD|AAC|FLAC|LPCM|Opus|Atmos)[\s._-]*[2567][01]\b/gi
const GLUED_RESOLUTION_RE = /\b(4k|uhd)[a-z]*?(?:2160|1080)\b/gi
const GLUED_EPISODE_MARKER_RE = /([Ss]\d{1,2}[Ee]\d{1,3})(?=[A-Za-z])/g
const REPEATED_YEAR_RE = /\b((?:19|20)\d{2})[\s._-]+\1\b/g
const TECH_TOKEN =
  '\\d{3,4}[pi]|\\d{3,4}x\\d{3,4}|4k|uhd|hd|sd|bluray|blu-ray|bdrip|bdremux|brrip|dvdrip|hdrip|web|webrip|web-?dl|hdtv|remux|x26[45]|h[.\\s_-]?26[45]|hevc|avc|av1|xvid|divx|dvd|cam|ts|tc|hdr\\w*|dv|sdr|imax|proper|repack|extended|unrated|multi|dual|10bit|truehd|atmos|dts(?:-?hd)?|ac3|e?ac3|ddp?|aac|flac'
const POST_YEAR_TECH_RE = new RegExp(`^(?:${TECH_TOKEN})$`, 'i')
const PACK_INDEX_RE = /^\d{1,3}[.\s_)-]+((?:19|20)\d{2})[.\s_-]+(.+)$/
const TECH_BOUNDARY_RE = new RegExp(`[.\\s_-](?:${TECH_TOKEN})\\b`, 'i')

function slugify(text) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'unknown'
}

function isJunkFile(name) {
  return JUNK_FILE_PATTERNS.some((re) => re.test(name))
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

function stripTechnicalTokens(name) {
  return name
    .replace(REPEATED_YEAR_RE, '$1')
    .replace(AUDIO_CHANNELS_RE, '$1')
    .replace(GLUED_RESOLUTION_RE, '$1')
    .replace(GLUED_EPISODE_MARKER_RE, '$1.')
}

function stripTags(name) {
  return name
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
}

function packIndexParse(name) {
  const m = PACK_INDEX_RE.exec(stripJunkPrefixes(name).replace(/\.[a-z0-9]{2,4}$/i, ''))
  if (!m) return null
  const rest = m[2]
  const firstToken = rest.split(/[.\s_-]/, 1)[0]
  if (POST_YEAR_TECH_RE.test(firstToken)) return null
  const cut = rest.search(TECH_BOUNDARY_RE)
  const head = cut > 0 ? rest.slice(0, cut) : rest
  const title = head
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/(?<=\S)-(?=\s|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!title) return null
  return { title, year: Number.parseInt(m[1], 10) }
}

function cleanName(name) {
  return stripTechnicalTokens(stripJunkPrefixes(name))
}

module.exports = { slugify, isJunkFile, stripTechnicalTokens, stripTags, cleanName, packIndexParse }
