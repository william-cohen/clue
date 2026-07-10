<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGameStore } from '../stores/game'
import { byCategory } from '../logic/cards'
import { suggestBestQuestions, shouldPassTurn } from '../logic/strategy'
import type { ScoredSuggestion } from '../logic/strategy'

const store = useGameStore()

const me = computed(() => store.players.find((p) => p.isMe))
const rooms = computed(() => byCategory(store.cards).room)

// Which rooms can I reach this turn?
// Default: all rooms (if the user hasn't specified). In real Cluedo you can only suggest
// the room you're currently in. We let the user pick one room (their current location)
// plus optionally rooms they were "transported" to by a previous suggestion this round.
const currentRoomId = ref<string | null>(null)
const transportedRoomIds = ref<Set<string>>(new Set())

function toggleTransported(id: string) {
  if (id === currentRoomId.value) return // current room is always reachable
  if (transportedRoomIds.value.has(id)) transportedRoomIds.value.delete(id)
  else transportedRoomIds.value.add(id)
  transportedRoomIds.value = new Set(transportedRoomIds.value)
}

const reachableRoomIds = computed(() => {
  const ids: string[] = []
  if (currentRoomId.value) ids.push(currentRoomId.value)
  for (const id of transportedRoomIds.value) ids.push(id)
  return ids
})

const allRoomsReachable = computed(() => reachableRoomIds.value.length === 0)

const scored = computed<ScoredSuggestion[]>(() => {
  if (!me.value) return []
  if (!me.value) return []
  return suggestBestQuestions(
    { setup: store.setup, chart: store.chart, events: store.events.slice(0, store.pointer) },
    me.value.id,
    reachableRoomIds.value,
    allRoomsReachable.value
  )
})

const topSuggestions = computed(() => scored.value.slice(0, 8))
const passTurn = computed(() => shouldPassTurn(scored.value))

function fmt(n: number): string {
  return n.toFixed(2)
}
</script>

<template>
  <div class="p-4 space-y-5 max-w-md mx-auto">
    <h1 class="text-xl font-bold">Suggest</h1>

    <!-- Room reachability -->
    <section class="space-y-2">
      <label class="text-xs uppercase text-slate-400">My current room</label>
      <select v-model="currentRoomId" class="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
        <option :value="null">— pick your room —</option>
        <option v-for="r in rooms" :key="r.id" :value="r.id">{{ r.name }}</option>
      </select>

      <div v-if="currentRoomId" class="pt-1">
        <label class="text-xs uppercase text-slate-400 block mb-1">Also transported here (by prior suggestions)</label>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="r in rooms" :key="r.id"
            v-show="r.id !== currentRoomId"
            type="button"
            class="px-2.5 py-1 rounded-full border text-xs"
            :class="transportedRoomIds.has(r.id)
              ? 'bg-sky-600 border-sky-500 text-white'
              : 'bg-slate-900 border-slate-700 text-slate-300'"
            @click="toggleTransported(r.id)"
          >{{ r.name }}</button>
        </div>
      </div>
    </section>

    <!-- Pass turn recommendation -->
    <div
      v-if="passTurn && topSuggestions.length > 0"
      class="rounded-xl bg-amber-900/30 border border-amber-600/40 p-4"
    >
      <div class="font-bold text-amber-300">Don't make a suggestion</div>
      <p class="text-xs text-slate-400 mt-1">
        No reachable question gives you a net information advantage. End your turn to deny opponents information.
      </p>
    </div>

    <!-- Top suggestions -->
    <section v-if="topSuggestions.length > 0" class="space-y-2">
      <h2 class="font-semibold text-slate-200">Best questions</h2>
      <div
        v-for="(s, i) in topSuggestions"
        :key="i"
        class="rounded-lg p-3 border"
        :class="s.recommend
          ? 'bg-emerald-900/20 border-emerald-600/40'
          : 'bg-slate-800/40 border-slate-700'"
      >
        <div class="flex items-center justify-between">
          <div class="font-semibold text-sm">
            <span v-if="s.recommend" class="text-emerald-400 mr-1">★</span>
            {{ s.suspectName }} · {{ s.weaponName }} · {{ s.roomName }}
          </div>
          <div class="text-xs text-slate-400">+{{ fmt(s.netScore) }}b</div>
        </div>

        <!-- Score bar -->
        <div class="flex gap-2 mt-2 text-[10px] text-slate-400">
          <span class="text-sky-400">you: +{{ fmt(s.ourGain) }}b</span>
          <span class="text-rose-400">leak: -{{ fmt(s.opponentLeak) }}b</span>
          <span v-if="s.resolveProb > 0" class="text-emerald-400">{{ Math.round(s.resolveProb * 100) }}% resolve</span>
        </div>

        <!-- Reasons -->
        <ul v-if="s.reasons.length" class="mt-2 space-y-0.5">
          <li v-for="(r, ri) in s.reasons" :key="ri" class="text-xs text-slate-400 flex gap-1">
            <span class="text-slate-600">•</span> {{ r }}
          </li>
        </ul>

        <!-- Outcomes -->
        <div v-if="s.outcomes.length" class="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500">
          <span v-for="(o, oi) in s.outcomes" :key="oi">
            {{ o.label }}: {{ Math.round(o.prob * 100) }}%
          </span>
        </div>
      </div>
    </section>

    <p v-else-if="!currentRoomId" class="text-sm text-slate-500">Pick your current room to get suggestions.</p>
  </div>
</template>