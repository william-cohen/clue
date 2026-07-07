<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../stores/game'
import { byCategory } from '../logic/cards'
import GridCell from './GridCell.vue'

const store = useGameStore()
const state = computed(() => store.state)

const grouped = computed(() => {
  return byCategory(state.value.cards)
})

const playerIds = computed(() => state.value.players.map((p) => p.id))
const playerById = computed(() => {
  const m: Record<string, { name: string; isMe: boolean }> = {}
  for (const p of state.value.players) m[p.id] = { name: p.name, isMe: p.isMe }
  return m
})

const sectionTitles: Record<string, string> = {
  room: 'Rooms',
  suspect: 'Suspects',
  weapon: 'Weapons'
}

function tapCell(cardId: string, playerId: string) {
  store.cycleCellState(cardId, playerId)
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
</script>

<template>
  <div class="overflow-x-auto">
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
            <td class="sticky left-0 z-10 bg-slate-900 px-2 py-1 text-slate-200 whitespace-nowrap border-t border-slate-800">
              {{ card.name }}
            </td>
            <td v-for="pid in playerIds" :key="pid" class="text-center border-t border-slate-800">
              <GridCell
                :state="state.grid[card.id][pid]"
                :me="playerById[pid].isMe"
                @tap="tapCell(card.id, pid)"
              />
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>