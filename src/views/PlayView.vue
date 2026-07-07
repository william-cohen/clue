<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGameStore } from '../stores/game'
import DetectiveGrid from '../components/DetectiveGrid.vue'
import TurnEntry from '../components/TurnEntry.vue'
import UndoRedoBar from '../components/UndoRedoBar.vue'

const store = useGameStore()
const tab = ref<'grid' | 'turn' | 'log'>('turn')

const turns = computed(() => store.state.turns)
const playerById = computed(() => {
  const m: Record<string, string> = {}
  for (const p of store.state.players) m[p.id] = p.name
  return m
})
const cardName = computed(() => {
  const m: Record<string, string> = {}
  for (const c of store.state.cards) m[c.id] = c.name
  return m
})
</script>

<template>
  <div class="min-h-screen pb-24">
    <!-- Tabs -->
    <nav class="sticky top-0 z-30 bg-slate-900/95 backdrop-blur border-b border-slate-800">
      <div class="flex max-w-md mx-auto">
        <button
          v-for="t in (['turn','grid','log'] as const)" :key="t"
          class="flex-1 py-3 text-sm font-medium"
          :class="tab === t ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-slate-400'"
          @click="tab = t"
        >{{ t === 'turn' ? 'New Turn' : t === 'grid' ? 'Sheet' : 'Log' }}</button>
      </div>
    </nav>

    <main class="max-w-md mx-auto">
      <TurnEntry v-if="tab === 'turn'" />
      <DetectiveGrid v-else-if="tab === 'grid'" />
      <section v-else class="p-4 space-y-2">
        <h1 class="text-xl font-bold mb-2">Turn log</h1>
        <div v-if="turns.length === 0" class="text-sm text-slate-500">No turns recorded yet.</div>
        <ol class="space-y-2">
          <li
            v-for="(t, i) in turns" :key="t.id"
            class="rounded-lg bg-slate-800/40 p-3 text-sm"
          >
            <div class="font-semibold">#{{ i + 1 }} — {{ playerById[t.askerId] }} asked</div>
            <div class="text-slate-300">
              {{ cardName[t.suggestion.suspect] }} / {{ cardName[t.suggestion.weapon] }} / {{ cardName[t.suggestion.room] }}
            </div>
            <div class="text-xs text-slate-400 mt-1">
              <span v-for="r in t.responses" :key="r.responderId" class="mr-2">
                {{ playerById[r.responderId] }}: {{ r.passed ? 'pass' : 'show' }}
              </span>
              <span v-if="t.groupNumber !== null" class="text-sky-400">→ group #{{ t.groupNumber }}</span>
            </div>
          </li>
        </ol>
        <button
          v-if="turns.length"
          class="mt-4 px-3 py-2 rounded-lg bg-slate-700 text-sm"
          @click="store.removeLastTurn()"
        >Remove last turn</button>
      </section>
    </main>

    <!-- Bottom bar -->
    <div class="fixed bottom-0 inset-x-0 z-30 bg-slate-900/95 backdrop-blur border-t border-slate-800">
      <div class="max-w-md mx-auto p-3">
        <UndoRedoBar />
      </div>
    </div>
  </div>
</template>