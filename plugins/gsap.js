import { defineNuxtPlugin } from '#app'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

const registerEffects = () => {
  gsap.registerEffect(fadeIn)
  gsap.registerEffect(fadeOut)
  gsap.registerEffect(aosFadeIn)
  gsap.registerEffect(marquee)
}

export default defineNuxtPlugin((nuxtApp) => {
  gsap.registerPlugin(ScrollTrigger)
  registerEffects()

  nuxtApp.provide('gsap', gsap)
  nuxtApp.provide('ScrollTrigger', ScrollTrigger)
})
