import { describe, it, expect } from 'vitest'
import {
  createObjects,
  stepObjects,
  applyImpulse,
  tickStanding,
  pushOutByPlayer,
  pushObjectsAround,
  MAX_OBJECT_SPEED,
  objectBox,
  resetObjects,
  publicObject,
} from '../shared/physics.js'
import { raycastWorld } from '../shared/raycast.js'
import { DYNAMIC_DEFS, COLLIDERS, ROOM, PLAYER } from '../shared/layout.js'

const mk = (over = {}) => ({
  id: 't',
  kind: 'chair',
  x: 0,
  z: 0,
  yaw: 0,
  radius: 0.3,
  height: 1.25,
  mass: 1,
  canFall: true,
  ...over,
})
const run = (objs, seconds, statics = [], dt = 0.05) => {
  for (let t = 0; t < seconds; t += dt) stepObjects(objs, dt, statics, ROOM)
}
const rng = () => 0.1

describe('DYNAMIC_DEFS', () => {
  it('has 12 chairs and 2 crates with expected fields', () => {
    expect(DYNAMIC_DEFS.filter((d) => d.kind === 'chair')).toHaveLength(12)
    expect(DYNAMIC_DEFS.filter((d) => d.kind === 'crate')).toHaveLength(2)
    for (const d of DYNAMIC_DEFS) {
      for (const k of ['id', 'kind', 'x', 'z', 'yaw', 'radius', 'height', 'mass', 'canFall']) expect(d).toHaveProperty(k)
    }
    expect(DYNAMIC_DEFS.filter((d) => d.kind === 'crate').every((d) => !d.canFall)).toBe(true)
  })
  it('chair yaw follows side', () => {
    expect(DYNAMIC_DEFS.find((d) => d.id === 'chair-0-1').yaw).toBe(0)
    expect(DYNAMIC_DEFS.find((d) => d.id === 'chair-0--1').yaw).toBe(Math.PI)
  })
  it('initial positions do not overlap each other, statics or walls', () => {
    for (const d of DYNAMIC_DEFS) {
      expect(d.x - d.radius).toBeGreaterThanOrEqual(ROOM.minX)
      expect(d.x + d.radius).toBeLessThanOrEqual(ROOM.maxX)
      expect(d.z - d.radius).toBeGreaterThanOrEqual(ROOM.minZ)
      expect(d.z + d.radius).toBeLessThanOrEqual(ROOM.maxZ)
      for (const box of COLLIDERS) {
        const nx = Math.max(box.min[0], Math.min(d.x, box.max[0]))
        const nz = Math.max(box.min[2], Math.min(d.z, box.max[2]))
        expect(Math.hypot(d.x - nx, d.z - nz)).toBeGreaterThanOrEqual(d.radius)
      }
    }
    for (let i = 0; i < DYNAMIC_DEFS.length; i++) {
      for (let j = i + 1; j < DYNAMIC_DEFS.length; j++) {
        const a = DYNAMIC_DEFS[i]
        const b = DYNAMIC_DEFS[j]
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(a.radius + b.radius)
      }
    }
  })
  it('COLLIDERS contains only fixed items', () => {
    expect(COLLIDERS.some((b) => /^(chair|crate)/.test(b.id))).toBe(false)
  })
})

describe('stepObjects', () => {
  it('sleeping objects with no input are not broadcast', () => {
    const objs = createObjects([mk()])
    expect(stepObjects(objs, 0.05, [], ROOM).size).toBe(0)
  })
  it('friction stops a sliding object and it falls asleep (still broadcast on that step)', () => {
    const objs = createObjects([mk()])
    applyImpulse(objs[0], [1, 0, 0], 1.5, 0, rng)
    objs[0].w = 0
    expect(stepObjects(objs, 0.05, [], ROOM).has('t')).toBe(true)
    let sleepStep = null
    for (let i = 0; i < 100 && !sleepStep; i++) {
      const ids = stepObjects(objs, 0.05, [], ROOM)
      if (objs[0].sleeping) sleepStep = ids
    }
    expect(objs[0].sleeping).toBe(true)
    expect(sleepStep.has('t')).toBe(true)
    expect(objs[0].x).toBeGreaterThan(0.1)
    expect(objs[0].x).toBeLessThan(1)
    expect(stepObjects(objs, 0.05, [], ROOM).size).toBe(0)
  })
  it('is clamped by room walls', () => {
    const objs = createObjects([mk({ x: ROOM.maxX - 1 })])
    applyImpulse(objs[0], [1, 0, 0], 8, 0, rng)
    run(objs, 3)
    expect(objs[0].x).toBeLessThanOrEqual(ROOM.maxX - 0.3 + 1e-9)
    objs[0].x = 0
    applyImpulse(objs[0], [0, 0, -1], 30, 0, rng)
    run(objs, 3)
    expect(objs[0].z).toBeGreaterThanOrEqual(ROOM.minZ + 0.3 - 1e-9)
  })
  it('bounces off fixed boxes without penetrating', () => {
    const wall = { id: 'w', min: [1, 0, -1], max: [1.5, 1, 1] }
    const objs = createObjects([mk()])
    applyImpulse(objs[0], [1, 0, 0], 6, 0, rng)
    let maxX = -Infinity
    let bounced = false
    for (let i = 0; i < 100; i++) {
      stepObjects(objs, 0.05, [wall], ROOM)
      maxX = Math.max(maxX, objs[0].x)
      if (objs[0].vx < 0) bounced = true
    }
    expect(maxX).toBeLessThanOrEqual(1 - 0.3 + 1e-6)
    expect(bounced).toBe(true)
  })
  it('overlapping objects are pushed apart', () => {
    const objs = createObjects([mk({ id: 'a', x: 0 }), mk({ id: 'b', x: 0.4 })])
    objs[0].sleeping = false
    run(objs, 1)
    expect(Math.hypot(objs[0].x - objs[1].x, objs[0].z - objs[1].z)).toBeGreaterThanOrEqual(0.6 - 1e-6)
  })
  it('a moving object transfers momentum to a sleeping one', () => {
    const objs = createObjects([mk({ id: 'a', x: 0 }), mk({ id: 'b', x: 1.0 })])
    applyImpulse(objs[0], [1, 0, 0], 3, 0, rng)
    run(objs, 0.5)
    expect(objs[1].x).toBeGreaterThan(1.0)
    expect(objs[1].sleeping).toBe(false)
  })
  it('heavier objects move less when pushed apart', () => {
    const objs = createObjects([mk({ id: 'a', x: 0, mass: 1 }), mk({ id: 'b', x: 0.4, mass: 3 })])
    objs[0].sleeping = false
    run(objs, 0.1)
    expect(Math.abs(objs[0].x)).toBeGreaterThan(Math.abs(objs[1].x - 0.4))
  })
})

describe('applyImpulse / tickStanding', () => {
  it('knocks a chair down (>= 2 m/s) but not a crate', () => {
    const [chair, crate] = createObjects([mk({ id: 'c' }), mk({ id: 'k', kind: 'crate', mass: 1.5, canFall: false })])
    applyImpulse(chair, [1, 0, 0], 2.5, 1000, rng)
    applyImpulse(crate, [1, 0, 0], 2.5, 1000, rng)
    expect(chair.state).toBe('down')
    expect(chair.downUntil).toBe(16000)
    expect(crate.state).toBe('up')
    expect(crate.vx).toBeCloseTo(2.5 / 1.5, 5)
    expect(chair.sleeping).toBe(false)
  })
  it('weak impulse does not knock down', () => {
    const [chair] = createObjects([mk()])
    applyImpulse(chair, [0, 0, 1], 1.0, 0, rng)
    expect(chair.state).toBe('up')
    expect(chair.vz).toBeCloseTo(1, 5)
    expect(chair.w).not.toBe(0)
  })
  it('stands back up after 15 s and the change is broadcast', () => {
    const objs = createObjects([mk()])
    applyImpulse(objs[0], [1, 0, 0], 2.5, 1000, rng)
    run(objs, 3) // 滑停睡著
    expect(objs[0].sleeping).toBe(true)
    expect(tickStanding(objs, 15999).size).toBe(0)
    expect(objs[0].state).toBe('down')
    expect(tickStanding(objs, 16000).has('t')).toBe(true)
    expect(objs[0].state).toBe('up')
    expect(stepObjects(objs, 0.05, [], ROOM).has('t')).toBe(true)
    expect(stepObjects(objs, 0.05, [], ROOM).size).toBe(0)
  })
})

describe('speed cap and impulse scaling', () => {
  it('10 stacked impulses never exceed MAX_OBJECT_SPEED', () => {
    const [o] = createObjects([mk()])
    for (let i = 0; i < 10; i++) {
      applyImpulse(o, [1, 0, 0], 5, 0, rng)
      expect(Math.hypot(o.vx, o.vz)).toBeLessThanOrEqual(MAX_OBJECT_SPEED + 1e-9)
    }
    expect(Math.hypot(o.vx, o.vz)).toBeCloseTo(MAX_OBJECT_SPEED, 9)
  })
  it('fast objects do not tunnel through a desk', () => {
    const desk = { id: 'd', min: [1, 0, -1], max: [1.3, 0.75, 1] }
    for (const dt of [0.05, 0.2]) {
      const objs = createObjects([mk()])
      for (let i = 0; i < 10; i++) applyImpulse(objs[0], [1, 0, 0], 5, 0, rng)
      for (let i = 0; i < 200; i++) {
        stepObjects(objs, dt, [desk], ROOM)
        expect(objs[0].x).toBeLessThanOrEqual(1 - 0.3 + 1e-6)
      }
    }
  })
  it('horizontal impulse scales with the horizontal component of dir', () => {
    const [a, b] = createObjects([mk({ id: 'a' }), mk({ id: 'b' })])
    applyImpulse(a, [0.1, -0.995, 0], 1.6, 0, rng)
    expect(Math.hypot(a.vx, a.vz)).toBeCloseTo(0.16, 5)
    applyImpulse(b, [3, 0, 0], 1.6, 0, rng) // 非單位向量也不超過 speed
    expect(b.vx).toBeCloseTo(1.6, 5)
  })
  it('1.6 m/s single shot does not knock down, rapid second hit does; re-hit does not extend downUntil', () => {
    const [c] = createObjects([mk()])
    applyImpulse(c, [1, 0, 0], 1.6, 1000, rng)
    expect(c.state).toBe('up')
    applyImpulse(c, [1, 0, 0], 1.6, 1100, rng)
    expect(c.state).toBe('down')
    expect(c.downUntil).toBe(16100)
    applyImpulse(c, [1, 0, 0], 1.6, 9000, rng)
    expect(c.downUntil).toBe(16100)
  })
  it('circle centre inside a box is pushed out along the shallowest axis', () => {
    const wall = { id: 'w', min: [0, 0, -5], max: [0.2, 1, 5] }
    const objs = createObjects([mk({ x: 0.15 })])
    objs[0].sleeping = false
    stepObjects(objs, 0.05, [wall], ROOM)
    expect(objs[0].x).toBeGreaterThanOrEqual(0.2 + 0.3 - 1e-6)
    expect(Math.abs(objs[0].z)).toBeLessThan(1e-6)
  })
})

describe('pushOutByPlayer extras', () => {
  it('keeps existing velocity and adds the player normal component, capped', () => {
    const obj = createObjects([mk({ x: 0.4 })])[0]
    obj.vx = 1
    obj.vz = 0.5
    pushOutByPlayer(obj, [0, 0, 0], [2, 0], [], ROOM, [])
    expect(obj.vx).toBeCloseTo(3, 5)
    expect(obj.vz).toBeCloseTo(0.5, 5)
    const o2 = createObjects([mk({ x: 0.4 })])[0]
    o2.vx = 7
    pushOutByPlayer(o2, [0, 0, 0], [3, 0], [], ROOM, [])
    expect(Math.hypot(o2.vx, o2.vz)).toBeLessThanOrEqual(MAX_OBJECT_SPEED + 1e-9)
  })
  it('lets a trapped player move away (not deeper) even when the object cannot be pushed', () => {
    // 椅子在牆角:右側有牆,玩家在其左側重疊
    const wall = { id: 'w', min: [0.5, 0, -1], max: [1, 1, 1] }
    const mkChair = () => createObjects([mk({ x: 0.2 })])[0]
    // 往外走(遠離)
    const a = mkChair()
    expect(pushOutByPlayer(a, [-0.1, 0, 0], [-1, 0], [wall], ROOM, [], [0, 0, 0])).toBe(true)
    expect(a.x).toBe(0.2)
    // 更深入(靠近)且推不動 -> 拒絕
    const b = mkChair()
    expect(pushOutByPlayer(b, [0.1, 0, 0], [1, 0], [wall], ROOM, [], [0, 0, 0])).toBe(false)
    // 原本沒重疊,新位置重疊且推不動 -> 拒絕
    const c = mkChair()
    expect(pushOutByPlayer(c, [-0.3, 0, 0], [1, 0], [wall], ROOM, [], [-0.9, 0, 0])).toBe(false)
  })
})

describe('pushObjectsAround rollback', () => {
  it('restores already-pushed objects when a later one cannot be pushed', () => {
    const wall = { id: 'w', min: [-0.3, 0, 0.8], max: [0.3, 1, 2] }
    const a = mk({ id: 'a', x: 0.4, z: 0 })
    const b = mk({ id: 'b', x: 0, z: 0.5 }) // 推向 +z 會撞牆
    const objs = createObjects([a, b])
    const res = pushObjectsAround(objs, [0, 0, 0], [1, 1], [-0.5, 0, 0], [wall], ROOM)
    expect(res.ok).toBe(false)
    expect(res.moved).toEqual([])
    expect(objs[0].x).toBe(0.4)
    expect(objs[0].vx).toBe(0)
    expect(objs[0].sleeping).toBe(true)
    expect(objs[1].z).toBe(0.5)
  })
  it('reports moved ids on success', () => {
    const objs = createObjects([mk({ id: 'a', x: 0.4 }), mk({ id: 'far', x: 5 })])
    const res = pushObjectsAround(objs, [0, 0, 0], [2, 0], [-0.1, 0, 0], [], ROOM)
    expect(res).toEqual({ ok: true, moved: ['a'] })
  })
})

describe('pushOutByPlayer', () => {
  it('pushes an overlapping object out along the normal with player speed', () => {
    const obj = createObjects([mk({ x: 0.4 })])[0]
    expect(pushOutByPlayer(obj, [0, 0, 0], [2, 0], [], ROOM, [])).toBe(true)
    expect(obj.x).toBeGreaterThanOrEqual(PLAYER.radius + obj.radius)
    expect(obj.vx).toBeCloseTo(2, 5)
    expect(obj.sleeping).toBe(false)
  })
  it('caps push speed at 3 m/s', () => {
    const obj = createObjects([mk({ x: 0.4 })])[0]
    pushOutByPlayer(obj, [0, 0, 0], [10, 0], [], ROOM, [])
    expect(obj.vx).toBeCloseTo(3, 5)
  })
  it('does nothing when not overlapping', () => {
    const obj = createObjects([mk({ x: 2 })])[0]
    expect(pushOutByPlayer(obj, [0, 0, 0], [2, 0], [], ROOM, [])).toBe(true)
    expect(obj.x).toBe(2)
    expect(obj.sleeping).toBe(true)
  })
  it('returns false and leaves the object untouched when pinned against a wall', () => {
    const obj = createObjects([mk({ x: ROOM.maxX - 0.3 })])[0]
    expect(pushOutByPlayer(obj, [ROOM.maxX - 0.7, 0, 0], [1, 0], [], ROOM, [])).toBe(false)
    expect(obj.x).toBeCloseTo(ROOM.maxX - 0.3, 9)
    expect(obj.sleeping).toBe(true)
  })
  it('returns false when blocked by a fixed box or another object', () => {
    const wall = { id: 'w', min: [0.5, 0, -1], max: [1, 1, 1] }
    const a = createObjects([mk({ x: 0.4 })])[0]
    expect(pushOutByPlayer(a, [0, 0, 0], [1, 0], [wall], ROOM, [])).toBe(false)
    const b = createObjects([mk({ x: 0.4 })])[0]
    expect(pushOutByPlayer(b, [0, 0, 0], [1, 0], [], ROOM, [mk({ id: 'o', x: 0.9 })])).toBe(false)
  })
})

describe('down chair ray hitbox', () => {
  it('a ray at the side of a fallen chair (outside radius, inside radius+0.3) hits it', () => {
    const [o] = createObjects([mk()])
    const ray = () => raycastWorld([0.45, 0.2, 2], [0, 0, -1], { objects: [o], boxes: [], maxDist: 20 })
    expect(ray().kind).toBe('wall')
    o.state = 'down'
    const hit = ray()
    expect(hit && hit.kind).toBe('object')
  })
})

describe('helpers', () => {
  it('objectBox uses footprint and state height', () => {
    const [o] = createObjects([mk({ x: 1, z: 2 })])
    const box = objectBox(o)
    expect(box.id).toBe('t')
    expect(box.min).toEqual([0.7, 0, 1.7])
    expect(box.max[1]).toBe(1.25)
    o.state = 'down'
    expect(objectBox(o).max[1]).toBeCloseTo(0.5, 9)
    expect(objectBox(o).min[0]).toBeCloseTo(1 - 0.6, 9)
    expect(objectBox(o).max[2]).toBeCloseTo(2 + 0.6, 9)
  })
  it('resetObjects restores initial state', () => {
    const objs = createObjects(DYNAMIC_DEFS)
    applyImpulse(objs[0], [1, 0, 0], 3, 0, rng)
    run(objs, 1)
    resetObjects(objs, DYNAMIC_DEFS)
    expect(objs[0].x).toBe(DYNAMIC_DEFS[0].x)
    expect(objs[0].state).toBe('up')
    expect(objs[0].sleeping).toBe(true)
  })
  it('publicObject has contract shape and rounds to 3 decimals', () => {
    const [o] = createObjects([mk({ x: 1.23456, z: -2.34567, yaw: 0.98765 })])
    expect(publicObject(o)).toEqual({ id: 't', x: 1.235, z: -2.346, yaw: 0.988, state: 'up' })
  })
  it('full layout: shaken objects never end up inside fixed boxes', () => {
    const objs = createObjects(DYNAMIC_DEFS)
    objs.forEach((o, i) => applyImpulse(o, [Math.cos(i), 0, Math.sin(i)], 4, 0, rng))
    run(objs, 5, COLLIDERS)
    for (const o of objs) {
      for (const box of COLLIDERS) {
        const nx = Math.max(box.min[0], Math.min(o.x, box.max[0]))
        const nz = Math.max(box.min[2], Math.min(o.z, box.max[2]))
        expect(Math.hypot(o.x - nx, o.z - nz)).toBeGreaterThanOrEqual(o.radius - 1e-6)
      }
    }
  })
})
