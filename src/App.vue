<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useGameStore } from './stores/game'
import SetupView from './views/SetupView.vue'
import PlayView from './views/PlayView.vue'

const store = useGameStore()
const phase = computed(() => store.state.phase)

onMounted(() => {
  store.load()
})
</script>

<template>
  <SetupView v-if="phase === 'setup'" />
  <PlayView v-else />
</template>