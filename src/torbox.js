const { TORBOX_BASE, VIDEO_EXTENSIONS, TORBOX_PAGE_LIMIT, TORBOX_MAX_PAGES } = require('./config')
const { getJson } = require('./httpUtils')

const SOURCES = ['torrents', 'webdl', 'usenet']
const ID_PARAMS = { torrents: 'torrent_id', webdl: 'web_id', usenet: 'usenet_id' }

function headers(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'User-Agent': 'Mozilla/5.0 (TorboxStremioAddon/1.0)',
  }
}

// A usenet 4xx (e.g. a plan without usenet) reads as empty so it can't fail the whole library.
async function getList(source, url, apiKey) {
  try {
    return await getJson(url, { headers: headers(apiKey) })
  } catch (err) {
    if (source === 'usenet' && /^HTTP 4\d\d /.test(err.message)) return null
    throw err
  }
}

async function fetchMylist(source, apiKey, { bypassCache = false } = {}) {
  const all = []
  for (let page = 0; page < TORBOX_MAX_PAGES; page++) {
    const offset = page * TORBOX_PAGE_LIMIT
    const url = `${TORBOX_BASE}/${source}/mylist?bypass_cache=${bypassCache}&limit=${TORBOX_PAGE_LIMIT}&offset=${offset}`
    const data = await getList(source, url, apiKey)
    const items = (data && data.data) || []
    all.push(...items)
    if (items.length < TORBOX_PAGE_LIMIT) break
  }
  return all
}

async function fetchNewest(source, apiKey) {
  const url = `${TORBOX_BASE}/${source}/mylist?bypass_cache=false&limit=1&offset=0`
  const data = await getList(source, url, apiKey)
  const items = (data && data.data) || []
  return items.length ? items[0] : null
}

function isVideo(filename) {
  const idx = filename.lastIndexOf('.')
  if (idx === -1) return false
  const ext = filename.slice(idx).toLowerCase()
  return VIDEO_EXTENSIONS.has(ext)
}

function buildStreamUrl(source, itemId, fileId, apiKey) {
  return `${TORBOX_BASE}/${source}/requestdl?token=${apiKey}&${ID_PARAMS[source]}=${itemId}&file_id=${fileId}&redirect=true`
}

module.exports = { SOURCES, fetchMylist, fetchNewest, isVideo, buildStreamUrl }
