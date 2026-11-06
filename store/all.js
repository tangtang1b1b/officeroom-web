import { defineStore } from 'pinia'

export const useAllStore = defineStore('all', () =>{
  const windowWidth = ref(0)
  const allData = ref({})
  const isScroll = ref(false)
  const isLoading = ref(false)
  const tagChange = ref(false)

  return {
    windowWidth,
    allData,
    isScroll,
    isLoading,
    tagChange
  }
})
