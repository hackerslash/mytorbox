const { TORBOX_BASE, VIDEO_EXTENSIONS, TORBOX_PAGE_LIMIT, TORBOX_MAX_PAGES } = require('./config')
const { getJson } = require('./httpUtils')

const SOURCES = ['torrents', 'webdl']

function headers(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'User-Agent': 'Mozilla/5.0 (TorboxStremioAddon/1.0)',
  }
}

async function fetchMylist(source, apiKey, { bypassCache = false } = {}) {
  const all = []
  for (let page = 0; page < TORBOX_MAX_PAGES; page++) {
    const offset = page * TORBOX_PAGE_LIMIT
    const url = `${TORBOX_BASE}/${source}/mylist?bypass_cache=${bypassCache}&limit=${TORBOX_PAGE_LIMIT}&offset=${offset}`
    const data = await getJson(url, { headers: headers(apiKey) })
    const items = (data && data.data) || []
    all.push(...items)
    if (items.length < TORBOX_PAGE_LIMIT) break
  }
  return all
}

async function fetchNewest(source, apiKey) {
  const url = `${TORBOX_BASE}/${source}/mylist?bypass_cache=false&limit=1&offset=0`
  const data = await getJson(url, { headers: headers(apiKey) })
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
  const idParam = source === 'torrents' ? 'torrent_id' : 'web_id'
  return `${TORBOX_BASE}/${source}/requestdl?token=${apiKey}&${idParam}=${itemId}&file_id=${fileId}&redirect=true`
}

module.exports = { SOURCES, fetchMylist, fetchNewest, isVideo, buildStreamUrl }
