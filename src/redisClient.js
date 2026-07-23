const Redis = require('ioredis')

const redisUrl = process.env.REDIS_URL
const redis = redisUrl ? new Redis(redisUrl) : null

if (!redis) {
  console.warn('redisClient: REDIS_URL not set — Redis-backed caching disabled, falling back to in-memory')
} else {
  redis.on('error', (err) => console.warn('redisClient: connection error:', err.message))
}

module.exports = redis
