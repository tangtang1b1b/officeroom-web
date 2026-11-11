<script setup>
const nickname = ref('')
const joined = ref(false)

const join = () => {
  if (!nickname.value.trim()) return
  nickname.value = nickname.value.trim().slice(0, 16)
  joined.value = true
}
</script>

<template>
  <OfficeScene v-if="joined" :nickname="nickname" />
  <div v-else class="flex min-h-screen items-center justify-center bg-neutral-100">
    <form class="flex w-72 flex-col gap-3 rounded bg-white p-6 shadow" @submit.prevent="join">
      <h1 class="text-lg font-bold">虛擬辦公室</h1>
      <input
        v-model="nickname"
        maxlength="16"
        placeholder="輸入暱稱"
        class="rounded border border-neutral-300 px-3 py-2"
        autofocus
      />
      <button type="submit" class="rounded bg-yellow-400 px-3 py-2 font-bold">進入辦公室</button>
    </form>
  </div>
</template>
