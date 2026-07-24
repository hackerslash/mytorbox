const config = require('./config')
const { getLibrary, hydrateStreams } = require('./library')
const { buildCustomCatalog } = require('./customCatalog')

const HAS_DEFAULTS = Boolean(config.DEFAULT_TORBOX_API_KEY && config.DEFAULT_TMDB_API_KEY)

const CUSTOM_MOVIES_CATALOG_ID = 'torbox-custom-movies'
const CUSTOM_SERIES_CATALOG_ID = 'torbox-custom-series'

const manifest = {
  id: 'addon.mytorbox',
  version: '1.0.0',
  name: 'MyTorbox',
  description: 'Browse your TorBox torrents and web downloads as a Stremio catalog with TMDB posters',
  logo: config.BASE_URL ? `${config.BASE_URL}/logo.png` : '/logo.png',
  resources: [
    'catalog',
    { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tb:'] },
    { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tb:'] },
  ],
  types: ['movie', 'series'],
  catalogs: [
    { type: 'movie', id: 'torbox-movies', name: 'MyTorbox Movies', extra: [{ name: 'skip' }] },
    { type: 'series', id: 'torbox-series', name: 'MyTorbox Series', extra: [{ name: 'skip' }] },
    { type: 'movie', id: CUSTOM_MOVIES_CATALOG_ID, name: 'Custom Streams', extra: [{ name: 'skip' }] },
    { type: 'series', id: CUSTOM_SERIES_CATALOG_ID, name: 'Custom Streams', extra: [{ name: 'skip' }] },
  ],
  idPrefixes: ['tb:'],
  config: [
    { key: 'torbox_key', type: 'password', title: 'TorBox API Key', required: true },
    { key: 'tmdb_key', type: 'password', title: 'TMDB API Key', required: true },
    { key: 'rpdb_key', type: 'password', title: 'RPDB API Key (optional)' },
  ],
  behaviorHints: {
    configurable: true,
    configurationRequired: !HAS_DEFAULTS,
  },
}

function resolveKeys(cfg) {
  if (cfg && cfg.torbox_key && cfg.tmdb_key) {
    return { torboxKey: cfg.torbox_key, tmdbKey: cfg.tmdb_key, rpdbKey: cfg.rpdb_key || null }
  }
  if (HAS_DEFAULTS) {
    return {
      torboxKey: config.DEFAULT_TORBOX_API_KEY,
      tmdbKey: config.DEFAULT_TMDB_API_KEY,
      rpdbKey: config.DEFAULT_RPDB_API_KEY,
    }
  }
  return null
}

function paginate(metas, extra) {
  const skip = Number.parseInt(extra && extra.skip, 10)
  const start = Number.isFinite(skip) && skip > 0 ? skip : 0
  return metas.slice(start, start + config.CATALOG_PAGE_SIZE)
}

async function getCatalog({ type, id, config: cfg, extra }) {
  const keys = resolveKeys(cfg)
  if (!keys) return { metas: [] }

  if (id === CUSTOM_MOVIES_CATALOG_ID || id === CUSTOM_SERIES_CATALOG_ID) {
    const custom = await buildCustomCatalog(keys.torboxKey, keys.tmdbKey, keys.rpdbKey)
    if (type === 'movie' && id === CUSTOM_MOVIES_CATALOG_ID) return { metas: paginate(custom.movies, extra) }
    if (type === 'series' && id === CUSTOM_SERIES_CATALOG_ID) return { metas: paginate(custom.series, extra) }
    return { metas: [] }
  }

  const lib = await getLibrary(keys.torboxKey, keys.tmdbKey, keys.rpdbKey)
  if (type === 'movie' && id === 'torbox-movies') return { metas: paginate(lib.movies, extra) }
  if (type === 'series' && id === 'torbox-series') return { metas: paginate(lib.series, extra) }
  return { metas: [] }
}

async function getMeta({ type, id, config: cfg }) {
  const keys = resolveKeys(cfg)
  if (!keys) return null

  if (id.startsWith('tb:custom:')) {
    const custom = await buildCustomCatalog(keys.torboxKey, keys.tmdbKey, keys.rpdbKey)
    const item = custom.meta[id]
    if (!item || item.type !== type) return null
    return { meta: item }
  }

  const lib = await getLibrary(keys.torboxKey, keys.tmdbKey, keys.rpdbKey)
  const item = lib.meta[id]
  if (!item || item.type !== type) return null
  return { meta: item }
}

async function getStream({ type, id, config: cfg }) {
  const keys = resolveKeys(cfg)
  if (!keys) return { streams: [] }

  if (id.startsWith('tb:custom:')) {
    const custom = await buildCustomCatalog(keys.torboxKey, keys.tmdbKey, keys.rpdbKey)
    const streams = custom.streams[id]
    if (!streams) return null
    return { streams }
  }

  const lib = await getLibrary(keys.torboxKey, keys.tmdbKey, keys.rpdbKey)
  const entries = lib.streams[id]
  if (!entries) return null
  return { streams: hydrateStreams(entries, keys.torboxKey) }
}

function manifestFor(cfg) {
  return {
    ...manifest,
    behaviorHints: {
      ...manifest.behaviorHints,
      configurationRequired: !resolveKeys(cfg),
    },
  }
}

module.exports = { manifest, manifestFor, resolveKeys, HAS_DEFAULTS, getCatalog, getMeta, getStream }
