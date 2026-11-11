import { defineStore } from 'pinia'

const MAX_CHAT = 100

export const useAllStore = defineStore('all', () =>{
  const windowWidth = ref(0)
  const allData = ref({})
  const isScroll = ref(false)
  const isLoading = ref(false)
  const tagChange = ref(false)

  // 虛擬辦公室:連線狀態、玩家名單、聊天紀錄(高頻的位置資料不放這裡)
  const netStatus = ref('idle') // idle | connecting | online | reconnecting | full | failed
  const myId = ref('')
  const roster = ref([]) // [{ id, name, color }]
  const chat = ref([]) // [{ key, from, text, system }]
  let chatKey = 0

  const pushChat = (from, text, system = false) => {
    chat.value.push({ key: ++chatKey, from, text, system })
    if (chat.value.length > MAX_CHAT) chat.value.splice(0, chat.value.length - MAX_CHAT)
  }
  const resetOffice = () => {
    netStatus.value = 'idle'
    myId.value = ''
    roster.value = []
    chat.value = []
  }

  return {
    windowWidth,
    allData,
    isScroll,
    isLoading,
    tagChange,
    netStatus,
    myId,
    roster,
    chat,
    pushChat,
    resetOffice,
  }
})
