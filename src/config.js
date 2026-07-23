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

const LIBRARY_TTL_MS = 300 * 1000
const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.webm', '.ts', '.flv'])

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
  VIDEO_EXTENSIONS,
}
