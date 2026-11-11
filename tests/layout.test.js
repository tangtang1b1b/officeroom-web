import { describe, it, expect } from 'vitest'
import { PLAYER, SEATS, SPAWN_POINTS, CHAIRS, COLLIDERS, DESKS, WALLS, FIXTURES, ROOM, footprint, minZAt, clusterGroup } from '../shared/layout.js'
import { isBlocked } from '../shared/collision.js'

describe('office layout', () => {
  it('spawn points are walkable', () => {
    for (const p of SPAWN_POINTS) expect(isBlocked(p.x, p.z)).toBe(false)
  })
  it('door gaps in the partition wall are walkable', () => {
    expect(isBlocked(-7.8, 3.4)).toBe(false) // 會議室門
    expect(isBlocked(0.5, 3.4)).toBe(false) // 會客室門
    expect(isBlocked(-1, 3.4)).toBe(true) // 牆面
    for (const x of [-7.8, 0.5]) for (const z of [2.65, 4.2]) expect(isBlocked(x, z)).toBe(false)
  })
  it('glass door leaf is solid but the doorway stays open', () => {
    expect(isBlocked(-8.38, 4.0)).toBe(true) // 門扇
    for (const z of [2.65, 3.4, 4.2]) expect(isBlocked(-7.7, z)).toBe(false)
  })
  it('has a single chest-height cabinet and three big lounge chairs on its wall side', () => {
    const shelves = FIXTURES.filter((x) => x.kind === 'shelf')
    expect(shelves).toHaveLength(1)
    expect(shelves[0].h).toBeLessThanOrEqual(1.3)
    const lounge = FIXTURES.filter((x) => x.kind === 'loungechair')
    expect(lounge).toHaveLength(3)
    for (const l of lounge) {
      expect(l.w).toBeGreaterThanOrEqual(1.0)
      expect(l.z).toBeGreaterThan(shelves[0].z + 1.0) // 在書櫃另一側,不與書櫃相連
      expect(l.z).toBeLessThan(3.2)
    }
  })
  it('desks and chairs stay clear of the slanted wall', () => {
    for (const d of [...DESKS, ...CHAIRS]) {
      const f = footprint(d, d.w, d.d)
      for (const x of [d.x - f.w / 2, d.x + f.w / 2]) expect(d.z - f.d / 2 - minZAt(x)).toBeGreaterThan(0.5)
    }
  })
  it('has 10 seats pointing at real desks and chairs, 7 named', () => {
    expect(SEATS).toHaveLength(10)
    for (const seat of SEATS) {
      expect(DESKS.some((d) => d.id === seat.deskId)).toBe(true)
      expect(CHAIRS.some((c) => c.id === seat.chairId)).toBe(true)
    }
    expect(SEATS.filter((s) => s.name)).toHaveLength(7)
  })
  it('every office desk and fixture lies inside the room', () => {
    for (const d of DESKS) {
      const f = footprint(d, d.w, d.d)
      expect(d.x - f.w / 2).toBeGreaterThanOrEqual(ROOM.minX)
      expect(d.x + f.w / 2).toBeLessThanOrEqual(ROOM.maxX)
      expect(d.z - f.d / 2).toBeGreaterThanOrEqual(ROOM.minZ)
      expect(d.z + f.d / 2).toBeLessThanOrEqual(ROOM.maxZ)
    }
    for (const f of [...FIXTURES, ...WALLS]) {
      const fp = footprint(f, f.w, f.d)
      expect(f.x - fp.w / 2).toBeGreaterThanOrEqual(ROOM.minX)
      expect(f.x + fp.w / 2).toBeLessThanOrEqual(ROOM.maxX)
      expect(f.z - fp.d / 2).toBeGreaterThanOrEqual(ROOM.minZ)
      expect(f.z + fp.d / 2).toBeLessThanOrEqual(ROOM.maxZ)
    }
  })
  it('desks do not overlap each other', () => {
    for (let i = 0; i < DESKS.length; i++) {
      for (let j = i + 1; j < DESKS.length; j++) {
        const a = DESKS[i]
        const b = DESKS[j]
        const fa = footprint(a, a.w, a.d)
        const fb = footprint(b, b.w, b.d)
        const overlapX = Math.abs(a.x - b.x) < (fa.w + fb.w) / 2
        const overlapZ = Math.abs(a.z - b.z) < (fa.d + fb.d) / 2
        expect(overlapX && overlapZ, `${a.id} vs ${b.id}`).toBe(false)
      }
    }
  })
  it('chair and crate colliders do not overlap other colliders', () => {
    const ids = new Set(CHAIRS.map((o) => o.id))
    const mine = COLLIDERS.filter((b) => ids.has(b.id))
    expect(mine).toHaveLength(10)
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
    for (const c of CHAIRS.filter((x) => x.id.startsWith('chair-') && /\d/.test(x.id))) expect(c.yaw).toBe(c.side > 0 ? 0 : Math.PI)
    for (const p of SPAWN_POINTS) expect(isBlocked(p.x, p.z, PLAYER.radius + 0.3)).toBe(false)
  })
  it('aisles between desk clusters are at least 1.2 m wide', () => {
    const gap = (a, b) => {
      const fa = footprint(a, a.w, a.d)
      const fb = footprint(b, b.w, b.d)
      return Math.hypot(Math.max(Math.abs(a.x - b.x) - (fa.w + fb.w) / 2, 0), Math.max(Math.abs(a.z - b.z) - (fa.d + fb.d) / 2, 0))
    }
    const cluster = (d) => clusterGroup(d.id) // 同組內首尾相接的桌子不檢查通道寬度;Will、Yuhua 視為同一排
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
      const f = footprint(d, d.w, d.d)
      expect(d.x - f.w / 2 - ROOM.minX).toBeGreaterThanOrEqual(1.2)
      expect(ROOM.maxX - (d.x + f.w / 2)).toBeGreaterThanOrEqual(1.2)
      expect(d.z - f.d / 2 - ROOM.minZ).toBeGreaterThanOrEqual(1.2)
      for (const o of others) {
        const fo = footprint(o, o.w, o.d)
        const dx = Math.max(Math.abs(d.x - o.x) - (f.w + fo.w) / 2, 0)
        const dz = Math.max(Math.abs(d.z - o.z) - (f.d + fo.d) / 2, 0)
        expect(Math.hypot(dx, dz) >= (o.id === 'wall-f' ? 0.4 : 1.0), `${d.id} vs ${o.id}`).toBe(true) // wall-f 刻意貼近 Will 的桌子,只留一點空位
      }
    }
  })
  it('keeps 10 chairs', () => {
    expect(CHAIRS).toHaveLength(10)
  })
})

describe('circle movement', () => {
  it('slides along the slanted wall instead of sticking', async () => {
    const { moveCircle } = await import('../shared/collision.js')
    // 貼著斜牆往 -x 走(牆往 +z 抬高),同時往牆的方向擠
    let p = { x: 3, z: minZAt(3) + 0.3 }
    for (let i = 0; i < 80; i++) p = moveCircle(p.x, p.z, -0.05, -0.02)
    expect(p.x).toBeLessThan(0) // 往前走了 4m 左右而沒有卡住
    expect(isBlocked(p.x, p.z)).toBe(false)
  })
  it('slides around a box corner and never ends up inside', async () => {
    const { moveCircle } = await import('../shared/collision.js')
    const shelf = FIXTURES.find((f) => f.id === 'shelf-a')
    let p = { x: shelf.x + shelf.w / 2 + 1, z: shelf.z }
    for (let i = 0; i < 60; i++) {
      p = moveCircle(p.x, p.z, -0.05, 0.03)
      expect(isBlocked(p.x, p.z, PLAYER.radius - 0.01)).toBe(false)
    }
  })
  it('random walks never penetrate colliders', async () => {
    const { moveCircle } = await import('../shared/collision.js')
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5
    for (const start of SPAWN_POINTS) {
      let p = { ...start }
      for (let i = 0; i < 400; i++) {
        p = moveCircle(p.x, p.z, rnd() * 0.16, rnd() * 0.16)
        expect(isBlocked(p.x, p.z, PLAYER.radius - 0.01)).toBe(false)
      }
    }
  })
})
