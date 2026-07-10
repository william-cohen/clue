import type {
  Card, CellState, Chart, Grid, PlayerGrid, SuggestionGroup
} from './types'
import type { GameEvent, SuggestionEvent, ManualEvent } from './events'

// ── Grid construction ───────────────────────────────────────────────

function makeGrid(cards: Card[], playerIds: string[]): Grid {
  const g: Grid = {}
  for (const c of cards) {
    const row: PlayerGrid = {}
    for (const p of playerIds) row[p] = { kind: 'empty' }
    g[c.id] = row
  }
  return g
}

function cloneGridDeep(grid: Grid): Grid {
  const out: Grid = {}
  for (const k of Object.keys(grid)) {
    const row = grid[k]
    const newRow: PlayerGrid = {}
    for (const pid of Object.keys(row)) {
      const c = row[pid]
      newRow[pid] = c.kind === 'note' ? { kind: 'note', ns: [...c.ns] } : c
    }
    out[k] = newRow
  }
  return out
}

// ── Chart constructors (pure) ──────────────────────────────────────

export function blankChart(cards: Card[], playerIds: string[]): Chart {
  return {
    grid: makeGrid(cards, playerIds),
    groups: {},
    nextGroupNumber: 1
  }
}

export function cloneChart(chart: Chart): Chart {
  return {
    grid: cloneGridDeep(chart.grid),
    groups: { ...chart.groups },
    nextGroupNumber: chart.nextGroupNumber
  }
}

// ── Cell helpers ───────────────────────────────────────────────────

const isX = (c: CellState) => c.kind === 'cross'
const isTick = (c: CellState) => c.kind === 'tick'

/** Set a cell with contradiction guards. Logs a warning on logical contradictions. */
function set(grid: Grid, cardId: string, playerId: string, st: CellState): boolean {
  const cur = grid[cardId][playerId]

  // Guards: never overwrite a definitive state with a contradictory one
  if (cur.kind === 'tick' && st.kind !== 'tick') {
    console.warn(`[engine] Contradiction: refusing to overwrite tick on ${cardId}/${playerId} with ${st.kind}`)
    return false
  }
  if (cur.kind === 'cross' && (st.kind === 'note' || st.kind === 'tick')) {
    console.warn(`[engine] Contradiction: refusing to overwrite cross on ${cardId}/${playerId} with ${st.kind}`)
    return false
  }
  // Idempotency check
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
  return false
}

// ── Deduction rules (private mutators on a cloned grid) ────────────

/** A tick on (player, card) means that card is unique → X for all other players. */
function propagateTickUniqueness(grid: Grid, players: string[], cardId: string, playerId: string): void {
  for (const p of players) {
    if (p !== playerId && !isTick(grid[cardId][p])) set(grid, cardId, p, { kind: 'cross' })
  }
}

/**
 * Resolve suggestion groups using the groups map.
 * For each group: the player *showed* on these cards, so they hold at least one.
 * If all but one of the original cardIds is now **crossed** for the player,
 * the remaining card must be the one they showed → tick it. This is sound because
 * a show proves the player holds at least one of the three (so the remaining card
 * is not in the envelope — it is in their hand).
 *
 * A **tick** on one group card satisfies the "holds at least one" constraint but
 * does NOT eliminate the others — the player may hold more than one. So ticks are
 * NOT counted as eliminated; only crosses (proven NOT held) count.
 */
function resolveNotes(grid: Grid, groups: Record<number, SuggestionGroup>): boolean {
  let changed = false
  for (const n of Object.keys(groups)) {
    const group = groups[Number(n)]
    const { playerId, cardIds } = group
    const crossed = cardIds.filter((cid) => grid[cid][playerId].kind === 'cross')
    const remaining = cardIds.filter((cid) => grid[cid][playerId].kind !== 'cross' && grid[cid][playerId].kind !== 'tick')
    if (remaining.length === 1 && crossed.length === cardIds.length - 1) {
      if (set(grid, remaining[0], playerId, { kind: 'tick' })) changed = true
    }
  }
  return changed
}

/** Run deduction rules to a fixed point. Mutates the passed-in grid. */
function fixedPoint(grid: Grid, players: string[], groups: Record<number, SuggestionGroup>): void {
  let changed = true
  while (changed) {
    changed = false
    for (const cardId of Object.keys(grid)) {
      for (const p of players) {
        if (isTick(grid[cardId][p])) propagateTickUniqueness(grid, players, cardId, p)
      }
    }
    if (resolveNotes(grid, groups)) changed = true
  }
}

// ── Pure propagation ────────────────────────────────────────────────

/**
 * Run deduction rules to a fixed point on a cloned chart. Pure: input unchanged.
 * Exposed for strategy simulations and tests that want to drive propagation
 * without going through the event layer.
 */
export function propagate(chart: Chart): Chart {
  const next = cloneChart(chart)
  const players = playerIdsOf(next.grid)
  fixedPoint(next.grid, players, next.groups)
  return next
}

/** Derive player ids from a grid (any row's keys). */
function playerIdsOf(grid: Grid): string[] {
  const firstCard = Object.keys(grid)[0]
  return firstCard ? Object.keys(grid[firstCard]) : []
}

// ── Event folding (pure) ───────────────────────────────────────────

/** Apply a single event to a chart, returning a new chart. Pure: input unchanged. */
export function foldEvent(chart: Chart, event: GameEvent, playerIds: string[]): Chart {
  const next = cloneChart(chart)

  if (event.type === 'suggestion') {
    foldSuggestion(next, event, playerIds)
  } else {
    foldManual(next, event, playerIds)
  }

  fixedPoint(next.grid, playerIds, next.groups)
  return next
}

function foldSuggestion(chart: Chart, event: SuggestionEvent, _playerIds: string[]): void {
  const { grid, groups } = chart
  const suggestionCardIds = [event.suggestion.suspect, event.suggestion.weapon, event.suggestion.room]

  // Passers: they do NOT have any of the three cards. Skipped players are ignored.
  for (const r of event.responses) {
    if (r.passed && !r.skipped) {
      for (const cid of suggestionCardIds) set(grid, cid, r.responderId, { kind: 'cross' })
    }
  }

  // First (non-skipped) shower: they hold at least one of the three.
  const shower = event.responses.find((r) => !r.passed && !r.skipped)
  if (!shower) return

  // If the shower revealed a specific card (e.g. "me" entered it), tick it directly.
  if (shower.shownCardId && suggestionCardIds.includes(shower.shownCardId)) {
    set(grid, shower.shownCardId, shower.responderId, { kind: 'tick' })
    return
  }

  const nonX = suggestionCardIds.filter((cid) => !isX(grid[cid][shower.responderId]))
  const alreadyTick = suggestionCardIds.filter((cid) => isTick(grid[cid][shower.responderId]))

  if (alreadyTick.length >= 1) {
    // They already hold a known card among the three; showing tells us nothing new.
    return
  }

  if (nonX.length === 1) {
    // Only one possible card → they hold it.
    set(grid, nonX[0], shower.responderId, { kind: 'tick' })
  } else if (nonX.length >= 2) {
    // Unknown which one — assign a group number and record the group membership.
    const groupNum = chart.nextGroupNumber
    groups[groupNum] = {
      playerId: shower.responderId,
      cardIds: [...nonX]
    }
    chart.nextGroupNumber = groupNum + 1
    for (const cid of nonX) mergeNote(grid, cid, shower.responderId, groupNum)
  }
}

function foldManual(chart: Chart, event: ManualEvent, playerIds: string[]): void {
  for (const e of event.entries) {
    set(chart.grid, e.cardId, e.playerId, e.state)
    if (e.state.kind === 'tick') {
      propagateTickUniqueness(chart.grid, playerIds, e.cardId, e.playerId)
    }
  }
}

// ── Hand application (pure) ─────────────────────────────────────────

/**
 * Apply a dealt hand to a chart: tick me's cards (and cross everyone else on
 * them), cross me on all non-hand cards (I know I don't have them), then
 * propagate. Pure: input unchanged.
 */
export function applyHand(chart: Chart, cards: Card[], meId: string, hand: string[]): Chart {
  if (hand.length === 0) return cloneChart(chart)
  const next = cloneChart(chart)
  const handSet = new Set(hand)
  const playerIds = playerIdsOf(next.grid)
  for (const card of cards) {
    if (handSet.has(card.id)) {
      set(next.grid, card.id, meId, { kind: 'tick' })
      for (const p of playerIds) {
        if (p !== meId) set(next.grid, card.id, p, { kind: 'cross' })
      }
    } else {
      set(next.grid, card.id, meId, { kind: 'cross' })
    }
  }
  fixedPoint(next.grid, playerIds, next.groups)
  return next
}

// ── Build chart from events (pure) ─────────────────────────────────

/** Build a chart by folding all events onto a blank chart + applying the dealt hand. */
export function buildChart(
  events: GameEvent[],
  cards: Card[],
  players: { id: string; hand: string[]; isMe: boolean }[]
): Chart {
  const playerIds = players.map((p) => p.id)
  let chart = blankChart(cards, playerIds)

  const me = players.find((p) => p.isMe)
  if (me && me.hand.length) {
    chart = applyHand(chart, cards, me.id, me.hand)
  }

  for (const event of events) {
    chart = foldEvent(chart, event, playerIds)
  }

  return chart
}

// ── Cell cycling (pure) ─────────────────────────────────────────────

/** Cycle a cell state for manual entry: empty → cross → tick → note → empty. */
export function cycleCell(cur: CellState, n = 1): CellState {
  switch (cur.kind) {
    case 'empty': return { kind: 'cross' }
    case 'cross': return { kind: 'tick' }
    case 'tick': return { kind: 'note', ns: [n] }
    case 'note': return { kind: 'empty' }
  }
}