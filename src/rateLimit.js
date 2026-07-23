const redis = require('./redisClient')

// Used only when Redis isn't configured (local dev). Not viable across serverless instances,
// but keeps the limiter functional for a single long-running process.
const memHits = new Map()

async function withinLimit(key, windowSeconds, limit) {
  if (redis) {
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, windowSeconds)
    return count <= limit
  }
  const now = Date.now()
  const entry = memHits.get(key)
  if (!entry || now - entry.start > windowSeconds * 1000) {
    memHits.set(key, { start: now, count: 1 })
    return true
  }
  entry.count += 1
  return entry.count <= limit
}

function rateLimit(prefix, { windowSeconds, limit }) {
  return async (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    try {
      const allowed = await withinLimit(`rl:${prefix}:${ip}`, windowSeconds, limit)
      if (!allowed) {
        res.status(429).json({ ok: false, error: 'Too many requests, try again later' })
        return
      }
    } catch (err) {
      console.warn(`rateLimit: check failed for ${prefix}, allowing request:`, err.message)
    }
    next()
  }
}

module.exports = { rateLimit }
