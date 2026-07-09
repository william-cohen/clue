import type { CellState, Suggestion, Response } from './types'

export interface SuggestionEvent {
  id: string
  type: 'suggestion'
  askerId: string
  suggestion: Suggestion
  responses: Response[]
}

export interface ManualEntry {
  cardId: string
  playerId: string
  state: CellState
}

export interface ManualEvent {
  id: string
  type: 'manual'
  entries: ManualEntry[]
  description: string
}

export type GameEvent = SuggestionEvent | ManualEvent

let eventCounter = 0
export function makeEventId(): string {
  return `e-${Date.now()}-${eventCounter++}`
}