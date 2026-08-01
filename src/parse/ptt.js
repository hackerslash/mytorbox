const PTT = require('parse-torrent-title')
const { firstInt, intList } = require('./values')

function fromPtt(name) {
  const p = PTT.parse(name)
  const season = firstInt(p.season)
  const episodes = intList(p.episode)
  return {
    parser: 'ptt',
    title: p.title || null,
    year: firstInt(p.year),
    season,
    episodes,
    isEpisode: season != null || episodes.length > 0,
  }
}

module.exports = { fromPtt }
