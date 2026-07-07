import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  Card, CellState, Edition, GameState, Grid, Player,
  Response, Suggestion, Turn
} from '../logic/types'
import { buildCards, CLASSIC_EDITION, slug } from '../logic/cards'
import {
  applyHand, applyTurn, cloneState, cycleCell, makeGrid, setCell
} from '../logic/deduction'

const HISTORY_LIMIT = 50
const STORAGE_KEY = 'clue-sheet-v1'

function freshState(): GameState {
  const edition: Edition = {
    rooms: [...CLASSIC_EDITION.rooms],
    suspects: [...CLASSIC_EDITION.suspects],
    weapons: [...CLASSIC_EDITION.weapons]
  }
  const cards = buildCards(edition)
  return {
    edition,
    cards,
    players: [],
    grid: {},
    turns: [],
    nextGroupNumber: 1,
    phase: 'setup'
  }
}

function rid(): string {
  return `p-${Math.random().toString(36).slice(2, 9)}`
}

export const useGameStore = defineStore('game', () => {
  const state = ref<GameState>(freshState())

  const past = ref<GameState[]>([])
  const future = ref<GameState[]>([])

  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)

  function snapshot(): void {
    past.value.push(cloneState(state.value))
    if (past.value.length > HISTORY_LIMIT) past.value.shift()
    future.value = []
  }

  function commit(next: GameState): void {
    state.value = next
    persist()
  }

  // --- Setup actions ---

  function setEdition(edition: Edition): void {
    snapshot()
    const cards = buildCards(edition)
    const next = cloneState(state.value)
    next.edition = {
      rooms: [...edition.rooms],
      suspects: [...edition.suspects],
      weapons: [...edition.weapons]
    }
    next.cards = cards
    // reset grid/players since card set changed
    next.players = []
    next.grid = {}
    next.turns = []
    next.phase = 'setup'
    commit(next)
  }

  function setPlayers(names: string[], meIndex: number): void {
    snapshot()
    const next = cloneState(state.value)
    next.players = names.map((name, i) => ({
      id: rid(),
      name: name.trim() || `Player ${i + 1}`,
      isMe: i === meIndex,
      hand: []
    }))
    next.grid = makeGrid(next.cards, next.players.map((p) => p.id))
    next.turns = []
    next.nextGroupNumber = 1
    next.phase = 'setup'
    commit(next)
  }

  function setMyHand(cardIds: string[]): void {
    snapshot()
    const next = cloneState(state.value)
    const me = next.players.find((p) => p.isMe)
    if (!me) return
    me.hand = [...cardIds]
    next.grid = applyHand(
      makeGrid(next.cards, next.players.map((p) => p.id)),
      next.cards,
      next.players.map((p) => p.id),
      me.id,
      cardIds
    )
    next.phase = 'play'
    commit(next)
  }

  // --- Play actions ---

  function addTurn(askerId: string, suggestion: Suggestion, responses: Response[]): void {
    snapshot()
    const { grid, turn } = applyTurn(state.value, askerId, suggestion, responses)
    const next = cloneState(state.value)
    next.grid = grid
    next.turns.push(turn)
    if (turn.groupNumber != null) next.nextGroupNumber = state.value.nextGroupNumber + 1
    commit(next)
  }

  function cycleCellState(cardId: string, playerId: string): void {
    snapshot()
    const next = cloneState(state.value)
    const cur = next.grid[cardId][playerId]
    const newSt = cycleCell(cur, next.nextGroupNumber)
    next.grid = setCell(next, cardId, playerId, newSt)
    if (newSt.kind === 'note') next.nextGroupNumber = Math.max(next.nextGroupNumber, newSt.n + 1)
    commit(next)
  }

  function setCellState(cardId: string, playerId: string, st: CellState): void {
    snapshot()
    const next = cloneState(state.value)
    next.grid = setCell(next, cardId, playerId, st)
    commit(next)
  }

  function removeLastTurn(): void {
    if (state.value.turns.length === 0) return
    snapshot()
    const next = cloneState(state.value)
    next.turns.pop()
    // Recompute grid from scratch using initial hand + remaining turns.
    const me = next.players.find((p) => p.isMe)
    let grid = makeGrid(next.cards, next.players.map((p) => p.id))
    if (me && me.hand.length) {
      grid = applyHand(grid, next.cards, next.players.map((p) => p.id), me.id, me.hand)
    }
    let nextGroup = 1
    for (const t of next.turns) {
      const r = applyTurn({ ...next, grid, nextGroupNumber: nextGroup }, t.askerId, t.suggestion, t.responses)
      grid = r.grid
      if (r.turn.groupNumber != null) nextGroup += 1
    }
    next.grid = grid
    next.nextGroupNumber = nextGroup
    commit(next)
  }

  // --- Undo / redo ---

  function undo(): void {
    if (!canUndo.value) return
    future.value.push(cloneState(state.value))
    const prev = past.value.pop()!
    state.value = prev
    persist()
  }

  function redo(): void {
    if (!canRedo.value) return
    past.value.push(cloneState(state.value))
    const nxt = future.value.pop()!
    state.value = nxt
    persist()
  }

  // --- Persistence ---

  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.value))
    } catch (e) {
      console.warn('persist failed', e)
    }
  }

  function load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as GameState
      // basic shape check
      if (parsed && parsed.cards && parsed.players) state.value = parsed
    } catch (e) {
      console.warn('load failed', e)
    }
  }

  function resetAll(): void {
    snapshot()
    state.value = freshState()
    persist()
  }

  return {
    state,
    canUndo, canRedo,
    setEdition, setPlayers, setMyHand,
    addTurn, cycleCellState, setCellState, removeLastTurn,
    undo, redo, resetAll, load
  }
})

// re-export for components
export type { Card, Edition, GameState, Grid, Player, Response, Suggestion, Turn, CellState }
export { slug }