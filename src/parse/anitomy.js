const { parse } = require('anitomy')
const { firstInt, intRange } = require('./values')

function fromAnitomy(name) {
  const a = parse(name)
  const episode = a.episode || {}
  const season = firstInt(a.season)
  const episodes = intRange(firstInt(episode.number), firstInt(episode.numberAlt))
  return {
    parser: 'anitomy',
    title: a.title || null,
    year: firstInt(a.year),
    season,
    episodes,
    isEpisode: season != null || episodes.length > 0,
  }
}

module.exports = { fromAnitomy }
