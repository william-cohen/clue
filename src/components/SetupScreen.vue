<script setup lang="ts">
import { reactive, ref, computed } from 'vue'
import { useGameStore } from '../stores/game'
import { CLASSIC_EDITION } from '../logic/cards'
import type { Edition, Category } from '../logic/types'

const store = useGameStore()

// local editable edition
const edition = reactive<Edition>({
  rooms: [...CLASSIC_EDITION.rooms],
  suspects: [...CLASSIC_EDITION.suspects],
  weapons: [...CLASSIC_EDITION.weapons]
})

const playerCount = ref(4)
const playerNames = ref<string[]>(['', '', '', ''])
const meIndex = ref(0)

function syncPlayerNames() {
  const n = playerCount.value
  while (playerNames.value.length < n) playerNames.value.push('')
  playerNames.value = playerNames.value.slice(0, n)
}

function editRoom(i: number, v: string) { edition.rooms[i] = v }
function editSuspect(i: number, v: string) { edition.suspects[i] = v }
function editWeapon(i: number, v: string) { edition.weapons[i] = v }
function addRoom() { edition.rooms.push('') }
function addSuspect() { edition.suspects.push('') }
function addWeapon() { edition.weapons.push('') }
function removeRoom(i: number) { edition.rooms.splice(i, 1) }
function removeSuspect(i: number) { edition.suspects.splice(i, 1) }
function removeWeapon(i: number) { edition.weapons.splice(i, 1) }

const allCards = computed<Record<Category, string[]>>(() => ({
  room: edition.rooms.filter(Boolean),
  suspect: edition.suspects.filter(Boolean),
  weapon: edition.weapons.filter(Boolean)
}))

const hand = ref<Set<string>>(new Set())
function toggleHand(name: string) {
  if (hand.value.has(name)) hand.value.delete(name)
  else hand.value.add(name)
  hand.value = new Set(hand.value)
}

const valid = computed(() => {
  if (edition.rooms.filter(Boolean).length < 3) return false
  if (edition.suspects.filter(Boolean).length < 3) return false
  if (edition.weapons.filter(Boolean).length < 3) return false
  if (playerCount.value < 3 || playerCount.value > 6) return false
  if (playerNames.value.slice(0, playerCount.value).some((n) => !n.trim())) return false
  return true
})

function submit() {
  const clean: Edition = {
    rooms: edition.rooms.map((s) => s.trim()).filter(Boolean),
    suspects: edition.suspects.map((s) => s.trim()).filter(Boolean),
    weapons: edition.weapons.map((s) => s.trim()).filter(Boolean)
  }
  store.setEdition(clean)
  store.setPlayers(playerNames.value.slice(0, playerCount.value), meIndex.value)
  // map names → card ids via slug
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  store.setMyHand([...hand.value].map(slug))
}
</script>

<template>
  <div class="p-4 space-y-6 max-w-md mx-auto">
    <header>
      <h1 class="text-xl font-bold">New game setup</h1>
      <p class="text-xs text-slate-400">Configure cards, players and your hand.</p>
    </header>

    <!-- Cards editor -->
    <section class="space-y-3">
      <h2 class="font-semibold text-slate-200">Cards</h2>
      <details class="rounded-lg bg-slate-800/40 p-3">
        <summary class="cursor-pointer text-sm">Edit card list ({{ edition.rooms.length }}/{{ edition.suspects.length }}/{{ edition.weapons.length }})</summary>
        <div class="mt-3 space-y-4">
          <div>
            <div class="flex justify-between items-center mb-1">
              <span class="text-xs uppercase text-slate-400">Rooms</span>
              <button class="text-xs px-2 py-1 bg-slate-700 rounded" @click="addRoom">+ add</button>
            </div>
            <div v-for="(r, i) in edition.rooms" :key="i" class="flex gap-2 mb-1">
              <input :value="r" @input="editRoom(i, ($event.target as HTMLInputElement).value)"
                class="flex-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-sm" />
              <button class="text-rose-400 px-2" @click="removeRoom(i)">×</button>
            </div>
          </div>
          <div>
            <div class="flex justify-between items-center mb-1">
              <span class="text-xs uppercase text-slate-400">Suspects</span>
              <button class="text-xs px-2 py-1 bg-slate-700 rounded" @click="addSuspect">+ add</button>
            </div>
            <div v-for="(s, i) in edition.suspects" :key="i" class="flex gap-2 mb-1">
              <input :value="s" @input="editSuspect(i, ($event.target as HTMLInputElement).value)"
                class="flex-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-sm" />
              <button class="text-rose-400 px-2" @click="removeSuspect(i)">×</button>
            </div>
          </div>
          <div>
            <div class="flex justify-between items-center mb-1">
              <span class="text-xs uppercase text-slate-400">Weapons</span>
              <button class="text-xs px-2 py-1 bg-slate-700 rounded" @click="addWeapon">+ add</button>
            </div>
            <div v-for="(w, i) in edition.weapons" :key="i" class="flex gap-2 mb-1">
              <input :value="w" @input="editWeapon(i, ($event.target as HTMLInputElement).value)"
                class="flex-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-sm" />
              <button class="text-rose-400 px-2" @click="removeWeapon(i)">×</button>
            </div>
          </div>
        </div>
      </details>
    </section>

    <!-- Players -->
    <section class="space-y-3">
      <h2 class="font-semibold text-slate-200">Players</h2>
      <label class="block text-sm">Count: {{ playerCount }}
        <input type="range" min="3" max="6" v-model.number="playerCount" @input="syncPlayerNames" class="w-full" />
      </label>
      <div v-for="i in playerCount" :key="i - 1" class="flex items-center gap-2">
        <input
          v-model="playerNames[i - 1]"
          :placeholder="`Player ${i}`"
          class="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm"
        />
        <label class="flex items-center gap-1 text-xs">
          <input type="radio" :value="i - 1" v-model="meIndex" /> me
        </label>
      </div>
    </section>

    <!-- My hand -->
    <section class="space-y-2">
      <h2 class="font-semibold text-slate-200">My dealt cards</h2>
      <p class="text-xs text-slate-400">Tap the cards you were dealt.</p>
      <div v-for="cat in (['room','suspect','weapon'] as const)" :key="cat" class="space-y-1">
        <div class="text-xs uppercase text-slate-400">{{ cat }}</div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="name in allCards[cat]"
            :key="name"
            type="button"
            class="px-3 py-1 rounded-full border text-sm"
            :class="hand.has(name) ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300'"
            @click="toggleHand(name)"
          >{{ name }}</button>
        </div>
      </div>
    </section>

    <button
      type="button"
      :disabled="!valid"
      class="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-40"
      @click="submit"
    >Start game</button>
  </div>
</template>