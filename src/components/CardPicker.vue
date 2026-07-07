<script setup lang="ts">
import { computed } from 'vue'
import type { Category } from '../logic/types'

const props = defineProps<{
  modelValue: string | null
  category: Category
  options: string[]
  placeholder?: string
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: string | null): void }>()

const value = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})
</script>

<template>
  <select v-model="value" class="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100">
    <option :value="null">{{ placeholder ?? '— pick —' }}</option>
    <option v-for="o in options" :key="o" :value="o">{{ o }}</option>
  </select>
</template>