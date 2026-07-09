<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CellState } from '../logic/types'

const props = defineProps<{
  state: CellState
  me?: boolean
  dirty?: boolean
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
    case 'note': return props.state.ns.join(',')
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

const noteSize = computed(() => {
  if (props.state.kind !== 'note') return 'text-base'
  const len = props.state.ns.join(',').length
  if (len <= 2) return 'text-base'
  if (len <= 4) return 'text-xs'
  return 'text-[10px]'
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
    class="w-9 h-9 flex items-center justify-center font-bold select-none rounded-md border bg-slate-800/40 active:bg-slate-700 touch-none transition-colors"
    :class="[
      colorClass, noteSize,
      props.dirty ? 'border-amber-400 ring-2 ring-amber-400/50' : 'border-slate-700'
    ]"
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