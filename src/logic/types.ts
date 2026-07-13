import type { GameEvent, ManualEvent, ManualEntry, SuggestionEvent } from './events'
export type { GameEvent, ManualEvent, ManualEntry, SuggestionEvent }

export type Category = 'room' | 'suspect' | 'weapon'

export interface Card {
  id: string
  name: string
  category: Category
}

export type CellState =
  | { kind: 'empty' }
  | { kind: 'cross' }
  | { kind: 'tick' }
  | { kind: 'note', ns: number[] }

export type Grid = Record<string, Record<string, CellState>>
export type PlayerGrid = Record<string, CellState>

export interface Player {
  id: string
  name: string
  isMe: boolean
  hand: string[]
}

export interface Edition {
  rooms: string[]
  suspects: string[]
  weapons: string[]
}

export interface Suggestion {
  suspect: string
  weapon: string
  room: string
}

export interface Response {
  responderId: string
  passed: boolean
  /** When the responder is "me" and revealed a specific card, its id is recorded here. */
  shownCardId?: string | null
  /** When the responder was skipped (absent), no deduction is made for them. */
  skipped?: boolean
}

export interface Turn {
  id: string
  askerId: string
  suggestion: Suggestion
  responses: Response[]
  groupNumber: number | null
}

/** A suggestion group: the player who showed + the original 3 cards they could have shown. */
export interface SuggestionGroup {
  playerId: string
  cardIds: string[]
}

/** The derived chart — computed by folding events through the inference engine. */
export interface Chart {
  grid: Grid
  groups: Record<number, SuggestionGroup>
  nextGroupNumber: number
  /** Cards dealt to each player — used by count-based deduction. */
  handSizes: Record<string, number>
}

/** Fixed setup data — doesn't change during play. */
export interface Setup {
  edition: Edition
  cards: Card[]
  players: Player[]
  myHand: string[]
  phase: 'setup' | 'play'
}

/** Persisted state: setup + event log. The chart is always derived. */
export interface PersistedState {
  setup: Setup
  events: GameEvent[]
  pointer: number
}