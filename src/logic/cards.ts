import type { Card, Category, Edition } from './types'

export const CLASSIC_EDITION: Edition = {
  rooms: [
    'Kitchen', 'Ballroom', 'Conservatory', 'Dining Room',
    'Billiard Room', 'Library', 'Lounge', 'Hall', 'Study'
  ],
  suspects: [
    'Miss Scarlett', 'Colonel Mustard', 'Mrs White',
    'Mr Green', 'Mrs Peacock', 'Professor Plum'
  ],
  weapons: [
    'Candlestick', 'Knife', 'Lead Pipe',
    'Revolver', 'Rope', 'Wrench'
  ]
}

export function buildCards(edition: Edition): Card[] {
  const make = (cat: Category, names: string[]): Card[] =>
    names.map((n) => ({ id: slug(n), name: n, category: cat }))
  return [
    ...make('room', edition.rooms),
    ...make('suspect', edition.suspects),
    ...make('weapon', edition.weapons)
  ]
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function byCategory(cards: Card[]): Record<Category, Card[]> {
  const out: Record<Category, Card[]> = { room: [], suspect: [], weapon: [] }
  for (const c of cards) out[c.category].push(c)
  return out
}