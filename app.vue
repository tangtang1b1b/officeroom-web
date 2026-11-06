<script setup>
import 'virtual:svg-icons-register'

// 頁面轉場白色遮罩
const isPageTransitioning = ref(false)
const nuxtApp = useNuxtApp()
const router = useRouter()
const TRANSITION_DURATION = 500

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const waitFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

const resetScrollPosition = () => {
  if (!import.meta.client) return

  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
  window.scrollTo(0, 0)
  nuxtApp.$lenis?.scrollTo(0, { immediate: true, force: true })
}

const refreshScrollTrigger = async () => {
  if (!import.meta.client) return

  await nextTick()
  await waitFrame()
  await waitFrame()
  resetScrollPosition()
  nuxtApp.$ScrollTrigger?.refresh(true)
}

// 先讓白色遮罩完全蓋住畫面，再回頂並放行換頁
router.beforeEach(async (to, from) => {
  if (to.path === from.path) {
    return true
  }

  isPageTransitioning.value = true
  nuxtApp.$lenis?.stop()
  await nextTick()
  await wait(TRANSITION_DURATION)
  resetScrollPosition()

  return true
})

// 監聽頁面轉場鉤子
nuxtApp.hook('page:finish', async () => {
  await refreshScrollTrigger()
  nuxtApp.$lenis?.start()
  await wait(TRANSITION_DURATION)
  isPageTransitioning.value = false
})
</script>

<template>
  <div>
    <NuxtLoadingIndicator />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <!-- 頁面轉場白色遮罩 -->
    <div
      class="ease-in-out pointer-events-none fixed inset-0 z-[9999] bg-white transition-opacity duration-500"
      :class="{ 'opacity-100': isPageTransitioning, 'opacity-0': !isPageTransitioning }"
    ></div>
  </div>
</template>

<style>
/* .page-enter-active,
.page-leave-active {
  transition: opacity 0.3s ease-in-out;
}
.page-enter-from,
.page-leave-to {
  opacity: 0;
} */
</style>
