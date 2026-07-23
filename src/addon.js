const { addonBuilder } = require('stremio-addon-sdk')
const config = require('./config')
const { getLibrary } = require('./library')

const HAS_DEFAULTS = Boolean(config.DEFAULT_TORBOX_API_KEY && config.DEFAULT_TMDB_API_KEY)

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
    { type: 'movie', id: 'torbox-movies', name: 'MyTorbox Movies' },
    { type: 'series', id: 'torbox-series', name: 'MyTorbox Series' },
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

const builder = new addonBuilder(manifest)

builder.defineCatalogHandler(async ({ type, id, config: cfg }) => {
  const keys = resolveKeys(cfg)
  if (!keys) return { metas: [] }
  const lib = await getLibrary(keys.torboxKey, keys.tmdbKey, keys.rpdbKey)
  if (type === 'movie' && id === 'torbox-movies') return { metas: lib.movies }
  if (type === 'series' && id === 'torbox-series') return { metas: lib.series }
  return { metas: [] }
})

builder.defineMetaHandler(async ({ type, id, config: cfg }) => {
  const keys = resolveKeys(cfg)
  if (!keys) return Promise.reject({ noHandler: true })
  const lib = await getLibrary(keys.torboxKey, keys.tmdbKey, keys.rpdbKey)
  const item = lib.meta[id]
  if (!item || item.type !== type) return Promise.reject({ noHandler: true })
  return { meta: item }
})

builder.defineStreamHandler(async ({ type, id, config: cfg }) => {
  const keys = resolveKeys(cfg)
  if (!keys) return { streams: [] }
  const lib = await getLibrary(keys.torboxKey, keys.tmdbKey, keys.rpdbKey)
  const streams = lib.streams[id]
  if (!streams) return Promise.reject({ noHandler: true })
  return { streams }
})

module.exports = { builder, manifest, HAS_DEFAULTS }
