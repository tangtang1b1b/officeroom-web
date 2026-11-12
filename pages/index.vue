<script setup>
import { SEATS } from '~/shared/layout.js'

const GUEST = '__guest__'
const STORAGE_KEY = 'office-last-seat'

// 選單:有名字的座位 + 訪客(自己打名字)
const people = SEATS.filter((seat) => seat.name)
const choice = ref(people[0]?.id ?? GUEST)
const guestName = ref('')
const joined = ref(false)
const nickname = ref('')
const seatId = ref('')
const config = useRuntimeConfig()

// 目前上班中(被占用)的座位;定時向 Worker 查詢,查不到就當全部可選(伺服器仍會擋)
const taken = ref(new Set())
const seatsUrl = () => {
  const ws = config.public.WS_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
  return ws.replace(/^ws/, 'http').replace(/\/ws$/, '/seats')
}
const refreshSeats = async () => {
  try {
    const res = await fetch(seatsUrl(), { cache: 'no-store' })
    if (!res.ok) return
    taken.value = new Set((await res.json()).seats || [])
    // 目前選的人剛好被占用 → 換到第一個空的
    if (taken.value.has(choice.value)) choice.value = people.find((p) => !taken.value.has(p.id))?.id ?? GUEST
  } catch {
    // 忽略
  }
}
let seatsTimer = null

// 只支援電腦(需要鍵盤與滑鼠鎖定視角):手機/平板(UA 或主要輸入為觸控)顯示提示
const isDesktop = ref(null)
const detectDesktop = () => {
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle/i.test(navigator.userAgent)
  // iPadOS 的 UA 偽裝成 Mac,改用觸控點數判斷
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  const touchPrimary = window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches
  return !(mobileUA || iPadOS || touchPrimary)
}

onMounted(() => {
  isDesktop.value = detectDesktop()
  if (!isDesktop.value) return
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && (saved === GUEST || people.some((p) => p.id === saved))) choice.value = saved
  } catch {
    // 無痕模式等情況讀不到,維持預設
  }
  refreshSeats()
  seatsTimer = setInterval(refreshSeats, 5000)
})
onBeforeUnmount(() => clearInterval(seatsTimer))

const isGuest = computed(() => choice.value === GUEST)
const choiceTaken = computed(() => !isGuest.value && taken.value.has(choice.value))

const join = () => {
  if (isGuest.value) {
    const name = guestName.value.trim().slice(0, 16)
    if (!name) return
    nickname.value = name
    seatId.value = ''
  } else {
    const seat = people.find((p) => p.id === choice.value)
    if (!seat || taken.value.has(seat.id)) return
    nickname.value = seat.name
    seatId.value = seat.id
  }
  try {
    localStorage.setItem(STORAGE_KEY, choice.value)
  } catch {
    // 忽略
  }
  joined.value = true
}
</script>

<template>
  <div v-if="isDesktop === false" class="flex min-h-screen flex-col items-center justify-center gap-2 bg-neutral-100 p-6 text-center">
    <h1 class="text-lg font-bold">虛擬辦公室</h1>
    <p class="text-base text-neutral-700">請使用電腦開啟</p>
    <p class="text-xs text-neutral-500">需要鍵盤與滑鼠操作,手機與平板暫不支援。</p>
  </div>
  <OfficeScene v-else-if="joined" :nickname="nickname" :seat-id="seatId" @logout="joined = false" />
  <div v-else class="flex min-h-screen items-center justify-center bg-neutral-100">
    <form class="flex w-72 flex-col gap-3 rounded bg-white p-6 shadow" @submit.prevent="join">
      <h1 class="text-lg font-bold">虛擬辦公室</h1>
      <label class="flex flex-col gap-1 text-sm text-neutral-600">
        你是誰
        <select v-model="choice" class="rounded border border-neutral-300 px-3 py-2 text-base text-black">
          <option v-for="person in people" :key="person.id" :value="person.id" :disabled="taken.has(person.id)">
            {{ person.name }}{{ taken.has(person.id) ? '(上班中)' : '' }}
          </option>
          <option :value="GUEST">訪客(自己輸入名字)</option>
        </select>
      </label>
      <input
        v-if="isGuest"
        v-model="guestName"
        maxlength="16"
        placeholder="輸入暱稱"
        class="rounded border border-neutral-300 px-3 py-2"
        autofocus
      />
      <p v-else class="text-xs text-neutral-500">進入後會站在你的位子旁;你離線時,位子上會坐著你的人偶。</p>
      <button type="submit" :disabled="choiceTaken" class="rounded bg-yellow-400 px-3 py-2 font-bold disabled:opacity-50">進入辦公室</button>
    </form>
  </div>
</template>
