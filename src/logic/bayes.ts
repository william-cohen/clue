import type { Card, Chart } from './types'
import type { GameEvent, SuggestionEvent } from './events'

/** Probability map: P(player holds card) for each (card, player) pair. */
export type ProbMap = Record<string, Record<string, number>>

/** Suggestion likelihoods λ_k = P(suggest {A,B,C} | holds k of 3). */
export const SUGGEST_LIKELIHOODS = [0.5, 0.3, 0.1, 0.02] as const

/**
 * Build a probability map by folding all events onto priors derived from the chart.
 * The chart encodes all hard deductions (crosses, ticks, groups); the Bayesian
 * updates add the soft "asker suggests what they don't hold" signal on top.
 * Pure: takes events + chart, returns a fresh ProbMap.
 */
export function buildProbabilities(
  events: GameEvent[],
  cards: Card[],
  playerIds: string[],
  chart: Chart
): ProbMap {
  const probs = buildPriors(chart, cards, playerIds)

  for (const event of events) {
    if (event.type === 'suggestion') {
      updateFromSuggestion(probs, event)
    }
  }
  return probs
}

/**
 * Derive prior probabilities from the hard grid state.
 * - tick → 1.0
 * - cross → 0.0
 * - empty → 1 / (num non-crossed players + 1 for envelope)
 * - note → 1 / group_card_count (player holds at least one card in the group; uniform over which)
 */
export function buildPriors(chart: Chart, cards: Card[], playerIds: string[]): ProbMap {
  const probs: ProbMap = {}

  for (const card of cards) {
    const row: Record<string, number> = {}
    const nonCrossed = playerIds.filter((p) => chart.grid[card.id][p].kind !== 'cross')
    const denom = nonCrossed.length + 1 // +1 for envelope

    for (const p of playerIds) {
      const cell = chart.grid[card.id][p]
      switch (cell.kind) {
        case 'tick': row[p] = 1.0; break
        case 'cross': row[p] = 0.0; break
        case 'note': row[p] = notePrior(chart, card.id, p); break
        case 'empty': row[p] = 1 / denom; break
      }
    }
    probs[card.id] = row
  }

  return probs
}

/** Prior for a note cell: 1 / (number of cards in the group), averaged if in multiple groups. */
function notePrior(chart: Chart, cardId: string, playerId: string): number {
  const cell = chart.grid[cardId][playerId]
  if (cell.kind !== 'note') return 0
  // Look up the group(s) this cell belongs to and average their sizes
  const sizes = cell.ns.map((n) => chart.groups[n]?.cardIds.length ?? 1)
  const avg = sizes.reduce((s, x) => s + x, 0) / sizes.length
  return 1 / avg
}

/**
 * Bayesian update from a suggestion event.
 *
 * Askers tend to suggest cards they DON'T hold. For the asker's 3 suggested cards,
 * we update P(asker holds X) downward using:
 *
 *   P(holds X | suggested {A,B,C}) ∝ P(suggested | holds X) × P(holds X)
 *
 * where P(suggested | holds X) marginalizes over how many of the other 2 cards
 * the asker also holds, weighted by the λ_k likelihoods.
 *
 * Passers and the shower are already hard-crossed/ticked by the engine. This
 * function only adds the soft asker signal.
 */
function updateFromSuggestion(
  probs: ProbMap,
  event: SuggestionEvent
): void {
  const { askerId, suggestion } = event
  const suggestionCardIds = [suggestion.suspect, suggestion.weapon, suggestion.room]

  // Compute current probability the asker holds each of the 3 suggested cards.
  const pCard = suggestionCardIds.map((cid) => probs[cid]?.[askerId] ?? 0)

  // For each suggested card X, compute P(suggested | holds X) and P(suggested | ¬X).
  // If the asker holds X, they also hold some subset of the other 2.
  // P(suggested | holds X, holds j of other 2) = λ_{1+j}
  // P(suggested | ¬X, holds j of other 2) = λ_j
  // We marginalize over j using the other cards' probabilities (independence approx).
  const likelihoods = [0, 0, 0]
  const notXLikelihoods = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const pOther = [0, 1, 2].filter((j) => j !== i).map((j) => pCard[j])
    let likeGiven = 0
    let likeNot = 0
    for (let mask = 0; mask < 4; mask++) {
      let j = 0
      let pMask = 1
      for (let k = 0; k < 2; k++) {
        if (mask & (1 << k)) { j++; pMask *= pOther[k] }
        else { pMask *= (1 - pOther[k]) }
      }
      likeGiven += pMask * SUGGEST_LIKELIHOODS[1 + j]
      likeNot += pMask * SUGGEST_LIKELIHOODS[j]
    }
    likelihoods[i] = likeGiven
    notXLikelihoods[i] = likeNot
  }

  // Bayesian update for each suggested card
  for (let i = 0; i < 3; i++) {
    const cid = suggestionCardIds[i]
    const prior = pCard[i]
    if (prior <= 0 || prior >= 1) continue // skip certain cards

    const pGiven = likelihoods[i]
    const pGivenNot = notXLikelihoods[i]

    const num = pGiven * prior
    const denom = num + pGivenNot * (1 - prior)
    if (denom > 0) {
      probs[cid][askerId] = num / denom
    }
  }
}