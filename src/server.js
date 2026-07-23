const path = require('path')
const fs = require('fs')
const express = require('express')
const cors = require('cors')
const addon = require('./addon')
const validators = require('./validators')
const library = require('./library')
const tmdb = require('./tmdb')
const customStreams = require('./customStreams')
const { CUSTOM_STREAM_MIN_TTL_MS, CUSTOM_STREAM_MAX_TTL_MS, CUSTOM_STREAM_DEFAULT_TTL_MS } = require('./config')

const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const LOGO_PATH = path.join(PUBLIC_DIR, 'logo.png')
const CONFIGURE_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'configure.html'), 'utf8')

function logoVersion() {
  return Math.floor(fs.statSync(LOGO_PATH).mtimeMs / 1000)
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function configurePage(torboxKey = '', tmdbKey = '', rpdbKey = '') {
  let page = CONFIGURE_HTML.replace(/__LOGO_VERSION__/g, String(logoVersion()))
  page = page.replace('id="torbox" placeholder', `id="torbox" value="${escapeHtml(torboxKey)}" placeholder`)
  page = page.replace('id="tmdb" placeholder', `id="tmdb" value="${escapeHtml(tmdbKey)}" placeholder`)
  page = page.replace('id="rpdb" placeholder', `id="rpdb" value="${escapeHtml(rpdbKey)}" placeholder`)
  return page
}

function decodeConfigParam(raw) {
  try {
    return JSON.parse(decodeURIComponent(raw))
  } catch {
    return null
  }
}

const app = express()
app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
  res.type('html').send(configurePage())
})

app.get('/configure', (req, res) => {
  res.type('html').send(configurePage())
})

app.get('/:config/configure', (req, res) => {
  const cfg = decodeConfigParam(req.params.config)
  if (!cfg) {
    res.type('html').send(configurePage())
    return
  }
  res.type('html').send(configurePage(cfg.torbox_key || '', cfg.tmdb_key || '', cfg.rpdb_key || ''))
})

app.post('/api/validate', async (req, res) => {
  const { torbox_key: torboxKey, tmdb_key: tmdbKey, rpdb_key: rpdbKey } = req.body || {}
  const [torbox, tmdb, rpdb] = await Promise.all([
    validators.checkTorbox(torboxKey),
    validators.checkTmdb(tmdbKey),
    validators.checkRpdb(rpdbKey),
  ])
  res.json({ torbox, tmdb, rpdb })
})

app.post('/api/cache/clear', async (req, res) => {
  await library.clearCache()
  tmdb.clearCache()
  res.json({ cleared: true })
})

function toPublicEntry(e) {
  return {
    id: e.id,
    type: e.type,
    imdb_id: e.imdbId,
    season: e.season,
    episode: e.episode,
    stream_url: e.streamUrl,
    title: e.title,
    created_at: e.createdAt,
    expires_at: e.expiresAt,
  }
}

async function enrichEntry(e, tmdbKey, rpdbKey) {
  const found = await tmdb.findByImdbId(e.imdbId, tmdbKey).catch(() => null)
  const tmdbRes = found ? found.result : null
  const name = (tmdbRes && (tmdbRes.title || tmdbRes.name)) || e.title || e.imdbId
  const poster = library.posterUrlFor(tmdbRes, e.type, rpdbKey)
  return { ...toPublicEntry(e), name, poster }
}

app.post('/api/custom-streams/list', async (req, res) => {
  const { torbox_key: torboxKey, tmdb_key: tmdbKey, rpdb_key: rpdbKey } = req.body || {}
  if (!torboxKey || !tmdbKey) {
    return res.status(400).json({ ok: false, error: 'torbox_key and tmdb_key are required' })
  }
  const entries = await customStreams.listCustomStreams(torboxKey, tmdbKey, rpdbKey || null)
  const enriched = await Promise.all(entries.map((e) => enrichEntry(e, tmdbKey, rpdbKey || null)))
  res.json({ ok: true, entries: enriched })
})

app.post('/api/custom-streams/add', async (req, res) => {
  const {
    torbox_key: torboxKey, tmdb_key: tmdbKey, rpdb_key: rpdbKey,
    type, imdb_id: imdbId, season, episode, stream_url: streamUrl, title, ttl_seconds: ttlSeconds,
  } = req.body || {}

  if (!torboxKey || !tmdbKey) {
    return res.status(400).json({ ok: false, error: 'torbox_key and tmdb_key are required' })
  }
  if (type !== 'movie' && type !== 'series') {
    return res.status(400).json({ ok: false, error: 'type must be "movie" or "series"' })
  }
  if (!customStreams.isValidImdbId(imdbId)) {
    return res.status(400).json({ ok: false, error: 'imdb_id must look like ttNNNNNNN' })
  }
  if (!customStreams.isValidStreamUrl(streamUrl)) {
    return res.status(400).json({ ok: false, error: 'stream_url must be a valid http(s) URL' })
  }

  let seasonNum = null
  let episodeNum = null
  if (type === 'series') {
    seasonNum = Number(season)
    episodeNum = Number(episode)
    if (!Number.isInteger(seasonNum) || seasonNum < 0) {
      return res.status(400).json({ ok: false, error: 'season must be a non-negative integer' })
    }
    if (!Number.isInteger(episodeNum) || episodeNum < 1) {
      return res.status(400).json({ ok: false, error: 'episode must be a positive integer' })
    }
  }

  const minTtlSec = Math.floor(CUSTOM_STREAM_MIN_TTL_MS / 1000)
  const maxTtlSec = Math.floor(CUSTOM_STREAM_MAX_TTL_MS / 1000)
  let ttlMs = CUSTOM_STREAM_DEFAULT_TTL_MS
  if (ttlSeconds !== undefined && ttlSeconds !== null) {
    const ttlSecondsNum = Number(ttlSeconds)
    if (!Number.isInteger(ttlSecondsNum) || ttlSecondsNum < minTtlSec || ttlSecondsNum > maxTtlSec) {
      return res.status(400).json({ ok: false, error: `ttl_seconds must be an integer between ${minTtlSec} and ${maxTtlSec}` })
    }
    ttlMs = ttlSecondsNum * 1000
  }

  const trimmedTitle = typeof title === 'string' ? title.trim().slice(0, 200) : ''
  const entry = await customStreams.addCustomStream(torboxKey, tmdbKey, rpdbKey || null, {
    type, imdbId, season: seasonNum, episode: episodeNum, streamUrl, title: trimmedTitle || null, ttlMs,
  })
  if (!entry) {
    return res.status(400).json({ ok: false, error: 'Custom stream limit reached, or storage is not configured' })
  }
  res.json({ ok: true, entry: toPublicEntry(entry) })
})

app.post('/api/custom-streams/remove', async (req, res) => {
  const { torbox_key: torboxKey, tmdb_key: tmdbKey, rpdb_key: rpdbKey, id } = req.body || {}
  if (!torboxKey || !tmdbKey || !id) {
    return res.status(400).json({ ok: false, error: 'torbox_key, tmdb_key, and id are required' })
  }
  const removed = await customStreams.removeCustomStream(torboxKey, tmdbKey, rpdbKey || null, id)
  if (!removed) {
    return res.status(404).json({ ok: false, error: 'Entry not found or already expired' })
  }
  res.json({ ok: true })
})

app.get('/logo.png', (req, res) => {
  res.set('Cache-Control', 'public, max-age=31536000, immutable')
  res.sendFile(LOGO_PATH)
})

// --- Stremio addon protocol (manifest/catalog/meta/stream) ---
// Hand-rolled instead of stremio-addon-sdk's router: the SDK silently deletes
// behaviorHints.configurable/configurationRequired from any manifest fetched
// through a URL that already has a :config segment (its own getRouter.js),
// which is exactly the URL this addon's install links use. We want manifest.js
// served byte-for-byte as defined in addon.js, always.

function stripJsonExt(s) {
  return s.endsWith('.json') ? s.slice(0, -5) : s
}

function manifestHandler(req, res) {
  const cfg = req.params.config ? decodeConfigParam(req.params.config) : null
  res.type('application/json').send(JSON.stringify(addon.manifestFor(cfg)))
}

app.get('/manifest.json', manifestHandler)
app.get('/:config/manifest.json', manifestHandler)

async function catalogHandler(req, res) {
  const cfg = req.params.config ? decodeConfigParam(req.params.config) : null
  const type = req.params.type
  const id = stripJsonExt(req.params.idWithExt)
  try {
    const result = await addon.getCatalog({ type, id, config: cfg })
    res.type('application/json').send(JSON.stringify(result))
  } catch (err) {
    console.error('catalog handler error:', err)
    res.status(500).json({ err: 'handler error' })
  }
}

async function metaHandler(req, res) {
  const cfg = req.params.config ? decodeConfigParam(req.params.config) : null
  const type = req.params.type
  const id = stripJsonExt(req.params.idWithExt)
  try {
    const result = await addon.getMeta({ type, id, config: cfg })
    if (!result) {
      res.status(404).json({ err: 'not found' })
      return
    }
    res.type('application/json').send(JSON.stringify(result))
  } catch (err) {
    console.error('meta handler error:', err)
    res.status(500).json({ err: 'handler error' })
  }
}

async function streamHandler(req, res) {
  const cfg = req.params.config ? decodeConfigParam(req.params.config) : null
  const type = req.params.type
  const id = stripJsonExt(req.params.idWithExt)
  try {
    const result = await addon.getStream({ type, id, config: cfg })
    if (!result) {
      res.status(404).json({ err: 'not found' })
      return
    }
    res.type('application/json').send(JSON.stringify(result))
  } catch (err) {
    console.error('stream handler error:', err)
    res.status(500).json({ err: 'handler error' })
  }
}

app.get('/catalog/:type/:idWithExt', catalogHandler)
app.get('/:config/catalog/:type/:idWithExt', catalogHandler)

app.get('/meta/:type/:idWithExt', metaHandler)
app.get('/:config/meta/:type/:idWithExt', metaHandler)

app.get('/stream/:type/:idWithExt', streamHandler)
app.get('/:config/stream/:type/:idWithExt', streamHandler)

module.exports = app
