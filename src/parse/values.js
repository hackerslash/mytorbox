const MAX_EPISODE_SPAN = 64

function firstInt(value) {
  const v = Array.isArray(value) ? value[0] : value
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : v
  return Number.isInteger(n) ? n : null
}

function intList(value) {
  const list = Array.isArray(value) ? value : [value]
  const out = []
  for (const v of list) {
    const n = firstInt(v)
    if (n != null && !out.includes(n)) out.push(n)
  }
  return out
}

function intRange(from, to) {
  if (from == null) return []
  if (to == null || to <= from || to - from >= MAX_EPISODE_SPAN) return [from]
  const out = []
  for (let n = from; n <= to; n++) out.push(n)
  return out
}

module.exports = { firstInt, intList, intRange }
