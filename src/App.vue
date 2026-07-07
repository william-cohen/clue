<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useGameStore } from './stores/game'
import SetupView from './views/SetupView.vue'
import PlayView from './views/PlayView.vue'

const store = useGameStore()
const phase = computed(() => store.state.phase)
const gameId = ref(0)

onMounted(() => {
  store.load()
})

// Bump gameId whenever phase flips so the view fully remounts with fresh local state.
watch(phase, () => { gameId.value++ })
</script>

<template>
  <SetupView v-if="phase === 'setup'" :key="`setup-${gameId}`" />
  <PlayView v-else :key="`play-${gameId}`" />
</template>