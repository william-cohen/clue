import { describe, it, expect } from 'vitest'
import type { Card, Chart, Setup, GameEvent } from '../src/logic/types'
import { buildCards, CLASSIC_EDITION, slug } from '../src/logic/cards'
import { blankChart, buildChart, foldEvent } from '../src/logic/engine'
import { makeEventId } from '../src/logic/events'
import { buildProbabilities, buildPriors, type ProbMap } from '../src/logic/bayes'

function buildSetup(meHand: string[] = []): Setup {
  const edition = {
    rooms: [...CLASSIC_EDITION.rooms],
    suspects: [...CLASSIC_EDITION.suspects],
    weapons: [...CLASSIC_EDITION.weapons]
  }
  const cards = buildCards(edition)
  const players = [
    { id: 'p0', name: 'Me', isMe: true, hand: meHand },
    { id: 'p1', name: 'Alice', isMe: false, hand: [] },
    { id: 'p2', name: 'Bob', isMe: false, hand: [] },
    { id: 'p3', name: 'Carol', isMe: false, hand: [] }
  ]
  return { edition, cards, players, myHand: meHand, phase: 'play' }
}

function suggEvent(
  askerId: string,
  suspect: string, weapon: string, room: string,
  responses: { responderId: string; passed: boolean; skipped?: boolean; shownCardId?: string | null }[]
): GameEvent {
  return {
    id: makeEventId(),
    type: 'suggestion',
    askerId,
    suggestion: { suspect, weapon, room },
    responses
  }
}

function getProb(probs: ProbMap, cardId: string, playerId: string): number {
  return probs[cardId]?.[playerId] ?? 0
}

const S = slug('Miss Scarlett')
const CA = slug('Candlestick')
const KI = slug('Kitchen')
const RO = slug('Rope')
const LO = slug('Lounge')

// ── Priors ─────────────────────────────────────────────────────────

describe('bayes: priors', () => {
  it('tick → 1.0, cross → 0.0', () => {
    const setup = buildSetup([S])
    const playerIds = setup.players.map((p) => p.id)
    const chart = buildChart([], setup.cards, setup.players)
    const probs = buildPriors(chart, setup.cards, playerIds)
    expect(getProb(probs, S, 'p0')).toBe(1.0)
    expect(getProb(probs, S, 'p1')).toBe(0.0)
  })

  it('empty → 1 / (non-crossed players + 1 for envelope)', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    const chart = blankChart(setup.cards, playerIds)
    const probs = buildPriors(chart, setup.cards, playerIds)
    expect(getProb(probs, KI, 'p0')).toBeCloseTo(0.2)
  })

  it('note → 1 / group_card_count', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    let chart = blankChart(setup.cards, playerIds)
    chart = foldEvent(chart, suggEvent('p0', S, CA, KI, [{ responderId: 'p1', passed: false }]), playerIds)
    const probs = buildPriors(chart, setup.cards, playerIds)
    // Group 1 has 3 cards → note prior = 1/3
    expect(getProb(probs, S, 'p1')).toBeCloseTo(1 / 3)
    expect(getProb(probs, CA, 'p1')).toBeCloseTo(1 / 3)
    expect(getProb(probs, KI, 'p1')).toBeCloseTo(1 / 3)
  })

  it('cross reduces other players\' priors', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    let chart = blankChart(setup.cards, playerIds)
    chart = foldEvent(chart, suggEvent('p0', KI, RO, LO, [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: true }
    ]), playerIds)
    const probs = buildPriors(chart, setup.cards, playerIds)
    expect(getProb(probs, KI, 'p0')).toBeCloseTo(1 / 3)
    expect(getProb(probs, KI, 'p3')).toBeCloseTo(1 / 3)
    expect(getProb(probs, KI, 'p1')).toBe(0)
    expect(getProb(probs, KI, 'p2')).toBe(0)
  })
})

// ── Asker update ──────────────────────────────────────────────────

describe('bayes: asker update', () => {
  it('suggesting a card lowers P(asker holds it) vs the chart priors', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    // p1 suggests {S, CA, KI}, everyone passes
    const ev = suggEvent('p1', S, CA, KI, [
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true },
      { responderId: 'p0', passed: true }
    ])
    let chart = blankChart(setup.cards, playerIds)
    chart = foldEvent(chart, ev, playerIds)
    // Priors from the chart (already has crosses from passes)
    const priors = buildPriors(chart, setup.cards, playerIds)
    // Bayesian probabilities (add the asker soft signal)
    const probs = buildProbabilities([ev], setup.cards, playerIds, chart)
    // The asker's probability for each suggested card should be lower than the
    // chart-derived prior (askers tend to not hold suggested cards).
    expect(getProb(probs, S, 'p1')).toBeLessThan(getProb(priors, S, 'p1'))
    expect(getProb(probs, CA, 'p1')).toBeLessThan(getProb(priors, CA, 'p1'))
    expect(getProb(probs, KI, 'p1')).toBeLessThan(getProb(priors, KI, 'p1'))
  })

  it('a card the asker cannot hold (cross=0) stays at 0', () => {
    const setup = buildSetup([S]) // me holds S → p1 crossed on S
    const playerIds = setup.players.map((p) => p.id)
    const ev = suggEvent('p1', S, CA, KI, [
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true },
      { responderId: 'p0', passed: true }
    ])
    const chart = buildChart([ev], setup.cards, setup.players)
    const probs = buildProbabilities([ev], setup.cards, playerIds, chart)
    // S/p1 is 0 (I hold it) — stays 0
    expect(getProb(probs, S, 'p1')).toBe(0)
    // CA and KI should be lowered by the asker signal
    const priors = buildPriors(chart, setup.cards, playerIds)
    expect(getProb(probs, CA, 'p1')).toBeLessThan(getProb(priors, CA, 'p1'))
  })

  it('repeated suggestions of the same card by the same asker compound', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    let chart = blankChart(setup.cards, playerIds)
    const events: GameEvent[] = []
    for (let i = 0; i < 3; i++) {
      const ev = suggEvent('p1', S, CA, KI, [
        { responderId: 'p2', passed: true },
        { responderId: 'p3', passed: true },
        { responderId: 'p0', passed: true }
      ])
      events.push(ev)
      chart = foldEvent(chart, ev, playerIds)
    }
    // After 1 event
    const chart1 = foldEvent(blankChart(setup.cards, playerIds), events[0], playerIds)
    const probs1 = buildProbabilities([events[0]], setup.cards, playerIds, chart1)
    // After 3 events
    const probs3 = buildProbabilities(events, setup.cards, playerIds, chart)
    expect(getProb(probs3, S, 'p1')).toBeLessThan(getProb(probs1, S, 'p1'))
  })

  it('different asker suggesting the same card does not lower the first asker\'s probability', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    let chart = blankChart(setup.cards, playerIds)
    // ev1: p1 asks {S, CA, KI}. p0 passes. p3 passes. p2 shows (p2 not crossed on S).
    const ev1 = suggEvent('p1', S, CA, KI, [
      { responderId: 'p2', passed: false },
      { responderId: 'p3', passed: true },
      { responderId: 'p0', passed: true }
    ])
    chart = foldEvent(chart, ev1, playerIds)

    // ev2: p2 asks {S, RO, LO}. p1 shows (p1 not crossed on S).
    const ev2 = suggEvent('p2', S, RO, LO, [
      { responderId: 'p3', passed: true },
      { responderId: 'p0', passed: true },
      { responderId: 'p1', passed: false }
    ])
    chart = foldEvent(chart, ev2, playerIds)

    const priors = buildPriors(chart, setup.cards, playerIds)
    const probs = buildProbabilities([ev1, ev2], setup.cards, playerIds, chart)

    // p1 (asker of ev1) should be lower than priors
    expect(getProb(probs, S, 'p1')).toBeLessThan(getProb(priors, S, 'p1'))
    // p2 (asker of ev2) should be lower than priors
    expect(getProb(probs, S, 'p2')).toBeLessThan(getProb(priors, S, 'p2'))
    // ev2 only touches p2: p1's probability with ev2 included should equal p1's
    // probability with ev2 excluded (same chart, just no ev2 Bayesian update)
    const probsWithoutEv2 = buildProbabilities([ev1], setup.cards, playerIds, chart)
    expect(getProb(probs, S, 'p1')).toBeCloseTo(getProb(probsWithoutEv2, S, 'p1'), 5)
  })
})

// ── Purity ─────────────────────────────────────────────────────────

describe('bayes: purity', () => {
  it('buildProbabilities is pure — same inputs → same output', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    const chart = blankChart(setup.cards, playerIds)
    const ev = suggEvent('p1', S, CA, KI, [
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true },
      { responderId: 'p0', passed: true }
    ])
    const p1 = buildProbabilities([ev], setup.cards, playerIds, chart)
    const p2 = buildProbabilities([ev], setup.cards, playerIds, chart)
    expect(p1).toEqual(p2)
  })
})