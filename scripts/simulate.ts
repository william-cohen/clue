/**
 * Simulation harness: deal real Cluedo games, simulate random AI players,
 * and check the deduction engine for contradictions.
 *
 * The simulator knows every player's hand and the envelope, so it can
 * detect when the engine produces impossible states (tick on a card the
 * player doesn't hold, cross on one they do, wrong solution guesses).
 *
 * Run: npx tsx scripts/simulate.ts
 */

import { buildCards, CLASSIC_EDITION, byCategory, slug } from '../src/logic/cards'
import { buildChart, foldEvent, blankChart, applyHand } from '../src/logic/engine'
import { makeEventId } from '../src/logic/events'
import type { SuggestionEvent } from '../src/logic/events'
import type { Card, Chart, GameEvent, Response, Suggestion } from '../src/logic/types'

// ── Types ──────────────────────────────────────────────────────────

interface SimPlayer {
  id: string
  name: string
  hand: string[]
  isMe: boolean
}

interface SimGame {
  cards: Card[]
  players: SimPlayer[]
  envelope: Suggestion
  events: GameEvent[]
}

interface Contradiction {
  game: number
  turn: number
  type: 'bad-tick' | 'bad-cross' | 'wrong-solution' | 'impossible-show'
  detail: string
}

// ── Setup ───────────────────────────────────────────────────────────

const NUM_PLAYERS = parseInt(process.argv[2] ?? '4', 10)
const NUM_GAMES = parseInt(process.argv[3] ?? '100', 10)
const MAX_TURNS = 80

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function dealGame(gameNum: number): SimGame {
  const cards = buildCards(CLASSIC_EDITION)
  const grouped = byCategory(cards)

  // Pick envelope: one from each category
  const envelopeSuspect = grouped.suspect[Math.floor(Math.random() * grouped.suspect.length)]
  const envelopeWeapon = grouped.weapon[Math.floor(Math.random() * grouped.weapon.length)]
  const envelopeRoom = grouped.room[Math.floor(Math.random() * grouped.room.length)]

  // Remaining cards (excluding envelope)
  const remaining = cards.filter(
    (c) => c.id !== envelopeSuspect.id && c.id !== envelopeWeapon.id && c.id !== envelopeRoom.id
  )
  const shuffled = shuffle(remaining)

  // Deal evenly; extras go to first players
  const players: SimPlayer[] = []
  for (let i = 0; i < NUM_PLAYERS; i++) {
    players.push({
      id: `p${i}`,
      name: `Player ${i + 1}`,
      hand: [],
      isMe: i === 0,
    })
  }
  for (let i = 0; i < shuffled.length; i++) {
    players[i % NUM_PLAYERS].hand.push(shuffled[i].id)
  }

  return {
    cards,
    players,
    envelope: { suspect: envelopeSuspect.id, weapon: envelopeWeapon.id, room: envelopeRoom.id },
    events: [],
  }
}

// ── Game simulation ─────────────────────────────────────────────────

/** A player's turn: make a random suggestion, resolve responses. */
function simulateTurn(game: SimGame, askerIdx: number): SuggestionEvent {
  const asker = game.players[askerIdx]
  const grouped = byCategory(game.cards)

  // Random suggestion: pick one of each category
  // Suggesters pick from ALL cards (not just unknowns) — like a real player
  const suspect = grouped.suspect[Math.floor(Math.random() * grouped.suspect.length)]
  const weapon = grouped.weapon[Math.floor(Math.random() * grouped.weapon.length)]
  const room = grouped.room[Math.floor(Math.random() * grouped.room.length)]
  const suggestion: Suggestion = { suspect: suspect.id, weapon: weapon.id, room: room.id }
  const suggestionCardIds = [suggestion.suspect, suggestion.weapon, suggestion.room]

  // Resolve responses in seat order after the asker
  const responses: Response[] = []
  let shown = false

  for (let i = 1; i < game.players.length; i++) {
    const idx = (askerIdx + i) % game.players.length
    const responder = game.players[idx]

    if (shown) {
      // This player is skipped (someone already showed)
      // In real Cluedo, later players don't respond. We still record
      // the fact that they were asked but didn't show (skipped).
      responses.push({ responderId: responder.id, passed: true, skipped: true })
      continue
    }

    // Does this responder hold any of the 3 suggested cards?
    const heldCards = suggestionCardIds.filter((cid) => responder.hand.includes(cid))

    if (heldCards.length === 0) {
      responses.push({ responderId: responder.id, passed: true })
    } else {
      // Show a random card from the held ones
      const shownCard = heldCards[Math.floor(Math.random() * heldCards.length)]
      responses.push({ responderId: responder.id, passed: false, shownCardId: shownCard })
      shown = true
    }
  }

  const event: SuggestionEvent = {
    id: makeEventId(),
    type: 'suggestion',
    askerId: asker.id,
    suggestion,
    responses,
  }

  game.events.push(event)
  return event
}

// ── Contradiction detection ─────────────────────────────────────────

function checkChart(
  game: SimGame,
  chart: Chart,
  gameNum: number,
  turn: number,
  contradictions: Contradiction[]
): void {
  const playerIds = game.players.map((p) => p.id)

  for (const card of game.cards) {
    for (const pid of playerIds) {
      const cell = chart.grid[card.id][pid]
      const player = game.players.find((p) => p.id === pid)!
      const actuallyHolds = player.hand.includes(card.id)
      const inEnvelope =
        card.id === game.envelope.suspect ||
        card.id === game.envelope.weapon ||
        card.id === game.envelope.room

      // Tick means "this player definitely holds this card"
      if (cell.kind === 'tick' && !actuallyHolds) {
        contradictions.push({
          game: gameNum,
          turn,
          type: 'bad-tick',
          detail: `${player.name} ticked on ${card.name} but doesn't hold it${
            inEnvelope ? ' (it is in the envelope)' : ''
          }`,
        })
      }

      // Cross means "this player definitely does NOT hold this card"
      if (cell.kind === 'cross' && actuallyHolds) {
        contradictions.push({
          game: gameNum,
          turn,
          type: 'bad-cross',
          detail: `${player.name} crossed on ${card.name} but actually holds it`,
        })
      }
    }
  }
}

/** Check if the detective (me) can solve the case and whether the solution is correct. */
function checkSolution(
  game: SimGame,
  chart: Chart,
  gameNum: number,
  turn: number,
  contradictions: Contradiction[]
): { solved: boolean; correct: boolean } {
  const me = game.players.find((p) => p.isMe)!
  const grid = chart.grid

  // Can we identify all three envelope cards?
  // A card is "solved as in-envelope" if it's crossed for ALL players
  const grouped = byCategory(game.cards)
  const solvedSuspects = grouped.suspect.filter(
    (c) => game.players.every((p) => grid[c.id][p.id].kind === 'cross')
  )
  const solvedWeapons = grouped.weapon.filter(
    (c) => game.players.every((p) => grid[c.id][p.id].kind === 'cross')
  )
  const solvedRooms = grouped.room.filter(
    (c) => game.players.every((p) => grid[c.id][p.id].kind === 'cross')
  )

  if (solvedSuspects.length === 1 && solvedWeapons.length === 1 && solvedRooms.length === 1) {
    const guess: Suggestion = {
      suspect: solvedSuspects[0].id,
      weapon: solvedWeapons[0].id,
      room: solvedRooms[0].id,
    }
    const correct =
      guess.suspect === game.envelope.suspect &&
      guess.weapon === game.envelope.weapon &&
      guess.room === game.envelope.room

    if (!correct) {
      contradictions.push({
        game: gameNum,
        turn,
        type: 'wrong-solution',
        detail: `Solved to ${guess.suspect}/${guess.weapon}/${guess.room} but envelope is ${game.envelope.suspect}/${game.envelope.weapon}/${game.envelope.room}`,
      })
    }

    return { solved: true, correct }
  }

  return { solved: false, correct: false }
}

// ── Main ────────────────────────────────────────────────────────────

function main(): void {
  const contradictions: Contradiction[] = []
  const stats = {
    totalGames: 0,
    gamesSolved: 0,
    gamesSolvedCorrectly: 0,
    totalTurns: 0,
    turnsToSolve: [] as number[],
  }

  for (let g = 0; g < NUM_GAMES; g++) {
    const game = dealGame(g)
    const playerIds = game.players.map((p) => p.id)
    const me = game.players.find((p) => p.isMe)!

    // Build initial chart with my hand applied
    let chart = buildChart([], game.cards, game.players)

    let solved = false
    let solvedCorrectly = false
    let solveTurn = -1

    for (let t = 0; t < MAX_TURNS; t++) {
      const askerIdx = t % game.players.length
      simulateTurn(game, askerIdx)

      // Rebuild chart from all events so far
      chart = buildChart(game.events, game.cards, game.players)

      // Check for contradictions after this turn
      checkChart(game, chart, g, t, contradictions)

      // Check if we can solve
      if (!solved) {
        const result = checkSolution(game, chart, g, t, contradictions)
        if (result.solved) {
          solved = true
          solvedCorrectly = result.correct
          solveTurn = t
        }
      }

      if (solved) break
    }

    stats.totalGames++
    stats.totalTurns += Math.min(solveTurn >= 0 ? solveTurn + 1 : MAX_TURNS, MAX_TURNS)
    if (solved) {
      stats.gamesSolved++
      stats.turnsToSolve.push(solveTurn + 1)
      if (solvedCorrectly) stats.gamesSolvedCorrectly++
    }

    if (contradictions.length > 0 && contradictions.length < 5) {
      // Early exit on first few contradictions for debugging
    }
  }

  // Report
  console.log('══════════════════════════════════════════════════')
  console.log(`  Simulation Results: ${NUM_GAMES} games, ${NUM_PLAYERS} players`)
  console.log('══════════════════════════════════════════════════')
  console.log(`  Games solved:           ${stats.gamesSolved}/${stats.totalGames}`)
  console.log(`  Solved correctly:       ${stats.gamesSolvedCorrectly}/${stats.totalGames}`)
  console.log(`  Avg turns to solve:     ${
    stats.turnsToSolve.length > 0
      ? (stats.turnsToSolve.reduce((s, t) => s + t, 0) / stats.turnsToSolve.length).toFixed(1)
      : 'N/A'
  }`)
  console.log(`  Total turns simulated:  ${stats.totalTurns}`)
  console.log()

  if (contradictions.length === 0) {
    console.log('  ✅ No contradictions detected — engine is sound!')
  } else {
    console.log(`  ❌ ${contradictions.length} contradiction(s) found:`)
    console.log()
    for (const c of contradictions.slice(0, 50)) {
      console.log(`  [Game ${c.game}, Turn ${c.turn}] ${c.type}: ${c.detail}`)
    }
    if (contradictions.length > 50) {
      console.log(`  ... and ${contradictions.length - 50} more`)
    }
  }
  console.log('══════════════════════════════════════════════════')
}

main()