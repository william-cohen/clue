<script setup lang="ts">
import { useGameStore } from '../stores/game'
const store = useGameStore()
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
    <span class="ml-auto text-xs text-slate-500">{{ store.canUndo ? 'history' : '' }}</span>
  </div>
</template>