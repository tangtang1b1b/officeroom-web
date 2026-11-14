import { describe, it, expect } from 'vitest'
import { createDog, stepDog, nudgeDog, pickTarget, DOG_RADIUS, DOG_SPEED, publicDog } from '../worker/dog.js'
import { isBlocked } from '../shared/collision.js'

// 簡單可重現的亂數
const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

describe('dog wandering', () => {
  it('starts on a free spot', () => {
    const dog = createDog(0)
    expect(isBlocked(dog.x, dog.z, DOG_RADIUS)).toBe(false)
  })

  it('idles first, then walks and actually moves', () => {
    const rand = seeded(1)
    const dog = createDog(0)
    const x0 = dog.x
    const z0 = dog.z
    let walked = false
    for (let t = 0; t < 60_000; t += 50) {
      stepDog(dog, t, 50, rand)
      if (dog.moving) walked = true
    }
    expect(walked).toBe(true)
    expect(Math.hypot(dog.x - x0, dog.z - z0)).toBeGreaterThan(0.01)
  })

  it('never ends up inside walls or furniture over a long run', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rand = seeded(seed)
      const dog = createDog(0)
      for (let t = 0; t < 10 * 60_000; t += 50) {
        stepDog(dog, t, 50, rand)
        expect(isBlocked(dog.x, dog.z, DOG_RADIUS - 0.02)).toBe(false)
      }
    }
  })

  it('never moves faster than its speed', () => {
    const rand = seeded(9)
    const dog = createDog(0)
    let px = dog.x
    let pz = dog.z
    for (let t = 0; t < 120_000; t += 50) {
      stepDog(dog, t, 50, rand)
      expect(Math.hypot(dog.x - px, dog.z - pz)).toBeLessThanOrEqual((DOG_SPEED * 50) / 1000 + 0.01)
      px = dog.x
      pz = dog.z
    }
  })

  it('picks targets that are not blocked', () => {
    const dog = createDog(0)
    for (let i = 0; i < 50; i++) {
      const t = pickTarget(dog, seeded(i + 1))
      if (t) expect(isBlocked(t.tx, t.tz, DOG_RADIUS)).toBe(false)
    }
  })

  it('public format is small and numeric', () => {
    const p = publicDog(createDog(0))
    expect(Object.keys(p).sort()).toEqual(['moving', 'yaw', 'z', 'x'].sort())
  })
})

describe('dog nudge', () => {
  it('is pushed a little along the shot direction and stops to idle', () => {
    const dog = createDog(0, { x: 4, z: 2.2 })
    dog.moving = true
    nudgeDog(dog, [0, 0, 1], 1000)
    expect(dog.z).toBeGreaterThan(2.2)
    expect(dog.z - 2.2).toBeLessThan(0.5)
    expect(dog.moving).toBe(false)
    expect(isBlocked(dog.x, dog.z, DOG_RADIUS)).toBe(false)
  })
  it('ignores a purely vertical shot', () => {
    const dog = createDog(0, { x: 4, z: 2.2 })
    nudgeDog(dog, [0, 1, 0], 0)
    expect([dog.x, dog.z]).toEqual([4, 2.2])
  })
})
