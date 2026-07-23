const path = require('path')
const fs = require('fs')
const express = require('express')
const cors = require('cors')
const { getRouter } = require('stremio-addon-sdk')
const { builder } = require('./addon')
const validators = require('./validators')
const library = require('./library')
const tmdb = require('./tmdb')
const customStreams = require('./customStreams')

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
    type, imdb_id: imdbId, season, episode, stream_url: streamUrl, title,
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

  const trimmedTitle = typeof title === 'string' ? title.trim().slice(0, 200) : ''
  const entry = await customStreams.addCustomStream(torboxKey, tmdbKey, rpdbKey || null, {
    type, imdbId, season: seasonNum, episode: episodeNum, streamUrl, title: trimmedTitle || null,
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

app.use(getRouter(builder.getInterface()))

module.exports = app
