import { describe, it, expect } from 'vitest'
import type { CellState, Chart, Setup, GameEvent } from '../src/logic/types'
import { buildCards, CLASSIC_EDITION, slug } from '../src/logic/cards'
import { buildChart, foldEvent, blankChart, cloneChart } from '../src/logic/engine'
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

function manualEvent(
  cardId: string, playerId: string, state: CellState, description = ''
): GameEvent {
  return { id: makeEventId(), type: 'manual', entries: [{ cardId, playerId, state }], description }
}

function getCell(chart: Chart, cardId: string, playerId: string): CellState {
  return chart.grid[cardId][playerId]
}

const S = slug('Miss Scarlett')
const M = slug('Colonel Mustard')
const W = slug('Mrs White')
const G = slug('Mr Green')
const P = slug('Mrs Peacock')
const PL = slug('Professor Plum')
const CA = slug('Candlestick')
const KN = slug('Knife')
const LP = slug('Lead Pipe')
const RE = slug('Revolver')
const RO = slug('Rope')
const WR = slug('Wrench')
const KI = slug('Kitchen')
const BA = slug('Ballroom')
const CO = slug('Conservatory')
const DR = slug('Dining Room')
const BI = slug('Billiard Room')
const LI = slug('Library')
const LO = slug('Lounge')
const HA = slug('Hall')
const ST = slug('Study')

describe('inference: basic passes', () => {
  it('a pass crosses all 3 cards for the responder', () => {
    const setup = buildSetup()
    const ev = suggEvent('p0', S, CA, KI, [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true }
    ])
    const chart = buildChart([ev], setup.cards, setup.players)
    expect(getCell(chart, S, 'p1')).toEqual({ kind: 'cross' })
    expect(getCell(chart, CA, 'p1')).toEqual({ kind: 'cross' })
    expect(getCell(chart, KI, 'p1')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p2')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p3')).toEqual({ kind: 'cross' })
  })

  it('a show does NOT cross the shower\'s cards', () => {
    const setup = buildSetup()
    const ev = suggEvent('p0', S, CA, KI, [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: false }
    ])
    const chart = buildChart([ev], setup.cards, setup.players)
    expect(getCell(chart, S, 'p1')).toEqual({ kind: 'cross' })
    // p2 showed → no X on any of the 3
    expect(getCell(chart, S, 'p2').kind).not.toBe('cross')
    expect(getCell(chart, CA, 'p2').kind).not.toBe('cross')
    expect(getCell(chart, KI, 'p2').kind).not.toBe('cross')
  })
})

describe('inference: show creates a group', () => {
  it('a show with 3 unknown cards creates a note group', () => {
    const setup = buildSetup()
    const ev = suggEvent('p0', S, CA, KI, [
      { responderId: 'p1', passed: false }
    ])
    const chart = buildChart([ev], setup.cards, setup.players)
    // p1 should have notes on all 3 cards with group 1
    expect(getCell(chart, S, 'p1')).toEqual({ kind: 'note', ns: [1] })
    expect(getCell(chart, CA, 'p1')).toEqual({ kind: 'note', ns: [1] })
    expect(getCell(chart, KI, 'p1')).toEqual({ kind: 'note', ns: [1] })
    // group 1 should be recorded
    expect(chart.groups[1]).toEqual({ playerId: 'p1', cardIds: [S, CA, KI] })
  })

  it('a show with 1 unknown card ticks it directly', () => {
    const setup = buildSetup()
    // First, cross p1 on S and CA (via a pass)
    const ev1 = suggEvent('p0', S, CA, KI, [
      { responderId: 'p1', passed: true }
    ])
    const chart1 = buildChart([ev1], setup.cards, setup.players)
    // Now p1 passes on another suggestion containing S and CA → they're already X'd
    // Then someone shows on a suggestion with S, CA, and a new card
    const ev2 = suggEvent('p0', S, CA, LO, [
      { responderId: 'p1', passed: false }
    ])
    const chart2 = buildChart([ev1, ev2], setup.cards, setup.players)
    // p1 has X on S and CA (from ev1 pass), showed on {S, CA, LO} → must have LO
    expect(getCell(chart2, LO, 'p1')).toEqual({ kind: 'tick' })
  })
})

describe('inference: resolveNotes with groups map (THE BUG FIX)', () => {
  it('a group resolves when 2 of 3 cards become X from later passes', () => {
    const setup = buildSetup()
    // Turn 1: p1 shows on {S, CA, KI} → group 1
    const ev1 = suggEvent('p0', S, CA, KI, [
      { responderId: 'p1', passed: false }
    ])
    // Turn 2: p1 passes on {S, RO, LI} → p1 gets X on S, RO, LI
    //   The X on S should count toward group 1's elimination
    const ev2 = suggEvent('p0', S, RO, LI, [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true }
    ])
    // Turn 3: p1 passes on {CA, KN, ST} → p1 gets X on CA, KN, ST
    //   The X on CA should count toward group 1's elimination
    //   Now group 1 has S=X, CA=X, KI=note → KI should tick
    const ev3 = suggEvent('p0', CA, KN, ST, [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true }
    ])
    const chart = buildChart([ev1, ev2, ev3], setup.cards, setup.players)
    expect(getCell(chart, KI, 'p1')).toEqual({ kind: 'tick' })
  })

  it('overlapping groups: resolving group 1 does not falsely resolve group 2', () => {
    const setup = buildSetup()
    // Turn 1: p1 shows on {S, CA, KI} → group 1: {S, CA, KI}
    const ev1 = suggEvent('p0', S, CA, KI, [
      { responderId: 'p1', passed: false }
    ])
    // Turn 2: p1 shows on {S, KN, LO} → group 2: {S, KN, LO} (S overlaps with group 1)
    const ev2 = suggEvent('p0', S, KN, LO, [
      { responderId: 'p1', passed: false }
    ])
    // Turn 3: p1 passes on {CA, KN, HA} → p1 gets X on CA, KN, HA
    //   CA is in group 1, KN is in group 2
    //   Group 1: S=note, CA=X, KI=note → 2 remaining, no resolution
    //   Group 2: S=note, KN=X, LO=note → 2 remaining, no resolution
    const ev3 = suggEvent('p0', CA, KN, HA, [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true }
    ])
    const chart = buildChart([ev1, ev2, ev3], setup.cards, setup.players)
    // Neither group should have resolved (both have 2 notes remaining)
    expect(getCell(chart, S, 'p1').kind).toBe('note')
    expect(getCell(chart, KI, 'p1').kind).toBe('note')
    expect(getCell(chart, LO, 'p1').kind).toBe('note')
  })

  it('overlapping groups: both resolve when enough Xs accumulate', () => {
    const setup = buildSetup()
    // Turn 1: p1 shows on {S, CA, KI} → group 1
    const ev1 = suggEvent('p0', S, CA, KI, [
      { responderId: 'p1', passed: false }
    ])
    // Turn 2: p1 shows on {S, KN, LO} → group 2 (S overlaps)
    const ev2 = suggEvent('p0', S, KN, LO, [
      { responderId: 'p1', passed: false }
    ])
    // Turn 3: p1 passes on {CA, KN, HA} → X on CA (group 1) and KN (group 2)
    const ev3 = suggEvent('p0', CA, KN, HA, [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true }
    ])
    // Turn 4: p1 passes on {KI, LO, ST} → X on KI (group 1) and LO (group 2)
    //   Now group 1: S=note, CA=X, KI=X → S should tick
    //   And group 2: S=note(1,2), KN=X, LO=X → S should tick (same cell!)
    const ev4 = suggEvent('p0', KI, LO, ST, [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true }
    ])
    const chart = buildChart([ev1, ev2, ev3, ev4], setup.cards, setup.players)
    // S should be ticked for p1 (both groups point to it)
    expect(getCell(chart, S, 'p1')).toEqual({ kind: 'tick' })
  })
})

describe('inference: tick uniqueness', () => {
  it('a tick on a card crosses all other players on that card', () => {
    const setup = buildSetup()
    // Manually tick S for p1, then everyone else must be crossed on S.
    const ev1 = manualEvent(S, 'p1', { kind: 'tick' })
    const chart = buildChart([ev1], setup.cards, setup.players)
    expect(getCell(chart, S, 'p1')).toEqual({ kind: 'tick' })
    expect(getCell(chart, S, 'p0')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p2')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p3')).toEqual({ kind: 'cross' })
  })
})

describe('inference: all-but-one X must NOT tick the remaining player (envelope)', () => {
  // The card could be in the envelope. Only a *show* (group resolution or
  // shownCardId) or the dealt hand can prove a player holds a card.
  it('every opponent passes on a non-me asker → asker is NOT ticked (might be the solution)', () => {
    const setup = buildSetup()
    // p3 asks {S, CA, KI}; p0, p1, p2 all pass. The card could be the envelope.
    const ev = suggEvent('p3', S, CA, KI, [
      { responderId: 'p0', passed: true },
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: true }
    ])
    const chart = buildChart([ev], setup.cards, setup.players)
    expect(getCell(chart, S, 'p0')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p1')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p2')).toEqual({ kind: 'cross' })
    // p3 is the asker — NOT ticked. Could be in the envelope.
    expect(getCell(chart, S, 'p3')).toEqual({ kind: 'empty' })
    expect(getCell(chart, CA, 'p3')).toEqual({ kind: 'empty' })
    expect(getCell(chart, KI, 'p3')).toEqual({ kind: 'empty' })
  })

  it('all-but-one X accumulated from legitimate passes still does not tick the last player', () => {
    const setup = buildSetup()
    // Cross p1, p2, p3 on S via three separate passes (each as a responder, not asker).
    const ev1 = suggEvent('p0', S, RO, LI, [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true }
    ])
    const chart = buildChart([ev1], setup.cards, setup.players)
    // p1, p2, p3 all crossed on S; p0 is the asker, never crossed.
    expect(getCell(chart, S, 'p1')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p2')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p3')).toEqual({ kind: 'cross' })
    // p0 (asker) is the only non-X. The engine must NOT tick p0 — S could be the envelope.
    expect(getCell(chart, S, 'p0')).toEqual({ kind: 'empty' })
  })
})

describe('inference: group resolution (the sound tick source)', () => {
  it('a group resolves when 2 of 3 cards become X from later passes', () => {
    const setup = buildSetup()
    // Turn 1: p1 shows on {S, CA, KI} → group 1
    const ev1 = suggEvent('p0', S, CA, KI, [
      { responderId: 'p1', passed: false }
    ])
    // Turn 2: p1 passes on {S, RO, LI} → X on S
    const ev2 = suggEvent('p0', S, RO, LI, [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true }
    ])
    // Turn 3: p1 passes on {CA, KN, ST} → X on CA → group 1 resolves to KI
    const ev3 = suggEvent('p0', CA, KN, ST, [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true }
    ])
    const chart = buildChart([ev1, ev2, ev3], setup.cards, setup.players)
    expect(getCell(chart, KI, 'p1')).toEqual({ kind: 'tick' })
  })
})

describe('inference: DEBUG regression — non-me asker, all pass, then asker later passes', () => {
  it('does not tick dining-room for an asker who later passes on it', () => {
    // Mirrors the real bug: asker suggests {professor-plum, knife, dining-room},
    // everyone passes, then the asker themselves passes on dining-room later.
    const setup = buildSetup([slug('Billiard Room'), slug('Hall'), slug('Library'), slug('Study')])
    const DR = slug('Dining Room')
    const PL = slug('Professor Plum')
    const KN = slug('Knife')
    // me = p0 holds billiard-room, hall, library, study (so I cross myself on others).
    // p1 (non-me) asks {PL, KN, DR}, everyone else passes.
    const ev1 = suggEvent('p1', PL, KN, DR, [
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true },
      { responderId: 'p0', passed: true }
    ])
    const chart1 = buildChart([ev1], setup.cards, setup.players)
    // p1 must NOT be ticked on DR — could be the envelope.
    expect(getCell(chart1, DR, 'p1')).not.toEqual({ kind: 'tick' })
    expect(getCell(chart1, PL, 'p1')).not.toEqual({ kind: 'tick' })
    expect(getCell(chart1, KN, 'p1')).not.toEqual({ kind: 'tick' })

    // Later p1 passes on a suggestion containing DR → proves p1 doesn't hold DR.
    const ev2 = suggEvent('p2', DR, slug('Rope'), slug('Kitchen'), [
      { responderId: 'p3', passed: true },
      { responderId: 'p0', passed: true },
      { responderId: 'p1', passed: true }
    ])
    const chart2 = buildChart([ev1, ev2], setup.cards, setup.players)
    // No contradiction warning should fire, and DR/p1 is a clean cross.
    expect(getCell(chart2, DR, 'p1')).toEqual({ kind: 'cross' })
  })
})

describe('inference: shownCardId', () => {
  it('shownCardId ticks that specific card for the shower', () => {
    const setup = buildSetup()
    const ev = suggEvent('p0', S, CA, KI, [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: false, shownCardId: CA }
    ])
    const chart = buildChart([ev], setup.cards, setup.players)
    expect(getCell(chart, CA, 'p2')).toEqual({ kind: 'tick' })
    // p1 passed → X on S, CA, KI
    expect(getCell(chart, S, 'p1')).toEqual({ kind: 'cross' })
    // p2 showed → no X on suggested cards (unless ticked via shownCardId)
    expect(getCell(chart, S, 'p2').kind).not.toBe('cross')
  })
})

describe('inference: skip', () => {
  it('skipped player gets no deduction', () => {
    const setup = buildSetup()
    const ev = suggEvent('p0', S, CA, KI, [
      { responderId: 'p1', passed: true, skipped: true },
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true }
    ])
    const chart = buildChart([ev], setup.cards, setup.players)
    // p1 was skipped → no X
    expect(getCell(chart, S, 'p1').kind).toBe('empty')
    expect(getCell(chart, CA, 'p1').kind).toBe('empty')
    // p2 and p3 passed → X
    expect(getCell(chart, S, 'p2')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p3')).toEqual({ kind: 'cross' })
  })
})

describe('inference: manual entry', () => {
  it('manual entry sets a cell state', () => {
    const setup = buildSetup()
    const ev = manualEvent(S, 'p1', { kind: 'cross' }, 'I think Alice doesn\'t have Scarlett')
    const chart = buildChart([ev], setup.cards, setup.players)
    expect(getCell(chart, S, 'p1')).toEqual({ kind: 'cross' })
  })

  it('manual tick propagates uniqueness', () => {
    const setup = buildSetup()
    const ev = manualEvent(S, 'p1', { kind: 'tick' }, 'I saw Alice has Scarlett')
    const chart = buildChart([ev], setup.cards, setup.players)
    expect(getCell(chart, S, 'p1')).toEqual({ kind: 'tick' })
    expect(getCell(chart, S, 'p0')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p2')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p3')).toEqual({ kind: 'cross' })
  })

  it('deleting a manual entry reconciles the chart', () => {
    const setup = buildSetup()
    const ev1 = manualEvent(S, 'p1', { kind: 'tick' }, 'guess')
    const ev2 = manualEvent(CA, 'p2', { kind: 'cross' }, 'hunch')
    // Build with both
    const chart1 = buildChart([ev1, ev2], setup.cards, setup.players)
    expect(getCell(chart1, S, 'p1')).toEqual({ kind: 'tick' })
    expect(getCell(chart1, CA, 'p2')).toEqual({ kind: 'cross' })
    // Remove ev1 → S tick for p1 should be gone, and propagated X's should be gone
    const chart2 = buildChart([ev2], setup.cards, setup.players)
    expect(getCell(chart2, S, 'p1').kind).not.toBe('tick')
    expect(getCell(chart2, S, 'p0').kind).not.toBe('cross') // uniqueness propagation reversed
  })
})

describe('inference: purity', () => {
  it('buildChart is a pure function — same events produce same chart', () => {
    const setup = buildSetup()
    const events = [
      suggEvent('p0', S, CA, KI, [{ responderId: 'p1', passed: false }]),
      suggEvent('p1', M, KN, BA, [{ responderId: 'p0', passed: true }, { responderId: 'p2', passed: false }])
    ]
    const chart1 = buildChart(events, setup.cards, setup.players)
    const chart2 = buildChart(events, setup.cards, setup.players)
    expect(chart1.grid).toEqual(chart2.grid)
    expect(chart1.groups).toEqual(chart2.groups)
    expect(chart1.nextGroupNumber).toEqual(chart2.nextGroupNumber)
  })

  it('foldEvent does not mutate the input chart', () => {
    const setup = buildSetup()
    const cards = setup.cards
    const playerIds = setup.players.map((p) => p.id)
    const chart = blankChart(cards, playerIds)
    const chartCopy = cloneChart(chart)
    const ev = suggEvent('p0', S, CA, KI, [{ responderId: 'p1', passed: true }])
    foldEvent(chart, ev, playerIds)
    // Original chart should be unchanged
    expect(chart.grid).toEqual(chartCopy.grid)
  })
})

describe('inference: hand application', () => {
  it('dealt hand ticks my cards and crosses others', () => {
    const setup = buildSetup([S, CA])
    const chart = buildChart([], setup.cards, setup.players)
    expect(getCell(chart, S, 'p0')).toEqual({ kind: 'tick' })
    expect(getCell(chart, CA, 'p0')).toEqual({ kind: 'tick' })
    expect(getCell(chart, S, 'p1')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p2')).toEqual({ kind: 'cross' })
    expect(getCell(chart, S, 'p3')).toEqual({ kind: 'cross' })
  })
})

describe('inference: alreadyTick short-circuit', () => {
  it('a show where the player already has a known tick among the 3 does nothing new', () => {
    const setup = buildSetup()
    // Give p1 a tick on S (via manual entry)
    const ev1 = manualEvent(S, 'p1', { kind: 'tick' })
    // Now p1 shows on {S, CA, KI} — they already have S ticked, so showing tells us nothing new
    const ev2 = suggEvent('p0', S, CA, KI, [
      { responderId: 'p1', passed: false }
    ])
    const chart = buildChart([ev1, ev2], setup.cards, setup.players)
    // CA and KI should NOT be ticked or noted (alreadyTick short-circuit)
    expect(getCell(chart, CA, 'p1').kind).toBe('empty')
    expect(getCell(chart, KI, 'p1').kind).toBe('empty')
  })
})