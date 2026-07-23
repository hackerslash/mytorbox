const { TORBOX_BASE, VIDEO_EXTENSIONS } = require('./config')
const { getJson } = require('./httpUtils')

const SOURCES = ['torrents', 'webdl']

function headers(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'User-Agent': 'Mozilla/5.0 (TorboxStremioAddon/1.0)',
  }
}

async function fetchMylist(source, apiKey) {
  const url = `${TORBOX_BASE}/${source}/mylist?bypass_cache=true`
  const data = await getJson(url, { headers: headers(apiKey) })
  return (data && data.data) || []
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

module.exports = { SOURCES, fetchMylist, isVideo, buildStreamUrl }
