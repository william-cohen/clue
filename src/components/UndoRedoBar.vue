<script setup lang="ts">
import { useGameStore } from '../stores/game'
const store = useGameStore()

function reset() {
  if (confirm('Reset everything? This clears the current game and returns to setup. Undo can bring it back.')) {
    store.resetAll()
  }
}
</script>

<template>
  <div class="flex items-center gap-2">
    <button
      type="button"
      class="px-3 py-2 rounded-lg bg-slate-700 text-slate-100 text-sm font-medium disabled:opacity-40"
      :disabled="!store.canUndo"
      @click="store.undo()"
    >↶ Undo</button>
    <button
      type="button"
      class="px-3 py-2 rounded-lg bg-slate-700 text-slate-100 text-sm font-medium disabled:opacity-40"
      :disabled="!store.canRedo"
      @click="store.redo()"
    >↷ Redo</button>
    <button
      type="button"
      class="ml-auto px-3 py-2 rounded-lg bg-rose-600/80 text-white text-sm font-medium"
      @click="reset"
    >Reset</button>
  </div>
</template>