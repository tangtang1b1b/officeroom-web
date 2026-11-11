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

onMounted(() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && (saved === GUEST || people.some((p) => p.id === saved))) choice.value = saved
  } catch {
    // 無痕模式等情況讀不到,維持預設
  }
})

const isGuest = computed(() => choice.value === GUEST)

const join = () => {
  if (isGuest.value) {
    const name = guestName.value.trim().slice(0, 16)
    if (!name) return
    nickname.value = name
    seatId.value = ''
  } else {
    const seat = people.find((p) => p.id === choice.value)
    if (!seat) return
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
  <OfficeScene v-if="joined" :nickname="nickname" :seat-id="seatId" @logout="joined = false" />
  <div v-else class="flex min-h-screen items-center justify-center bg-neutral-100">
    <form class="flex w-72 flex-col gap-3 rounded bg-white p-6 shadow" @submit.prevent="join">
      <h1 class="text-lg font-bold">虛擬辦公室</h1>
      <label class="flex flex-col gap-1 text-sm text-neutral-600">
        你是誰
        <select v-model="choice" class="rounded border border-neutral-300 px-3 py-2 text-base text-black">
          <option v-for="person in people" :key="person.id" :value="person.id">{{ person.name }}</option>
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
      <button type="submit" class="rounded bg-yellow-400 px-3 py-2 font-bold">進入辦公室</button>
    </form>
  </div>
</template>
