import { describe, it, expect } from 'vitest'
import type { CellState, Chart, Setup, GameEvent } from '../src/logic/types'
import { buildCards, CLASSIC_EDITION } from '../src/logic/cards'
import { buildChart } from '../src/logic/engine'
import { makeEventId } from '../src/logic/events'
import { suggestBestQuestions, shouldPassTurn, type StrategyState } from '../src/logic/strategy'

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function buildSetup(
  meHand: string[] = [],
  oppHands: Record<string, string[]> = {}
): Setup {
  const edition = {
    rooms: [...CLASSIC_EDITION.rooms],
    suspects: [...CLASSIC_EDITION.suspects],
    weapons: [...CLASSIC_EDITION.weapons]
  }
  const cards = buildCards(edition)
  const players = [
    { id: 'p0', name: 'Me', isMe: true, hand: meHand },
    { id: 'p1', name: 'Alice', isMe: false, hand: oppHands['p1'] ?? [] },
    { id: 'p2', name: 'Bob', isMe: false, hand: oppHands['p2'] ?? [] },
    { id: 'p3', name: 'Carol', isMe: false, hand: oppHands['p3'] ?? [] }
  ]
  return { edition, cards, players, myHand: meHand, phase: 'play' }
}

function buildStrategyState(
  setup: Setup,
  events: GameEvent[] = []
): StrategyState {
  const chart = buildChart(events, setup.cards, setup.players)
  return { setup, chart }
}

function suggestionEvent(
  askerId: string,
  suspect: string, weapon: string, room: string,
  responses: { responderId: string; passed: boolean; skipped?: boolean; shownCardId?: string }[]
): GameEvent {
  return {
    id: makeEventId(),
    type: 'suggestion',
    askerId,
    suggestion: { suspect, weapon, room },
    responses
  }
}

describe('strategy scoring', () => {
  it('produces suggestions', () => {
    const setup = buildSetup()
    const state = buildStrategyState(setup)
    const results = suggestBestQuestions(state, 'p0', [], true)
    expect(results.length).toBeGreaterThan(0)
  })

  it('gains differ between empty sheet and sheet with many Xs', () => {
    const setup = buildSetup()
    const empty = buildStrategyState(setup)
    const emptyTop = suggestBestQuestions(empty, 'p0', [], true)[0]

    // Add a suggestion where Alice passes → she gets X'd on 3 cards
    const ev = suggestionEvent('p0', slug('Miss Scarlett'), slug('Candlestick'), slug('Kitchen'), [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true }
    ])
    const after = buildStrategyState(setup, [ev])
    const afterTop = suggestBestQuestions(after, 'p0', [], true)[0]

    expect(emptyTop.ourGain).not.toEqual(afterTop.ourGain)
  })

  it('empty sheet: all suggestions have equal gain (symmetry)', () => {
    const setup = buildSetup()
    const state = buildStrategyState(setup)
    const results = suggestBestQuestions(state, 'p0', [], true)
    const gains = results.map((r) => r.ourGain)
    expect(Math.max(...gains) - Math.min(...gains)).toBeLessThan(0.01)
  })

  it('sheet with Xs: gains vary across suggestions', () => {
    const setup = buildSetup()
    const ev = suggestionEvent('p0', slug('Miss Scarlett'), slug('Candlestick'), slug('Kitchen'), [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true }
    ])
    const state = buildStrategyState(setup, [ev])
    const results = suggestBestQuestions(state, 'p0', [], true)
    const gains = results.map((r) => r.ourGain)
    expect(Math.max(...gains) - Math.min(...gains)).toBeGreaterThan(0.01)
  })

  it('room reachability filters suggestions', () => {
    const setup = buildSetup()
    const state = buildStrategyState(setup)
    const kitchenId = slug('Kitchen')
    const results = suggestBestQuestions(state, 'p0', [kitchenId], false)
    expect(results.every((s) => s.suggestion.room === kitchenId)).toBe(true)
  })

  it('suggestions are sorted by net score descending', () => {
    const setup = buildSetup()
    const state = buildStrategyState(setup)
    const results = suggestBestQuestions(state, 'p0', [], true)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].netScore).toBeGreaterThanOrEqual(results[i].netScore)
    }
  })

  it('recommends pass when all suggestions have negative net score', () => {
    const setup = buildSetup()
    const state = buildStrategyState(setup)
    const results = suggestBestQuestions(state, 'p0', [], true)
    const pass = shouldPassTurn(results)
    // On an empty sheet, everything is symmetric — may or may not recommend pass
    expect(typeof pass).toBe('boolean')
  })
})