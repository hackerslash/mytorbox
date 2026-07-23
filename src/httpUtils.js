const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getJson(url, options = {}, retries = 5) {
  let lastErr
  for (let attempt = 0; attempt < retries; attempt++) {
    let res
    try {
      res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) })
    } catch (e) {
      lastErr = e
      await sleep(1500 * (attempt + 1))
      continue
    }
    if (RETRYABLE_STATUS.has(res.status)) {
      lastErr = new Error(`retryable status ${res.status} for ${url}`)
      await sleep(1500 * (attempt + 1))
      continue
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`)
    }
    return res.json()
  }
  throw lastErr
}

module.exports = { getJson, sleep }
