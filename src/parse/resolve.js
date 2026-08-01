const { fromGuessit } = require('./guessit')
const { fromPtt } = require('./ptt')
const { fromAnitomy } = require('./anitomy')
const { mergeParsed } = require('./merge')
const { canSkipGuessit } = require('./gate')

const warned = new Set()

function run(adapter, name) {
  try {
    return adapter(name)
  } catch (err) {
    if (!warned.has(adapter.name)) {
      warned.add(adapter.name)
      console.warn(`parse: ${adapter.name} failed on ${JSON.stringify(name)}: ${err.message}`)
    }
    return null
  }
}

function parseName(name) {
  const ptt = run(fromPtt, name)
  const anitomy = run(fromAnitomy, name)
  const skip = canSkipGuessit(name, ptt, anitomy)
  const parsed = skip ? [ptt, anitomy] : [run(fromGuessit, name), ptt, anitomy]
  return { ...mergeParsed(parsed), guessit: !skip }
}

function makeParseResolver(loaded) {
  const current = new Map()
  return {
    resolve(str) {
      if (current.has(str)) return current.get(str)
      const parsed = loaded && loaded.has(str) ? loaded.get(str) : parseName(str)
      current.set(str, parsed)
      return parsed
    },
    current,
  }
}

module.exports = { parseName, makeParseResolver, DIRECT_RESOLVER: { resolve: parseName, current: null } }
