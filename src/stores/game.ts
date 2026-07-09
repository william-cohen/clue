import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  Card, CellState, Chart, Edition, Player, Setup,
  Response, Suggestion, GameEvent, ManualEntry
} from '../logic/types'
import { buildCards, CLASSIC_EDITION } from '../logic/cards'
import { buildChart, cycleCell } from '../logic/engine'
import { makeEventId } from '../logic/events'
import type { SuggestionEvent, ManualEvent } from '../logic/events'

const STORAGE_KEY = 'clue-sheet-v2'

function blankSetup(): Setup {
  const edition: Edition = {
    rooms: [...CLASSIC_EDITION.rooms],
    suspects: [...CLASSIC_EDITION.suspects],
    weapons: [...CLASSIC_EDITION.weapons]
  }
  return {
    edition,
    cards: buildCards(edition),
    players: [],
    myHand: [],
    phase: 'setup'
  }
}

function rid(): string {
  return `p-${Math.random().toString(36).slice(2, 9)}`
}

/** Migrate old single-cell manual events to the multi-entry shape. */
function migrateManualEvents(events: any[]): GameEvent[] {
  return events.map((e: any) => {
    if (e?.type === 'manual' && e.cardId && e.playerId && e.state && !e.entries) {
      return {
        id: e.id,
        type: 'manual',
        entries: [{ cardId: e.cardId, playerId: e.playerId, state: e.state }],
        description: e.description ?? ''
      } as ManualEvent
    }
    return e as GameEvent
  })
}

export const useGameStore = defineStore('game', () => {
  const setup = ref<Setup>(blankSetup())
  const events = ref<GameEvent[]>([])
  const pointer = ref(0)

  // Derived chart — the source of truth for the grid
  const chart = computed<Chart>(() =>
    buildChart(events.value.slice(0, pointer.value), setup.value.cards, setup.value.players)
  )

  // Convenience accessors for components
  const cards = computed(() => setup.value.cards)
  const players = computed(() => setup.value.players)
  const grid = computed(() => chart.value.grid)
  const groups = computed(() => chart.value.groups)
  const nextGroupNumber = computed(() => chart.value.nextGroupNumber)
  const phase = computed(() => setup.value.phase)

  // Event lists for display
  const suggestionEvents = computed(() => events.value.filter((e): e is SuggestionEvent => e.type === 'suggestion'))
  const manualEvents = computed(() => events.value.filter((e): e is ManualEvent => e.type === 'manual'))

  // Undo/redo: pointer moves through the event log
  const canUndo = computed(() => pointer.value > 0)
  const canRedo = computed(() => pointer.value < events.value.length)

  // ── Setup actions ────────────────────────────────────────────────

  function setEdition(edition: Edition): void {
    setup.value = {
      ...blankSetup(),
      edition: {
        rooms: [...edition.rooms],
        suspects: [...edition.suspects],
        weapons: [...edition.weapons]
      },
      cards: buildCards(edition)
    }
    events.value = []
    pointer.value = 0
    persist()
  }

  function setPlayers(names: string[], meIndex: number): void {
    setup.value = {
      ...setup.value,
      players: names.map((name, i) => ({
        id: rid(),
        name: name.trim() || `Player ${i + 1}`,
        isMe: i === meIndex,
        hand: []
      })),
      phase: 'setup'
    }
    events.value = []
    pointer.value = 0
    persist()
  }

  function setMyHand(cardIds: string[]): void {
    const me = setup.value.players.find((p) => p.isMe)
    if (!me) return
    me.hand = [...cardIds]
    setup.value = { ...setup.value, myHand: [...cardIds], phase: 'play' }
    persist()
  }

  // ── Event actions ────────────────────────────────────────────────

  function commitEvent(event: GameEvent): void {
    // Truncate any redo events
    events.value = [...events.value.slice(0, pointer.value), event]
    pointer.value = events.value.length
    persist()
  }

  function addSuggestion(askerId: string, suggestion: Suggestion, responses: Response[]): void {
    const event: SuggestionEvent = {
      id: makeEventId(),
      type: 'suggestion',
      askerId,
      suggestion,
      responses
    }
    commitEvent(event)
  }

  function addManualEntry(cardId: string, playerId: string, state: CellState, description: string): void {
    addManualEntries([{ cardId, playerId, state }], description)
  }

  function addManualEntries(entries: ManualEntry[], description: string): void {
    if (entries.length === 0) return
    const event: ManualEvent = {
      id: makeEventId(),
      type: 'manual',
      entries,
      description
    }
    commitEvent(event)
  }

  function cycleCellState(cardId: string, playerId: string): void {
    const cur = chart.value.grid[cardId][playerId]
    const newSt = cycleCell(cur, chart.value.nextGroupNumber)
    addManualEntry(cardId, playerId, newSt, '')
  }

  function setCellState(cardId: string, playerId: string, st: CellState, description = ''): void {
    addManualEntry(cardId, playerId, st, description)
  }

  function removeEvent(eventId: string): void {
    const idx = events.value.findIndex((e) => e.id === eventId)
    if (idx < 0) return
    events.value = events.value.filter((e) => e.id !== eventId)
    if (pointer.value > events.value.length) pointer.value = events.value.length
    persist()
  }

  function removeLastSuggestion(): void {
    // Find the last suggestion event
    for (let i = events.value.length - 1; i >= 0; i--) {
      if (events.value[i].type === 'suggestion') {
        const id = events.value[i].id
        removeEvent(id)
        return
      }
    }
  }

  // ── Undo/redo ────────────────────────────────────────────────────

  function undo(): void {
    if (pointer.value > 0) {
      pointer.value--
      persist()
    }
  }

  function redo(): void {
    if (pointer.value < events.value.length) {
      pointer.value++
      persist()
    }
  }

  // ── Reset ────────────────────────────────────────────────────────

  function resetAll(): void {
    setup.value = blankSetup()
    events.value = []
    pointer.value = 0
    persist()
  }

  // ── Persistence ──────────────────────────────────────────────────

  function persist(): void {
    try {
      const data = {
        setup: setup.value,
        events: events.value,
        pointer: pointer.value
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      console.warn('persist failed', e)
    }
  }

  function load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (parsed?.setup && parsed?.events) {
        setup.value = parsed.setup
        events.value = migrateManualEvents(parsed.events)
        pointer.value = parsed.pointer ?? events.value.length
      } else if (parsed?.cards && parsed?.players) {
        // Migrate old format (GameState → event-sourced)
        migrateOldFormat(parsed)
      }
    } catch (e) {
      console.warn('load failed', e)
    }
  }

  function migrateOldFormat(old: any): void {
    // Old format had: edition, cards, players, grid, turns, nextGroupNumber, phase
    setup.value = {
      edition: old.edition,
      cards: old.cards,
      players: old.players,
      myHand: old.players.find((p: any) => p.isMe)?.hand ?? [],
      phase: old.phase ?? 'play'
    }
    const newEvents: GameEvent[] = []
    if (old.turns) {
      for (const t of old.turns) {
        newEvents.push({
          id: makeEventId(),
          type: 'suggestion',
          askerId: t.askerId,
          suggestion: t.suggestion,
          responses: t.responses
        })
      }
    }
    events.value = newEvents
    pointer.value = newEvents.length
    persist()
  }

  return {
    // state
    setup, events, pointer,
    chart, cards, players, grid, groups, nextGroupNumber, phase,
    suggestionEvents, manualEvents,
    canUndo, canRedo,
    // setup actions
    setEdition, setPlayers, setMyHand,
    // event actions
    addSuggestion, addManualEntry, addManualEntries, cycleCellState, setCellState,
    removeEvent, removeLastSuggestion,
    // undo/redo
    undo, redo,
    // misc
    resetAll, load
  }
})

// re-export for components
export type { Card, Edition, Player, Response, Suggestion, CellState, GameEvent }