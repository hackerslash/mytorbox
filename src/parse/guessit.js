const { guessit } = require('guessit-js')
const { firstInt, intList } = require('./values')

function fromGuessit(name) {
  const g = guessit(name)
  const year = g.year || null
  const season = firstInt(g.season)
  return {
    parser: 'guessit',
    title: (Array.isArray(g.title) ? g.title[0] : g.title) || null,
    year,
    season: season === year ? null : season,
    episodes: intList(g.episode ?? g.absolute_episode),
    isEpisode: g.type === 'episode',
  }
}

module.exports = { fromGuessit }
