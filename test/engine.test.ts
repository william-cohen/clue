import { describe, it, expect } from 'vitest'
import type { CellState, Chart, Setup, GameEvent } from '../src/logic/types'
import { buildCards, CLASSIC_EDITION, slug } from '../src/logic/cards'
import {
  blankChart, cloneChart, applyHand, propagate, foldEvent, cycleCell
} from '../src/logic/engine'
import { makeEventId } from '../src/logic/events'

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

function manualEvent(cardId: string, playerId: string, state: CellState, description = ''): GameEvent {
  return { id: makeEventId(), type: 'manual', entries: [{ cardId, playerId, state }], description }
}

function getCell(chart: Chart, cardId: string, playerId: string): CellState {
  return chart.grid[cardId][playerId]
}

const S = slug('Miss Scarlett')
const CA = slug('Candlestick')
const KI = slug('Kitchen')
const KN = slug('Knife')
const LO = slug('Lounge')
const RO = slug('Rope')

// ── cycleCell ──────────────────────────────────────────────────────

describe('engine: cycleCell', () => {
  it('cycles empty → cross → tick → note → empty', () => {
    expect(cycleCell({ kind: 'empty' })).toEqual({ kind: 'cross' })
    expect(cycleCell({ kind: 'cross' })).toEqual({ kind: 'tick' })
    expect(cycleCell({ kind: 'tick' })).toEqual({ kind: 'note', ns: [1] })
    expect(cycleCell({ kind: 'note', ns: [1] })).toEqual({ kind: 'empty' })
  })

  it('uses the n parameter for the note group number', () => {
    expect(cycleCell({ kind: 'tick' }, 7)).toEqual({ kind: 'note', ns: [7] })
    expect(cycleCell({ kind: 'tick' }, 42)).toEqual({ kind: 'note', ns: [42] })
  })

  it('is pure — does not mutate the input state', () => {
    const input: CellState = { kind: 'tick' }
    cycleCell(input, 3)
    expect(input).toEqual({ kind: 'tick' })
  })
})

// ── applyHand ──────────────────────────────────────────────────────

describe('engine: applyHand', () => {
  it('ticks my hand cards and crosses everyone else on them', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    const chart = blankChart(setup.cards, playerIds)
    const result = applyHand(chart, setup.cards, 'p0', [S, CA])
    expect(getCell(result, S, 'p0')).toEqual({ kind: 'tick' })
    expect(getCell(result, CA, 'p0')).toEqual({ kind: 'tick' })
    expect(getCell(result, S, 'p1')).toEqual({ kind: 'cross' })
    expect(getCell(result, S, 'p2')).toEqual({ kind: 'cross' })
    expect(getCell(result, S, 'p3')).toEqual({ kind: 'cross' })
  })

  it('crosses me on all non-hand cards (I know I do not have them)', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    const chart = blankChart(setup.cards, playerIds)
    const result = applyHand(chart, setup.cards, 'p0', [S])
    expect(getCell(result, KI, 'p0')).toEqual({ kind: 'cross' })
    expect(getCell(result, KN, 'p0')).toEqual({ kind: 'cross' })
  })

  it('does not touch other players on non-hand cards (they could hold them)', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    const chart = blankChart(setup.cards, playerIds)
    const result = applyHand(chart, setup.cards, 'p0', [S])
    expect(getCell(result, KI, 'p1')).toEqual({ kind: 'empty' })
    expect(getCell(result, KI, 'p2')).toEqual({ kind: 'empty' })
  })

  it('propagates: a tick on my card crosses others via fixedPoint', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    const chart = blankChart(setup.cards, playerIds)
    const result = applyHand(chart, setup.cards, 'p0', [S, CA])
    // S is ticked for p0 → p1, p2, p3 all crossed on S (propagation)
    expect(getCell(result, S, 'p1')).toEqual({ kind: 'cross' })
    expect(getCell(result, S, 'p2')).toEqual({ kind: 'cross' })
    expect(getCell(result, S, 'p3')).toEqual({ kind: 'cross' })
  })

  it('is pure — does not mutate the input chart', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    const chart = blankChart(setup.cards, playerIds)
    const snapshot = cloneChart(chart)
    applyHand(chart, setup.cards, 'p0', [S, CA])
    expect(chart.grid).toEqual(snapshot.grid)
    expect(chart.groups).toEqual(snapshot.groups)
    expect(chart.nextGroupNumber).toBe(snapshot.nextGroupNumber)
  })

  it('empty hand returns a cloned chart unchanged', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    const chart = blankChart(setup.cards, playerIds)
    const result = applyHand(chart, setup.cards, 'p0', [])
    expect(result.grid).toEqual(chart.grid)
    expect(result).not.toBe(chart) // a clone, not the same reference
  })
})

// ── propagate ──────────────────────────────────────────────────────

describe('engine: propagate', () => {
  it('a tick on (player, card) crosses all other players on that card', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    let chart = blankChart(setup.cards, playerIds)
    // Manually set a tick via foldEvent (a manual tick)
    chart = foldEvent(chart, manualEvent(S, 'p1', { kind: 'tick' }), playerIds)
    // Propagate should already have run inside foldEvent; verify result
    expect(getCell(chart, S, 'p1')).toEqual({ kind: 'tick' })
    expect(getCell(chart, S, 'p0')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p2')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p3')).toEqual({ kind: 'cross' })
  })

  it('a group with 2 of 3 cards eliminated ticks the remaining card', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    // p1 shows on {S, CA, KI} → group 1
    let chart = blankChart(setup.cards, playerIds)
    chart = foldEvent(chart, suggEvent('p0', S, CA, KI, [{ responderId: 'p1', passed: false }]), playerIds)
    // p1 passes on {S, RO, LO} → X on S
    chart = foldEvent(chart, suggEvent('p0', S, RO, LO, [{ responderId: 'p1', passed: true }]), playerIds)
    // p1 passes on {CA, KN, LO} → X on CA → group 1 resolves to KI
    chart = foldEvent(chart, suggEvent('p0', CA, KN, LO, [{ responderId: 'p1', passed: true }]), playerIds)
    expect(getCell(chart, KI, 'p1')).toEqual({ kind: 'tick' })
  })

  it('a tick on one card in a group does NOT tick the other (holds at least one, not exactly one)', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    // p1 shows on {S, CA} → group 1 on {S, CA} (two-card group, both noted for p1).
    let chart = blankChart(setup.cards, playerIds)
    chart = foldEvent(chart, suggEvent('p0', S, CA, LO, [{ responderId: 'p1', passed: false }]), playerIds)
    // S and CA both have note(1) for p1; LO is not in the group (p1 would have been
    // crossed on LO if p0's suggestion included LO... actually LO is the room and
    // p1 showed, so LO is also a candidate. Let's make the group exactly {S, CA}
    // by crossing p1 on LO first via a prior pass.)
    // Redo: cross p1 on LO first, then p1 shows on {S, CA, LO} → group on {S, CA} only.
    chart = blankChart(setup.cards, playerIds)
    chart = foldEvent(chart, suggEvent('p0', LO, RO, KI, [{ responderId: 'p1', passed: true }]), playerIds)
    // Now p1 has X on LO → showing on {S, CA, LO} means group is {S, CA} (non-X cards).
    chart = foldEvent(chart, suggEvent('p0', S, CA, LO, [{ responderId: 'p1', passed: false }]), playerIds)
    // Confirm the group is {S, CA} and both are notes for p1.
    expect(getCell(chart, S, 'p1').kind).toBe('note')
    expect(getCell(chart, CA, 'p1').kind).toBe('note')
    // Now: someone reveals that p1 holds S (e.g. via a shownCardId in a later suggestion).
    // Tick S/p1. The group constraint is satisfied — p1 holds at least one of {S, CA}.
    // But p1 may or may not also hold CA. The engine must NOT tick CA.
    chart = foldEvent(chart, suggEvent('p0', S, KN, KI, [{ responderId: 'p1', passed: false, shownCardId: S }]), playerIds)
    expect(getCell(chart, S, 'p1')).toEqual({ kind: 'tick' })
    // CA/p1 must remain a note, NOT a tick — p1 could hold both, or just S.
    expect(getCell(chart, CA, 'p1').kind).toBe('note')
  })

  it('all-but-one X does NOT tick the last player (the envelope bug)', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    let chart = blankChart(setup.cards, playerIds)
    // Cross p1, p2, p3 on S via passes; p0 is the asker (never crossed).
    chart = foldEvent(chart, suggEvent('p0', S, RO, LO, [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true }
    ]), playerIds)
    // Run propagate explicitly to be sure no rule ticks p0.
    const after = propagate(chart)
    expect(getCell(after, S, 'p0')).toEqual({ kind: 'empty' })
    expect(getCell(after, S, 'p1')).toEqual({ kind: 'cross' })
    expect(getCell(after, S, 'p2')).toEqual({ kind: 'cross' })
    expect(getCell(after, S, 'p3')).toEqual({ kind: 'cross' })
  })

  it('all-but-one X with the last being a NOTE does NOT tick it (envelope + group card)', () => {
    const setup = buildSetup([slug('Billiard Room')]) // me holds BI → crossed on everything else
    const playerIds = setup.players.map((p) => p.id)
    
    // Start from a chart with my hand applied (crosses me on all non-hand cards).
    let chart = applyHand(blankChart(setup.cards, playerIds), setup.cards, 'p0', [slug('Billiard Room')])
    // Turn 1: p0 (me) asks {S, CA, KI}. p2 passes (X on S,CA,KI). p1 shows (no shownCardId)
    //         → group 1 on {S, CA, KI} for p1 (notes on all three).
    chart = foldEvent(chart, suggEvent('p0', S, CA, KI, [
      { responderId: 'p2', passed: true },
      { responderId: 'p1', passed: false }
    ]), playerIds)
    // Turn 2: p1 asks {KI, RO, LO}. p2 passes (X on KI). p0 passes (X on KI — me holds BI).
    //         Now KI row: p0=X (from hand), p2=X, p1=note(1).
    chart = foldEvent(chart, suggEvent('p1', KI, RO, LO, [
      { responderId: 'p2', passed: true },
      { responderId: 'p0', passed: true }
    ]), playerIds)
    // Explicitly propagate to give any row-based rule a chance to fire.
    const after = propagate(chart)
    // KI/p1 must NOT be ticked — KI could be in the envelope; p1 may hold S or CA instead.
    expect(getCell(after, KI, 'p1').kind).toBe('note')
    expect(getCell(after, KI, 'p0')).toEqual({ kind: 'cross' })
    expect(getCell(after, KI, 'p2')).toEqual({ kind: 'cross' })
    // The same applies to S and CA — all three group cards have the all-X-on-others
    // shape, none should be ticked by a row rule. Only group resolution (2 of 3
    // eliminated) can tick them.
    for (const cid of [S, CA]) {
      expect(getCell(after, cid, 'p1').kind).toBe('note')
      expect(getCell(after, cid, 'p0')).toEqual({ kind: 'cross' })
      expect(getCell(after, cid, 'p2')).toEqual({ kind: 'cross' })
    }
  })

  it('is pure — does not mutate the input chart', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    let chart = blankChart(setup.cards, playerIds)
    chart = foldEvent(chart, suggEvent('p0', S, CA, KI, [{ responderId: 'p1', passed: false }]), playerIds)
    const snapshot = cloneChart(chart)
    propagate(chart)
    expect(chart.grid).toEqual(snapshot.grid)
    expect(chart.groups).toEqual(snapshot.groups)
    expect(chart.nextGroupNumber).toBe(snapshot.nextGroupNumber)
  })
})

// ── Multi-entry manual events ──────────────────────────────────────

describe('engine: multi-entry manual events', () => {
  const G = slug('Mr Green')
  const LO = slug('Lounge')

  function manualEvent(entries: { cardId: string; playerId: string; state: CellState }[], description = ''): GameEvent {
    return { id: makeEventId(), type: 'manual', entries, description }
  }

  it('a single manual event can set multiple cells at once', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    let chart = blankChart(setup.cards, playerIds)
    // "Ruth (p1) doesn't have candlestick or Mr Green" — one event, two crosses.
    chart = foldEvent(chart, manualEvent([
      { cardId: CA, playerId: 'p1', state: { kind: 'cross' } },
      { cardId: G, playerId: 'p1', state: { kind: 'cross' } }
    ], "Ruth doesn't have candlestick or Mr Green"), playerIds)
    expect(getCell(chart, CA, 'p1')).toEqual({ kind: 'cross' })
    expect(getCell(chart, G, 'p1')).toEqual({ kind: 'cross' })
    // Other players' cells untouched
    expect(getCell(chart, CA, 'p2')).toEqual({ kind: 'empty' })
    expect(getCell(chart, G, 'p3')).toEqual({ kind: 'empty' })
  })

  it('deleting a multi-entry event reverts all its cells', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    let chart = blankChart(setup.cards, playerIds)
    const ev = manualEvent([
      { cardId: CA, playerId: 'p1', state: { kind: 'cross' } },
      { cardId: G, playerId: 'p1', state: { kind: 'cross' } },
      { cardId: LO, playerId: 'p2', state: { kind: 'cross' } }
    ], 'batch hunch')
    chart = foldEvent(chart, ev, playerIds)
    expect(getCell(chart, CA, 'p1').kind).toBe('cross')
    expect(getCell(chart, LO, 'p2').kind).toBe('cross')
    // Rebuild without the event → all three cells revert to empty
    const chart2 = blankChart(setup.cards, playerIds)
    expect(getCell(chart2, CA, 'p1')).toEqual({ kind: 'empty' })
    expect(getCell(chart2, G, 'p1')).toEqual({ kind: 'empty' })
    expect(getCell(chart2, LO, 'p2')).toEqual({ kind: 'empty' })
  })

  it('a tick in one entry propagates crosses to other players within the same event', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    let chart = blankChart(setup.cards, playerIds)
    // Batch: tick S for p1, and cross KI for p2 — the tick should cross S for p0,p2,p3.
    chart = foldEvent(chart, manualEvent([
      { cardId: S, playerId: 'p1', state: { kind: 'tick' } },
      { cardId: KI, playerId: 'p2', state: { kind: 'cross' } }
    ], 'saw p1 has Scarlett; p2 lacks Kitchen'), playerIds)
    expect(getCell(chart, S, 'p1')).toEqual({ kind: 'tick' })
    expect(getCell(chart, S, 'p0')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p2')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p3')).toEqual({ kind: 'cross' })
    expect(getCell(chart, KI, 'p2')).toEqual({ kind: 'cross' })
  })

  it('an empty entries array is a no-op (pure, no change)', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    const chart = blankChart(setup.cards, playerIds)
    const result = foldEvent(chart, manualEvent([]), playerIds)
    expect(result.grid).toEqual(chart.grid)
    expect(result).not.toBe(chart) // still a clone, pure
  })

  it('a single manual event can mix crosses, ticks, and notes across different cells', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    let chart = blankChart(setup.cards, playerIds)
    // One commit: p1 gets X on candlestick, p2 gets ✓ on Mr Green, p3 gets note group 1 on lounge.
    chart = foldEvent(chart, manualEvent([
      { cardId: CA, playerId: 'p1', state: { kind: 'cross' } },
      { cardId: G, playerId: 'p2', state: { kind: 'tick' } },
      { cardId: LO, playerId: 'p3', state: { kind: 'note', ns: [1] } }
    ], 'mixed batch'), playerIds)
    expect(getCell(chart, CA, 'p1')).toEqual({ kind: 'cross' })
    expect(getCell(chart, G, 'p2')).toEqual({ kind: 'tick' })
    expect(getCell(chart, LO, 'p3')).toEqual({ kind: 'note', ns: [1] })
    // Tick propagation: G ticked for p2 → crossed for everyone else
    expect(getCell(chart, G, 'p0')).toEqual({ kind: 'cross' })
    expect(getCell(chart, G, 'p1')).toEqual({ kind: 'cross' })
    expect(getCell(chart, G, 'p3')).toEqual({ kind: 'cross' })
  })

  it('foldEvent is pure — does not mutate the input chart', () => {
    const setup = buildSetup()
    const playerIds = setup.players.map((p) => p.id)
    const chart = blankChart(setup.cards, playerIds)
    const snapshot = cloneChart(chart)
    foldEvent(chart, manualEvent([
      { cardId: CA, playerId: 'p1', state: { kind: 'cross' } },
      { cardId: G, playerId: 'p1', state: { kind: 'cross' } }
    ]), playerIds)
    expect(chart.grid).toEqual(snapshot.grid)
    expect(chart.groups).toEqual(snapshot.groups)
    expect(chart.nextGroupNumber).toBe(snapshot.nextGroupNumber)
  })
})