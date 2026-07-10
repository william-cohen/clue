<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CellState } from '../logic/types'

const props = defineProps<{
  state: CellState
  me?: boolean
  dirty?: boolean
  prob?: number
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

// Heat tint: only for uncertain cells (empty/note). Ticks and crosses are certain.
// Cold-to-warm scientific gradient: blue (low) → cyan → green → yellow → red (high).
const heatStops = [
  { t: 0.00, r:  30, g:   0, b: 140 }, // deep blue
  { t: 0.25, r:   0, g: 120, b: 200 }, // cyan-blue
  { t: 0.50, r:  20, g: 180, b: 100 }, // green
  { t: 0.75, r: 230, g: 160, b:  30 }, // yellow-orange
  { t: 1.00, r: 200, g:  30, b:  30 }, // red
]

function heatColor(p: number): string {
  const clamped = Math.max(0, Math.min(1, p))
  for (let i = 0; i < heatStops.length - 1; i++) {
    const a = heatStops[i]
    const b = heatStops[i + 1]
    if (clamped >= a.t && clamped <= b.t) {
      const f = (clamped - a.t) / (b.t - a.t)
      const r = Math.round(a.r + f * (b.r - a.r))
      const g = Math.round(a.g + f * (b.g - a.g))
      const bl = Math.round(a.b + f * (b.b - a.b))
      // opacity scales with probability, capped at 0.4
      const opacity = Math.min(0.4, 0.08 + clamped * 0.4)
      return `background: rgba(${r}, ${g}, ${bl}, ${opacity})`
    }
  }
  return ''
}

const heatStyle = computed(() => {
  if (props.state.kind === 'tick' || props.state.kind === 'cross') return ''
  const p = props.prob ?? 0
  if (p <= 0) return ''
  return heatColor(p)
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
    :style="heatStyle"
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