<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGameStore } from '../stores/game'
import DetectiveGrid from '../components/DetectiveGrid.vue'
import TurnEntry from '../components/TurnEntry.vue'
import SuggestView from '../components/SuggestView.vue'
import UndoRedoBar from '../components/UndoRedoBar.vue'

const store = useGameStore()
const tab = ref<'turn' | 'grid' | 'log' | 'suggest'>('turn')

const suggestionEvents = computed(() => store.suggestionEvents)
const manualEvents = computed(() => store.manualEvents)
const playerById = computed(() => {
  const m: Record<string, string> = {}
  for (const p of store.players) m[p.id] = p.name
  return m
})
const cardName = computed(() => {
  const m: Record<string, string> = {}
  for (const c of store.cards) m[c.id] = c.name
  return m
})

function stateLabel(kind: string, ns?: number[]): string {
  switch (kind) {
    case 'cross': return '×'
    case 'tick': return '✓'
    case 'note': return ns ? `note ${ns.join(',')}` : 'note'
    default: return ''
  }
}
</script>

<template>
  <div class="min-h-screen pb-24">
    <!-- Tabs -->
    <nav class="sticky top-0 z-30 bg-slate-900/95 backdrop-blur border-b border-slate-800">
      <div class="flex max-w-md mx-auto">
        <button
          v-for="t in (['turn','grid','log','suggest'] as const)" :key="t"
          class="flex-1 py-3 text-sm font-medium"
          :class="tab === t ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-slate-400'"
          @click="tab = t"
        >{{ t === 'turn' ? 'New Turn' : t === 'suggest' ? 'Suggest' : t === 'grid' ? 'Sheet' : 'Log' }}</button>
      </div>
    </nav>

    <main class="max-w-md mx-auto">
      <TurnEntry v-if="tab === 'turn'" />
      <DetectiveGrid v-else-if="tab === 'grid'" />
      <SuggestView v-else-if="tab === 'suggest'" />
      <section v-else class="p-4 space-y-4">
        <h1 class="text-xl font-bold">Log</h1>

        <!-- Suggestions -->
        <div>
          <h2 class="text-sm font-semibold text-slate-300 mb-2">Suggestions</h2>
          <div v-if="suggestionEvents.length === 0" class="text-sm text-slate-500">No suggestions recorded yet.</div>
          <ol class="space-y-2">
            <li
              v-for="(t, i) in suggestionEvents" :key="t.id"
              class="rounded-lg bg-slate-800/40 p-3 text-sm"
            >
              <div class="font-semibold">#{{ i + 1 }} — {{ playerById[t.askerId] }} asked</div>
              <div class="text-slate-300">
                {{ cardName[t.suggestion.suspect] }} / {{ cardName[t.suggestion.weapon] }} / {{ cardName[t.suggestion.room] }}
              </div>
              <div class="text-xs text-slate-400 mt-1">
                <span v-for="r in t.responses" :key="r.responderId" class="mr-2">
                  {{ playerById[r.responderId] }}:
                  {{ r.skipped ? 'skip' : (r.passed ? 'pass' : (r.shownCardId ? `show ${cardName[r.shownCardId]}` : 'show')) }}
                </span>
              </div>
            </li>
          </ol>
          <button
            v-if="suggestionEvents.length"
            class="mt-3 px-3 py-2 rounded-lg bg-slate-700 text-sm"
            @click="store.removeLastSuggestion()"
          >Remove last suggestion</button>
        </div>

        <!-- Manual entries -->
        <div>
          <h2 class="text-sm font-semibold text-slate-300 mb-2">Manual entries</h2>
          <div v-if="manualEvents.length === 0" class="text-sm text-slate-500">No manual entries.</div>
          <ul class="space-y-1.5">
            <li
              v-for="e in manualEvents" :key="e.id"
              class="flex items-start gap-2 rounded-lg bg-slate-800/40 p-2.5 text-sm"
            >
              <span class="text-slate-300 flex-1">
                <span v-for="(en, i) in e.entries" :key="i" class="inline-block mr-1">
                  <span class="font-medium">{{ cardName[en.cardId] }}</span>
                  <span class="text-slate-500"> · {{ playerById[en.playerId] }}</span>
                  <span class="ml-1.5" :class="{
                    'text-rose-400': en.state.kind === 'cross',
                    'text-emerald-400': en.state.kind === 'tick',
                    'text-sky-400': en.state.kind === 'note'
                  }">{{ stateLabel(en.state.kind, en.state.kind === 'note' ? en.state.ns : undefined) }}</span>
                  <span v-if="i < e.entries.length - 1" class="text-slate-600">,</span>
                </span>
                <span v-if="e.description" class="block text-xs text-slate-500 mt-0.5">{{ e.description }}</span>
              </span>
              <button
                class="text-rose-400 text-xs px-2 py-1"
                @click="store.removeEvent(e.id)"
              >Delete</button>
            </li>
          </ul>
        </div>
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