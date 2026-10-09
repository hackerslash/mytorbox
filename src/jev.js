const { TYPESAFE_API_KEY } = require('./config')
const { getJson } = require('./httpUtils')
const stats = require('./stats')

const MAX_CANDIDATES = 8
const NONE = 'none'
const EXTRA = 'extra'

function describe(r, alternativeTitles) {
  const name = r.title || r.name || ''
  const original = r.original_title || r.original_name
  const date = r.release_date || r.first_air_date || ''
  return {
    title: name,
    original_title: original && original !== name ? original : undefined,
    alternative_titles: alternativeTitles && alternativeTitles.length ? alternativeTitles : undefined,
    year: date.slice(0, 4) || undefined,
    overview: (r.overview || '').slice(0, 240) || undefined,
  }
}

function buildRequest(title, year, kind, candidates, alts = [], filename) {
  const criteria = {}
  candidates.forEach((r, i) => {
    criteria[`c${i}`] = describe(r, alts[i])
  })
  criteria[NONE] = 'None of the candidates is the same work as the parsed title.'
  if (filename) {
    criteria[EXTRA] =
      'The file is not a movie or an episode at all: a featurette, making-of, behind-the-scenes, interview, promo, ' +
      'trailer, teaser, deleted scene, stage greeting, panel, or similar bonus material.'
  }
  const what = kind === 'movie' ? 'movie' : 'TV series'
  return {
    model: 'jev-latest',
    state: { parsed_title: title, parsed_year: year || null, filename: filename || undefined },
    questions: {
      match: {
        type: 'choice',
        instructions:
          `\`parsed_title\` was parsed from a video filename in someone's torrent library, and \`parsed_year\` is the year in that filename if there was one. ` +
          `The options are TMDB ${what} search results. Which option is the same ${what} the file contains? ` +
          'Parsed titles can be abbreviated, misspelled, transliterated, translated, or have release tags left in them. ' +
          'Each option lists its main title and, when known, its alternative titles in other languages and regions; a match on any of them counts. ' +
          'Sequel numbers and years matter: a different installment or remake is not the same work. ' +
          'When `filename` is given, it is the file itself; a bonus feature, featurette, promo, or interview is not the work, so choose extra for it. ' +
          'Choose none only when the file is a movie or episode and the candidates are clearly different works.',
        criteria,
      },
    },
  }
}

// null = Jev chose none; EXTRA = the file is bonus material, not a work; undefined = the call failed.
async function pickCandidate(title, year, kind, candidates, alts, filename) {
  try {
    const data = await getJson('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequest(title, year, kind, candidates, alts, filename)),
    }, 2)
    const choice = data.answers.match.choice
    stats.track(choice === NONE || choice === EXTRA ? `jev:${choice}` : 'jev:pick')
    if (choice === NONE) return null
    if (choice === EXTRA) return EXTRA
    return candidates[Number(choice.slice(1))]
  } catch {
    stats.track('jev:error')
    return undefined
  }
}

module.exports = { pickCandidate, MAX_CANDIDATES, EXTRA }
