<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGameStore } from '../stores/game'
import { byCategory } from '../logic/cards'
import type { Response, Suggestion } from '../logic/types'

const store = useGameStore()
const state = computed(() => store.state)

const askerId = ref<string>(state.value.players[0]?.id ?? '')
const suspectName = ref<string | null>(null)
const weaponName = ref<string | null>(null)
const roomName = ref<string | null>(null)

const cards = computed(() => byCategory(state.value.cards))
const roomNames = computed(() => cards.value.room.map((c) => c.name))
const suspectNames = computed(() => cards.value.suspect.map((c) => c.name))
const weaponNames = computed(() => cards.value.weapon.map((c) => c.name))

const playerById = computed(() => {
  const m: Record<string, { id: string; name: string; isMe: boolean }> = {}
  for (const p of state.value.players) m[p.id] = p
  return m
})

// responders are players in seat order starting after the asker, until someone shows.
const seatOrder = computed(() => state.value.players.map((p) => p.id))
const responders = computed(() => {
  const ids = seatOrder.value
  const idx = ids.indexOf(askerId.value)
  if (idx < 0) return []
  const out: { id: string; name: string; isMe: boolean }[] = []
  for (let i = 1; i <= ids.length - 1; i++) {
    const pid = ids[(idx + i) % ids.length]
    const p = playerById.value[pid]
    out.push({ id: pid, name: p.name, isMe: p.isMe })
  }
  return out
})

const responses = ref<Record<string, 'pending' | 'pass' | 'show'>>({})

function resetForm() {
  suspectName.value = null
  weaponName.value = null
  roomName.value = null
  responses.value = {}
}

function setResponse(id: string, v: 'pass' | 'show') {
  responses.value[id] = v
  if (v === 'show') {
    // lock later responders as not asked.
    const order = responders.value.map((r) => r.id)
    const idx = order.indexOf(id)
    for (const laterId of order.slice(idx + 1)) {
      if (!(laterId in responses.value) || responses.value[laterId] === 'pending') {
        responses.value[laterId] = 'pending'
      }
    }
  }
}

const responderStatus = computed(() => {
  return responders.value.map((r) => ({
    ...r,
    status: responses.value[r.id] ?? 'pending',
    reached: isReached(r.id)
  }))
})

function isReached(id: string): boolean {
  const order = responders.value.map((r) => r.id)
  for (const pid of order) {
    const s = responses.value[pid] ?? 'pending'
    if (pid === id) return true
    if (s === 'show') return false
    if (s === 'pending') return false
  }
  return false
}

const firstShower = computed<string | null>(() => {
  const order = responders.value.map((r) => r.id)
  for (const pid of order) {
    if (responses.value[pid] === 'show') return pid
  }
  return null
})
void firstShower

const allReachedResolved = computed(() => {
  const order = responders.value.map((r) => r.id)
  let resolved = false
  for (const pid of order) {
    const s = responses.value[pid] ?? 'pending'
    if (s === 'show') { resolved = true; break }
    if (s === 'pending') return false
  }
  if (!resolved) return false
  return true
})
void allReachedResolved

// Whether the form has a complete, coherent set of responses (someone showed OR everyone passed).
const canSubmitStrict = computed(() => {
  if (!askerId.value) return false
  if (!suspectName.value || !weaponName.value || !roomName.value) return false
  // Build the actual reached list: every responder until & including a shower must have a non-pending state.
  const order = responders.value.map((r) => r.id)
  let sawShow = false
  for (const pid of order) {
    const s = responses.value[pid] ?? 'pending'
    if (s === 'pending') {
      // not reached yet → invalid unless we've already seen a show
      if (sawShow) break
      return false
    }
    if (s === 'show') { sawShow = true; break }
  }
  return true
})

function submit() {
  if (!canSubmitStrict.value) return
  const order = responders.value.map((r) => r.id)
  const rs: Response[] = []
  for (const pid of order) {
    const s = responses.value[pid] ?? 'pending'
    if (s === 'pending') break
    rs.push({ responderId: pid, passed: s === 'pass' })
    if (s === 'show') break
  }
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const sugg: Suggestion = {
    suspect: slug(suspectName.value!),
    weapon: slug(weaponName.value!),
    room: slug(roomName.value!)
  }
  store.addTurn(askerId.value, sugg, rs)
  resetForm()
}

function meLabel(r: { isMe: boolean }): string {
  return r.isMe ? ' (me)' : ''
}
</script>

<template>
  <div class="p-4 space-y-5 max-w-md mx-auto">
    <h1 class="text-xl font-bold">New turn</h1>

    <section class="space-y-2">
      <label class="text-xs uppercase text-slate-400">Asker</label>
      <select v-model="askerId" class="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
        <option v-for="p in state.players" :key="p.id" :value="p.id">{{ p.name }}{{ p.isMe ? ' (me)' : '' }}</option>
      </select>
    </section>

    <section class="space-y-2">
      <label class="text-xs uppercase text-slate-400">Suggestion</label>
      <div class="grid grid-cols-1 gap-2">
        <select v-model="suspectName" class="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
          <option :value="null">— suspect —</option>
          <option v-for="n in suspectNames" :key="n" :value="n">{{ n }}</option>
        </select>
        <select v-model="weaponName" class="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
          <option :value="null">— weapon —</option>
          <option v-for="n in weaponNames" :key="n" :value="n">{{ n }}</option>
        </select>
        <select v-model="roomName" class="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
          <option :value="null">— room —</option>
          <option v-for="n in roomNames" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>
    </section>

    <section class="space-y-2">
      <label class="text-xs uppercase text-slate-400">Responses (in turn order)</label>
      <div class="space-y-2">
        <div
          v-for="r in responderStatus"
          :key="r.id"
          class="flex items-center justify-between gap-2 rounded-lg bg-slate-800/40 px-3 py-2"
          :class="{ 'opacity-40': !r.reached }"
        >
          <span class="text-sm">{{ r.name }}{{ meLabel(r) }}</span>
          <div class="flex gap-1" v-if="r.reached">
            <button
              type="button"
              class="px-3 py-1 rounded-md text-xs font-semibold"
              :class="r.status === 'pass' ? 'bg-rose-600 text-white' : 'bg-slate-700 text-slate-300'"
              @click="setResponse(r.id, 'pass')"
            >Nothing</button>
            <button
              type="button"
              class="px-3 py-1 rounded-md text-xs font-semibold"
              :class="r.status === 'show' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'"
              @click="setResponse(r.id, 'show')"
            >Show</button>
          </div>
          <span v-else class="text-xs text-slate-500">—</span>
        </div>
      </div>
    </section>

    <button
      type="button"
      :disabled="!canSubmitStrict"
      class="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-40"
      @click="submit"
    >Record turn</button>
  </div>
</template>