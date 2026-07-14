import type { Card, Chart, Grid, GameEvent, Setup, Suggestion } from './types'
import { byCategory } from './cards'
import { foldEvent } from './engine'
import type { SuggestionEvent } from './events'
import { makeEventId } from './events'
import { buildProbabilities, buildPriors, type ProbMap } from './bayes'

/** Combined view of setup + chart + event log for the strategy engine. */
export interface StrategyState {
  setup: Setup
  chart: Chart
  events: GameEvent[]
}

export interface ScoredSuggestion {
  suggestion: Suggestion
  /** Names for display */
  suspectName: string
  weaponName: string
  roomName: string
  /** Our expected information gain, in bits */
  ourGain: number
  /** Average info leaked to each opponent, in bits */
  opponentLeak: number
  /** ourGain - opponentLeak (the net score; higher = better) */
  netScore: number
  /** Probability we learn something definitive (a tick), 0..1 */
  resolveProb: number
  /** Human-readable reasoning bullets */
  reasons: string[]
  /** Outcome probabilities for display */
  outcomes: { label: string; prob: number; ourGain: number }[]
  recommend: boolean
}

/** Who could plausibly hold a card, from a given observer's perspective? Returns player ids + 'solution'. */
function possibleHolders(grid: Grid, cardId: string, playerIds: string[], observerHand: string[]): string[] {
  const holders: string[] = []
  for (const pid of playerIds) {
    const cell = grid[cardId][pid]
    if (cell.kind === 'cross') continue
    if (cell.kind === 'tick') return [pid] // known holder → zero entropy
    holders.push(pid)
  }
  // The card might be in the solution (envelope)
  // If no player is ticked, solution is still possible unless we know the card is held
  const isHeldBySomeone = playerIds.some((pid) => grid[cardId][pid].kind === 'tick')
  if (!isHeldBySomeone) holders.push('__solution__')
  // If observer holds this card, they know it's not in the solution and they have it
  if (observerHand.includes(cardId)) return ['__me__']
  return holders
}

/**
 * Shannon entropy (in bits) of a single card from an observer's perspective,
 * using the Bayesian probability map for a non-uniform distribution.
 *
 * Build a distribution: p[player] = ProbMap[cardId][player] for each non-crossed
 * player, plus p[envelope] = 1 - sum(p[players]). Normalize, then compute -Σ p log2 p.
 *
 * Falls back to uniform (log2) if probs are not available.
 */
export function cardEntropyBayes(
  grid: Grid,
  probs: ProbMap,
  cardId: string,
  playerIds: string[],
  observerHand: string[]
): number {
  // Observer knows their own cards
  if (observerHand.includes(cardId)) return 0

  // If ticked for some player, entropy is 0 (known holder)
  const ticked = playerIds.find((pid) => grid[cardId][pid].kind === 'tick')
  if (ticked) return 0

  // Non-crossed players are the candidates
  const candidates = playerIds.filter((pid) => grid[cardId][pid].kind !== 'cross')
  if (candidates.length === 0) return 0 // in envelope, solved

  // Build distribution from ProbMap
  const row = probs[cardId]
  const dist: number[] = []
  let sum = 0
  for (const pid of candidates) {
    const p = row?.[pid] ?? 0
    dist.push(p)
    sum += p
  }
  // Envelope slot: 1 - sum(player probs). Only if no one is ticked.
  const envelopeP = Math.max(0, 1 - sum)
  dist.push(envelopeP)
  sum += envelopeP

  if (sum <= 0) return 0

  // Normalize and compute Shannon entropy
  let h = 0
  for (const p of dist) {
    if (p > 0) {
      const pn = p / sum
      h -= pn * Math.log2(pn)
    }
  }
  return h
}

/** Total Shannon entropy across all cards from an observer's perspective. */
export function totalEntropyBayes(
  grid: Grid,
  probs: ProbMap,
  cards: Card[],
  playerIds: string[],
  observerHand: string[]
): number {
  let h = 0
  for (const c of cards) h += cardEntropyBayes(grid, probs, c.id, playerIds, observerHand)
  return h
}

/** Estimate probability that a responder can show one of the 3 suggested cards.
 *  Uses Bayesian posteriors from the probability map for sharper estimates. */
function showProbability(grid: Grid, probs: ProbMap, cardIds: string[], responderId: string): number {
  // If any of the 3 is already ticked for the responder → they definitely can show (they have it).
  for (const cid of cardIds) {
    if (grid[cid][responderId].kind === 'tick') return 1
  }
  // If all 3 are crossed → they definitely cannot show.
  const nonX = cardIds.filter((cid) => grid[cid][responderId].kind !== 'cross')
  if (nonX.length === 0) return 0
  // P(holds at least one) = 1 - Π(1 - P(holds X))
  let pShow = 1
  for (const cid of nonX) {
    const p = probs[cid]?.[responderId] ?? 0
    pShow *= (1 - p)
  }
  return Math.min(1, 1 - pShow)
}

interface Outcome {
  /** responderId who showed, or null if all passed */
  showerId: string | null
  prob: number
}

/** Enumerate possible outcomes for a suggestion given turn order. */
function enumerateOutcomes(
  grid: Grid,
  probs: ProbMap,
  suggestionCardIds: string[],
  responderOrder: string[]
): Outcome[] {
  // Each responder either passes or shows; the first to show ends it.
  // We compute probability of each outcome path.
  const outcomes: Outcome[] = []
  let cumPassProb = 1 // probability all prior responders passed

  for (let i = 0; i < responderOrder.length; i++) {
    const rid = responderOrder[i]
    const pShow = showProbability(grid, probs, suggestionCardIds, rid)
    const pPass = 1 - pShow

    // outcome: this responder shows
    if (pShow > 0) {
      outcomes.push({ showerId: rid, prob: cumPassProb * pShow })
    }
    // continue: this responder passes
    cumPassProb *= pPass
    if (cumPassProb < 0.001) break
  }
  // outcome: everyone passed
  if (cumPassProb > 0) {
    outcomes.push({ showerId: null, prob: cumPassProb })
  }

  // normalize (probabilities may not sum to 1 due to heuristic)
  const total = outcomes.reduce((s, o) => s + o.prob, 0)
  if (total > 0) for (const o of outcomes) o.prob /= total
  return outcomes
}

/** Build a synthesized suggestion event for simulation. */
function simEvent(
  askerId: string,
  suggestionCardIds: string[],
  responses: { responderId: string; passed: boolean; shownCardId?: string | null }[]
): SuggestionEvent {
  return {
    id: makeEventId(),
    type: 'suggestion',
    askerId,
    suggestion: {
      suspect: suggestionCardIds[0],
      weapon: suggestionCardIds[1],
      room: suggestionCardIds[2]
    },
    responses
  }
}

/** Result of simulating one outcome: entropy + how many new ticks it produced. */
interface SimResult {
  entropy: number
  newTicks: number
}

/** Count ticks in a grid for a set of (cardId, playerId) pairs we care about. */
function countTicks(grid: Grid, cardIds: string[], playerIds: string[]): number {
  let n = 0
  for (const cid of cardIds) {
    for (const pid of playerIds) {
      if (grid[cid][pid].kind === 'tick') n++
    }
  }
  return n
}

/**
 * Simulate an outcome's effect on entropy from a given observer's perspective.
 * Uses the pure engine's foldEvent to propagate consequences — no direct grid
 * mutation. Pure with respect to the input chart.
 *
 * Returns the observer's entropy after the outcome and the number of new ticks
 * the outcome produces (for resolveProb computation).
 */
function entropyAfter(
  chart: Chart,
  cards: Card[],
  playerIds: string[],
  observerHand: string[],
  suggestionCardIds: string[],
  outcome: Outcome,
  observerIsAsker: boolean,
  askerId: string
): SimResult {
  const ticksBefore = countTicks(chart.grid, suggestionCardIds, playerIds)

  if (outcome.showerId === null) {
    // All passed → every non-asker responder is crossed on all 3 cards.
    const responses = playerIds
      .filter((p) => p !== askerId)
      .map((p) => ({ responderId: p, passed: true }))
    const simChart = foldEvent(chart, simEvent(askerId, suggestionCardIds, responses), playerIds)
    const simProbs = buildPriors(simChart, cards, playerIds)
    const entropy = totalEntropyBayes(simChart.grid, simProbs, cards, playerIds, observerHand)
    const newTicks = countTicks(simChart.grid, suggestionCardIds, playerIds) - ticksBefore
    return { entropy, newTicks }
  }

  // Someone showed.
  const shower = outcome.showerId
  const observerHolds = suggestionCardIds.filter((cid) => observerHand.includes(cid))

  if (observerIsAsker) {
    // The asker SEES the actual card. Model which card was most likely shown.
    if (observerHolds.length === 2) {
      // Shower must have the 3rd card — we see it.
      const third = suggestionCardIds.find((cid) => !observerHolds.includes(cid))!
      const responses = [{ responderId: shower, passed: false, shownCardId: third }]
      const simChart = foldEvent(chart, simEvent(askerId, suggestionCardIds, responses), playerIds)
      const simProbs = buildPriors(simChart, cards, playerIds)
      const entropy = totalEntropyBayes(simChart.grid, simProbs, cards, playerIds, observerHand)
      const newTicks = countTicks(simChart.grid, suggestionCardIds, playerIds) - ticksBefore
      return { entropy, newTicks }
    } else if (observerHolds.length === 1) {
      // Shower has one of the 2 non-observer cards — we don't know which. Average.
      const candidates = suggestionCardIds.filter((cid) => !observerHolds.includes(cid))
      let avgH = 0
      let avgNewTicks = 0
      for (const shown of candidates) {
        const responses = [{ responderId: shower, passed: false, shownCardId: shown }]
        const simChart = foldEvent(chart, simEvent(askerId, suggestionCardIds, responses), playerIds)
        const simProbs = buildPriors(simChart, cards, playerIds)
        avgH += totalEntropyBayes(simChart.grid, simProbs, cards, playerIds, observerHand)
        avgNewTicks += countTicks(simChart.grid, suggestionCardIds, playerIds) - ticksBefore
      }
      return { entropy: avgH / candidates.length, newTicks: avgNewTicks / candidates.length }
    } else {
      // Observer holds 0. Shower showed one of 3 — weighted average by Bayesian prob.
      const candidates = suggestionCardIds.filter((cid) => {
        const cell = chart.grid[cid][shower]
        return cell.kind !== 'cross' && cell.kind !== 'tick'
      })
      if (candidates.length === 0) {
        // Contradiction — shower shouldn't have been able to show.
        const curProbs = buildPriors(chart, cards, playerIds)
        const entropy = totalEntropyBayes(chart.grid, curProbs, cards, playerIds, observerHand)
        return { entropy, newTicks: 0 }
      }
      // Weight by P(shower holds this card) from the current probs
      const curProbs = buildPriors(chart, cards, playerIds)
      const weights = candidates.map((cid) => curProbs[cid]?.[shower] ?? 0)
      const wSum = weights.reduce((s, w) => s + w, 0)
      let avgH = 0
      let avgNewTicks = 0
      for (let i = 0; i < candidates.length; i++) {
        const responses = [{ responderId: shower, passed: false, shownCardId: candidates[i] }]
        const simChart = foldEvent(chart, simEvent(askerId, suggestionCardIds, responses), playerIds)
        const simProbs = buildPriors(simChart, cards, playerIds)
        const w = wSum > 0 ? weights[i] / wSum : 1 / candidates.length
        avgH += w * totalEntropyBayes(simChart.grid, simProbs, cards, playerIds, observerHand)
        avgNewTicks += w * (countTicks(simChart.grid, suggestionCardIds, playerIds) - ticksBefore)
      }
      return { entropy: avgH, newTicks: avgNewTicks }
    }
  } else {
    // Observer is NOT the asker (an opponent watching).
    // They only know: passers don't have any of the 3; the shower has at least one,
    // but they DON'T see which card (shownCardId: null) → foldEvent creates a note group.
    const responses: { responderId: string; passed: boolean; shownCardId?: string | null }[] = playerIds
      .filter((p) => p !== askerId && p !== shower)
      .map((p) => ({ responderId: p, passed: true }))
    responses.push({ responderId: shower, passed: false, shownCardId: null })
    const simChart = foldEvent(chart, simEvent(askerId, suggestionCardIds, responses), playerIds)
    const simProbs = buildPriors(simChart, cards, playerIds)
    const entropy = totalEntropyBayes(simChart.grid, simProbs, cards, playerIds, observerHand)
    const newTicks = countTicks(simChart.grid, suggestionCardIds, playerIds) - ticksBefore
    return { entropy, newTicks }
  }
}

/** Score a single suggestion. */
function scoreSuggestion(
  state: StrategyState,
  meId: string,
  suggestion: Suggestion,
  suggestionNames: { suspect: string; weapon: string; room: string },
  reachable: boolean,
  responderOrder: string[]
): ScoredSuggestion {
  const grid = state.chart.grid
  const cards = state.setup.cards
  const playerIds = state.setup.players.map((p) => p.id)
  const meHand = state.setup.players.find((p) => p.id === meId)?.hand ?? []

  const suggestionCardIds = [suggestion.suspect, suggestion.weapon, suggestion.room]

  // Bayesian probability map — sharper than the grid alone for outcome prediction
  const probs = buildProbabilities(
    state.events,
    cards,
    playerIds,
    state.chart
  )

  // Entropy before, from our perspective (Shannon, using ProbMap)
  const ourEntropyBefore = totalEntropyBayes(grid, probs, cards, playerIds, meHand)

  // Opponents' entropy before
  const opponents = state.setup.players.filter((p) => p.id !== meId)
  const oppEntropyBefore: Record<string, number> = {}
  for (const opp of opponents) {
    // Opponent knows their own hand
    oppEntropyBefore[opp.id] = totalEntropyBayes(grid, probs, cards, playerIds, opp.hand)
  }

  // Enumerate outcomes
  const outcomes = enumerateOutcomes(grid, probs, suggestionCardIds, responderOrder)

  // Expected entropy after, from our perspective
  let ourEntropyAfter = 0
  let opponentEntropyAfter: Record<string, number> = {}
  for (const opp of opponents) opponentEntropyAfter[opp.id] = 0
  let resolveProb = 0

  const outcomeDetails: { label: string; prob: number; ourGain: number }[] = []

  for (const o of outcomes) {
    const sim = entropyAfter(state.chart, cards, playerIds, meHand, suggestionCardIds, o, true, meId)
    ourEntropyAfter += o.prob * sim.entropy

    for (const opp of opponents) {
      const oppSim = entropyAfter(state.chart, cards, playerIds, opp.hand, suggestionCardIds, o, false, meId)
      opponentEntropyAfter[opp.id] += o.prob * oppSim.entropy
    }

    // Probability of a definitive resolution: how many new ticks did this outcome produce?
    // newTicks is averaged over card-uncertainty when the asker doesn't see the card.
    // resolveProb = P(at least one definitive tick from this outcome)
    if (o.showerId && sim.newTicks > 0) {
      resolveProb += o.prob * Math.min(1, sim.newTicks)
    }

    const label = o.showerId
      ? `${state.setup.players.find((p) => p.id === o.showerId)?.name ?? '?'} shows`
      : 'all pass'
    outcomeDetails.push({
      label,
      prob: o.prob,
      ourGain: ourEntropyBefore - sim.entropy
    })
  }

  const ourGain = ourEntropyBefore - ourEntropyAfter
  const oppLeakValues = opponents.map((opp) => oppEntropyBefore[opp.id] - opponentEntropyAfter[opp.id])
  const opponentLeak = oppLeakValues.length > 0
    ? oppLeakValues.reduce((s, v) => s + v, 0) / oppLeakValues.length
    : 0

  const netScore = ourGain - opponentLeak

  // Build reasons
  const reasons: string[] = []
  const meHoldsInSuggestion = suggestionCardIds.filter((cid) => meHand.includes(cid))
  if (meHoldsInSuggestion.length === 2) {
    reasons.push('You hold 2 of 3 cards — a show reveals the 3rd definitively')
  } else if (meHoldsInSuggestion.length === 1) {
    reasons.push('You hold 1 of 3 — a show narrows the shower to 1 of the other 2')
  }
  const uncertainCards = suggestionCardIds.filter((cid) => {
    const holders = possibleHolders(grid, cid, playerIds, meHand)
    return holders.length > 1
  })
  if (uncertainCards.length === 3) {
    reasons.push('All 3 cards are still uncertain for at least one player')
  }
  if (outcomeDetails.length > 0 && outcomeDetails[0].prob > 0.4 && outcomeDetails[0].label.includes('shows')) {
    reasons.push(`Likely ${outcomeDetails[0].label} (${Math.round(outcomeDetails[0].prob * 100)}%)`)
  }
  if (resolveProb > 0.3) {
    reasons.push(`${Math.round(resolveProb * 100)}% chance of a definitive resolution`)
  }
  if (!reachable) {
    reasons.unshift('⚠ Not reachable from your current room')
  }

  return {
    suggestion,
    suspectName: suggestionNames.suspect,
    weaponName: suggestionNames.weapon,
    roomName: suggestionNames.room,
    ourGain,
    opponentLeak,
    netScore,
    resolveProb,
    reasons,
    outcomes: outcomeDetails.sort((a, b) => b.prob - a.prob).slice(0, 3),
    recommend: false
  }
}

/** Score all suggestions and return the best ones, sorted by net score. */
export function suggestBestQuestions(
  state: StrategyState,
  meId: string,
  reachableRoomIds: string[],
  allRoomsReachable: boolean
): ScoredSuggestion[] {
  const grouped = byCategory(state.setup.cards)
  const meObj = state.setup.players.find((p) => p.id === meId)
  if (!meObj) return []

  // Responder order: players after me in seat order
  const seatOrder = state.setup.players.map((p) => p.id)
  const myIdx = seatOrder.indexOf(meId)
  const responderOrder: string[] = []
  for (let i = 1; i <= seatOrder.length - 1; i++) {
    responderOrder.push(seatOrder[(myIdx + i) % seatOrder.length])
  }

  const results: ScoredSuggestion[] = []

  for (const suspect of grouped.suspect) {
    for (const weapon of grouped.weapon) {
      for (const room of grouped.room) {
        const reachable = allRoomsReachable || reachableRoomIds.includes(room.id)
        const scored = scoreSuggestion(
          state,
          meId,
          { suspect: suspect.id, weapon: weapon.id, room: room.id },
          { suspect: suspect.name, weapon: weapon.name, room: room.name },
          reachable,
          responderOrder
        )
        // Only include reachable suggestions, but mark unreachable ones
        if (reachable) results.push(scored)
      }
    }
  }

  // Sort by net score descending
  results.sort((a, b) => b.netScore - a.netScore)

  // Mark top as recommended
  if (results.length > 0) {
    results[0].recommend = true
    // If the best net score is negative, recommend not suggesting
    if (results[0].netScore <= 0) {
      results[0].recommend = false
    }
  }

  return results
}

/** Whether to recommend "don't make a suggestion" — true if no suggestion has positive net gain. */
export function shouldPassTurn(scored: ScoredSuggestion[]): boolean {
  return scored.length === 0 || scored[0].netScore <= 0
}