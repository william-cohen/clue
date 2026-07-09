<script setup lang="ts">
import { computed, ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { useGameStore } from '../stores/game'
import { byCategory } from '../logic/cards'
import { cycleCell } from '../logic/engine'
import type { CellState } from '../logic/types'
import GridCell from './GridCell.vue'
import NumberPad from './NumberPad.vue'

const store = useGameStore()

const grouped = computed(() => {
  return byCategory(store.cards)
})

const playerIds = computed(() => store.players.map((p) => p.id))
const playerById = computed(() => {
  const m: Record<string, { name: string; isMe: boolean }> = {}
  for (const p of store.players) m[p.id] = { name: p.name, isMe: p.isMe }
  return m
})

const sectionTitles: Record<string, string> = {
  room: 'Rooms',
  suspect: 'Suspects',
  weapon: 'Weapons'
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

// ── Staging overlay ────────────────────────────────────────────────
// Pending cell edits, keyed by `${cardId}|${playerId}`. Not yet committed.

const cellKey = (cardId: string, playerId: string) => `${cardId}|${playerId}`
const staged = reactive(new Map<string, CellState>())
const description = ref('')

const hasStaged = computed(() => staged.size > 0)
const stagedCount = computed(() => staged.size)

/** What the cell should display: staged state if present, else committed. */
function displayState(cardId: string, playerId: string): CellState {
  const k = cellKey(cardId, playerId)
  return staged.get(k) ?? store.grid[cardId][playerId]
}

/** Is this cell dirty (has a staged change vs the committed grid)? */
function isDirty(cardId: string, playerId: string): boolean {
  const k = cellKey(cardId, playerId)
  return staged.has(k)
}

function isRowSolved(cardId: string): boolean {
  for (const pid of playerIds.value) {
    if (displayState(cardId, pid).kind !== 'cross') return false
  }
  return true
}

// ── Tap to cycle a cell (staging) ──────────────────────────────────

function tapCell(cardId: string, playerId: string) {
  const k = cellKey(cardId, playerId)
  const cur = displayState(cardId, playerId)
  const next = cycleCell(cur, store.nextGroupNumber)
  if (next.kind === 'empty' || sameState(next, store.grid[cardId][playerId])) {
    // Cycled back to empty, or back to the committed state → drop the stage
    staged.delete(k)
  } else {
    staged.set(k, next)
  }
}

function sameState(a: CellState, b: CellState): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'note' && b.kind === 'note') {
    return a.ns.length === b.ns.length && a.ns.every((v, i) => v === b.ns[i])
  }
  return true
}

// ── Long-press → number pad (edits staging) ───────────────────────

const pad = ref<{ cardId: string; playerId: string; x: number; y: number } | null>(null)

function onLongPress(cardId: string, playerId: string, coords: { x: number; y: number }) {
  pad.value = { cardId, playerId, x: coords.x, y: coords.y }
}

const padCellNs = computed<number[]>(() => {
  if (!pad.value) return []
  const c = displayState(pad.value.cardId, pad.value.playerId)
  return c.kind === 'note' ? c.ns : []
})

function pickNumber(n: number) {
  if (!pad.value) return
  const { cardId, playerId } = pad.value
  const cur = displayState(cardId, playerId)
  let ns: number[]
  if (cur.kind === 'note') {
    ns = cur.ns.includes(n) ? cur.ns.filter((x) => x !== n) : [...cur.ns, n].sort((a, b) => a - b)
  } else {
    ns = [n]
  }
  const k = cellKey(cardId, playerId)
  if (ns.length === 0) {
    // Notes cleared → if committed state was also empty/non-note, drop stage
    const committed = store.grid[cardId][playerId]
    if (committed.kind === 'note' || committed.kind === 'empty') {
      staged.delete(k)
    } else {
      staged.set(k, { kind: 'empty' })
    }
  } else {
    staged.set(k, { kind: 'note', ns })
  }
}

function clearCell() {
  if (!pad.value) return
  const { cardId, playerId } = pad.value
  const k = cellKey(cardId, playerId)
  const committed = store.grid[cardId][playerId]
  if (committed.kind === 'empty') {
    staged.delete(k)
  } else {
    staged.set(k, { kind: 'empty' })
  }
  pad.value = null
}

function closePad() {
  pad.value = null
}

// ── Commit / discard ───────────────────────────────────────────────

function commitStaged() {
  if (staged.size === 0) return
  const entries = [...staged.entries()].map(([k, state]) => {
    const [cardId, playerId] = k.split('|')
    return { cardId, playerId, state }
  })
  store.addManualEntries(entries, description.value)
  discardStaged()
}

function discardStaged() {
  staged.clear()
  description.value = ''
}

// ── Keyboard ───────────────────────────────────────────────────────

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    closePad()
    discardStaged()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="overflow-x-auto pb-40">
    <table class="border-collapse text-sm">
      <thead>
        <tr>
          <th class="sticky left-0 z-20 bg-slate-900 text-left px-2 py-1 w-32 min-w-32">Card</th>
          <th
            v-for="pid in playerIds"
            :key="pid"
            class="px-1 py-1 min-w-12"
            :class="playerById[pid].isMe ? 'text-emerald-400' : 'text-slate-300'"
          >
            <div class="flex flex-col items-center">
              <span class="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold">
                {{ initials(playerById[pid].name) }}
              </span>
              <span class="text-[10px] mt-0.5 max-w-12 truncate">{{ playerById[pid].name }}</span>
            </div>
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-for="cat in (['room','suspect','weapon'] as const)" :key="cat">
          <tr>
            <td
              colspan="99"
              class="sticky left-0 bg-slate-800/60 px-2 py-1 text-xs uppercase tracking-wide text-slate-400 font-semibold"
            >
              {{ sectionTitles[cat] }}
            </td>
          </tr>
          <tr v-for="card in grouped[cat]" :key="card.id">
            <td
              class="sticky left-0 z-10 bg-slate-900 px-2 py-1 whitespace-nowrap border-t border-slate-800"
              :class="isRowSolved(card.id) ? 'text-slate-100 font-bold underline decoration-emerald-500 decoration-2 underline-offset-2' : 'text-slate-200'"
            >
              {{ card.name }}
            </td>
            <td v-for="pid in playerIds" :key="pid" class="text-center border-t border-slate-800">
              <GridCell
                :state="displayState(card.id, pid)"
                :me="playerById[pid].isMe"
                :dirty="isDirty(card.id, pid)"
                @tap="tapCell(card.id, pid)"
                @longpress="onLongPress(card.id, pid, $event)"
              />
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <!-- backdrop to catch outside taps for number pad -->
    <div
      v-if="pad"
      class="fixed inset-0 z-40"
      @pointerdown="closePad"
      @click="closePad"
    />
    <NumberPad
      v-if="pad"
      :x="pad.x"
      :y="pad.y"
      :max="9"
      :active="padCellNs"
      @pick="pickNumber"
      @clear="clearCell"
      @close="closePad"
    />

    <!-- Staging commit bar -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="translate-y-full opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-full opacity-0"
    >
      <div v-if="hasStaged" class="fixed bottom-0 inset-x-0 z-30 border-t border-slate-700 bg-slate-900/95 backdrop-blur">
        <div class="max-w-md mx-auto p-3 space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-400">{{ stagedCount }} change{{ stagedCount === 1 ? '' : 's' }}</span>
            <div class="flex-1" />
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg bg-slate-700 text-xs text-slate-300"
              @click="discardStaged"
            >Discard</button>
            <button
              type="button"
              class="px-4 py-1.5 rounded-lg bg-emerald-600 text-xs text-white font-medium"
              @click="commitStaged"
            >Commit</button>
          </div>
          <input
            v-model="description"
            type="text"
            placeholder="Note (optional): e.g. Ruth doesn't have candlestick or Mr Green"
            class="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200"
            @pointerdown.stop
          />
        </div>
      </div>
    </Transition>
  </div>
</template>