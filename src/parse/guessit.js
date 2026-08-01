const { guessit } = require('guessit-js')
const { firstInt, intList } = require('./values')

function fromGuessit(name) {
  const g = guessit(name)
  return {
    parser: 'guessit',
    title: (Array.isArray(g.title) ? g.title[0] : g.title) || null,
    year: g.year || null,
    season: firstInt(g.season),
    episodes: intList(g.episode ?? g.absolute_episode),
    isEpisode: g.type === 'episode',
  }
}

module.exports = { fromGuessit }
