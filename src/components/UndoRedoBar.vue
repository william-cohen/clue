<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { useGameStore } from '../stores/game'

const store = useGameStore()

const confirming = ref(false)
const secondsLeft = ref(0)
let timer: number | null = null

function startConfirm() {
  confirming.value = true
  secondsLeft.value = 3
  if (timer != null) clearInterval(timer)
  timer = window.setInterval(() => {
    secondsLeft.value--
    if (secondsLeft.value <= 0) {
      cancelConfirm()
    }
  }, 1000)
}

function cancelConfirm() {
  confirming.value = false
  secondsLeft.value = 0
  if (timer != null) {
    clearInterval(timer)
    timer = null
  }
}

function reset() {
  if (confirming.value) {
    cancelConfirm()
    store.resetAll()
  } else {
    startConfirm()
  }
}

onBeforeUnmount(() => {
  if (timer != null) clearInterval(timer)
})
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
      class="ml-auto px-3 py-2 rounded-lg text-sm font-medium transition-colors"
      :class="confirming
        ? 'bg-rose-600 text-white animate-pulse'
        : 'bg-rose-600/80 text-white'"
      @click="reset"
    >{{ confirming ? `Confirm? (${secondsLeft})` : 'Reset' }}</button>
  </div>
</template>