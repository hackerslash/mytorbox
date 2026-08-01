const crypto = require('crypto')
const redis = require('./redisClient')
const {
  STATS_ENABLED,
  STATS_TTL_SECONDS,
  STATS_RETENTION_DAYS,
  STATS_FLUSH_MS,
  STATS_USER_THROTTLE_MS,
  STATS_SUMMARY_TTL_SECONDS,
  STATS_SCAN_LIMIT,
  STATS_HOURLY_TTL_SECONDS,
  STATS_TOP_LIBRARIES,
  STATS_LIBRARY_SAMPLE_LIMIT,
  STATS_UA_SAMPLE_LIMIT,
  STATS_UA_MAX_LENGTH,
} = require('./config')

const NS = 'st'
const SUMMARY_KEY = `${NS}:summary`

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

const LATENCY_SUM = 'ms'
const LATENCY_COUNT = 'msn'

function enabled() {
  return Boolean(redis) && STATS_ENABLED
}

function dayId(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10)
}

function hourId(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 13)
}

function recentDays(n, ts = Date.now()) {
  return Array.from({ length: n }, (_, i) => dayId(ts - (n - 1 - i) * DAY_MS))
}

function recentHours(n, ts = Date.now()) {
  return Array.from({ length: n }, (_, i) => hourId(ts - (n - 1 - i) * HOUR_MS))
}

function counterKey(event, day) {
  return `${NS}:c:${event}:${day}`
}

function hourlyKey(event, hour) {
  return `${NS}:h:${event}:${hour}`
}

function usersKey(day) {
  return `${NS}:u:${day}`
}

function uaSampleKey(day) {
  return `${NS}:uaraw:${day}`
}

function firstSeenKey(userHash) {
  return `${NS}:first:${userHash}`
}

function libraryKey(userHash) {
  return `${NS}:lib:${userHash}`
}

function userHash(keys) {
  if (!keys || !keys.torboxKey || !keys.tmdbKey) return null
  return crypto
    .createHash('sha256')
    .update(`${keys.torboxKey}|${keys.tmdbKey}|`)
    .digest('hex')
}

const pending = new Map()
let flushTimer = null
let flushing = null

// A day/hour counter only needs its TTL set once, not on every flush — this halves the
// commands per flush. Day keys are never rewritten after their day ends, so a key can't
// outlive its TTL and come back untracked.
const ttlSet = new Set()
let ttlSetDay = null

function ttlFor(key) {
  return key.startsWith(`${NS}:h:`) ? STATS_HOURLY_TTL_SECONDS : STATS_TTL_SECONDS
}

function needsTtl(key) {
  const day = dayId()
  if (day !== ttlSetDay) {
    ttlSet.clear()
    ttlSetDay = day
  }
  if (ttlSet.has(key)) return false
  ttlSet.add(key)
  return true
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => { flush() }, STATS_FLUSH_MS)
  if (flushTimer.unref) flushTimer.unref()
}

function queue(key, by) {
  pending.set(key, (pending.get(key) || 0) + by)
  scheduleFlush()
}

const pendingUa = new Map()

function cleanUa(ua) {
  return ua.replace(/[^\x20-\x7e]/g, '').replace(/ {2,}/g, ' ').trim().slice(0, STATS_UA_MAX_LENGTH)
}

function trackUserAgent(ua) {
  if (!enabled() || typeof ua !== 'string') return
  const cleaned = cleanUa(ua)
  if (!cleaned) return
  if (!pendingUa.has(cleaned) && pendingUa.size >= STATS_UA_SAMPLE_LIMIT) {
    track('uasample:capped')
    return
  }
  pendingUa.set(cleaned, (pendingUa.get(cleaned) || 0) + 1)
  scheduleFlush()
}

async function flushUa() {
  if (!pendingUa.size) return
  const batch = [...pendingUa]
  pendingUa.clear()
  const key = uaSampleKey(dayId())
  try {
    const known = new Set(await redis.hkeys(key))
    let room = STATS_UA_SAMPLE_LIMIT - known.size
    let dropped = 0
    const pipe = redis.pipeline()
    for (const [ua, by] of batch) {
      if (!known.has(ua)) {
        if (room <= 0) {
          dropped += by
          continue
        }
        room--
      }
      pipe.hincrby(key, ua, by)
    }
    pipe.expire(key, STATS_TTL_SECONDS)
    await pipe.exec()
    if (dropped) track('uasample:capped', dropped)
  } catch (err) {
    console.warn('stats: ua sample flush failed:', err.message)
  }
}

async function readUaSamples(day) {
  try {
    const raw = await redis.hgetall(uaSampleKey(day))
    return Object.entries(raw || {})
      .map(([ua, count]) => ({ ua, count: num(count) }))
      .sort((a, b) => b.count - a.count)
  } catch {
    return []
  }
}

async function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!redis) {
    pending.clear()
    pendingUa.clear()
    return
  }
  await flushUa()
  if (!pending.size) return
  const batch = [...pending]
  pending.clear()
  const pipe = redis.pipeline()
  const ops = []
  for (const [key, by] of batch) {
    pipe.incrby(key, by)
    ops.push(null)
    if (needsTtl(key)) {
      pipe.expire(key, ttlFor(key))
      ops.push(key)
    }
  }
  try {
    const replies = await pipe.exec()
    if (Array.isArray(replies)) {
      replies.forEach((reply, i) => {
        if (ops[i] && Array.isArray(reply) && reply[0]) ttlSet.delete(ops[i])
      })
    }
  } catch (err) {
    for (const key of ops) if (key) ttlSet.delete(key)
    console.warn('stats: flush failed, dropping', batch.length, 'counters:', err.message)
  }
}

async function flushNow() {
  if (!enabled()) return
  if (flushing) await flushing.catch(() => {})
  flushing = flush()
  await flushing.catch(() => {})
  flushing = null
}

function track(event, by = 1) {
  if (!enabled() || !by) return
  queue(counterKey(event, dayId()), by)
}

function trackHourly(event, by = 1) {
  if (!enabled() || !by) return
  const now = Date.now()
  queue(counterKey(event, dayId(now)), by)
  queue(hourlyKey(event, hourId(now)), by)
}

function trackDuration(event, ms) {
  if (!enabled() || !Number.isFinite(ms)) return
  const day = dayId()
  queue(counterKey(`${LATENCY_SUM}:${event}`, day), Math.max(0, Math.round(ms)))
  queue(counterKey(`${LATENCY_COUNT}:${event}`, day), 1)
}

const recentUsers = new Map()
const MAX_RECENT_USERS = 5000

function throttled(hash) {
  const now = Date.now()
  const last = recentUsers.get(hash)
  if (last && now - last < STATS_USER_THROTTLE_MS) return true
  if (recentUsers.size >= MAX_RECENT_USERS) recentUsers.clear()
  recentUsers.set(hash, now)
  return false
}

async function markUser(hash) {
  const day = dayId()
  const added = await redis.pfadd(usersKey(day), hash)
  if (added === 1) await redis.expire(usersKey(day), STATS_TTL_SECONDS)
  const isNew = await redis.set(firstSeenKey(hash), Date.now(), 'EX', STATS_TTL_SECONDS, 'NX')
  if (isNew) track('users:new')
}

function trackUser(keys) {
  if (!enabled()) return
  const hash = userHash(keys)
  if (!hash || throttled(hash)) return
  markUser(hash).catch(() => {})
}

async function writeLibraryShape(hash, shape) {
  const pipe = redis.pipeline()
  pipe.hset(libraryKey(hash), shape)
  pipe.expire(libraryKey(hash), STATS_TTL_SECONDS)
  await pipe.exec()
}

function trackLibraryShape(hash, lib, buildMs) {
  if (!enabled() || !hash || !lib) return
  const streamIds = Object.keys(lib.streams || {})
  const episodes = streamIds.filter((id) => /:\d+:\d+$/.test(id)).length
  const streams = streamIds.reduce((n, id) => n + (lib.streams[id] || []).length, 0)
  const shape = {
    movies: (lib.movies || []).length,
    series: (lib.series || []).length,
    episodes,
    streams,
    updatedAt: Date.now(),
  }
  if (Number.isFinite(buildMs)) shape.buildMs = Math.round(buildMs)
  writeLibraryShape(hash, shape).catch(() => {})
}

async function scanKeys(match, limit = STATS_SCAN_LIMIT) {
  const keys = []
  let cursor = '0'
  let truncated = false
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', match, 'COUNT', 500)
    cursor = next
    for (const k of batch) keys.push(k)
    if (keys.length >= limit) {
      truncated = true
      break
    }
  } while (cursor !== '0')
  return { keys, truncated }
}

async function mgetAll(keys) {
  const out = new Map()
  for (let i = 0; i < keys.length; i += 400) {
    const slice = keys.slice(i, i + 400)
    const values = await redis.mget(...slice)
    slice.forEach((k, j) => out.set(k, values[j]))
  }
  return out
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function sumWindow(byDay, days) {
  return days.reduce((n, d) => n + num(byDay[d]), 0)
}

function splitStatsKey(key) {
  const lastColon = key.lastIndexOf(':')
  if (lastColon === -1) return null
  const bucket = key.slice(lastColon + 1)
  const event = key.slice(0, lastColon).split(':').slice(2).join(':')
  if (!event || !bucket) return null
  return { event, bucket }
}

const KEYSPACE_GROUPS = [
  { name: 'library', match: 'lib:*' },
  { name: 'libraryParts', match: 'libp:*' },
  { name: 'parseCache', match: 'pc2:*' },
  { name: 'customStreams', match: 'cs:*' },
  { name: 'rateLimit', match: 'rl:*' },
  { name: 'stats', match: `${NS}:*` },
]

async function readInfo() {
  try {
    const raw = await redis.info()
    const fields = {}
    for (const line of String(raw).split('\n')) {
      const idx = line.indexOf(':')
      if (idx === -1) continue
      fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
    return {
      version: fields.redis_version || null,
      usedMemory: fields.used_memory_human || null,
      peakMemory: fields.used_memory_peak_human || null,
      connectedClients: fields.connected_clients ? num(fields.connected_clients) : null,
      uptimeDays: fields.uptime_in_days ? num(fields.uptime_in_days) : null,
      keyspaceHits: fields.keyspace_hits ? num(fields.keyspace_hits) : null,
      keyspaceMisses: fields.keyspace_misses ? num(fields.keyspace_misses) : null,
      evictedKeys: fields.evicted_keys ? num(fields.evicted_keys) : null,
    }
  } catch {
    return null
  }
}

function windowsFor(byDay, days) {
  const today = days[days.length - 1]
  return {
    today: num(byDay[today]),
    d7: sumWindow(byDay, days.slice(-7)),
    d30: sumWindow(byDay, days),
  }
}

async function uniqueUsers(days, availableDays) {
  const count = async (window) => {
    const keys = window.filter((d) => availableDays.has(d)).map(usersKey)
    if (!keys.length) return 0
    try {
      return num(await redis.pfcount(...keys))
    } catch {
      return 0
    }
  }
  const [today, d7, d30] = await Promise.all([
    count(days.slice(-1)),
    count(days.slice(-7)),
    count(days),
  ])
  const daily = await Promise.all(days.map((d) => (availableDays.has(d) ? count([d]) : 0)))
  return { today, d7, d30, daily }
}

async function readLibraryShapes(keys) {
  const sampled = keys.slice(0, STATS_LIBRARY_SAMPLE_LIMIT)
  const empty = {
    users: 0, tracked: keys.length, sampled: sampled.length,
    truncated: sampled.length < keys.length,
    movies: 0, series: 0, episodes: 0, streams: 0, top: [],
  }
  const pipe = redis.pipeline()
  for (const k of sampled) pipe.hgetall(k)
  let replies = []
  try {
    replies = await pipe.exec()
  } catch {
    return empty
  }
  const rows = []
  replies.forEach(([err, val], i) => {
    if (err || !val || !Object.keys(val).length) return
    rows.push({
      user: sampled[i].slice(`${NS}:lib:`.length, `${NS}:lib:`.length + 8),
      movies: num(val.movies),
      series: num(val.series),
      episodes: num(val.episodes),
      streams: num(val.streams),
      buildMs: val.buildMs ? num(val.buildMs) : null,
      updatedAt: num(val.updatedAt) || null,
    })
  })
  const total = (field) => rows.reduce((n, r) => n + r[field], 0)
  return {
    ...empty,
    users: rows.length,
    movies: total('movies'),
    series: total('series'),
    episodes: total('episodes'),
    streams: total('streams'),
    top: [...rows]
      .sort((a, b) => b.movies + b.episodes - (a.movies + a.episodes))
      .slice(0, STATS_TOP_LIBRARIES),
  }
}

function uaBreakdown(counters) {
  const rows = Object.entries(counters)
    .filter(([event]) => event.startsWith('ua:'))
    .map(([event, value]) => [event.slice(3), value])
  const share = (window) => {
    const total = rows.reduce((n, [, v]) => n + num(v[window]), 0)
    const byClient = {}
    for (const [name, v] of [...rows].sort((a, b) => num(b[1][window]) - num(a[1][window]))) {
      const count = num(v[window])
      byClient[name] = { count, pct: total ? Math.round((1000 * count) / total) / 10 : 0 }
    }
    return { total, byClient }
  }
  return { today: share('today'), d7: share('d7'), d30: share('d30') }
}

async function buildSummary() {
  const startedAt = Date.now()
  const days = recentDays(STATS_RETENTION_DAYS)
  const hours = recentHours(24)

  const scanned = await Promise.all(KEYSPACE_GROUPS.map((g) => scanKeys(g.match)))
  const groups = {}
  let truncated = false
  let statsKeys = []
  KEYSPACE_GROUPS.forEach((g, i) => {
    groups[g.name] = scanned[i].keys
    truncated = truncated || scanned[i].truncated
    if (g.name === 'stats') statsKeys = scanned[i].keys
  })

  const counterKeys = statsKeys.filter((k) => k.startsWith(`${NS}:c:`))
  const hourlyKeys = statsKeys.filter((k) => k.startsWith(`${NS}:h:`))
  const userDayKeys = statsKeys.filter((k) => k.startsWith(`${NS}:u:`))
  const libShapeKeys = statsKeys.filter((k) => k.startsWith(`${NS}:lib:`))
  const firstSeenKeys = statsKeys.filter((k) => k.startsWith(`${NS}:first:`))

  const counterValues = await mgetAll(counterKeys)
  const hourlyValues = await mgetAll(hourlyKeys.filter((k) => {
    const parts = splitStatsKey(k)
    return parts && hours.includes(parts.bucket)
  }))

  const byEvent = {}
  for (const [key, value] of counterValues) {
    const parts = splitStatsKey(key)
    if (!parts) continue
    if (!byEvent[parts.event]) byEvent[parts.event] = {}
    byEvent[parts.event][parts.bucket] = num(value)
  }
  const hourlyByEvent = {}
  for (const [key, value] of hourlyValues) {
    const parts = splitStatsKey(key)
    if (!parts) continue
    if (!hourlyByEvent[parts.event]) hourlyByEvent[parts.event] = {}
    hourlyByEvent[parts.event][parts.bucket] = num(value)
  }

  const counters = {}
  const latency = {}
  for (const [event, byDay] of Object.entries(byEvent)) {
    if (event.startsWith(`${LATENCY_SUM}:`) || event.startsWith(`${LATENCY_COUNT}:`)) continue
    counters[event] = { ...windowsFor(byDay, days), daily: days.map((d) => num(byDay[d])) }
  }
  for (const event of Object.keys(byEvent)) {
    if (!event.startsWith(`${LATENCY_SUM}:`)) continue
    const name = event.slice(LATENCY_SUM.length + 1)
    const sums = windowsFor(byEvent[event], days)
    const counts = windowsFor(byEvent[`${LATENCY_COUNT}:${name}`] || {}, days)
    latency[name] = {
      avgToday: counts.today ? Math.round(sums.today / counts.today) : null,
      avg7d: counts.d7 ? Math.round(sums.d7 / counts.d7) : null,
      avg30d: counts.d30 ? Math.round(sums.d30 / counts.d30) : null,
      samples30d: counts.d30,
    }
  }

  const availableUserDays = new Set(userDayKeys.map((k) => k.slice(`${NS}:u:`.length)))
  const unique = await uniqueUsers(days, availableUserDays)
  const library = await readLibraryShapes(libShapeKeys)

  const csKeys = groups.customStreams || []
  const rlKeys = groups.rateLimit || []
  const rateLimitIps = {}
  for (const k of rlKeys) {
    const bucket = k.split(':')[1] || 'unknown'
    rateLimitIps[bucket] = (rateLimitIps[bucket] || 0) + 1
  }

  let dbsize = null
  try {
    dbsize = num(await redis.dbsize())
  } catch {
    dbsize = null
  }
  const info = await readInfo()

  const counted =
    (groups.library || []).length +
    (groups.libraryParts || []).length +
    (groups.parseCache || []).length +
    csKeys.length +
    rlKeys.length +
    statsKeys.length
  const newUsers = counters['users:new'] || { today: 0, d7: 0, d30: 0, daily: days.map(() => 0) }
  const requestDaily = (counters.req && counters.req.daily) || days.map(() => 0)

  return {
    generatedAt: Date.now(),
    buildMs: Date.now() - startedAt,
    windowDays: STATS_RETENTION_DAYS,
    days,
    hours,
    redis: { configured: true, trackingEnabled: STATS_ENABLED, dbsize, info },
    users: {
      unique: { today: unique.today, d7: unique.d7, d30: unique.d30 },
      dailyUnique: unique.daily,
      new: { today: newUsers.today, d7: newUsers.d7, d30: newUsers.d30 },
      dailyNew: newUsers.daily,
      cachedLibraries: (groups.library || []).length,
      knownParseCaches: (groups.parseCache || []).length,
      seenInWindow: firstSeenKeys.length,
    },
    requests: {
      total: counters.req || { today: 0, d7: 0, d30: 0, daily: requestDaily },
      daily: requestDaily,
      hourly: hours.map((h) => num((hourlyByEvent.req || {})[h])),
      latency,
    },
    library,
    customStreams: {
      entries: csKeys.filter((k) => k.startsWith('cs:entry:')).length,
      users: csKeys.filter((k) => k.startsWith('cs:idx:')).length,
      verifiedCached: csKeys.filter((k) => k.startsWith('cs:verified:')).length,
    },
    rateLimit: { trackedIps: rlKeys.length, byBucket: rateLimitIps },
    userAgents: uaBreakdown(counters),
    userAgentSamples: await readUaSamples(dayId()),
    counters,
    keyspace: {
      total: dbsize,
      library: (groups.library || []).length,
      libraryParts: (groups.libraryParts || []).length,
      parseCache: (groups.parseCache || []).length,
      customStreams: csKeys.length,
      rateLimit: rlKeys.length,
      stats: statsKeys.length,
      tmdbAndOther: dbsize === null ? null : Math.max(0, dbsize - counted),
    },
    scan: { truncated, keysSeen: counted },
  }
}

async function summary({ fresh = false } = {}) {
  if (!redis) {
    return {
      generatedAt: Date.now(),
      redis: { configured: false, trackingEnabled: false },
      unavailable: 'Redis is not configured — no stats are collected.',
    }
  }
  if (!fresh) {
    try {
      const cached = await redis.get(SUMMARY_KEY)
      if (cached) return { ...JSON.parse(cached), cached: true }
    } catch {}
  }
  await flushNow()
  const payload = await buildSummary()
  try {
    await redis.set(SUMMARY_KEY, JSON.stringify(payload), 'EX', STATS_SUMMARY_TTL_SECONDS)
  } catch {}
  return { ...payload, cached: false }
}

module.exports = {
  enabled,
  userHash,
  track,
  trackHourly,
  trackDuration,
  trackUser,
  trackUserAgent,
  trackLibraryShape,
  flushNow,
  summary,
  dayId,
  hourId,
  recentDays,
  recentHours,
}
