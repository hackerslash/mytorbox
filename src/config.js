require('dotenv').config()

const DEFAULT_TORBOX_API_KEY = process.env.TORBOX_API_KEY || null
const DEFAULT_TMDB_API_KEY = process.env.TMDB_API_KEY || null
const DEFAULT_RPDB_API_KEY = process.env.RPDB_API_KEY || null

const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '')
const PORT = parseInt(process.env.PORT || '7000', 10)

const TORBOX_BASE = 'https://api.torbox.app/v1/api'
const TMDB_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'
const RPDB_BASE = 'https://api.ratingposterdb.com'

const LIBRARY_CHECK_INTERVAL_MS = 60 * 60 * 1000
const LIBRARY_PROBE_INTERVAL_MS = 2 * 60 * 1000
// Hard expiry for a cached library — evicts inactive users; refreshed on every check.
const LIBRARY_HARD_TTL_MS = 24 * 60 * 60 * 1000
// guessit(filename) is deterministic and filenames are immutable, so parse results
// can be cached for a long time (namespace bumped if the parser logic changes).
const PARSE_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60
// TMDB search/image lookups are stable public data — cache across rebuilds and users.
const TMDB_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60
// TorBox /mylist paginates at 1000 items per page by default.
const TORBOX_PAGE_LIMIT = 1000
// Safety cap on pagination so a misbehaving API (e.g. one that ignores offset) can't
// loop forever — 50k items is far beyond any real library.
const TORBOX_MAX_PAGES = 50
// A genuine "no TMDB match" (or a transient error) is cached only briefly so newly
// added TMDB entries appear soon, unlike successful lookups which are stable.
const TMDB_NEGATIVE_CACHE_TTL_SECONDS = 6 * 60 * 60
// Skip caching values larger than this — keeps writes safely under the hosted-Redis
// (Upstash) per-request size ceiling. Library blobs are gzipped, so this is generous.
const MAX_CACHE_VALUE_BYTES = 900 * 1024
const CATALOG_PAGE_SIZE = 100
const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.webm', '.ts', '.flv'])
const MIN_FILE_SIZE_BYTES = 500 * 1024 * 1024

const CUSTOM_STREAM_DEFAULT_TTL_MS = 3 * 60 * 60 * 1000
const CUSTOM_STREAM_MIN_TTL_MS = 5 * 60 * 1000
const CUSTOM_STREAM_MAX_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CUSTOM_STREAMS_PER_KEY = 200
const MAX_STREAM_URL_LENGTH = 2000
const CUSTOM_STREAM_VERIFY_TTL_SECONDS = 10 * 60


const ADMIN_SECRET = process.env.ADMIN_SECRET || null


const ADDON_ACCESS_TOKEN = process.env.ADDON_ACCESS_TOKEN || null

const STATS_ENABLED = process.env.STATS_ENABLED !== '0'
const STATS_TTL_SECONDS = 31 * 24 * 60 * 60
const STATS_RETENTION_DAYS = 30
const statsFlushSeconds = parseInt(process.env.STATS_FLUSH_SECONDS, 10) 
const STATS_FLUSH_MS = (Number.isInteger(statsFlushSeconds) && statsFlushSeconds >= 1 ? statsFlushSeconds : 60) * 1000
const STATS_USER_THROTTLE_MS = 5 * 60 * 1000
const STATS_SUMMARY_TTL_SECONDS = 60
const STATS_SCAN_LIMIT = 50000
const STATS_TOP_LIBRARIES = 10
const STATS_LIBRARY_SAMPLE_LIMIT = 1000

const RATE_LIMITS = {
  validate: { windowSeconds: 300, limit: 20 },
  customStreamWrite: { windowSeconds: 3600, limit: 30 },
  customStreamRead: { windowSeconds: 300, limit: 60 },
  cacheClear: { windowSeconds: 3600, limit: 5 },
  stats: { windowSeconds: 300, limit: 40 },
}

module.exports = {
  DEFAULT_TORBOX_API_KEY,
  DEFAULT_TMDB_API_KEY,
  DEFAULT_RPDB_API_KEY,
  BASE_URL,
  PORT,
  TORBOX_BASE,
  TMDB_BASE,
  TMDB_IMAGE_BASE,
  RPDB_BASE,
  LIBRARY_CHECK_INTERVAL_MS,
  LIBRARY_PROBE_INTERVAL_MS,
  LIBRARY_HARD_TTL_MS,
  PARSE_CACHE_TTL_SECONDS,
  TMDB_CACHE_TTL_SECONDS,
  TMDB_NEGATIVE_CACHE_TTL_SECONDS,
  TORBOX_PAGE_LIMIT,
  TORBOX_MAX_PAGES,
  MAX_CACHE_VALUE_BYTES,
  CATALOG_PAGE_SIZE,
  VIDEO_EXTENSIONS,
  MIN_FILE_SIZE_BYTES,
  CUSTOM_STREAM_DEFAULT_TTL_MS,
  CUSTOM_STREAM_MIN_TTL_MS,
  CUSTOM_STREAM_MAX_TTL_MS,
  MAX_CUSTOM_STREAMS_PER_KEY,
  MAX_STREAM_URL_LENGTH,
  CUSTOM_STREAM_VERIFY_TTL_SECONDS,
  ADMIN_SECRET,
  ADDON_ACCESS_TOKEN,
  STATS_ENABLED,
  STATS_TTL_SECONDS,
  STATS_RETENTION_DAYS,
  STATS_FLUSH_MS,
  STATS_USER_THROTTLE_MS,
  STATS_SUMMARY_TTL_SECONDS,
  STATS_SCAN_LIMIT,
  STATS_TOP_LIBRARIES,
  STATS_LIBRARY_SAMPLE_LIMIT,
  RATE_LIMITS,
}
