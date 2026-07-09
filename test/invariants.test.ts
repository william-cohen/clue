import { describe, it, expect, vi } from 'vitest'
import type { CellState, Setup, GameEvent } from '../src/logic/types'
import { buildCards, CLASSIC_EDITION, slug } from '../src/logic/cards'
import { buildChart } from '../src/logic/engine'
import { makeEventId } from '../src/logic/events'

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

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

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Generate a random but valid event sequence. */
function generateRandomEvents(setup: Setup, count: number): GameEvent[] {
  const events: GameEvent[] = []
  const playerIds = setup.players.map((p) => p.id)
  const allCardIds = setup.cards.map((c) => c.id)
  const suspects = setup.cards.filter((c) => c.category === 'suspect').map((c) => c.id)
  const weapons = setup.cards.filter((c) => c.category === 'weapon').map((c) => c.id)
  const rooms = setup.cards.filter((c) => c.category === 'room').map((c) => c.id)

  for (let i = 0; i < count; i++) {
    const asker = randomChoice(playerIds)
    const s = randomChoice(suspects)
    const w = randomChoice(weapons)
    const r = randomChoice(rooms)
    // Generate responses
    const order = playerIds.filter((p) => p !== asker)
    const responses: { responderId: string; passed: boolean; skipped?: boolean; shownCardId?: string | null }[] = []
    let someoneShowed = false
    for (const responder of order) {
      if (someoneShowed) break
      const action = Math.random()
      if (action < 0.3) {
        responses.push({ responderId: responder, passed: true })
      } else if (action < 0.5) {
        responses.push({ responderId: responder, passed: true, skipped: true })
      } else {
        // Show
        const shownCardId = Math.random() < 0.5 ? randomChoice([s, w, r]) : null
        responses.push({ responderId: responder, passed: false, shownCardId })
        someoneShowed = true
      }
    }
    if (!someoneShowed) {
      // Everyone passed (or skipped)
    }
    events.push(sugg(asker, s, w, r, responses))
  }
  return events
}

describe('invariants', () => {
  const setup = buildSetup([slug('Miss Scarlett'), slug('Candlestick')])

  it('no card is ticked for 2+ players', () => {
    for (let trial = 0; trial < 20; trial++) {
      const events = generateRandomEvents(setup, 15)
      const chart = buildChart(events, setup.cards, setup.players)
      for (const card of setup.cards) {
        const row = chart.grid[card.id]
        const tickCount = setup.players.filter((p) => row[p.id]?.kind === 'tick').length
        expect(tickCount).toBeLessThanOrEqual(1)
      }
    }
  })

  it('no cell is both tick and cross', () => {
    for (let trial = 0; trial < 20; trial++) {
      const events = generateRandomEvents(setup, 15)
      const chart = buildChart(events, setup.cards, setup.players)
      for (const card of setup.cards) {
        for (const p of setup.players) {
          const cell = chart.grid[card.id][p.id]
          // A cell is one kind — can't be both
          expect(cell.kind).not.toBe('undefined')
          expect(['empty', 'cross', 'tick', 'note']).toContain(cell.kind)
        }
      }
    }
  })

  it('if a card is ticked for a player, all other players have cross', () => {
    for (let trial = 0; trial < 20; trial++) {
      const events = generateRandomEvents(setup, 15)
      const chart = buildChart(events, setup.cards, setup.players)
      for (const card of setup.cards) {
        const row = chart.grid[card.id]
        const tickPlayer = setup.players.find((p) => row[p.id]?.kind === 'tick')
        if (tickPlayer) {
          for (const p of setup.players) {
            if (p.id !== tickPlayer.id) {
              expect(row[p.id]?.kind).toBe('cross')
            }
          }
        }
      }
    }
  })

  it('chart is a pure function of events (same events → same chart)', () => {
    for (let trial = 0; trial < 5; trial++) {
      const events = generateRandomEvents(setup, 10)
      const c1 = buildChart(events, setup.cards, setup.players)
      const c2 = buildChart(events, setup.cards, setup.players)
      expect(c1.grid).toEqual(c2.grid)
      expect(c1.groups).toEqual(c2.groups)
      expect(c1.nextGroupNumber).toEqual(c2.nextGroupNumber)
    }
  })

  it('every cell is defined (not undefined)', () => {
    for (let trial = 0; trial < 20; trial++) {
      const events = generateRandomEvents(setup, 15)
      const chart = buildChart(events, setup.cards, setup.players)
      for (const card of setup.cards) {
        for (const p of setup.players) {
          expect(chart.grid[card.id][p.id]).toBeDefined()
        }
      }
    }
  })

  it('a sound tick is never contradicted by a later all-pass from the same asker', () => {
    // The DEBUG bug: an unsound tick on (asker, card) was later contradicted when
    // that asker passed on a suggestion containing the same card. With the fix,
    // the all-pass never produces a tick to begin with, so no contradiction can
    // arise. We verify the engine logs zero contradiction warnings when we build
    // a chart whose only events are the bug-triggering shape (no random prefix
    // that could introduce unrelated inconsistencies).
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const meHand = new Set(setup.players.find((p) => p.isMe)!.hand)
      const suspects = setup.cards.filter((c) => c.category === 'suspect' && !meHand.has(c.id)).map((c) => c.id)
      const weapons = setup.cards.filter((c) => c.category === 'weapon' && !meHand.has(c.id)).map((c) => c.id)
      const rooms = setup.cards.filter((c) => c.category === 'room' && !meHand.has(c.id)).map((c) => c.id)
      const nonMe = setup.players.filter((p) => !p.isMe)
      for (let trial = 0; trial < 50; trial++) {
        const asker = randomChoice(nonMe)
        const s = randomChoice(suspects), w = randomChoice(weapons), r = randomChoice(rooms)
        const otherAsker = randomChoice(nonMe.filter((p) => p.id !== asker.id))
        const events: GameEvent[] = [
          // All opponents pass on the asker's suggestion.
          sugg(asker.id, s, w, r,
            setup.players.filter((p) => p.id !== asker.id).map((p) => ({ responderId: p.id, passed: true }))),
          // The asker later passes on a suggestion containing the same room.
          sugg(otherAsker.id, s, w, r,
            setup.players.filter((p) => p.id !== otherAsker.id).map((p) => ({ responderId: p.id, passed: true })))
        ]
        buildChart(events, setup.cards, setup.players)
      }
      const inferenceWarns = warn.mock.calls
        .map((c) => String(c[0]))
        .filter((msg) => msg.includes('[inference] Contradiction'))
      expect(inferenceWarns).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it('all-pass on a non-me asker never produces a tick for the asker', () => {
    // Targeted: every trial forces the bug-triggering shape.
    const suspects = setup.cards.filter((c) => c.category === 'suspect').map((c) => c.id)
    const weapons = setup.cards.filter((c) => c.category === 'weapon').map((c) => c.id)
    const rooms = setup.cards.filter((c) => c.category === 'room').map((c) => c.id)
    for (let trial = 0; trial < 30; trial++) {
      const asker = randomChoice(setup.players.filter((p) => !p.isMe))
      const s = randomChoice(suspects), w = randomChoice(weapons), r = randomChoice(rooms)
      const responses = setup.players
        .filter((p) => p.id !== asker.id)
        .map((p) => ({ responderId: p.id, passed: true }))
      const chart = buildChart([sugg(asker.id, s, w, r, responses)], setup.cards, setup.players)
      for (const cid of [s, w, r]) {
        expect(chart.grid[cid][asker.id].kind).not.toBe('tick')
      }
    }
  })
})