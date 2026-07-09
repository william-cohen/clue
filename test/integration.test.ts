import { describe, it, expect } from 'vitest'
import type { CellState, Setup, GameEvent } from '../src/logic/types'
import { buildCards, CLASSIC_EDITION, slug } from '../src/logic/cards'
import { buildChart } from '../src/logic/engine'
import { makeEventId } from '../src/logic/events'

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Card id shortcuts
const S = slug('Miss Scarlett'), M = slug('Colonel Mustard'), W = slug('Mrs White')
const G = slug('Mr Green'), P = slug('Mrs Peacock'), PL = slug('Professor Plum')
const CA = slug('Candlestick'), KN = slug('Knife'), LP = slug('Lead Pipe')
const RE = slug('Revolver'), RO = slug('Rope'), WR = slug('Wrench')
const KI = slug('Kitchen'), BA = slug('Ballroom'), CO = slug('Conservatory')
const DR = slug('Dining Room'), BI = slug('Billiard Room'), LI = slug('Library')
const LO = slug('Lounge'), HA = slug('Hall'), ST = slug('Study')

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

function sugg(
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

function manual(cardId: string, playerId: string, state: CellState, description = ''): GameEvent {
  return { id: makeEventId(), type: 'manual', entries: [{ cardId, playerId, state }], description }
}

function getCell(events: GameEvent[], setup: Setup, cardId: string, playerId: string): CellState {
  return buildChart(events, setup.cards, setup.players).grid[cardId][playerId]
}

describe('integration: full 4-player game', () => {
  it('simulates a complete game where opponents reveal cards via shows', () => {
    // Solution: Professor Plum, Revolver, Library
    // Dealt hands:
    //   Me (p0): Scarlett, Candlestick, Kitchen
    //   Alice (p1): Mustard, Knife, Ballroom
    //   Bob (p2): White, Lead Pipe, Conservatory
    //   Carol (p3): Green, Rope, Dining Room
    // Remaining (envelope): Plum, Peacock, Revolver, Wrench, Billiard Room,
    //   Library, Lounge, Hall, Study
    // (Only 3 of those are actually in the envelope; the rest are simply not
    //  dealt in this simplified 4×3 layout. The engine only models player hands,
    //  so undealt cards behave like envelope cards — never ticked.)
    //
    // Each opponent reveals their cards to ME via shownCardId when I ask.
    // (Only the asker sees the shown card, so this models me learning directly.)
    const meHand = [S, CA, KI]
    const setup = buildSetup(meHand)

    const events: GameEvent[] = [
      // Turn 1: I ask {Mustard, Knife, Ballroom}. Alice shows Mustard.
      sugg('p0', M, KN, BA, [
        { responderId: 'p1', passed: false, shownCardId: M }
      ]),
      // Turn 2: I ask {Knife, Ballroom, Lounge}. Alice shows Knife.
      sugg('p0', KN, BA, LO, [
        { responderId: 'p1', passed: false, shownCardId: KN }
      ]),
      // Turn 3: I ask {Ballroom, Rope, Lounge}. Alice shows Ballroom.
      sugg('p0', BA, RO, LO, [
        { responderId: 'p1', passed: false, shownCardId: BA }
      ]),
      // Turn 4: I ask {White, Lead Pipe, Conservatory}. Bob shows White.
      sugg('p0', W, LP, CO, [
        { responderId: 'p2', passed: false, shownCardId: W }
      ]),
      // Turn 5: I ask {Lead Pipe, Conservatory, Hall}. Bob shows Lead Pipe.
      sugg('p0', LP, CO, HA, [
        { responderId: 'p2', passed: false, shownCardId: LP }
      ]),
      // Turn 6: I ask {Conservatory, Rope, Hall}. Bob shows Conservatory.
      sugg('p0', CO, RO, HA, [
        { responderId: 'p2', passed: false, shownCardId: CO }
      ]),
      // Turn 7: I ask {Green, Rope, Dining Room}. Carol shows Green.
      sugg('p0', G, RO, DR, [
        { responderId: 'p3', passed: false, shownCardId: G }
      ]),
      // Turn 8: I ask {Rope, Dining Room, Study}. Carol shows Rope.
      sugg('p0', RO, DR, ST, [
        { responderId: 'p3', passed: false, shownCardId: RO }
      ]),
      // Turn 9: I ask {Dining Room, Wrench, Study}. Carol shows Dining Room.
      sugg('p0', DR, WR, ST, [
        { responderId: 'p3', passed: false, shownCardId: DR }
      ]),
    ]

    const chart = buildChart(events, setup.cards, setup.players)

    // Each shown card is ticked for its shower, and crossed for everyone else.
    expect(chart.grid[M]['p1']).toEqual({ kind: 'tick' })
    expect(chart.grid[KN]['p1']).toEqual({ kind: 'tick' })
    expect(chart.grid[BA]['p1']).toEqual({ kind: 'tick' })
    expect(chart.grid[W]['p2']).toEqual({ kind: 'tick' })
    expect(chart.grid[LP]['p2']).toEqual({ kind: 'tick' })
    expect(chart.grid[CO]['p2']).toEqual({ kind: 'tick' })
    expect(chart.grid[G]['p3']).toEqual({ kind: 'tick' })
    expect(chart.grid[RO]['p3']).toEqual({ kind: 'tick' })
    expect(chart.grid[DR]['p3']).toEqual({ kind: 'tick' })

    // Ticks propagate crosses to everyone else on those cards.
    expect(chart.grid[M]['p0']).toEqual({ kind: 'cross' })
    expect(chart.grid[M]['p2']).toEqual({ kind: 'cross' })
    expect(chart.grid[M]['p3']).toEqual({ kind: 'cross' })

    // Solution / undealt cards: nobody ever showed or passed on these to me,
    // so they remain empty for opponents. The critical invariant is that the
    // engine must NOT tick them for anyone (they could be the envelope).
    for (const pid of ['p0', 'p1', 'p2', 'p3']) {
      expect(chart.grid[PL][pid].kind).not.toBe('tick')
      expect(chart.grid[RE][pid].kind).not.toBe('tick')
      expect(chart.grid[LI][pid].kind).not.toBe('tick')
    }
    // Me (p0) is crossed on all non-hand cards via the dealt-hand step.
    expect(chart.grid[PL]['p0']).toEqual({ kind: 'cross' })
    expect(chart.grid[RE]['p0']).toEqual({ kind: 'cross' })
    expect(chart.grid[LI]['p0']).toEqual({ kind: 'cross' })

    // Invariant: no card is ticked for two players.
    for (const card of setup.cards) {
      const row = chart.grid[card.id]
      const ticks = setup.players.filter((p) => row[p.id]?.kind === 'tick').length
      expect(ticks).toBeLessThanOrEqual(1)
    }
  })

  it('regression: a non-me asker with all-pass is never ticked on the suggested cards', () => {
    // Direct repro of the DEBUG bug in a minimal 4-player setup.
    const meHand = [S]
    const setup = buildSetup(meHand)
    const DR = slug('Dining Room')
    const PL = slug('Professor Plum')
    const KN = slug('Knife')

    // p1 (non-me) asks {Plum, Knife, Dining Room}; everyone else passes.
    const ev = sugg('p1', PL, KN, DR, [
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true },
      { responderId: 'p0', passed: true }
    ])
    const chart = buildChart([ev], setup.cards, setup.players)

    // Passers crossed; asker NOT ticked (could be the envelope).
    expect(chart.grid[PL]['p2']).toEqual({ kind: 'cross' })
    expect(chart.grid[PL]['p3']).toEqual({ kind: 'cross' })
    expect(chart.grid[PL]['p0']).toEqual({ kind: 'cross' })
    expect(chart.grid[DR]['p1'].kind).not.toBe('tick')
    expect(chart.grid[PL]['p1'].kind).not.toBe('tick')
    expect(chart.grid[KN]['p1'].kind).not.toBe('tick')

    // Later, p1 passes on a suggestion containing DR → no contradiction, clean cross.
    const ev2 = sugg('p2', DR, RO, KI, [
      { responderId: 'p3', passed: true },
      { responderId: 'p0', passed: true },
      { responderId: 'p1', passed: true }
    ])
    const chart2 = buildChart([ev, ev2], setup.cards, setup.players)
    expect(chart2.grid[DR]['p1']).toEqual({ kind: 'cross' })
  })

  it('simulates overlapping suggestions with a show', () => {
    const meHand = [S] // I only have Scarlett
    const setup = buildSetup(meHand)

    const events: GameEvent[] = [
      // Turn 1: Me asks {Mustard, Knife, Ballroom}. Alice shows.
      sugg('p0', M, KN, BA, [
        { responderId: 'p1', passed: false }
      ]),
      // Group 1: p1 has one of {Mustard, Knife, Ballroom}
      // Turn 2: Me asks {Mustard, Revolver, Library}. Alice shows again.
      sugg('p0', M, RE, LI, [
        { responderId: 'p1', passed: false }
      ]),
      // Group 2: p1 has one of {Mustard, Revolver, Library}
      // Mustard overlaps groups 1 and 2.
      // Turn 3: Bob asks {Knife, Revolver, Kitchen}. Alice passes.
      sugg('p2', KN, RE, KI, [
        { responderId: 'p3', passed: true },
        { responderId: 'p0', passed: true },
        { responderId: 'p1', passed: true }
      ]),
      // p3 has X on KN, RE, KI. p0 has X on KN, RE (not KI — I have KI? No, I have S).
      // Wait, p0 (me) has hand [S]. So p0 passes on {KN, RE, KI} → X on KN, RE, KI.
      // p1 passes → X on KN, RE, KI.
      // Now group 1: {M, KN, BA} — KN is X for p1 → group 1 has M=note, BA=note remaining
      // Group 2: {M, RE, LI} — RE is X for p1 → group 2 has M=note, LI=note remaining
      // No resolution yet (2 remaining in each).
    ]

    const chart = buildChart(events, setup.cards, setup.players)

    // p1 should have notes on M, BA (group 1) and M, LI (group 2)
    const mCell = chart.grid[M]['p1']
    expect(mCell.kind).toBe('note')
    if (mCell.kind === 'note') {
      expect(mCell.ns).toContain(1)
      expect(mCell.ns).toContain(2)
    }
    expect(chart.grid[BA]['p1'].kind).toBe('note')
    expect(chart.grid[LI]['p1'].kind).toBe('note')
    // KN and RE should be X for p1
    expect(chart.grid[KN]['p1']).toEqual({ kind: 'cross' })
    expect(chart.grid[RE]['p1']).toEqual({ kind: 'cross' })
  })

  it('handles skip correctly — skipped player is not crossed', () => {
    const setup = buildSetup()
    const events: GameEvent[] = [
      sugg('p0', S, CA, KI, [
        { responderId: 'p1', passed: true, skipped: true },
        { responderId: 'p2', passed: true },
        { responderId: 'p3', passed: false }
      ])
    ]
    const chart = buildChart(events, setup.cards, setup.players)
    // p1 skipped → no deduction
    expect(chart.grid[S]['p1']).toEqual({ kind: 'empty' })
    expect(chart.grid[CA]['p1']).toEqual({ kind: 'empty' })
    expect(chart.grid[KI]['p1']).toEqual({ kind: 'empty' })
    // p2 passed → X
    expect(chart.grid[S]['p2']).toEqual({ kind: 'cross' })
    // p3 showed → note group
    expect(chart.grid[S]['p3'].kind).toBe('note')
  })

  it('me asks and sees the shown card — recorded via shownCardId', () => {
    const setup = buildSetup([S, CA]) // I hold Scarlett and Candlestick
    const events: GameEvent[] = [
      sugg('p0', M, KN, KI, [
        { responderId: 'p1', passed: true },
        { responderId: 'p2', passed: false, shownCardId: KN }
      ])
    ]
    const chart = buildChart(events, setup.cards, setup.players)
    // p2 showed Knife → tick
    expect(chart.grid[KN]['p2']).toEqual({ kind: 'tick' })
    // p1 passed → X on Mustard, Knife, Kitchen
    expect(chart.grid[M]['p1']).toEqual({ kind: 'cross' })
    expect(chart.grid[KN]['p1']).toEqual({ kind: 'cross' })
    // p2 showing means p2 has Knife → cross for everyone else
    expect(chart.grid[KN]['p0']).toEqual({ kind: 'cross' })
    expect(chart.grid[KN]['p1']).toEqual({ kind: 'cross' })
    expect(chart.grid[KN]['p3']).toEqual({ kind: 'cross' })
  })

  it('me shows — recorded via shownCardId', () => {
    const setup = buildSetup([S, CA]) // I hold Scarlett and Candlestick
    const events: GameEvent[] = [
      // Alice asks {Scarlett, Knife, Kitchen}. I show Scarlett.
      sugg('p1', S, KN, KI, [
        { responderId: 'p2', passed: true },
        { responderId: 'p3', passed: true },
        { responderId: 'p0', passed: false, shownCardId: S }
      ])
    ]
    const chart = buildChart(events, setup.cards, setup.players)
    // I showed Scarlett → already ticked (from hand), stays tick
    expect(chart.grid[S]['p0']).toEqual({ kind: 'tick' })
    // p2, p3 passed → X on S, KN, KI
    expect(chart.grid[KN]['p2']).toEqual({ kind: 'cross' })
    expect(chart.grid[KI]['p3']).toEqual({ kind: 'cross' })
  })

  it('delete a manual entry and chart reconciles', () => {
    const setup = buildSetup()
    const ev1 = sugg('p0', S, CA, KI, [
      { responderId: 'p1', passed: true },
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true }
    ])
    const ev2 = manual(M, 'p1', { kind: 'tick' }, 'I think Alice has Mustard')
    const ev3 = sugg('p1', W, LP, CO, [
      { responderId: 'p0', passed: true },
      { responderId: 'p2', passed: true },
      { responderId: 'p3', passed: true }
    ])

    // With all 3 events: p1 has tick on M (manual) → M is X for everyone else
    const chart1 = buildChart([ev1, ev2, ev3], setup.cards, setup.players)
    expect(chart1.grid[M]['p1']).toEqual({ kind: 'tick' })
    expect(chart1.grid[M]['p0']).toEqual({ kind: 'cross' })

    // Delete ev2 → p1 no longer has tick on M → M should not be X for others (from that tick)
    const chart2 = buildChart([ev1, ev3], setup.cards, setup.players)
    expect(chart2.grid[M]['p1'].kind).not.toBe('tick')
    expect(chart2.grid[M]['p0'].kind).not.toBe('cross')
  })

  it('idempotent: same events replayed produce same chart', () => {
    const setup = buildSetup([S, CA])
    const events: GameEvent[] = [
      sugg('p0', M, KN, KI, [{ responderId: 'p1', passed: false }]),
      sugg('p1', PL, RE, LI, [
        { responderId: 'p0', passed: true },
        { responderId: 'p2', passed: true },
        { responderId: 'p3', passed: true }
      ]),
      manual(W, 'p2', { kind: 'cross' }, 'Bob doesn\'t have White')
    ]
    const c1 = buildChart(events, setup.cards, setup.players)
    const c2 = buildChart(events, setup.cards, setup.players)
    expect(c1.grid).toEqual(c2.grid)
    expect(c1.groups).toEqual(c2.groups)
  })
})