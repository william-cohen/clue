<script setup lang="ts">
import { computed } from 'vue'
import type { CellState } from '../logic/types'

const props = defineProps<{
  state: CellState
  me?: boolean
}>()

const emit = defineEmits<{ (e: 'tap'): void }>()

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
</script>

<template>
  <button
    type="button"
    class="w-9 h-9 flex items-center justify-center text-base font-bold select-none rounded-md border border-slate-700 bg-slate-800/40 active:bg-slate-700"
    :class="colorClass"
    @click="emit('tap')"
  >
    {{ label }}
  </button>
</template>