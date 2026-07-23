const path = require('path')
const fs = require('fs')
const express = require('express')
const cors = require('cors')
const { getRouter } = require('stremio-addon-sdk')
const { builder } = require('./addon')
const validators = require('./validators')

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

app.get('/logo.png', (req, res) => {
  res.set('Cache-Control', 'public, max-age=31536000, immutable')
  res.sendFile(LOGO_PATH)
})

app.use(getRouter(builder.getInterface()))

module.exports = app
