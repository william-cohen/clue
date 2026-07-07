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
  | { kind: 'note', n: number }

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
}

export interface Turn {
  id: string
  askerId: string
  suggestion: Suggestion
  responses: Response[]
  groupNumber: number | null
}

export interface GameState {
  edition: Edition
  cards: Card[]
  players: Player[]
  grid: Grid
  turns: Turn[]
  nextGroupNumber: number
  phase: 'setup' | 'play'
}