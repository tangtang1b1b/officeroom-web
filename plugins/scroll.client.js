import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from '@studio-freight/lenis'

export default defineNuxtPlugin((nuxtApp) => {
  const lenis = new Lenis()

  lenis.on('scroll', ScrollTrigger.update)

  gsap.ticker.add((time) => {
    lenis.raf(time * 1000)
  })
  gsap.ticker.lagSmoothing(0)

  // 頁面渲染完成後重新計算 ScrollTrigger；回頂時機由 app.vue 的遮罩流程控制
  nuxtApp.hook('page:finish', () => {
    requestAnimationFrame(() => {
      ScrollTrigger.refresh(true)
    })
  })

  return {
    provide: {
      lenis,
    },
  }
})
