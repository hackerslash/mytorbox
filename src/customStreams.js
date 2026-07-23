const crypto = require('crypto')
const redis = require('./redisClient')
const { slugify } = require('./parser')
const validators = require('./validators')
const {
  CUSTOM_STREAM_DEFAULT_TTL_MS,
  CUSTOM_STREAM_MIN_TTL_MS,
  CUSTOM_STREAM_MAX_TTL_MS,
  MAX_CUSTOM_STREAMS_PER_KEY,
  MAX_STREAM_URL_LENGTH,
  CUSTOM_STREAM_VERIFY_TTL_SECONDS,
} = require('./config')

function clampTtlMs(ttlMs) {
  if (!Number.isFinite(ttlMs)) return CUSTOM_STREAM_DEFAULT_TTL_MS
  return Math.min(Math.max(ttlMs, CUSTOM_STREAM_MIN_TTL_MS), CUSTOM_STREAM_MAX_TTL_MS)
}

function userKeyFor(torboxKey, tmdbKey, rpdbKey) {
  return crypto.createHash('sha256').update(`${torboxKey}|${tmdbKey}|${rpdbKey || ''}`).digest('hex')
}

function entryKey(userKey, entryId) {
  return `cs:entry:${userKey}:${entryId}`
}

function idxKey(userKey) {
  return `cs:idx:${userKey}`
}

function isValidImdbId(id) {
  return typeof id === 'string' && /^tt\d+$/.test(id)
}

function isValidStreamUrl(url) {
  return typeof url === 'string' && url.length <= MAX_STREAM_URL_LENGTH && /^https?:\/\/.+/i.test(url)
}


async function isVerifiedUser(uKey, torboxKey, tmdbKey) {
  const vKey = `cs:verified:${uKey}`
  const cached = await redis.get(vKey)
  if (cached === '1') return true

  const [torbox, tmdbCheck] = await Promise.all([
    validators.checkTorbox(torboxKey),
    validators.checkTmdb(tmdbKey),
  ])
  const ok = torbox.valid && tmdbCheck.valid
  if (ok) await redis.set(vKey, '1', 'EX', CUSTOM_STREAM_VERIFY_TTL_SECONDS)
  return ok
}

// Entries without an IMDb id (content TorBox/TMDB has no listing for) still need a stable
// key to group multiple sources under one catalog item — derive one from the title instead.
function groupKeyFor(imdbId, title) {
  return imdbId || `noimdb-${slugify(title || 'untitled')}`
}

async function addCustomStream(torboxKey, tmdbKey, rpdbKey, entry) {
  if (!redis) return null

  const uKey = userKeyFor(torboxKey, tmdbKey, rpdbKey)
  const idx = idxKey(uKey)

  try {
    if (!(await isVerifiedUser(uKey, torboxKey, tmdbKey))) return null

    const now = Date.now()
    await redis.zremrangebyscore(idx, 0, now)
    const count = await redis.zcard(idx)
    if (count >= MAX_CUSTOM_STREAMS_PER_KEY) return null

    const ttlMs = clampTtlMs(entry.ttlMs)
    const ttlSeconds = Math.floor(ttlMs / 1000)

    const id = crypto.randomUUID()
    const expiresAt = now + ttlMs
    const stored = {
      id,
      type: entry.type,
      imdbId: entry.imdbId || null,
      groupKey: groupKeyFor(entry.imdbId, entry.title),
      season: entry.type === 'series' ? entry.season : null,
      episode: entry.type === 'series' ? entry.episode : null,
      streamUrl: entry.streamUrl,
      title: entry.title || null,
      createdAt: now,
      expiresAt,
    }

    await redis.set(entryKey(uKey, id), JSON.stringify(stored), 'EX', ttlSeconds)
    await redis.zadd(idx, expiresAt, id)
    await redis.expire(idx, ttlSeconds + 60)

    return stored
  } catch (err) {
    console.warn('customStreams: addCustomStream failed:', err.message)
    return null
  }
}

async function listCustomStreams(torboxKey, tmdbKey, rpdbKey) {
  if (!redis) return []

  const uKey = userKeyFor(torboxKey, tmdbKey, rpdbKey)
  const idx = idxKey(uKey)

  try {
    const now = Date.now()
    await redis.zremrangebyscore(idx, 0, now)
    const ids = await redis.zrange(idx, 0, -1)
    if (!ids.length) return []

    const keys = ids.map((id) => entryKey(uKey, id))
    const raw = await redis.mget(...keys)

    const entries = []
    const staleIds = []
    raw.forEach((val, i) => {
      if (!val) {
        staleIds.push(ids[i])
        return
      }
      entries.push(JSON.parse(val))
    })

    if (staleIds.length) await redis.zrem(idx, ...staleIds)

    return entries.sort((a, b) => b.createdAt - a.createdAt)
  } catch (err) {
    console.warn('customStreams: listCustomStreams failed:', err.message)
    return []
  }
}

async function removeCustomStream(torboxKey, tmdbKey, rpdbKey, entryId) {
  if (!redis) return false

  const uKey = userKeyFor(torboxKey, tmdbKey, rpdbKey)
  const idx = idxKey(uKey)

  try {
    const deleted = await redis.del(entryKey(uKey, entryId))
    await redis.zrem(idx, entryId)
    return deleted > 0
  } catch (err) {
    console.warn('customStreams: removeCustomStream failed:', err.message)
    return false
  }
}

module.exports = {
  addCustomStream,
  listCustomStreams,
  removeCustomStream,
  isValidImdbId,
  isValidStreamUrl,
}
