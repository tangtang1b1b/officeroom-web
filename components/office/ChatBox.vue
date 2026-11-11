<script setup>
const props = defineProps({
  messages: { type: Array, default: () => [] },
  roster: { type: Array, default: () => [] },
  myId: { type: [String, Number], default: null },
})
const emit = defineEmits(['send', 'close'])

const isOpen = ref(false)
const text = ref('')
const input = ref(null)
const list = ref(null)

const recent = computed(() => props.messages.slice(-4))
const colorCss = (color) => (typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : color)

const scrollBottom = async () => {
  await nextTick()
  if (list.value) list.value.scrollTop = list.value.scrollHeight
}

const open = async () => {
  isOpen.value = true
  document.exitPointerLock?.()
  await nextTick()
  input.value?.focus()
  scrollBottom()
}
const close = () => {
  if (!isOpen.value) return
  isOpen.value = false
  text.value = ''
  emit('close')
}
const submit = () => {
  const value = text.value.trim()
  if (!value) {
    close() // 輸入框空白時再按 Enter:關閉聊天,回到準心
    return
  }
  emit('send', value.slice(0, 200))
  text.value = ''
  scrollBottom()
}

const onKeydown = (event) => {
  if (event.isComposing) return // 注音/輸入法選字中的 Esc、Enter 不處理
  if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return
  if (isOpen.value) return
  event.preventDefault()
  open()
}

watch(() => props.messages.length, scrollBottom)

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

defineExpose({ open, close, isOpen })
</script>

<template>
  <!-- 面板收起時:左下角顯示最近幾則訊息 -->
  <div v-if="!isOpen" class="pointer-events-none absolute bottom-16 left-4 w-80 space-y-1 text-sm text-white">
    <p
      v-for="message in recent"
      :key="message.key"
      class="rounded-lg bg-black/45 px-2 py-1"
      :class="message.system ? 'text-white/60' : ''"
    >
      <span v-if="!message.system" class="font-bold text-yellow-300">{{ message.from }}:</span>
      {{ message.text }}
    </p>
  </div>

  <!-- 右側面板:線上名單與聊天室 -->
  <aside
    v-if="isOpen"
    class="pointer-events-auto absolute bottom-20 right-4 top-20 flex w-80 flex-col overflow-hidden rounded-2xl bg-white/95 text-sm text-neutral-800 shadow-xl backdrop-blur"
  >
    <header class="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
      <div>
        <p class="font-bold">辦公室聊天室</p>
        <p class="text-xs text-neutral-500">線上 {{ roster.length }} / 10</p>
      </div>
      <button class="rounded-full px-2 py-1 text-lg leading-none text-neutral-500 hover:bg-neutral-100" title="關閉" @click="close">
        ×
      </button>
    </header>

    <ul class="flex flex-wrap gap-1.5 border-b border-neutral-200 px-4 py-2">
      <li
        v-for="player in roster"
        :key="player.id"
        class="flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-xs"
      >
        <span class="inline-block h-2 w-2 rounded-full" :style="{ background: colorCss(player.color) }"></span>
        {{ player.name }}<span v-if="player.id === myId" class="text-neutral-400">(你)</span>
      </li>
    </ul>

    <div ref="list" class="flex-1 space-y-2 overflow-y-auto px-4 py-3">
      <p
        v-for="message in messages"
        :key="message.key"
        class="rounded-lg px-3 py-2"
        :class="message.system ? 'bg-transparent text-center text-xs text-neutral-400' : 'bg-neutral-100'"
      >
        <span v-if="!message.system" class="mr-1 font-bold text-amber-600">{{ message.from }}</span>
        {{ message.text }}
      </p>
    </div>

    <form class="flex gap-2 border-t border-neutral-200 p-3" @submit.prevent="submit">
      <input
        ref="input"
        v-model="text"
        maxlength="200"
        placeholder="輸入訊息,Enter 送出;空白時按 Enter 關閉"
        class="min-w-0 flex-1 rounded-lg bg-neutral-100 px-3 py-2 outline-none focus:ring-2 focus:ring-yellow-400"
      />
      <button type="submit" class="rounded-lg bg-yellow-400 px-4 font-bold text-black">送出</button>
    </form>
  </aside>
</template>
