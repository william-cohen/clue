<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  x: number
  y: number
  max: number
}>()

const emit = defineEmits<{
  (e: 'pick', n: number): void
  (e: 'clear'): void
  (e: 'close'): void
}>()

const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9]

const style = computed(() => {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400
  const left = Math.min(props.x, vw - 200)
  const top = Math.max(8, props.y - 120)
  return { left: `${left}px`, top: `${top}px` }
})
</script>

<template>
  <div
    class="fixed z-50 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-2"
    :style="style"
    @pointerdown.stop
    @click.stop
  >
    <div class="grid grid-cols-3 gap-1 mb-2">
      <button
        v-for="n in nums.slice(0, max)" :key="n"
        type="button"
        class="w-11 h-11 rounded-lg bg-slate-700 text-slate-100 font-bold text-sm active:bg-sky-600"
        @click="emit('pick', n)"
      >{{ n }}</button>
    </div>
    <div class="flex gap-1">
      <button
        type="button"
        class="flex-1 py-1.5 rounded-lg bg-slate-700 text-xs text-slate-300"
        @click="emit('clear')"
      >Clear</button>
      <button
        type="button"
        class="flex-1 py-1.5 rounded-lg bg-slate-700 text-xs text-slate-300"
        @click="emit('close')"
      >Close</button>
    </div>
  </div>
</template>