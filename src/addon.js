const config = require('./config')
const { getLibrary, hydrateStreams, withPosters } = require('./library')
const posters = require('./posters')
const { buildCustomCatalog } = require('./customCatalog')
const customStreams = require('./customStreams')

const HAS_DEFAULTS = Boolean(config.DEFAULT_TORBOX_API_KEY && config.DEFAULT_TMDB_API_KEY)

const CUSTOM_MOVIES_CATALOG_ID = 'torbox-custom-movies'
const CUSTOM_SERIES_CATALOG_ID = 'torbox-custom-series'

function catalog(type, id, name, searchable = true) {
  const extra = searchable ? [{ name: 'search' }, { name: 'skip' }] : [{ name: 'skip' }]
  return {
    type,
    id,
    name,
    extra,
    extraSupported: extra.map((e) => e.name),
  }
}

function buildCatalogs(searchable, includeCustom = true) {
  const catalogs = [
    catalog('movie', 'torbox-movies', 'MyTorbox Movies', searchable),
    catalog('series', 'torbox-series', 'MyTorbox Series', searchable),
  ]
  if (includeCustom) {
    catalogs.push(catalog('movie', CUSTOM_MOVIES_CATALOG_ID, 'Custom Streams', searchable))
    catalogs.push(catalog('series', CUSTOM_SERIES_CATALOG_ID, 'Custom Streams', searchable))
  }
  return catalogs
}

function searchDisabled(cfg) {
  return Boolean(cfg && cfg.no_search)
}

const manifest = {
  id: 'addon.mytorbox',
  version: '1.3.0',
  name: 'MyTorbox',
  description: 'Browse your TorBox torrents and web downloads as a Stremio catalog with TMDB posters',
  logo: config.BASE_URL ? `${config.BASE_URL}/logo.png` : '/logo.png',
  resources: [
    'catalog',
    { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tb:'] },
    { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'tb:'] },
  ],
  types: ['movie', 'series'],
  catalogs: buildCatalogs(true),
  idPrefixes: ['tt', 'tb:'],
  config: [
    { key: 'torbox_key', type: 'password', title: 'TorBox API Key', required: true },
    { key: 'tmdb_key', type: 'password', title: 'TMDB API Key', required: true },
    { key: 'rpdb_key', type: 'password', title: 'RPDB API Key (optional)' },
    { key: 'poster_url', type: 'text', title: 'Custom poster URL with {imdb_id}' },
    { key: 'no_search', type: 'checkbox', title: 'Keep my library out of Stremio search' },
  ],
  behaviorHints: {
    configurable: true,
    configurationRequired: !HAS_DEFAULTS,
  },
}

function placeholderMeta(id, type, name, description) {
  const meta = { id, type, name, description }
  if (config.BASE_URL) meta.poster = `${config.BASE_URL}/logo.png`
  if (type === 'series') meta.videos = []
  return meta
}

const EXPIRED_CUSTOM = [
  'Custom stream expired',
  'This custom stream has expired. Add it again from the MyTorbox configure page to restore it.',
]

const OUTDATED_ITEM = [
  'Outdated item',
  'This entry no longer matches your MyTorbox library. Reload or reinstall the addon to refresh your catalog.',
]

function resolveKeys(cfg) {
  if (cfg && cfg.torbox_key && cfg.tmdb_key) {
    return {
      torboxKey: cfg.torbox_key,
      tmdbKey: cfg.tmdb_key,
      poster: posters.resolveProvider(cfg.poster_url, cfg.rpdb_key),
    }
  }
  if (HAS_DEFAULTS) {
    return {
      torboxKey: config.DEFAULT_TORBOX_API_KEY,
      tmdbKey: config.DEFAULT_TMDB_API_KEY,
      poster: posters.resolveProvider(config.DEFAULT_POSTER_URL, config.DEFAULT_RPDB_API_KEY),
    }
  }
  return null
}

function paginate(metas, extra) {
  const skip = Number.parseInt(extra && extra.skip, 10)
  const start = Number.isFinite(skip) && skip > 0 ? skip : 0
  return metas.slice(start, start + config.CATALOG_PAGE_SIZE)
}

function normalizeForSearch(str) {
  return String(str == null ? '' : str)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function searchTokens(extra) {
  if (!extra || typeof extra.search !== 'string') return null
  return normalizeForSearch(extra.search).split(' ').filter(Boolean)
}

function matchesTokens(meta, tokens) {
  const haystack = normalizeForSearch(`${meta.name || ''} ${meta.releaseInfo || ''}`)
  const compact = haystack.replace(/ /g, '')
  return tokens.every((t) => haystack.includes(t) || compact.includes(t))
}

function selectMetas(metas, extra) {
  const tokens = searchTokens(extra)
  if (!tokens) return paginate(metas, extra)
  if (!tokens.length) return []
  return paginate(metas.filter((m) => matchesTokens(m, tokens)), extra)
}

async function getCatalog({ type, id, config: cfg, extra }) {
  const keys = resolveKeys(cfg)
  if (!keys) return { metas: [] }

  if (searchDisabled(cfg) && extra && extra.search !== undefined) return { metas: [] }

  if (id === CUSTOM_MOVIES_CATALOG_ID || id === CUSTOM_SERIES_CATALOG_ID) {
    const custom = await buildCustomCatalog(keys.torboxKey, keys.tmdbKey, keys.poster)
    if (type === 'movie' && id === CUSTOM_MOVIES_CATALOG_ID) return { metas: selectMetas(custom.movies, extra) }
    if (type === 'series' && id === CUSTOM_SERIES_CATALOG_ID) return { metas: selectMetas(custom.series, extra) }
    return { metas: [] }
  }

  const lib = await getLibrary(keys.torboxKey, keys.tmdbKey)
  if (type === 'movie' && id === 'torbox-movies') {
    return { metas: withPosters(selectMetas(lib.movies, extra), keys.poster) }
  }
  if (type === 'series' && id === 'torbox-series') {
    return { metas: withPosters(selectMetas(lib.series, extra), keys.poster) }
  }
  return { metas: [] }
}

async function getMeta({ type, id, config: cfg }) {
  const keys = resolveKeys(cfg)
  if (!keys) return null

  if (id.startsWith('tb:custom:')) {
    const custom = await buildCustomCatalog(keys.torboxKey, keys.tmdbKey, keys.poster)
    const item = custom.meta[id]
    if (item && item.type === type) return { meta: item }
    if (id.startsWith(`tb:custom:${type}:`)) return { meta: placeholderMeta(id, type, ...EXPIRED_CUSTOM) }
    return null
  }

  const lib = await getLibrary(keys.torboxKey, keys.tmdbKey)
  const item = lib.meta[id]
  if (item && item.type === type) return { meta: withPosters([item], keys.poster)[0] }
  if (id.startsWith(`tb:${type}:`)) return { meta: placeholderMeta(id, type, ...OUTDATED_ITEM) }
  return null
}

async function getStream({ type, id, config: cfg }) {
  const keys = resolveKeys(cfg)
  if (!keys) return { streams: [] }

  if (id.startsWith('tb:custom:')) {
    const custom = await buildCustomCatalog(keys.torboxKey, keys.tmdbKey, keys.poster)
    const streams = custom.streams[id]
    if (!streams) return null
    return { streams }
  }

  const lib = await getLibrary(keys.torboxKey, keys.tmdbKey)
  const entries = lib.streams[id]
  if (!entries) return null
  return { streams: hydrateStreams(entries, keys.torboxKey) }
}

async function manifestFor(cfg) {
  const keys = resolveKeys(cfg)
  const includeCustom = keys
    ? await customStreams.hasCustomStreams(keys.torboxKey, keys.tmdbKey)
    : true
  return {
    ...manifest,
    catalogs: buildCatalogs(!searchDisabled(cfg), includeCustom),
    behaviorHints: {
      ...manifest.behaviorHints,
      configurationRequired: !keys,
    },
  }
}

module.exports = { manifest, manifestFor, resolveKeys, HAS_DEFAULTS, getCatalog, getMeta, getStream }
