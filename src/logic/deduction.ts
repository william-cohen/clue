import type {
  Card, CellState, GameState, Grid, PlayerGrid,
  Response, Suggestion, Turn
} from './types'

export function makeGrid(cards: Card[], playerIds: string[]): Grid {
  const g: Grid = {}
  for (const c of cards) {
    const row: PlayerGrid = {}
    for (const p of playerIds) row[p] = { kind: 'empty' }
    g[c.id] = row
  }
  return g
}

export function cloneGrid(g: Grid): Grid {
  const out: Grid = {}
  for (const k of Object.keys(g)) {
    const row = g[k]
    const newRow: PlayerGrid = {}
    for (const pid of Object.keys(row)) {
      const c = row[pid]
      newRow[pid] = c.kind === 'note' ? { kind: 'note', ns: [...c.ns] } : c
    }
    out[k] = newRow
  }
  return out
}

export function cloneState(s: GameState): GameState {
  return {
    edition: { ...s.edition, rooms: [...s.edition.rooms], suspects: [...s.edition.suspects], weapons: [...s.edition.weapons] },
    cards: s.cards.map((c) => ({ ...c })),
    players: s.players.map((p) => ({ ...p, hand: [...p.hand] })),
    grid: cloneGrid(s.grid),
    turns: s.turns.map((t) => ({ ...t, responses: t.responses.map((r) => ({ ...r })) })),
    nextGroupNumber: s.nextGroupNumber,
    phase: s.phase
  }
}

const isX = (c: CellState) => c.kind === 'cross'
const isTick = (c: CellState) => c.kind === 'tick'

function set(grid: Grid, cardId: string, playerId: string, st: CellState): boolean {
  const cur = grid[cardId][playerId]
  if (cur.kind === st.kind) {
    if (st.kind === 'note' && cur.kind === 'note') {
      if (sameNumbers(cur.ns, st.ns)) return false
    } else {
      return false
    }
  }
  grid[cardId][playerId] = st
  return true
}

function sameNumbers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort((x, y) => x - y)
  const sb = [...b].sort((x, y) => x - y)
  return sa.every((v, i) => v === sb[i])
}

/** Merge a group number into an existing note cell (or create a new note). */
function mergeNote(grid: Grid, cardId: string, playerId: string, n: number): boolean {
  const cur = grid[cardId][playerId]
  if (cur.kind === 'note') {
    if (cur.ns.includes(n)) return false
    cur.ns = [...cur.ns, n].sort((a, b) => a - b)
    return true
  }
  if (cur.kind === 'empty') {
    grid[cardId][playerId] = { kind: 'note', ns: [n] }
    return true
  }
  // cross or tick — don't add notes
  return false
}

/** A tick on (player, card) means that card is unique → X for all other players. */
function propagateTickUniqueness(grid: Grid, _cards: Card[], players: string[], cardId: string, playerId: string): void {
  for (const p of players) {
    if (p !== playerId && !isTick(grid[cardId][p])) set(grid, cardId, p, { kind: 'cross' })
  }
}

/** If all but one player have X on a card, the remaining player has the card. */
function propagateCardUniqueness(grid: Grid, cards: Card[], players: string[]): boolean {
  let changed = false
  for (const card of cards) {
    const row = grid[card.id]
    const xCount = players.filter((p) => isX(row[p])).length
    const tickCount = players.filter((p) => isTick(row[p])).length
    if (tickCount === 0 && xCount === players.length - 1) {
      const holder = players.find((p) => !isX(row[p]))
      if (holder) {
        set(grid, card.id, holder, { kind: 'tick' })
        changed = true
      }
    }
  }
  return changed
}

/** If a player's note cells for a suggestion group have 2 X's, the shown card is the 3rd → tick. */
function resolveNotes(grid: Grid, playerIds: string[]): boolean {
  let changed = false
  const allCardIds = Object.keys(grid)
  for (const p of playerIds) {
    // collect all group numbers this player has notes for
    const groupNumbers = new Set<number>()
    for (const cid of allCardIds) {
      const c = grid[cid][p]
      if (c.kind === 'note') for (const n of c.ns) groupNumbers.add(n)
    }
    for (const n of groupNumbers) {
      // all cardIds that carry group n for this player
      const group = allCardIds.filter((cid) => {
        const c = grid[cid][p]
        return c.kind === 'note' && c.ns.includes(n)
      })
      // Only resolve multi-card groups — a lone note is a manual marker, not a deduction.
      if (group.length < 2) continue
      const xCount = group.filter((cid) => isX(grid[cid][p])).length
      const nonX = group.filter((cid) => !isX(grid[cid][p]) && grid[cid][p].kind !== 'tick')
      // If only one non-X (and non-tick) cell remains in the group, promote it to tick.
      if (xCount === group.length - 1 && nonX.length === 1) {
        set(grid, nonX[0], p, { kind: 'tick' })
        changed = true
      }
    }
  }
  return changed
}

export function fixedPoint(grid: Grid, cards: Card[], players: string[]): void {
  let changed = true
  while (changed) {
    changed = false
    for (const cardId of Object.keys(grid)) {
      for (const p of players) {
        if (isTick(grid[cardId][p])) propagateTickUniqueness(grid, cards, players, cardId, p)
      }
    }
    if (propagateCardUniqueness(grid, cards, players)) changed = true
    if (resolveNotes(grid, players)) changed = true
  }
}

export interface ApplyResult {
  grid: Grid
  turn: Turn
}

/** Apply one completed turn to a cloned grid. Returns the new grid and the turn (with groupNumber filled). */
export function applyTurn(state: GameState, askerId: string, suggestion: Suggestion, responses: Response[]): ApplyResult {
  const grid = cloneGrid(state.grid)
  const cards = state.cards
  const players = state.players.map((p) => p.id)
  const suggestionCardIds = [suggestion.suspect, suggestion.weapon, suggestion.room]

  // Asker: by asking, they don't have any of these cards themselves? Not necessarily — they may
  // hold one and still ask. We cannot deduce anything about the asker from the question alone.

  // Passers: they do NOT have any of the three cards. Skipped players are ignored entirely.
  for (const r of responses) {
    if (r.passed && !r.skipped) {
      for (const cid of suggestionCardIds) set(grid, cid, r.responderId, { kind: 'cross' })
    }
  }

  // First (non-skipped) shower: they hold at least one of the three.
  const shower = responses.find((r) => !r.passed && !r.skipped)
  let groupNumber: number | null = null
  if (shower) {
    // If the shower revealed a specific card (e.g. "me" entered it), tick it directly.
    if (shower.shownCardId && suggestionCardIds.includes(shower.shownCardId)) {
      set(grid, shower.shownCardId, shower.responderId, { kind: 'tick' })
    } else {
      const nonX = suggestionCardIds.filter((cid) => !isX(grid[cid][shower.responderId]))
      const alreadyTick = suggestionCardIds.filter((cid) => isTick(grid[cid][shower.responderId]))

      if (alreadyTick.length >= 1) {
        // They already hold a known card among the three; showing tells us nothing new.
      } else if (nonX.length === 1) {
        // Only one possible card → they hold it.
        set(grid, nonX[0], shower.responderId, { kind: 'tick' })
      } else if (nonX.length >= 2) {
        // Unknown which one — assign a group number to all non-X cells, merging with existing notes.
        groupNumber = state.nextGroupNumber
        for (const cid of nonX) mergeNote(grid, cid, shower.responderId, groupNumber)
      }
    }
  }

  fixedPoint(grid, cards, players)

  const turn: Turn = {
    id: cryptoTurnId(),
    askerId,
    suggestion,
    responses: responses.map((r) => ({ ...r })),
    groupNumber
  }
  return { grid, turn }
}

let turnCounter = 0
function cryptoTurnId(): string {
  return `t-${Date.now()}-${turnCounter++}`
}

/** Manually set a cell, then re-run propagation. Returns new grid. */
export function setCell(state: GameState, cardId: string, playerId: string, st: CellState): Grid {
  const grid = cloneGrid(state.grid)
  set(grid, cardId, playerId, st)
  if (st.kind === 'tick') {
    propagateTickUniqueness(grid, state.cards, state.players.map((p) => p.id), cardId, playerId)
  }
  fixedPoint(grid, state.cards, state.players.map((p) => p.id))
  return grid
}

/** Initialize grid from a player's known hand: tick their cards, cross for others. */
export function applyHand(grid: Grid, cards: Card[], players: string[], meId: string, handCardIds: string[]): Grid {
  const g = cloneGrid(grid)
  for (const cid of handCardIds) {
    set(g, cid, meId, { kind: 'tick' })
    for (const p of players) if (p !== meId) set(g, cid, p, { kind: 'cross' })
  }
  fixedPoint(g, cards, players)
  return g
}

export function cycleCell(cur: CellState, n = 1): CellState {
  switch (cur.kind) {
    case 'empty': return { kind: 'cross' }
    case 'cross': return { kind: 'tick' }
    case 'tick': return { kind: 'note', ns: [n] }
    case 'note': return { kind: 'empty' }
  }
}