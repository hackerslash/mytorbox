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

function cleanName(name) {
  return stripTechnicalTokens(stripJunkPrefixes(name))
}

module.exports = { slugify, isJunkFile, stripTechnicalTokens, stripTags, cleanName }
