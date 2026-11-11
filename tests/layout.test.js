import { describe, it, expect } from 'vitest'
import { SPAWN_POINTS, CHAIRS, CRATES, COLLIDERS, DESKS, WALLS, FIXTURES, ROOM } from '../shared/layout.js'
import { isBlocked } from '../shared/collision.js'

describe('office layout', () => {
  it('spawn points are walkable', () => {
    for (const p of SPAWN_POINTS) expect(isBlocked(p.x, p.z)).toBe(false)
  })
  it('door gaps in the partition wall are walkable', () => {
    expect(isBlocked(-5.4, 3.4)).toBe(false) // 會議室門
    expect(isBlocked(3.0, 3.4)).toBe(false) // 會客室門
    expect(isBlocked(-1, 3.4)).toBe(true) // 牆面
    // 門前後兩側也可走到
    for (const x of [-5.4, 3.0]) for (const z of [2.65, 4.2]) expect(isBlocked(x, z)).toBe(false)
  })
  it('shelf aisle lets players cross the cabinet line', () => {
    for (let z = 0; z <= 2.65; z += 0.1) expect(isBlocked(0, z)).toBe(false)
  })
  it('every office desk and fixture lies inside the room', () => {
    for (const d of DESKS) {
      expect(d.x - d.w / 2).toBeGreaterThanOrEqual(ROOM.minX)
      expect(d.x + d.w / 2).toBeLessThanOrEqual(ROOM.maxX)
      expect(d.z - d.d / 2).toBeGreaterThanOrEqual(ROOM.minZ)
      expect(d.z + d.d / 2).toBeLessThanOrEqual(ROOM.maxZ)
    }
    for (const f of [...FIXTURES, ...WALLS]) {
      expect(f.x - f.w / 2).toBeGreaterThanOrEqual(ROOM.minX)
      expect(f.x + f.w / 2).toBeLessThanOrEqual(ROOM.maxX)
      expect(f.z - f.d / 2).toBeGreaterThanOrEqual(ROOM.minZ)
      expect(f.z + f.d / 2).toBeLessThanOrEqual(ROOM.maxZ)
    }
  })
  it('desks do not overlap each other', () => {
    for (let i = 0; i < DESKS.length; i++) {
      for (let j = i + 1; j < DESKS.length; j++) {
        const a = DESKS[i]
        const b = DESKS[j]
        const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2
        const overlapZ = Math.abs(a.z - b.z) < (a.d + b.d) / 2
        expect(overlapX && overlapZ, `${a.id} vs ${b.id}`).toBe(false)
      }
    }
  })
  it('chair and crate colliders do not overlap other colliders', () => {
    const ids = new Set([...CHAIRS, ...CRATES].map((o) => o.id))
    const mine = COLLIDERS.filter((b) => ids.has(b.id))
    expect(mine).toHaveLength(14)
    for (const a of mine) {
      for (const b of COLLIDERS) {
        if (a === b) continue
        const overlap = [0, 1, 2].every((i) => a.min[i] < b.max[i] && b.min[i] < a.max[i])
        expect(overlap, `${a.id} vs ${b.id}`).toBe(false)
      }
      expect(a.min[0]).toBeGreaterThanOrEqual(ROOM.minX)
      expect(a.max[0]).toBeLessThanOrEqual(ROOM.maxX)
      expect(a.min[2]).toBeGreaterThanOrEqual(ROOM.minZ)
      expect(a.max[2]).toBeLessThanOrEqual(ROOM.maxZ)
    }
  })
  it('chairs carry yaw from side; spawns are clear of chair colliders', () => {
    for (const c of CHAIRS) expect(c.yaw).toBe(c.side > 0 ? 0 : Math.PI)
    for (const p of SPAWN_POINTS) expect(isBlocked(p.x, p.z, 0.3 + 0.3)).toBe(false)
  })
  it('aisles between desk clusters are at least 1.2 m wide', () => {
    const gap = (a, b) => Math.hypot(Math.max(Math.abs(a.x - b.x) - (a.w + b.w) / 2, 0), Math.max(Math.abs(a.z - b.z) - (a.d + b.d) / 2, 0))
    const cluster = (d) => d.id.split('-')[1]
    for (let i = 0; i < DESKS.length; i++) {
      for (let j = i + 1; j < DESKS.length; j++) {
        if (cluster(DESKS[i]) === cluster(DESKS[j])) continue
        expect(gap(DESKS[i], DESKS[j]) >= 1.2, `${DESKS[i].id} vs ${DESKS[j].id}`).toBe(true)
      }
    }
  })
  it('desk clusters keep 1.2 m from the outer walls and from other furniture', () => {
    const others = [...FIXTURES, ...WALLS]
    for (const d of DESKS) {
      expect(d.x - d.w / 2 - ROOM.minX).toBeGreaterThanOrEqual(1.2)
      expect(ROOM.maxX - (d.x + d.w / 2)).toBeGreaterThanOrEqual(1.2)
      expect(d.z - d.d / 2 - ROOM.minZ).toBeGreaterThanOrEqual(1.2)
      for (const o of others) {
        const dx = Math.max(Math.abs(d.x - o.x) - (d.w + o.w) / 2, 0)
        const dz = Math.max(Math.abs(d.z - o.z) - (d.d + o.d) / 2, 0)
        expect(Math.hypot(dx, dz) >= 1.0, `${d.id} vs ${o.id}`).toBe(true)
      }
    }
  })
  it('keeps 12 chairs and 2 crates', () => {
    expect(CHAIRS).toHaveLength(12)
    expect(CRATES).toHaveLength(2)
  })
})
