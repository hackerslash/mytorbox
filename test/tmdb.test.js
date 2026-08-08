const test = require('node:test')
const assert = require('node:assert/strict')

const { titleVariants, stripStudioPrefix } = require('../src/tmdb')

test('strips studio branding prepended to the title', () => {
  assert.equal(stripStudioPrefix("Marvel Studios' Black Widow"), 'Black Widow')
  assert.equal(stripStudioPrefix('Marvel Studios Black Widow'), 'Black Widow')
  assert.equal(stripStudioPrefix("Walt Disney Pictures' Frozen"), 'Frozen')
  assert.equal(stripStudioPrefix('Walt Disney Animation Studios Encanto'), 'Encanto')
  assert.equal(stripStudioPrefix('Pixar Soul'), 'Soul')
})

test('leaves titles without studio branding untouched', () => {
  assert.equal(stripStudioPrefix('Black Widow'), 'Black Widow')
  assert.equal(stripStudioPrefix('The Marvels'), 'The Marvels')
  assert.equal(stripStudioPrefix('Studio 54'), 'Studio 54')
})

test('offers a studio-stripped search variant on the retry chain', () => {
  assert.deepEqual(titleVariants("Marvel Studios' Black Widow", 'movie'), ['Black Widow'])
  assert.deepEqual(titleVariants('Black Widow', 'movie'), [])
})

test('expands a P<n>/Pt<n> part abbreviation as a variant, keeping the number', () => {
  assert.ok(titleVariants('The Godfather P1', 'movie').includes('The Godfather Part 1'))
  assert.ok(titleVariants('The Godfather Pt2', 'movie').includes('The Godfather Part 2'))
  assert.deepEqual(titleVariants('The Godfather', 'movie'), [])
})

test('offers a format-stripped variant for 3D/SBS tags', () => {
  assert.ok(titleVariants('Black Adam 3D', 'movie').includes('Black Adam'))
  assert.ok(titleVariants('Avatar Half-SBS', 'movie').includes('Avatar'))
  assert.deepEqual(titleVariants('Black Adam', 'movie'), [])
})

test('offers the leading Cyrillic run first, dropping the Latin/junk tail', () => {
  assert.deepEqual(titleVariants('Донни Дарко DC', 'movie'), ['Донни Дарко'])
  assert.deepEqual(titleVariants('Извне From Сезон 1 Серии 1-10', 'tv'), ['Извне'])
  assert.equal(titleVariants('Перемещение В движении Moving Mubing Сезон 1 Серии 1', 'tv')[0], 'Перемещение В движении')
  assert.equal(titleVariants('Black Widow', 'movie').length, 0)
})
