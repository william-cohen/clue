import type { Card, CellState, GameState, Grid, PlayerGrid, Suggestion } from './types'
import { byCategory } from './cards'
import { fixedPoint } from './deduction'

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

/** Entropy (in bits) of a single card from observer's perspective. */
function cardEntropy(grid: Grid, cardId: string, playerIds: string[], observerHand: string[]): number {
  const holders = possibleHolders(grid, cardId, playerIds, observerHand)
  if (holders.length <= 1) return 0
  return Math.log2(holders.length)
}

/** Total entropy across all unsolved cards from a perspective. */
function totalEntropy(grid: Grid, cards: Card[], playerIds: string[], observerHand: string[]): number {
  let h = 0
  for (const c of cards) h += cardEntropy(grid, c.id, playerIds, observerHand)
  return h
}

/** Estimate probability that a responder can show one of the 3 suggested cards. */
function showProbability(grid: Grid, cardIds: string[], responderId: string): number {
  // If any of the 3 is already ticked for the responder → they definitely can show (they have it).
  for (const cid of cardIds) {
    if (grid[cid][responderId].kind === 'tick') return 1
  }
  // Otherwise, estimate: fraction of the 3 cards that aren't crossed for them.
  const nonX = cardIds.filter((cid) => grid[cid][responderId].kind !== 'cross')
  if (nonX.length === 0) return 0
  // Rough heuristic: more non-X cards → higher chance they hold at least one.
  // Use 1 - product of (1 - p_each), where p_each ~ 1/possibleHolders.
  let pShow = 1
  for (const cid of nonX) {
    const holders = possibleHolders(grid, cid, [responderId], [])
    const p = holders.includes(responderId) ? 1 / holders.length : 0
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
  suggestionCardIds: string[],
  responderOrder: string[]
): Outcome[] {
  // Each responder either passes or shows; the first to show ends it.
  // We compute probability of each outcome path.
  const outcomes: Outcome[] = []
  let cumPassProb = 1 // probability all prior responders passed

  for (let i = 0; i < responderOrder.length; i++) {
    const rid = responderOrder[i]
    const pShow = showProbability(grid, suggestionCardIds, rid)
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

/** Deep-clone a grid including note arrays. */
function deepCloneGrid(grid: Grid): Grid {
  const out: Grid = {}
  for (const k of Object.keys(grid)) {
    const src = grid[k]
    const newRow: PlayerGrid = {}
    for (const pid of Object.keys(src)) {
      const c = src[pid]
      newRow[pid] = c.kind === 'note' ? { kind: 'note', ns: [...c.ns] } : c
    }
    out[k] = newRow
  }
  return out
}

/** Set a cell in a grid (mutating). */
function setCellSim(grid: Grid, cid: string, pid: string, st: CellState): void {
  grid[cid][pid] = st
}

/** Simulate an outcome's effect on entropy from a given observer's perspective.
 *  Uses the real deduction engine's fixedPoint to propagate consequences. */
function entropyAfter(
  grid: Grid,
  cards: Card[],
  playerIds: string[],
  observerHand: string[],
  suggestionCardIds: string[],
  outcome: Outcome,
  observerIsAsker: boolean,
  groupNumber: number
): number {
  const simGrid = deepCloneGrid(grid)

  if (outcome.showerId === null) {
    // All passed → every responder is crossed on all 3 cards
    for (const rid of playerIds) {
      if (rid === observerHand[0] && observerIsAsker) continue // asker doesn't pass to themselves
      for (const cid of suggestionCardIds) {
        if (simGrid[cid][rid].kind === 'empty') setCellSim(simGrid, cid, rid, { kind: 'cross' })
      }
    }
    fixedPoint(simGrid, cards, playerIds)
    return totalEntropy(simGrid, cards, playerIds, observerHand)
  }

  // Someone showed.
  const shower = outcome.showerId
  const observerHolds = suggestionCardIds.filter((cid) => observerHand.includes(cid))

  if (observerIsAsker) {
    // The asker SEES the actual card. We need to model which card was most likely shown.
    // If the observer holds 2 of 3, the shower must have the 3rd → tick it.
    // If the observer holds 1 of 3, the shower showed one of the other 2.
    // If the observer holds 0, the shower showed one of 3 (pick the most informative).
    if (observerHolds.length === 2) {
      const third = suggestionCardIds.find((cid) => !observerHolds.includes(cid))!
      setCellSim(simGrid, third, shower, { kind: 'tick' })
      fixedPoint(simGrid, cards, playerIds)
      return totalEntropy(simGrid, cards, playerIds, observerHand)
    } else if (observerHolds.length === 1) {
      // The shower has one of the 2 non-observer cards. Pick the one with more uncertainty
      // (more possible holders) to resolve → that's the one most likely to be shown.
      // Actually, we don't know which — model both possibilities and average.
      const candidates = suggestionCardIds.filter((cid) => !observerHolds.includes(cid))
      let avgH = 0
      for (const shown of candidates) {
        const g = deepCloneGrid(simGrid)
        setCellSim(g, shown, shower, { kind: 'tick' })
        fixedPoint(g, cards, playerIds)
        avgH += totalEntropy(g, cards, playerIds, observerHand)
      }
      return avgH / candidates.length
    } else {
      // Observer holds 0. The shower showed one of 3. Average over the 3 possibilities,
      // weighted by how likely the shower is to hold each card.
      const candidates = suggestionCardIds.filter((cid) => simGrid[cid][shower].kind !== 'cross' && simGrid[cid][shower].kind !== 'tick')
      if (candidates.length === 0) {
        // Contradiction — shower shouldn't have been able to show. Return current entropy.
        return totalEntropy(simGrid, cards, playerIds, observerHand)
      }
      // Weight by inverse of possible holders (fewer holders = more likely they have it)
      const weights = candidates.map((cid) => {
        const holders = possibleHolders(simGrid, cid, playerIds, observerHand)
        return holders.length > 0 ? 1 / holders.length : 1
      })
      const wSum = weights.reduce((s, w) => s + w, 0)
      let avgH = 0
      for (let i = 0; i < candidates.length; i++) {
        const g = deepCloneGrid(simGrid)
        setCellSim(g, candidates[i], shower, { kind: 'tick' })
        fixedPoint(g, cards, playerIds)
        avgH += (weights[i] / wSum) * totalEntropy(g, cards, playerIds, observerHand)
      }
      return avgH
    }
  } else {
    // Observer is NOT the asker (an opponent watching).
    // They only know: passers don't have any of the 3; the shower has at least one.
    // Passers already handled by the caller? No — we need to cross prior passers too.
    // The outcome only tells us the shower; prior responders must have passed.
    // But we don't know who passed before the shower here — that's handled by enumerateOutcomes
    // and we only get the final shower. We approximate: cross all non-shower responders on the 3 cards
    // (they passed), and for the shower, add a note group to the non-X cells.
    for (const rid of playerIds) {
      if (rid === shower) continue
      for (const cid of suggestionCardIds) {
        if (simGrid[cid][rid].kind === 'empty') setCellSim(simGrid, cid, rid, { kind: 'cross' })
      }
    }
    // Shower has at least one of the 3 → add a note group to non-X cells
    const nonX = suggestionCardIds.filter((cid) => simGrid[cid][shower].kind !== 'cross' && simGrid[cid][shower].kind !== 'tick')
    if (nonX.length >= 2) {
      for (const cid of nonX) {
        const cur = simGrid[cid][shower]
        if (cur.kind === 'note') {
          if (!cur.ns.includes(groupNumber)) setCellSim(simGrid, cid, shower, { kind: 'note', ns: [...cur.ns, groupNumber].sort((a, b) => a - b) })
        } else if (cur.kind === 'empty') {
          setCellSim(simGrid, cid, shower, { kind: 'note', ns: [groupNumber] })
        }
      }
    } else if (nonX.length === 1) {
      setCellSim(simGrid, nonX[0], shower, { kind: 'tick' })
    }
    fixedPoint(simGrid, cards, playerIds)
    return totalEntropy(simGrid, cards, playerIds, observerHand)
  }
}

/** Score a single suggestion. */
function scoreSuggestion(
  state: GameState,
  meId: string,
  suggestion: Suggestion,
  suggestionNames: { suspect: string; weapon: string; room: string },
  reachable: boolean,
  responderOrder: string[]
): ScoredSuggestion {
  const grid = state.grid
  const cards = state.cards
  const playerIds = state.players.map((p) => p.id)
  const meHand = state.players.find((p) => p.id === meId)?.hand ?? []

  const suggestionCardIds = [suggestion.suspect, suggestion.weapon, suggestion.room]

  // Entropy before, from our perspective
  const ourEntropyBefore = totalEntropy(grid, cards, playerIds, meHand)

  // Opponents' entropy before
  const opponents = state.players.filter((p) => p.id !== meId)
  const oppEntropyBefore: Record<string, number> = {}
  for (const opp of opponents) {
    // Opponent knows their own hand
    oppEntropyBefore[opp.id] = totalEntropy(grid, cards, playerIds, opp.hand)
  }

  // Enumerate outcomes
  const outcomes = enumerateOutcomes(grid, suggestionCardIds, responderOrder)
  const groupNum = state.nextGroupNumber

  // Expected entropy after, from our perspective
  let ourEntropyAfter = 0
  let opponentEntropyAfter: Record<string, number> = {}
  for (const opp of opponents) opponentEntropyAfter[opp.id] = 0
  let resolveProb = 0

  const outcomeDetails: { label: string; prob: number; ourGain: number }[] = []

  for (const o of outcomes) {
    const hAfter = entropyAfter(grid, cards, playerIds, meHand, suggestionCardIds, o, true, groupNum)
    ourEntropyAfter += o.prob * hAfter

    for (const opp of opponents) {
      const oppHAfter = entropyAfter(grid, cards, playerIds, opp.hand, suggestionCardIds, o, false, groupNum)
      opponentEntropyAfter[opp.id] += o.prob * oppHAfter
    }

    // Probability of a definitive resolution (we learn exactly which card)
    if (o.showerId) {
      const observerHolds = suggestionCardIds.filter((cid) => meHand.includes(cid))
      if (observerHolds.length === 2) resolveProb += o.prob // we'll learn the 3rd definitively
      else if (observerHolds.length === 1) resolveProb += o.prob * 0.5
    }

    const label = o.showerId
      ? `${state.players.find((p) => p.id === o.showerId)?.name ?? '?'} shows`
      : 'all pass'
    outcomeDetails.push({
      label,
      prob: o.prob,
      ourGain: ourEntropyBefore - hAfter
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
  state: GameState,
  meId: string,
  reachableRoomIds: string[],
  allRoomsReachable: boolean
): ScoredSuggestion[] {
  const grouped = byCategory(state.cards)
  const meObj = state.players.find((p) => p.id === meId)
  if (!meObj) return []

  // Responder order: players after me in seat order
  const seatOrder = state.players.map((p) => p.id)
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