require('dotenv').config()

const DEFAULT_TORBOX_API_KEY = process.env.TORBOX_API_KEY || null
const DEFAULT_TMDB_API_KEY = process.env.TMDB_API_KEY || null
const DEFAULT_RPDB_API_KEY = process.env.RPDB_API_KEY || null

const VERCEL_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
const BASE_URL = (process.env.BASE_URL || (VERCEL_URL ? `https://${VERCEL_URL}` : '')).replace(/\/$/, '')
const PORT = parseInt(process.env.PORT || '7000', 10)

const TORBOX_BASE = 'https://api.torbox.app/v1/api'
const TMDB_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'
const RPDB_BASE = 'https://api.ratingposterdb.com'

const LIBRARY_TTL_MS = 15 * 60 * 1000
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

const RATE_LIMITS = {
  validate: { windowSeconds: 300, limit: 20 },
  customStreamWrite: { windowSeconds: 3600, limit: 30 },
  customStreamRead: { windowSeconds: 300, limit: 60 },
  cacheClear: { windowSeconds: 3600, limit: 5 },
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
  LIBRARY_TTL_MS,
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
  RATE_LIMITS,
}
