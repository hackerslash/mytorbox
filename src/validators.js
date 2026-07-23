const { TORBOX_BASE, TMDB_BASE, RPDB_BASE } = require('./config')
const { sleep } = require('./httpUtils')

const RPDB_PROBE_TMDB_ID = 550 // Fight Club — stable, always exists on TMDB

async function getWithRetry(url, options = {}, retries = 3) {
  let lastErr
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(10000) })
    } catch (e) {
      lastErr = e
      await sleep(1200 * (attempt + 1))
    }
  }
  throw lastErr
}

async function checkTorbox(key) {
  if (!key) return { valid: false, detail: 'Missing key' }
  let res
  try {
    res = await getWithRetry(`${TORBOX_BASE}/user/me?settings=false`, {
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'Mozilla/5.0 (MyTorbox/1.0)' },
    })
  } catch {
    return { valid: false, detail: 'Could not reach TorBox' }
  }
  if (res.status === 200) return { valid: true, detail: 'OK' }
  if (res.status === 403) return { valid: false, detail: 'Invalid TorBox API key' }
  return { valid: false, detail: `TorBox returned HTTP ${res.status}` }
}

async function checkTmdb(key) {
  if (!key) return { valid: false, detail: 'Missing key' }
  let res
  try {
    res = await getWithRetry(`${TMDB_BASE}/authentication?api_key=${encodeURIComponent(key)}`)
  } catch {
    return { valid: false, detail: 'Could not reach TMDB' }
  }
  if (res.status === 200) return { valid: true, detail: 'OK' }
  if (res.status === 401) return { valid: false, detail: 'Invalid TMDB API key' }
  return { valid: false, detail: `TMDB returned HTTP ${res.status}` }
}

async function checkRpdb(key) {
  if (!key) return null
  let res
  try {
    res = await getWithRetry(
      `${RPDB_BASE}/${encodeURIComponent(key)}/tmdb/poster-default/movie-${RPDB_PROBE_TMDB_ID}.jpg?fallback=true`
    )
  } catch {
    return { valid: false, detail: 'Could not reach RPDB' }
  }
  if (res.status === 403) return { valid: false, detail: 'Invalid RPDB API key' }
  if (res.status === 200) return { valid: true, detail: 'OK' }
  return { valid: false, detail: `RPDB returned HTTP ${res.status}` }
}

module.exports = { checkTorbox, checkTmdb, checkRpdb }
