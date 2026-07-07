<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CellState } from '../logic/types'

const props = defineProps<{
  state: CellState
  me?: boolean
}>()

const emit = defineEmits<{
  (e: 'tap'): void
  (e: 'longpress', payload: { x: number; y: number }): void
}>()

const label = computed(() => {
  switch (props.state.kind) {
    case 'empty': return ''
    case 'cross': return '×'
    case 'tick': return '✓'
    case 'note': return String(props.state.n)
  }
})

const colorClass = computed(() => {
  switch (props.state.kind) {
    case 'empty': return 'text-slate-500'
    case 'cross': return 'text-rose-500'
    case 'tick': return 'text-emerald-500'
    case 'note': return 'text-sky-400'
  }
})

const pressTimer = ref<number | null>(null)
const longPressed = ref(false)
const PRESS_MS = 450

function startPress(e: PointerEvent) {
  longPressed.value = false
  const x = e.clientX
  const y = e.clientY
  pressTimer.value = window.setTimeout(() => {
    longPressed.value = true
    emit('longpress', { x, y })
  }, PRESS_MS)
}

function endPress() {
  if (pressTimer.value != null) {
    clearTimeout(pressTimer.value)
    pressTimer.value = null
  }
}

function onClick() {
  if (longPressed.value) {
    longPressed.value = false
    return
  }
  emit('tap')
}
</script>

<template>
  <button
    type="button"
    class="w-9 h-9 flex items-center justify-center text-base font-bold select-none rounded-md border border-slate-700 bg-slate-800/40 active:bg-slate-700 touch-none"
    :class="colorClass"
    @pointerdown="startPress"
    @pointerup="endPress"
    @pointerleave="endPress"
    @pointercancel="endPress"
    @contextmenu.prevent
    @click="onClick"
  >
    {{ label }}
  </button>
</template>