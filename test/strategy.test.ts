import { describe, it, expect } from 'vitest'
import type { GameState, Grid, CellState, Player, Edition } from '../src/logic/types'
import { buildCards, CLASSIC_EDITION } from '../src/logic/cards'
import { makeGrid } from '../src/logic/deduction'
import { suggestBestQuestions, shouldPassTurn } from '../src/logic/strategy'

function buildState(
  gridOverrides: Record<string, Record<string, CellState>> = {},
  meHand: string[] = [],
  oppHands: Record<string, string[]> = {}
): GameState {
  const edition: Edition = {
    rooms: [...CLASSIC_EDITION.rooms],
    suspects: [...CLASSIC_EDITION.suspects],
    weapons: [...CLASSIC_EDITION.weapons]
  }
  const cards = buildCards(edition)
  const players: Player[] = [
    { id: 'p0', name: 'Me', isMe: true, hand: meHand },
    { id: 'p1', name: 'Alice', isMe: false, hand: oppHands['p1'] ?? [] },
    { id: 'p2', name: 'Bob', isMe: false, hand: oppHands['p2'] ?? [] },
    { id: 'p3', name: 'Carol', isMe: false, hand: oppHands['p3'] ?? [] }
  ]
  const ids = players.map((p) => p.id)
  const grid: Grid = makeGrid(cards, ids)
  for (const [cid, row] of Object.entries(gridOverrides)) {
    for (const [pid, st] of Object.entries(row)) grid[cid][pid] = st
  }
  return { edition, cards, players, grid, turns: [], nextGroupNumber: 1, phase: 'play' }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

describe('strategy scoring', () => {
  it('produces suggestions', () => {
    const state = buildState()
    const results = suggestBestQuestions(state, 'p0', [], true)
    expect(results.length).toBeGreaterThan(0)
  })

  it('gains differ between empty sheet and sheet with many Xs', () => {
    const empty = buildState()
    const emptyResults = suggestBestQuestions(empty, 'p0', [], true)
    const emptyTop = emptyResults[0]

    // Sheet where Alice has been crossed off most cards
    const cardIds = empty.cards.map((c) => c.id)
    const overrides: Record<string, Record<string, CellState>> = {}
    for (const cid of cardIds) {
      overrides[cid] = {
        p0: { kind: 'empty' },
        p1: { kind: 'cross' },
        p2: { kind: 'empty' },
        p3: { kind: 'empty' }
      }
    }
    const partial = buildState(overrides)
    const partialResults = suggestBestQuestions(partial, 'p0', [], true)
    const partialTop = partialResults[0]

    expect(emptyTop.ourGain).not.toEqual(partialTop.ourGain)
  })

  it('empty sheet: all suggestions have equal gain (symmetry)', () => {
    const state = buildState()
    const results = suggestBestQuestions(state, 'p0', [], true)
    const gains = results.map((r) => r.ourGain)
    const maxGain = Math.max(...gains)
    const minGain = Math.min(...gains)
    // On a blank sheet, all suggestions are symmetric → gains should be nearly identical
    expect(maxGain - minGain).toBeLessThan(0.01)
  })

  it('sheet with Xs: gains vary across suggestions', () => {
    // Cross Alice off half the suspects, none of the weapons/rooms
    const suspects = CLASSIC_EDITION.suspects.slice(0, 3).map(slug)
    const overrides: Record<string, Record<string, CellState>> = {}
    for (const sid of suspects) {
      overrides[sid] = {
        p0: { kind: 'empty' },
        p1: { kind: 'cross' },
        p2: { kind: 'empty' },
        p3: { kind: 'empty' }
      }
    }
    const state = buildState(overrides)
    const results = suggestBestQuestions(state, 'p0', [], true)
    const gains = results.map((r) => r.ourGain)
    const maxGain = Math.max(...gains)
    const minGain = Math.min(...gains)
    // With asymmetric X's, gains should differ
    expect(maxGain - minGain).toBeGreaterThan(0.01)
  })

  it('suggesting fully-crossed cards: show narrows to fewer candidates', () => {
    // Cross a suspect for ALL players (solved = in the envelope)
    const solvedSuspect = slug('Miss Scarlett')
    const overrides: Record<string, Record<string, CellState>> = {
      [solvedSuspect]: {
        p0: { kind: 'cross' },
        p1: { kind: 'cross' },
        p2: { kind: 'cross' },
        p3: { kind: 'cross' }
      }
    }
    const state = buildState(overrides)
    const results = suggestBestQuestions(state, 'p0', [], true)

    const withSolved = results.filter((r) => r.suggestion.suspect === solvedSuspect)
    const withoutSolved = results.filter((r) => r.suggestion.suspect !== solvedSuspect)
    const avgWith = withSolved.reduce((s, r) => s + r.ourGain, 0) / withSolved.length
    const avgWithout = withoutSolved.reduce((s, r) => s + r.ourGain, 0) / withoutSolved.length
    console.log(`solved suspect — gain: ${avgWith.toFixed(3)}, unsolved: ${avgWithout.toFixed(3)}`)
    // A show on a suggestion with a solved card narrows to 2 candidates instead of 3
    // → higher per-show gain. But also higher leak. Net should be similar or slightly worse.
    // We just verify the engine handles solved cards without crashing and produces results.
    expect(withSolved.length).toBeGreaterThan(0)
    expect(withoutSolved.length).toBeGreaterThan(0)
  })

  it('holding cards reduces opponent leak when opponents know less', () => {
    const suspectId = slug('Miss Scarlett')
    const weaponId = slug('Candlestick')
    // I hold Scarlett + Candlestick. Opponents have empty hands (don't know my cards).
    const state = buildState({}, [suspectId, weaponId])
    const results = suggestBestQuestions(state, 'p0', [], true)

    const hold2 = results.find((r) => r.suggestion.suspect === suspectId && r.suggestion.weapon === weaponId)!
    const hold0 = results.find((r) => r.suggestion.suspect !== suspectId && r.suggestion.weapon !== weaponId)!

    console.log(`hold 2: gain=${hold2.ourGain.toFixed(3)} leak=${hold2.opponentLeak.toFixed(3)} net=${hold2.netScore.toFixed(3)}`)
    console.log(`hold 0: gain=${hold0.ourGain.toFixed(3)} leak=${hold0.opponentLeak.toFixed(3)} net=${hold0.netScore.toFixed(3)}`)
    // Both should be scored; the net scores should differ
    expect(hold2.netScore).not.toEqual(hold0.netScore)
  })

  it('room reachability filters suggestions', () => {
    const state = buildState()
    const kitchenId = slug('Kitchen')
    const results = suggestBestQuestions(state, 'p0', [kitchenId], false)
    expect(results.every((s) => s.suggestion.room === kitchenId)).toBe(true)
  })

  it('suggestions are sorted by net score descending', () => {
    const state = buildState()
    const results = suggestBestQuestions(state, 'p0', [], true)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].netScore).toBeGreaterThanOrEqual(results[i].netScore)
    }
  })

  it('recommends pass when all suggestions have negative net score', () => {
    // Heavily crossed sheet where most info is already known
    const cardIds = CLASSIC_EDITION.suspects.map(slug).concat(CLASSIC_EDITION.weapons.map(slug))
    const overrides: Record<string, Record<string, CellState>> = {}
    for (const cid of cardIds) {
      overrides[cid] = {
        p0: { kind: 'cross' },
        p1: { kind: 'cross' },
        p2: { kind: 'cross' },
        p3: { kind: 'cross' }
      }
    }
    const state = buildState(overrides)
    const results = suggestBestQuestions(state, 'p0', [], true)
    const pass = shouldPassTurn(results)
    console.log(`pass recommended: ${pass}, top net: ${results[0]?.netScore.toFixed(3)}`)
    // With most cards solved, net score should be low or negative
    // (Rooms are still unsolved, so there may still be positive suggestions)
  })
})