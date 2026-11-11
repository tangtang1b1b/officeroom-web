<script setup>
const props = defineProps({
  messages: { type: Array, default: () => [] },
})
const emit = defineEmits(['send', 'close'])

const isOpen = ref(false)
const text = ref('')
const input = ref(null)
const list = ref(null)

const visible = computed(() => props.messages.slice(-8))

const open = async () => {
  isOpen.value = true
  document.exitPointerLock?.()
  await nextTick()
  input.value?.focus()
}
const close = () => {
  isOpen.value = false
  text.value = ''
  emit('close')
}
const submit = () => {
  const value = text.value.trim()
  if (value) emit('send', value.slice(0, 200))
  close()
}

const onKeydown = (event) => {
  if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return
  if (isOpen.value) return
  event.preventDefault()
  open()
}

watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    if (list.value) list.value.scrollTop = list.value.scrollHeight
  },
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

defineExpose({ open, isOpen })
</script>

<template>
  <div class="pointer-events-none absolute bottom-4 left-4 w-80 text-sm text-white">
    <div ref="list" class="mb-2 max-h-48 space-y-1 overflow-hidden">
      <p
        v-for="message in visible"
        :key="message.key"
        class="rounded bg-black/45 px-2 py-1"
        :class="message.system ? 'text-white/60' : ''"
      >
        <span v-if="!message.system" class="font-bold text-yellow-300">{{ message.from }}</span>
        <span v-if="!message.system">:</span>
        {{ message.text }}
      </p>
    </div>
    <form v-if="isOpen" class="pointer-events-auto" @submit.prevent="submit">
      <input
        ref="input"
        v-model="text"
        maxlength="200"
        placeholder="輸入訊息,Enter 送出,Esc 取消"
        class="w-full rounded bg-black/70 px-2 py-1 text-white outline-none ring-1 ring-yellow-300"
        @keydown.esc.prevent="close"
        @blur="isOpen && close()"
      />
    </form>
    <p v-else class="text-xs text-white/60">按 Enter 聊天</p>
  </div>
</template>
